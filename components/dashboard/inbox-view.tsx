"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConversationFeed, type ScoreFilter } from "./conversation-feed";
import { ActionStation } from "./action-station";
import { CrmDrawer } from "./crm-drawer";
import { 
  getConversationsCursor, 
  getConversation, 
  type ConversationData,
  type Channel,
  type ConversationsCursorOptions 
} from "@/actions/lead-actions";
import { getSmsCampaignFilters } from "@/actions/sms-campaign-actions";
import { syncAllConversations, enqueueConversationSync, reanalyzeLeadSentiment } from "@/actions/message-actions";
import { getAutoFollowUpsOnReply, setAutoFollowUpsOnReply } from "@/actions/settings-actions";
import { subscribeToLeads, unsubscribe } from "@/lib/supabase";
import { Loader2, Wifi, WifiOff, Inbox, RefreshCw, FilterX } from "lucide-react";
import { type Conversation, type Lead } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import Link from "next/link";

interface InboxViewProps {
  isActive?: boolean;
  activeChannels: Channel[];
  activeFilter: string;
  activeWorkspace: string | null;
  workspacesReady?: boolean;
  hasWorkspaces?: boolean;
  workspaceHasConnectedAccounts?: boolean;
  initialConversationId?: string | null;
  initialCrmOpen?: boolean;
  onLeadSelect?: (leadId: string | null) => void;
  onClearFilters?: () => void;
}

// Polling interval in milliseconds (60 seconds)
const POLLING_INTERVAL = 60000;
// Keep a slower heartbeat when realtime is connected.
const REALTIME_HEARTBEAT_INTERVAL = 60000;
const EMPTY_SMS_CLIENT_OPTIONS: Array<{ id: string; name: string; leadCount: number }> = [];

// Extended Conversation type with sentimentTag
type ConversationWithSentiment = Conversation & { 
  sentimentTag?: string | null;
};

// Convert DB conversation to component format
function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function convertToComponentFormat(conv: ConversationData): ConversationWithSentiment {
  return {
    id: conv.id,
    lead: {
      id: conv.lead.id,
      name: conv.lead.name,
      firstName: conv.lead.firstName ?? null,
      lastName: conv.lead.lastName ?? null,
      email: conv.lead.email || "",
      alternateEmails: conv.lead.alternateEmails ?? [],
      currentReplierEmail: conv.lead.currentReplierEmail ?? null,
      currentReplierName: conv.lead.currentReplierName ?? null,
      currentReplierSince: toDateOrNull(conv.lead.currentReplierSince),
      phone: conv.lead.phone || "",
      company: conv.lead.company,
      title: conv.lead.title || "",
      website: conv.lead.companyWebsite || "",
      timezone: "",
      leadScore: 50,
      autoReplyEnabled: conv.lead.autoReplyEnabled,
      autoFollowUpEnabled: conv.lead.autoFollowUpEnabled,
      clientId: conv.lead.clientId,
      smsCampaignId: conv.lead.smsCampaignId,
      smsCampaignName: conv.lead.smsCampaignName,
      smsDndActive: conv.lead.smsDndActive,
      status: conv.lead.status as Lead["status"],
      qualification: {
        budget: false,
        authority: false,
        need: false,
        timing: false,
      },
      // Enrichment data
      linkedinUrl: conv.lead.linkedinUrl,
      companyName: conv.lead.companyName,
      companyWebsite: conv.lead.companyWebsite,
      companyState: conv.lead.companyState,
      emailBisonLeadId: conv.lead.emailBisonLeadId,
      enrichmentStatus: conv.lead.enrichmentStatus,
      followUpBlockedReason: conv.lead.followUpBlockedReason ?? null,
      autoBookMeetingsEnabled: conv.lead.autoBookMeetingsEnabled,
      // GHL integration data
      ghlContactId: conv.lead.ghlContactId,
      ghlLocationId: conv.lead.ghlLocationId,
      // Sentiment tag (from conversation level)
      sentimentTag: conv.sentimentTag,
      // Lead scoring (Phase 33)
      overallScore: conv.lead.overallScore,
      scoredAt: toDateOrNull(conv.lead.scoredAt),
      // Lead assignment (Phase 43)
      assignedToUserId: conv.lead.assignedToUserId,
      assignedToEmail: conv.lead.assignedToEmail,
      assignedAt: toDateOrNull(conv.lead.assignedAt),
    },
    channels: conv.channels,
    availableChannels: conv.availableChannels,
    primaryChannel: conv.primaryChannel,
    platform: conv.primaryChannel, // For backward compatibility
    classification: (conv.sentimentTag?.toLowerCase().replace(/\s+/g, "-") || conv.classification) as Conversation["classification"],
    lastMessage: conv.lastMessage,
    lastSubject: conv.lastSubject,
    lastMessageTime: new Date(conv.lastMessageTime),
    messages: [],
    hasAiDraft: conv.hasAiDraft,
    requiresAttention: conv.requiresAttention,
    sentimentTag: conv.sentimentTag, // Keep original sentiment tag for filtering
  };
}

export function InboxView({
  isActive = true,
  activeChannels,
  activeFilter,
  activeWorkspace,
  workspacesReady = true,
  hasWorkspaces = true,
  workspaceHasConnectedAccounts = false,
  initialConversationId,
  initialCrmOpen,
  onLeadSelect,
  onClearFilters,
}: InboxViewProps) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => initialConversationId ?? null);
  const queryClient = useQueryClient();
  const leadLastMessageAtRef = useRef<Map<string, number>>(new Map());
  const workspaceLastMessageAtRef = useRef<number>(0);

  // Wrapper to update both local state and notify parent
  const handleLeadSelect = useCallback((leadId: string | null) => {
    setActiveConversationId(leadId);
    onLeadSelect?.(leadId);
  }, [onLeadSelect]);
  
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [isCrmOpen, setIsCrmOpen] = useState<boolean>(() => Boolean(initialCrmOpen));
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [activeSentiments, setActiveSentiments] = useState<string[]>([]);
  const [activeSmsClient, setActiveSmsClient] = useState<string>("all");
  const [activeScoreFilter, setActiveScoreFilter] = useState<ScoreFilter>("all");
  const [newConversationCount, setNewConversationCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isPageVisible, setIsPageVisible] = useState<boolean>(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  });
  
  // Sync state management - track which leads are currently syncing
  const [syncingLeadIds, setSyncingLeadIds] = useState<Set<string>>(new Set());
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [syncAllCursor, setSyncAllCursor] = useState<number | null>(null);
  const [reanalyzingLeadId, setReanalyzingLeadId] = useState<string | null>(null);
  const [isReanalyzingAllSentiments, setIsReanalyzingAllSentiments] = useState(false);
  const [autoFollowUpsOnReplyEnabled, setAutoFollowUpsOnReplyEnabled] = useState(false);
  const [isTogglingAutoFollowUpsOnReply, setIsTogglingAutoFollowUpsOnReply] = useState(false);
  
  // Delayed loading state - only show spinner after 300ms to avoid flicker on fast loads
  const [showDelayedSpinner, setShowDelayedSpinner] = useState(false);
  
  const realtimeConnectedRef = useRef(false);
  const prevConversationIdRef = useRef<string | null>(null);
  const lastAutoSyncRef = useRef<Map<string, number>>(new Map());
  const activeConversationRequestRef = useRef(0);
  const activeConversationLastFetchedAtRef = useRef<Map<string, number>>(new Map());
  const activeConversationListTimestampRef = useRef<number>(0);
  const conversationsByIdRef = useRef<Map<string, ConversationWithSentiment>>(new Map());

  // Reset SMS sub-client and score filters when switching workspaces
  useEffect(() => {
    setActiveSmsClient((previous) => (previous === "all" ? previous : "all"));
    setActiveScoreFilter((previous) => (previous === "all" ? previous : "all"));
  }, [activeWorkspace]);

  // Reset selection when switching workspaces to avoid showing a lead from another workspace.
  // Intentionally scoped to workspace transitions only.
  useEffect(() => {
    // If the inbox was opened via deep-link (e.g. Slack "Edit in dashboard"),
    // keep that lead selected when the workspace auto-switches.
    const nextConversationId = initialConversationId ?? null;
    setActiveConversationId((previous) =>
      previous === nextConversationId ? previous : nextConversationId
    );
    setActiveConversation((previous) => (previous === null ? previous : null));
    setIsCrmOpen((previous) => (previous ? false : previous));
    setNewConversationCount((previous) => (previous === 0 ? previous : 0));
    setSyncAllCursor((previous) => (previous === null ? previous : null));
    leadLastMessageAtRef.current = new Map();
    workspaceLastMessageAtRef.current = 0;
    activeConversationLastFetchedAtRef.current = new Map();
    activeConversationListTimestampRef.current = 0;
    prevConversationIdRef.current = null;
  }, [activeWorkspace]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const handleVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Load workspace auto-followups-on-reply setting for the inbox sidebar switch
  useEffect(() => {
    async function loadAutoFollowUpsSetting() {
      if (!activeWorkspace) {
        setAutoFollowUpsOnReplyEnabled(false);
        return;
      }

      const result = await getAutoFollowUpsOnReply(activeWorkspace);
      if (result.success) {
        setAutoFollowUpsOnReplyEnabled(result.enabled === true);
      }
    }

    loadAutoFollowUpsSetting().catch(() => undefined);
  }, [activeWorkspace]);

  // Fetch SMS sub-clients for campaign filtering
  const smsCampaignFiltersQuery = useQuery({
    queryKey: ["smsCampaignFilters", activeWorkspace],
    enabled: Boolean(activeWorkspace) && isActive,
    queryFn: async () => {
      if (!activeWorkspace) {
        return { success: false as const, error: "No workspace selected" };
      }
      return getSmsCampaignFilters(activeWorkspace);
    },
    staleTime: 60_000,
  });

  const smsCampaignFilters = smsCampaignFiltersQuery.data?.success
    ? smsCampaignFiltersQuery.data.data
    : null;
  const smsClientOptions = useMemo(
    () => (activeWorkspace ? smsCampaignFilters?.campaigns ?? EMPTY_SMS_CLIENT_OPTIONS : EMPTY_SMS_CLIENT_OPTIONS),
    [activeWorkspace, smsCampaignFilters]
  );
  const smsClientUnattributedCount = useMemo(
    () => (activeWorkspace ? smsCampaignFilters?.unattributedLeadCount ?? 0 : 0),
    [activeWorkspace, smsCampaignFilters]
  );

  const normalizedChannels = useMemo(
    () => [...activeChannels].sort(),
    [activeChannels]
  );

  const normalizedSentiments = useMemo(
    () => [...activeSentiments].sort(),
    [activeSentiments]
  );

  const isSameQueryFilters = useCallback((
    previousBase: unknown,
    nextBase: Omit<ConversationsCursorOptions, "search">
  ) => {
    if (!previousBase || typeof previousBase !== "object") return false;

    const previous = previousBase as Partial<Omit<ConversationsCursorOptions, "search">>;

    const isSameStringArray = (a?: string[], b?: string[]) => {
      if (!a && !b) return true;
      if (!a || !b) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    };

    return (
      previous.clientId === nextBase.clientId &&
      previous.smsCampaignId === nextBase.smsCampaignId &&
      previous.smsCampaignUnattributed === nextBase.smsCampaignUnattributed &&
      previous.filter === nextBase.filter &&
      previous.scoreFilter === nextBase.scoreFilter &&
      previous.limit === nextBase.limit &&
      isSameStringArray(previous.channels as string[] | undefined, nextBase.channels as string[] | undefined) &&
      isSameStringArray(previous.sentimentTags, nextBase.sentimentTags)
    );
  }, []);

  // Build base query options for cursor-based pagination (everything except search)
  const baseQueryOptions: Omit<ConversationsCursorOptions, "search"> = useMemo(() => ({
    clientId: activeWorkspace,
    channels: normalizedChannels.length > 0 ? normalizedChannels : undefined,
    sentimentTags: normalizedSentiments.length > 0 ? normalizedSentiments : undefined,
    smsCampaignId:
      activeSmsClient !== "all" && activeSmsClient !== "unattributed"
        ? activeSmsClient
        : undefined,
    smsCampaignUnattributed: activeSmsClient === "unattributed" ? true : undefined,
    filter: activeFilter
      ? (activeFilter as "responses" | "attention" | "needs_repair" | "previous_attention" | "drafts" | "ai_sent" | "ai_review" | "all")
      : undefined,
    scoreFilter: activeScoreFilter !== "all" ? activeScoreFilter : undefined,
    limit: 50,
  }), [activeWorkspace, normalizedChannels, normalizedSentiments, activeSmsClient, activeFilter, activeScoreFilter]);

  // Full query options (includes search)
  const queryOptions: ConversationsCursorOptions = useMemo(() => ({
    ...baseQueryOptions,
    search: searchQuery.trim() ? searchQuery.trim() : undefined,
  }), [baseQueryOptions, searchQuery]);

  const conversationsQueryEnabled = isActive && workspacesReady && hasWorkspaces;

  // Infinite query for conversations
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["conversations", baseQueryOptions, queryOptions.search ?? ""],
    enabled: conversationsQueryEnabled,
    queryFn: async ({ pageParam }) => {
      const result = await getConversationsCursor({
        ...queryOptions,
        // Jam evidence shows cursor can serialize as `{}` across the RSC boundary.
        // Only pass it through when it is a real cursor string.
        cursor: typeof pageParam === "string" ? pageParam : undefined,
      });
      if (!result.success) {
        throw new Error(result.error || "Failed to fetch conversations");
      }
      return result;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: (previousData, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      const previousBase = Array.isArray(previousKey) ? previousKey[1] : null;
      if (!isSameQueryFilters(previousBase, baseQueryOptions)) return undefined;
      return previousData;
    },
    staleTime: 30000,
    refetchInterval: (query) => {
      if (!conversationsQueryEnabled) return false;
      if (query.state.status === "error") return false;
      if (!isPageVisible) return false;
      if (isLive) return REALTIME_HEARTBEAT_INTERVAL;
      return POLLING_INTERVAL;
    },
  });

  const wasConversationsQueryEnabledRef = useRef(conversationsQueryEnabled);
  const wasPageVisibleRef = useRef(isPageVisible);

  useEffect(() => {
    const wasEnabled = wasConversationsQueryEnabledRef.current;
    const wasVisible = wasPageVisibleRef.current;
    wasConversationsQueryEnabledRef.current = conversationsQueryEnabled;
    wasPageVisibleRef.current = isPageVisible;

    if (!conversationsQueryEnabled) return;
    if (!isPageVisible) return;

    const becameEnabled = !wasEnabled && conversationsQueryEnabled;
    const becameVisible = !wasVisible && isPageVisible;
    if (becameEnabled || becameVisible) {
      void refetch();
    }
  }, [conversationsQueryEnabled, isPageVisible, refetch]);

  // Manage delayed loading spinner (only show after 300ms)
  useEffect(() => {
    if (isLoading && !data) {
      const timer = setTimeout(() => setShowDelayedSpinner(true), 300);
      return () => clearTimeout(timer);
    } else {
      setShowDelayedSpinner(false);
    }
  }, [isLoading, data]);

  // Flatten all pages into conversations array
  const allConversations = useMemo(() => {
    return data?.pages.flatMap((page) => page.conversations) || [];
  }, [data]);

  // Convert to component format
  const conversations: ConversationWithSentiment[] = useMemo(() => {
    return allConversations.map(convertToComponentFormat);
  }, [allConversations]);

  const conversationsById = useMemo(() => {
    const byId = new Map<string, ConversationWithSentiment>();
    for (const conversation of conversations) {
      byId.set(conversation.id, conversation);
    }
    return byId;
  }, [conversations]);

  useEffect(() => {
    conversationsByIdRef.current = conversationsById;
  }, [conversationsById]);

  // Track the most recent message timestamp we know about for each lead currently in view.
  // Supabase realtime UPDATE payloads typically do not include the full previous row, so we
  // cannot reliably compare `payload.old.lastMessageAt`.
  useEffect(() => {
    const next = new Map<string, number>();
    let maxMs = 0;
    for (const conv of conversations) {
      const lastMs = conv.lastMessageTime instanceof Date ? conv.lastMessageTime.getTime() : Date.parse(String(conv.lastMessageTime));
      if (Number.isFinite(lastMs)) {
        next.set(conv.id, lastMs);
        if (lastMs > maxMs) maxMs = lastMs;
      }
    }
    leadLastMessageAtRef.current = next;
    workspaceLastMessageAtRef.current = maxMs;
  }, [conversations, activeWorkspace]);

  // Legacy fetchConversations for sync operations (just triggers refetch)
  const fetchConversations = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Fetch full conversation when active conversation changes
  // Uses optimistic UI: show lead info immediately, load messages in background
  // showLoading: true for initial loads (shows spinner), false for background polling (silent refresh)
  const fetchActiveConversation = useCallback(async (showLoading = true) => {
    if (!activeConversationId) {
      activeConversationRequestRef.current += 1;
      setActiveConversation(null);
      setIsLoadingMessages(false);
      return;
    }

    const conversationId = activeConversationId;
    const requestId = activeConversationRequestRef.current + 1;
    activeConversationRequestRef.current = requestId;

    // Optimistic UI: Immediately show conversation with data from list
    const baseConv = conversationsByIdRef.current.get(conversationId);
    const baseLastMessageMs =
      baseConv?.lastMessageTime instanceof Date
        ? baseConv.lastMessageTime.getTime()
        : baseConv?.lastMessageTime
          ? Date.parse(String(baseConv.lastMessageTime))
          : null;
    const hasBaseLastMessageMs =
      typeof baseLastMessageMs === "number" &&
      Number.isFinite(baseLastMessageMs) &&
      baseLastMessageMs > 0;
    const lastFetchedMessageMs = activeConversationLastFetchedAtRef.current.get(conversationId) ?? 0;

    // For background refreshes, skip server fetch when the list already indicates no new messages.
    if (
      !showLoading &&
      hasBaseLastMessageMs &&
      baseLastMessageMs <= lastFetchedMessageMs
    ) {
      return;
    }

    if (baseConv) {
      // Only show loading state and clear messages for initial/explicit loads
      // For background polling, keep existing messages visible
      if (showLoading) {
        setActiveConversation({
          ...baseConv,
          messages: [], // Empty initially, will load
        });
        setIsLoadingMessages(true);
      }
    } else if (showLoading) {
      // When the lead isn't present in the current list (filters/pagination), avoid showing a stale conversation.
      setActiveConversation(null);
      setIsLoadingMessages(true);
    }

    const shouldAutoSync =
      !!baseConv && (baseConv.channels.includes("email") || baseConv.channels.includes("sms"));
    const lastSyncAt = lastAutoSyncRef.current.get(conversationId) || 0;
    const shouldSyncNow = shouldAutoSync && Date.now() - lastSyncAt > 5 * 60 * 1000; // 5 minutes

    if (shouldSyncNow) {
      lastAutoSyncRef.current.set(conversationId, Date.now());
      enqueueConversationSync(conversationId).catch((err) => {
        console.error("[InboxView] Auto-sync enqueue failed:", err);
      });
    }

    // Fetch full messages in background
    const result = await getConversation(conversationId);
    if (activeConversationRequestRef.current !== requestId) return;
    if (result.success && result.data) {
      const messages = (result.data.messages ?? []).map((m) => ({
        ...m,
        timestamp: toDateOrNull(m.timestamp) ?? new Date(),
      }));
      const newestMessageMs = messages.reduce((max, message) => {
        const ms = message.timestamp instanceof Date ? message.timestamp.getTime() : Date.parse(String(message.timestamp));
        if (!Number.isFinite(ms)) return max;
        return ms > max ? ms : max;
      }, 0);
      if (newestMessageMs > 0) {
        activeConversationLastFetchedAtRef.current.set(conversationId, newestMessageMs);
      } else if (hasBaseLastMessageMs) {
        activeConversationLastFetchedAtRef.current.set(conversationId, baseLastMessageMs);
      }

	      if (baseConv) {
	        // Keep lead automation flags in sync with server-side updates (e.g. enabling follow-ups on first setter reply).
	        setActiveConversation({
	          ...baseConv,
	          viewerRole: result.data.viewerRole ?? baseConv.viewerRole ?? null,
		          lead: {
		            ...baseConv.lead,
	            firstName: result.data.lead.firstName ?? baseConv.lead.firstName ?? null,
	            lastName: result.data.lead.lastName ?? baseConv.lead.lastName ?? null,
	            autoReplyEnabled: result.data.lead.autoReplyEnabled,
	            autoFollowUpEnabled: result.data.lead.autoFollowUpEnabled,
	            autoBookMeetingsEnabled: result.data.lead.autoBookMeetingsEnabled,
	            smsDndActive: result.data.lead.smsDndActive,
	            status: result.data.lead.status as Lead["status"],
	            sentimentTag: result.data.lead.sentimentTag,
	            alternateEmails: result.data.lead.alternateEmails ?? baseConv.lead.alternateEmails ?? [],
		            currentReplierEmail: result.data.lead.currentReplierEmail ?? null,
		            currentReplierName: result.data.lead.currentReplierName ?? null,
		            currentReplierSince: toDateOrNull(result.data.lead.currentReplierSince),
		            followUpBlockedReason: result.data.lead.followUpBlockedReason ?? baseConv.lead.followUpBlockedReason ?? null,
		          },
		          messages,
		        });
	      } else {
	        const lastMessage = messages[messages.length - 1];
	        const sentimentTag = result.data.lead.sentimentTag ?? null;

        setActiveConversation({
          id: result.data.id,
          viewerRole: result.data.viewerRole ?? null,
	          lead: {
            id: result.data.lead.id,
            name: result.data.lead.name,
            firstName: result.data.lead.firstName ?? null,
            lastName: result.data.lead.lastName ?? null,
            email: result.data.lead.email || "",
            alternateEmails: result.data.lead.alternateEmails ?? [],
	            currentReplierEmail: result.data.lead.currentReplierEmail ?? null,
	            currentReplierName: result.data.lead.currentReplierName ?? null,
	            currentReplierSince: toDateOrNull(result.data.lead.currentReplierSince),
	            phone: result.data.lead.phone || "",
            company: result.data.lead.company,
            title: result.data.lead.title || "",
            website: result.data.lead.companyWebsite || "",
            timezone: "",
            leadScore: 50,
            autoReplyEnabled: result.data.lead.autoReplyEnabled,
            autoFollowUpEnabled: result.data.lead.autoFollowUpEnabled,
            autoBookMeetingsEnabled: result.data.lead.autoBookMeetingsEnabled,
            smsDndActive: result.data.lead.smsDndActive,
            clientId: result.data.lead.clientId,
            smsCampaignId: result.data.lead.smsCampaignId,
            smsCampaignName: result.data.lead.smsCampaignName,
            status: result.data.lead.status as Lead["status"],
            qualification: {
              budget: false,
              authority: false,
              need: false,
              timing: false,
            },
            linkedinUrl: result.data.lead.linkedinUrl,
            companyName: result.data.lead.companyName,
            companyWebsite: result.data.lead.companyWebsite,
            companyState: result.data.lead.companyState,
            emailBisonLeadId: result.data.lead.emailBisonLeadId,
            enrichmentStatus: result.data.lead.enrichmentStatus,
            followUpBlockedReason: result.data.lead.followUpBlockedReason ?? null,
            ghlContactId: result.data.lead.ghlContactId,
            ghlLocationId: result.data.lead.ghlLocationId,
            sentimentTag: result.data.lead.sentimentTag,
          },
          channels: result.data.channels,
          availableChannels: result.data.availableChannels,
          primaryChannel: result.data.primaryChannel,
          platform: result.data.primaryChannel,
          classification: (sentimentTag?.toLowerCase().replace(/\s+/g, "-") || "new") as Conversation["classification"],
          lastMessage: lastMessage?.content ?? "",
          lastSubject: lastMessage?.subject ?? null,
          lastMessageTime: lastMessage?.timestamp ? new Date(lastMessage.timestamp) : new Date(),
          messages,
          hasAiDraft: false,
          requiresAttention: false,
        });
    }
    }

    if (showLoading && activeConversationRequestRef.current === requestId) {
      setIsLoadingMessages(false);
    }
  }, [activeConversationId]);

  // Sync a single conversation (SMS and/or Email based on lead's external IDs)
  const handleSyncConversation = useCallback(async (leadId: string) => {
    // Add to syncing set
    setSyncingLeadIds(prev => new Set(prev).add(leadId));
    
    try {
      const result = await enqueueConversationSync(leadId);
      if (!result.success) {
        toast.error(result.error || "Failed to queue sync");
        return;
      }

      if (result.alreadyQueued) {
        toast.info("Sync already queued", { description: "Processing in the background." });
      } else {
        toast.success("Sync queued", { description: "Processing in the background." });
      }
    } catch (err) {
      toast.error("Failed to queue sync");
    } finally {
      // Remove from syncing set
      setSyncingLeadIds(prev => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  }, []);

  // Sync all SMS conversations
  const handleSyncAll = useCallback(async (forceReclassify: boolean = false) => {
    if (!activeWorkspace) {
      toast.error("No workspace selected");
      return;
    }

    setIsSyncingAll(true);
    
    // Get all SMS conversation IDs and mark them as syncing
    const smsLeadIds = conversations
      .filter(c => c.channels.includes("sms"))
      .map(c => c.id);
    
    setSyncingLeadIds(new Set(smsLeadIds));
    
    try {
      const result = await syncAllConversations(activeWorkspace, {
        forceReclassify,
        cursor: syncAllCursor,
        maxSeconds: 60,
        // Explicitly disable expensive side-effects during bulk sync.
        runBounceCleanup: false,
      });

      if (!result.success) {
        toast.error(result.error || "Failed to sync all conversations");
        return;
      }

      const {
        totalLeads,
        processedLeads = 0,
        nextCursor,
        hasMore,
        totalImported,
        totalHealed,
        totalReclassified,
        totalLeadUpdated,
        errors,
      } = result;

      const processedSoFar = hasMore && typeof nextCursor === "number" ? nextCursor : totalLeads;
      setSyncAllCursor(hasMore && typeof nextCursor === "number" ? nextCursor : null);

      const parts = [];
      if (totalImported > 0) parts.push(`${totalImported} new messages`);
      if (totalHealed > 0) parts.push(`${totalHealed} fixed`);
      if (totalReclassified > 0) parts.push(`${totalReclassified} sentiments re-analyzed`);
      if (totalLeadUpdated > 0) parts.push(`${totalLeadUpdated} contacts updated`);
      if (errors > 0) parts.push(`${errors} errors`);

      toast.success(
        hasMore
          ? `Synced ${processedSoFar}/${totalLeads} leads`
          : `Sync complete (${processedSoFar}/${totalLeads})`,
        {
          description: [
            processedLeads ? `Processed ${processedLeads} in this chunk.` : null,
            parts.length ? parts.join(", ") : null,
            hasMore ? "Click Sync All again to continue." : null,
          ]
            .filter(Boolean)
            .join(" "),
        }
      );

      // Refresh conversations list
      fetchConversations();
      fetchActiveConversation();
    } catch (err) {
      toast.error("Failed to sync all conversations");
    } finally {
      setIsSyncingAll(false);
      setSyncingLeadIds(new Set());
    }
  }, [activeWorkspace, conversations, fetchConversations, fetchActiveConversation, syncAllCursor]);

  const handleReanalyzeSentiment = useCallback(async (leadId: string) => {
    setReanalyzingLeadId(leadId);
    try {
      const result = await reanalyzeLeadSentiment(leadId);
      if (result.success) {
        toast.success("Sentiment re-analyzed", {
          description: result.sentimentTag ? `New tag: ${result.sentimentTag}` : undefined,
        });

        // Optimistically update the active conversation badge/tag without clearing messages
        setActiveConversation((prev) => {
          if (!prev || prev.id !== leadId) return prev;
          const nextTag = result.sentimentTag || prev.lead.sentimentTag || "Neutral";
          const normalized = nextTag.toLowerCase().replace(/\s+/g, "-") as Conversation["classification"];
          return {
            ...prev,
            lead: {
              ...prev.lead,
              sentimentTag: nextTag,
            },
            classification: normalized,
          };
        });

        // Refresh list so the left-side badges update
        fetchConversations();
      } else {
        toast.error(result.error || "Failed to re-analyze sentiment");
      }
    } catch (err) {
      toast.error("Failed to re-analyze sentiment");
    } finally {
      setReanalyzingLeadId(null);
    }
  }, [fetchConversations]);

  const handleReanalyzeAllSentiments = useCallback(async (leadIds: string[]) => {
    if (!leadIds || leadIds.length === 0) {
      toast.info("No conversations to re-analyze");
      return;
    }

    const ok = confirm(
      [
        `Re-analyze sentiments for ${leadIds.length} conversation${leadIds.length === 1 ? "" : "s"}?`,
        "",
        "This uses existing message history (no sync), and may take a bit.",
      ].join("\n")
    );
    if (!ok) return;

    setIsReanalyzingAllSentiments(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const leadId of leadIds) {
        try {
          const result = await reanalyzeLeadSentiment(leadId);
          if (result.success) successCount += 1;
          else errorCount += 1;
        } catch {
          errorCount += 1;
        }
      }

      toast.success("Re-analysis complete", {
        description: `${successCount} updated${errorCount > 0 ? `, ${errorCount} errors` : ""}`,
      });

      fetchConversations();
      fetchActiveConversation(false);
    } finally {
      setIsReanalyzingAllSentiments(false);
    }
  }, [fetchActiveConversation, fetchConversations]);

  const handleToggleAutoFollowUpsOnReply = useCallback(async (enabled: boolean) => {
    if (!activeWorkspace) {
      toast.error("No workspace selected");
      return;
    }

    const ok = confirm(
      [
        `${enabled ? "Enable" : "Disable"} Auto Follow-ups for positive email replies?`,
        "",
        enabled
          ? "When ON: once a lead replies positively via email, follow-ups will be auto-enabled for that lead."
          : "When OFF: follow-ups must be enabled per lead (manual).",
      ].join("\n")
    );
    if (!ok) return;

    setIsTogglingAutoFollowUpsOnReply(true);
    const previous = autoFollowUpsOnReplyEnabled;
    setAutoFollowUpsOnReplyEnabled(enabled);
    try {
      const result = await setAutoFollowUpsOnReply(activeWorkspace, enabled);
      if (!result.success) {
        setAutoFollowUpsOnReplyEnabled(previous);
        toast.error(result.error || "Failed to update auto follow-ups setting");
        return;
      }
      toast.success("Auto Follow-ups setting updated", {
        description: enabled ? "Auto-enroll on positive email replies is ON" : "Auto-enroll is OFF",
      });
    } catch (err) {
      setAutoFollowUpsOnReplyEnabled(previous);
      toast.error("Failed to update auto follow-ups setting");
    } finally {
      setIsTogglingAutoFollowUpsOnReply(false);
    }
  }, [activeWorkspace, autoFollowUpsOnReplyEnabled]);

  // Reset sentiment filter when workspace changes
  useEffect(() => {
    setActiveSentiments((previous) => (previous.length === 0 ? previous : []));
  }, [activeWorkspace]);

  // Handle initial conversation selection (e.g., from CRM "Open in Master Inbox")
  useEffect(() => {
    if (initialConversationId) {
      setActiveConversationId((previous) =>
        previous === initialConversationId ? previous : initialConversationId
      );
    }
  }, [initialConversationId]);

  // Open CRM drawer for deep links (e.g., Follow-ups "Start sequence")
  useEffect(() => {
    if (initialCrmOpen) {
      setIsCrmOpen(true);
    }
  }, [initialCrmOpen]);

  // Fetch active conversation when selection changes
  useEffect(() => {
    if (!isActive) return;
    // Only show loading spinner when the conversation ID actually changes (user switched conversations)
    // For background updates triggered by conversations list changes, do silent refresh
    const isNewConversation = activeConversationId !== prevConversationIdRef.current;
    prevConversationIdRef.current = activeConversationId;
    
    fetchActiveConversation(isNewConversation);
  }, [fetchActiveConversation, activeConversationId, isActive]);

  // Background-refresh the selected conversation only when that conversation's list timestamp advances.
  useEffect(() => {
    if (!isActive) return;
    if (!activeConversationId) {
      activeConversationListTimestampRef.current = 0;
      return;
    }

    const activeConversationFromList = conversationsById.get(activeConversationId);
    if (!activeConversationFromList) return;

    const listTimestampMs =
      activeConversationFromList.lastMessageTime instanceof Date
        ? activeConversationFromList.lastMessageTime.getTime()
        : Date.parse(String(activeConversationFromList.lastMessageTime));

    if (!Number.isFinite(listTimestampMs)) return;
    if (listTimestampMs <= activeConversationListTimestampRef.current) return;

    activeConversationListTimestampRef.current = listTimestampMs;
    fetchActiveConversation(false);
  }, [activeConversationId, conversationsById, fetchActiveConversation, isActive]);

  const parseRealtimeTimestampMs = (value: unknown): number | null => {
    if (!value) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "string") {
      const ms = Date.parse(value);
      return Number.isNaN(ms) ? null : ms;
    }
    return null;
  };

  // Workspace-scoped realtime subscription for "new" badge.
  // IMPORTANT: do NOT subscribe to Message rows in the browser (too noisy + higher PII risk).
  useEffect(() => {
    if (!isActive) {
      setIsLive(false);
      return;
    }

    if (!activeWorkspace) {
      setIsLive(false);
      return;
    }

    realtimeConnectedRef.current = false;

    const channel = subscribeToLeads(
      (payload) => {
        realtimeConnectedRef.current = true;
        setIsLive(true);

        const leadId =
          typeof payload.new?.id === "string"
            ? (payload.new.id as string)
            : typeof payload.old?.id === "string"
              ? (payload.old.id as string)
              : null;

        if (!leadId) return;

        const newLastMessageAt = parseRealtimeTimestampMs(payload.new?.lastMessageAt);
        if (newLastMessageAt == null) return;

        const previousLastMessageAt = leadLastMessageAtRef.current.get(leadId) ?? workspaceLastMessageAtRef.current ?? 0;
        if (newLastMessageAt <= previousLastMessageAt) return;

        // Update our local baseline so repeated UPDATEs don't inflate the badge.
        leadLastMessageAtRef.current.set(leadId, newLastMessageAt);
        if (newLastMessageAt > workspaceLastMessageAtRef.current) {
          workspaceLastMessageAtRef.current = newLastMessageAt;
        }

        // Only increment when this update indicates a *new inbound* message.
        const direction = payload.new?.lastMessageDirection;
        if (direction === "inbound") {
          setNewConversationCount((prev) => prev + 1);
        }
      },
      { clientId: activeWorkspace }
    );

    const checkConnection = setTimeout(() => {
      if (!realtimeConnectedRef.current) {
        setIsLive(false);
      }
    }, 5000);

    return () => {
      clearTimeout(checkConnection);
      unsubscribe(channel);
    };
  }, [activeWorkspace, isActive]);

  // Handle new conversations badge click
  const handleNewConversationsClick = useCallback(() => {
    setNewConversationCount(0);
    refetch();
  }, [refetch]);

  // Conversations are already filtered by the server via queryOptions
  // Just use the conversations directly
  const filteredConversations = conversations;

  // Check if any filters are currently active
  const hasActiveFilters = activeFilter !== "" || activeSentiments.length > 0 || activeChannels.length > 0 || activeScoreFilter !== "all";

  // Handle clearing all filters (resets sentiment and score filters locally and calls parent for channel/filter)
  const handleClearAllFilters = useCallback(() => {
    setActiveSentiments([]);
    setActiveScoreFilter("all");
    onClearFilters?.();
  }, [onClearFilters]);

  // Check if current conversation is syncing
  const isCurrentConversationSyncing = activeConversationId 
    ? syncingLeadIds.has(activeConversationId) 
    : false;

  // Auto-select first conversation when list loads
  useEffect(() => {
    if (conversations.length > 0 && !activeConversationId) {
      const firstConversation = conversations[0];
      if (firstConversation) {
        handleLeadSelect(firstConversation.id);
      }
    }
  }, [conversations, activeConversationId, handleLeadSelect]);

  const handleLoadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  // Only show full-page loading spinner on initial load after 300ms delay
  // This prevents blocking when switching workspaces (cached data shows immediately)
  if (showDelayedSpinner) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-4">
          <div className="p-4 rounded-full bg-destructive/10 w-fit mx-auto">
            <WifiOff className="h-12 w-12 text-destructive" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-destructive">Error loading conversations</h3>
            <p className="text-sm text-muted-foreground max-w-md font-mono bg-muted p-2 rounded mt-2">
              {error?.message || "Unknown error"}
            </p>
            <Button variant="outline" onClick={() => refetch()} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Empty state when no conversations (only show if not loading)
  if (conversations.length === 0 && !isLoading && !activeConversationId) {
    // Show different message if filters are active vs no conversations at all
    if (hasActiveFilters) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center space-y-4">
            <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto">
              <FilterX className="h-12 w-12 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">No matching conversations</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                No conversations match your current filters. Try adjusting your filters or clear them to see all conversations.
              </p>
              <Button 
                variant="outline" 
                onClick={handleClearAllFilters} 
                className="mt-4"
              >
                <FilterX className="h-4 w-4 mr-2" />
                Clear all filters
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-4">
          <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto">
            <Inbox className="h-12 w-12 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">No conversations yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {activeWorkspace 
                ? (workspaceHasConnectedAccounts
                    ? "This workspace doesn't have any conversations yet. They will appear here when leads start messaging."
                    : "This workspace has no connected accounts yet. Connect an integration to start receiving messages here.")
                : "Select a workspace or wait for incoming messages from your GHL integrations."
              }
            </p>
            {activeWorkspace && !workspaceHasConnectedAccounts ? (
              <Button asChild variant="outline" className="mt-4">
                <Link href="/?view=settings&settingsTab=integrations">
                  Go to Settings → Integrations
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Status indicators */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
        {/* Subtle fetching indicator for background refreshes */}
        {isFetching && data && (
          <Badge variant="outline" className="text-xs bg-muted/50 text-muted-foreground">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Updating...
          </Badge>
        )}
        
        {/* New conversations badge */}
        {newConversationCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewConversationsClick}
            className="bg-primary/10 border-primary/30 text-primary text-xs"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            {newConversationCount} new
          </Button>
        )}
        
        {/* Live indicator */}
        <Badge 
          variant="outline" 
          className={`text-xs ${isLive ? "bg-green-500/10 text-green-500 border-green-500/30" : "bg-muted text-muted-foreground"}`}
        >
          {isLive ? (
            <>
              <Wifi className="h-3 w-3 mr-1" />
              Live
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 mr-1" />
              Polling
            </>
          )}
        </Badge>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {newConversationCount > 0 ? `${newConversationCount} new conversations available.` : ""}
      </div>
	      
		      <ConversationFeed
		        conversations={filteredConversations}
		        activeConversationId={activeConversationId}
		        onSelectConversation={handleLeadSelect}
            onDebouncedSearchChange={setSearchQuery}
		        activeSentiments={activeSentiments}
		        onSentimentsChange={setActiveSentiments}
		        activeSmsClient={activeSmsClient}
		        onSmsClientChange={activeWorkspace ? setActiveSmsClient : undefined}
		        smsClientOptions={smsClientOptions}
		        smsClientUnattributedCount={smsClientUnattributedCount}
	        isLoadingSmsClients={activeWorkspace ? smsCampaignFiltersQuery.isLoading : false}
	        activeScoreFilter={activeScoreFilter}
	        onScoreFilterChange={activeWorkspace ? setActiveScoreFilter : undefined}
	        syncingLeadIds={syncingLeadIds}
	        onSyncAll={handleSyncAll}
	        isSyncingAll={isSyncingAll}
	        onReanalyzeAllSentiments={handleReanalyzeAllSentiments}
	        isReanalyzingAllSentiments={isReanalyzingAllSentiments}
	        autoFollowUpsOnReplyEnabled={autoFollowUpsOnReplyEnabled}
	        onToggleAutoFollowUpsOnReply={activeWorkspace ? handleToggleAutoFollowUpsOnReply : undefined}
	        isTogglingAutoFollowUpsOnReply={isTogglingAutoFollowUpsOnReply}
	        hasMore={hasNextPage}
	        isLoadingMore={isFetchingNextPage}
	        onLoadMore={handleLoadMore}
	      />

	      <ActionStation
	        conversation={activeConversation}
	        onToggleCrm={() => setIsCrmOpen(!isCrmOpen)}
	        isCrmOpen={isCrmOpen}
	        isSyncing={isCurrentConversationSyncing}
	        onSync={handleSyncConversation}
	        isReanalyzingSentiment={!!activeConversationId && reanalyzingLeadId === activeConversationId}
	        onReanalyzeSentiment={handleReanalyzeSentiment}
	        isLoadingMessages={isLoadingMessages}
	      />
      {activeConversation && (
        <CrmDrawer
          lead={activeConversation.lead}
          viewerRole={activeConversation.viewerRole}
          isOpen={isCrmOpen}
          onClose={() => setIsCrmOpen(false)}
          onLeadUpdate={() => {
            fetchConversations();
            fetchActiveConversation();
          }}
        />
      )}
    </>
  );
}

// Preserve a readable name for production component stacks (webpack minification renames functions).
;(InboxView as any).displayName = "InboxView"
