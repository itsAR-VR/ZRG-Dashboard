"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConversationFeed } from "./conversation-feed";
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
import { syncConversationHistory, syncAllConversations, syncEmailConversationHistory, syncAllEmailConversations, smartSyncConversation, reanalyzeLeadSentiment } from "@/actions/message-actions";
import { getAutoFollowUpsOnReply, setAutoFollowUpsOnReply } from "@/actions/settings-actions";
import { subscribeToMessages, subscribeToLeads, unsubscribe } from "@/lib/supabase";
import { Loader2, Wifi, WifiOff, Inbox, RefreshCw, FilterX } from "lucide-react";
import { type Conversation, type Lead } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface InboxViewProps {
  activeChannels: Channel[];
  activeFilter: string;
  activeWorkspace: string | null;
  initialConversationId?: string | null;
  onLeadSelect?: (leadId: string | null) => void;
  onClearFilters?: () => void;
}

// Polling interval in milliseconds (30 seconds)
const POLLING_INTERVAL = 30000;

// Extended Conversation type with sentimentTag
type ConversationWithSentiment = Conversation & { 
  sentimentTag?: string | null;
};

// Convert DB conversation to component format
function convertToComponentFormat(conv: ConversationData): ConversationWithSentiment {
  return {
    id: conv.id,
    lead: {
      id: conv.lead.id,
      name: conv.lead.name,
      email: conv.lead.email || "",
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
      autoBookMeetingsEnabled: conv.lead.autoBookMeetingsEnabled,
      // GHL integration data
      ghlContactId: conv.lead.ghlContactId,
      ghlLocationId: conv.lead.ghlLocationId,
      // Sentiment tag (from conversation level)
      sentimentTag: conv.sentimentTag,
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

export function InboxView({ activeChannels, activeFilter, activeWorkspace, initialConversationId, onLeadSelect, onClearFilters }: InboxViewProps) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Wrapper to update both local state and notify parent
  const handleLeadSelect = useCallback((leadId: string | null) => {
    setActiveConversationId(leadId);
    onLeadSelect?.(leadId);
  }, [onLeadSelect]);
  
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [isCrmOpen, setIsCrmOpen] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [activeSentiments, setActiveSentiments] = useState<string[]>([]);
  const [activeSmsClient, setActiveSmsClient] = useState<string>("all");
  const [newConversationCount, setNewConversationCount] = useState(0);
  
  // Sync state management - track which leads are currently syncing
  const [syncingLeadIds, setSyncingLeadIds] = useState<Set<string>>(new Set());
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [reanalyzingLeadId, setReanalyzingLeadId] = useState<string | null>(null);
  const [isReanalyzingAllSentiments, setIsReanalyzingAllSentiments] = useState(false);
  const [autoFollowUpsOnReplyEnabled, setAutoFollowUpsOnReplyEnabled] = useState(false);
  const [isTogglingAutoFollowUpsOnReply, setIsTogglingAutoFollowUpsOnReply] = useState(false);
  
  // Delayed loading state - only show spinner after 300ms to avoid flicker on fast loads
  const [showDelayedSpinner, setShowDelayedSpinner] = useState(false);
  
  const realtimeConnectedRef = useRef(false);
  const prevConversationIdRef = useRef<string | null>(null);
  const lastAutoSyncRef = useRef<Map<string, number>>(new Map());

  // Reset SMS sub-client filter when switching workspaces
  useEffect(() => {
    setActiveSmsClient("all");
  }, [activeWorkspace]);

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
    enabled: Boolean(activeWorkspace),
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

  const normalizedChannels = useMemo(
    () => [...activeChannels].sort(),
    [activeChannels]
  );

  const normalizedSentiments = useMemo(
    () => [...activeSentiments].sort(),
    [activeSentiments]
  );

  // Build query options for cursor-based pagination
  const queryOptions: ConversationsCursorOptions = useMemo(() => ({
    clientId: activeWorkspace,
    channels: normalizedChannels.length > 0 ? normalizedChannels : undefined,
    sentimentTags: normalizedSentiments.length > 0 ? normalizedSentiments : undefined,
    smsCampaignId:
      activeSmsClient !== "all" && activeSmsClient !== "unattributed"
        ? activeSmsClient
        : undefined,
    smsCampaignUnattributed: activeSmsClient === "unattributed" ? true : undefined,
    filter: activeFilter as "responses" | "attention" | "needs_repair" | "previous_attention" | "drafts" | "all" | undefined,
    limit: 50,
  }), [activeWorkspace, normalizedChannels, normalizedSentiments, activeSmsClient, activeFilter]);

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
    queryKey: ["conversations", queryOptions],
    queryFn: async ({ pageParam }) => {
      const result = await getConversationsCursor({
        ...queryOptions,
        cursor: pageParam as string | null,
      });
      if (!result.success) {
        throw new Error(result.error || "Failed to fetch conversations");
      }
      return result;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30000,
    refetchInterval: 30000, // Poll every 30 seconds as fallback
  });

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

  // Legacy fetchConversations for sync operations (just triggers refetch)
  const fetchConversations = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Fetch full conversation when active conversation changes
  // Uses optimistic UI: show lead info immediately, load messages in background
  // showLoading: true for initial loads (shows spinner), false for background polling (silent refresh)
  const fetchActiveConversation = useCallback(async (showLoading = true) => {
    if (!activeConversationId) {
      setActiveConversation(null);
      setIsLoadingMessages(false);
      return;
    }

    // Optimistic UI: Immediately show conversation with data from list
    const baseConv = conversations.find((c) => c.id === activeConversationId);
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
    }

    const shouldAutoSync =
      !!baseConv && (baseConv.channels.includes("email") || baseConv.channels.includes("sms"));
    const lastSyncAt = lastAutoSyncRef.current.get(activeConversationId) || 0;
    const shouldSyncNow = shouldAutoSync && Date.now() - lastSyncAt > 5 * 60 * 1000; // 5 minutes

    const syncPromise = shouldSyncNow
      ? smartSyncConversation(activeConversationId).catch((err) => {
          console.error("[InboxView] Auto-sync failed:", err);
          return null;
        })
      : Promise.resolve(null);

    if (shouldSyncNow) {
      lastAutoSyncRef.current.set(activeConversationId, Date.now());
    }

    // Fetch full messages in background
    const result = await getConversation(activeConversationId);
    if (result.success && result.data) {
      // Update with full message data
      if (baseConv) {
        setActiveConversation({
          ...baseConv,
          messages: result.data.messages,
        });
      }
    }

    const syncResult = await syncPromise;
    if (syncResult?.success) {
      const imported = syncResult.importedCount || 0;
      const healed = syncResult.healedCount || 0;
      const hasChanges = imported > 0 || healed > 0;

      if (hasChanges) {
        const refreshed = await getConversation(activeConversationId);
        if (refreshed.success && refreshed.data && baseConv) {
          setActiveConversation({
            ...baseConv,
            messages: refreshed.data.messages,
          });
        }
        refetch().catch(() => undefined);
      }
    }
    if (showLoading) {
      setIsLoadingMessages(false);
    }
  }, [activeConversationId, conversations, refetch]);

  // Sync a single conversation (SMS and/or Email based on lead's external IDs)
  const handleSyncConversation = useCallback(async (leadId: string) => {
    // Add to syncing set
    setSyncingLeadIds(prev => new Set(prev).add(leadId));
    
    try {
      // Use smart sync which determines the best sync method based on lead's actual IDs
      const result = await smartSyncConversation(leadId);
      
      if (result.success) {
        const imported = result.importedCount || 0;
        const healed = result.healedCount || 0;
        const hasChanges = imported > 0 || healed > 0;

        if (hasChanges) {
          const parts = [];
          if (imported > 0) parts.push(`${imported} new`);
          if (healed > 0) parts.push(`${healed} fixed`);
          
          toast.success(`Synced: ${parts.join(", ")}`, {
            description: `Total messages: ${result.totalMessages}`
          });
          // Refresh the active conversation if it's the one we synced
          if (leadId === activeConversationId) {
            fetchActiveConversation();
          }
        } else {
          toast.info("No changes needed", {
            description: `All ${result.totalMessages} messages already synced`
          });
        }
      } else {
        toast.error(result.error || "Failed to sync history");
      }
    } catch (err) {
      toast.error("Failed to sync conversation");
    } finally {
      // Remove from syncing set
      setSyncingLeadIds(prev => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
    }
  }, [activeConversationId, fetchActiveConversation]);

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
      const result = await syncAllConversations(activeWorkspace, { forceReclassify });
      
      if (result.success) {
        const { totalLeads, totalImported, totalHealed, totalDraftsGenerated, totalReclassified, errors } = result;
        
        if (totalImported > 0 || totalHealed > 0 || totalDraftsGenerated > 0 || totalReclassified > 0) {
          const parts = [];
          if (totalImported > 0) parts.push(`${totalImported} new messages`);
          if (totalHealed > 0) parts.push(`${totalHealed} fixed`);
          if (totalReclassified > 0) parts.push(`${totalReclassified} sentiments re-analyzed`);
          if (totalDraftsGenerated > 0) parts.push(`${totalDraftsGenerated} AI drafts`);
          if (errors > 0) parts.push(`${errors} errors`);
          
          toast.success(`Synced ${totalLeads} conversations`, {
            description: parts.join(", ")
          });
          // Refresh conversations list
          fetchConversations();
          fetchActiveConversation();
        } else {
          toast.info("All conversations already synced", {
            description: `Checked ${totalLeads} SMS conversations`
          });
        }
      } else {
        toast.error(result.error || "Failed to sync all conversations");
      }
    } catch (err) {
      toast.error("Failed to sync all conversations");
    } finally {
      setIsSyncingAll(false);
      setSyncingLeadIds(new Set());
    }
  }, [activeWorkspace, conversations, fetchConversations, fetchActiveConversation]);

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
    setActiveSentiments([]);
  }, [activeWorkspace]);

  // Handle initial conversation selection (e.g., from CRM "Open in Master Inbox")
  useEffect(() => {
    if (initialConversationId) {
      setActiveConversationId(initialConversationId);
    }
  }, [initialConversationId]);

  // Fetch active conversation when selection changes
  useEffect(() => {
    // Only show loading spinner when the conversation ID actually changes (user switched conversations)
    // For background updates triggered by conversations list changes, do silent refresh
    const isNewConversation = activeConversationId !== prevConversationIdRef.current;
    prevConversationIdRef.current = activeConversationId;
    
    fetchActiveConversation(isNewConversation);
  }, [fetchActiveConversation, activeConversationId]);

  // Set up realtime subscriptions for new conversation badge
  useEffect(() => {
    console.log("[Realtime] Setting up subscriptions...");

    const messagesChannel = subscribeToMessages((payload) => {
      console.log("[Realtime] New message received:", payload);
      realtimeConnectedRef.current = true;
      setIsLive(true);
      // Increment new conversation count instead of immediate refetch
      if (payload.eventType === "INSERT") {
        setNewConversationCount((prev) => prev + 1);
      }
    });

    const leadsChannel = subscribeToLeads((payload) => {
      console.log("[Realtime] Lead updated:", payload);
      realtimeConnectedRef.current = true;
      setIsLive(true);
      if (payload.eventType === "INSERT") {
        setNewConversationCount((prev) => prev + 1);
      }
    });

    const checkConnection = setTimeout(() => {
      if (!realtimeConnectedRef.current) {
        console.log("[Realtime] No connection detected, relying on polling");
        setIsLive(false);
      }
    }, 5000);

    return () => {
      console.log("[Realtime] Cleaning up subscriptions...");
      clearTimeout(checkConnection);
      unsubscribe(messagesChannel);
      unsubscribe(leadsChannel);
    };
  }, []);

  // Handle new conversations badge click
  const handleNewConversationsClick = useCallback(() => {
    setNewConversationCount(0);
    refetch();
  }, [refetch]);

  // Conversations are already filtered by the server via queryOptions
  // Just use the conversations directly
  const filteredConversations = conversations;

  // Check if any filters are currently active
  const hasActiveFilters = activeFilter !== "" || activeSentiments.length > 0 || activeChannels.length > 0;

  // Handle clearing all filters (resets sentiment locally and calls parent for channel/filter)
  const handleClearAllFilters = useCallback(() => {
    setActiveSentiments([]);
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
  if (conversations.length === 0 && !isLoading) {
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
                ? "This workspace doesn't have any conversations yet. They will appear here when leads start messaging."
                : "Select a workspace or wait for incoming messages from your GHL integrations."
              }
            </p>
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
	      
		      <ConversationFeed
		        conversations={filteredConversations}
		        activeConversationId={activeConversationId}
		        onSelectConversation={handleLeadSelect}
		        activeSentiments={activeSentiments}
		        onSentimentsChange={setActiveSentiments}
		        activeSmsClient={activeSmsClient}
		        onSmsClientChange={activeWorkspace ? setActiveSmsClient : undefined}
		        smsClientOptions={activeWorkspace ? smsCampaignFilters?.campaigns || [] : []}
		        smsClientUnattributedCount={activeWorkspace ? smsCampaignFilters?.unattributedLeadCount || 0 : 0}
	        isLoadingSmsClients={activeWorkspace ? smsCampaignFiltersQuery.isLoading : false}
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
	        onLoadMore={() => fetchNextPage()}
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
