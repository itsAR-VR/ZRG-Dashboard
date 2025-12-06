"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ConversationFeed } from "./conversation-feed";
import { ActionStation } from "./action-station";
import { CrmDrawer } from "./crm-drawer";
import { getConversations, getConversation, type ConversationData } from "@/actions/lead-actions";
import { syncConversationHistory, syncAllConversations } from "@/actions/message-actions";
import { subscribeToMessages, subscribeToLeads, unsubscribe } from "@/lib/supabase";
import { Loader2, Wifi, WifiOff, Inbox } from "lucide-react";
import { type Conversation, type Lead } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface InboxViewProps {
  activeChannel: string;
  activeFilter: string;
  activeWorkspace: string | null;
  initialConversationId?: string | null;
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
      website: "",
      timezone: "",
      leadScore: 50,
      autoReplyEnabled: conv.lead.autoReplyEnabled,
      autoFollowUpEnabled: conv.lead.autoFollowUpEnabled,
      clientId: conv.lead.clientId,
      status: conv.lead.status as Lead["status"],
      qualification: {
        budget: false,
        authority: false,
        need: false,
        timing: false,
      },
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

export function InboxView({ activeChannel, activeFilter, activeWorkspace, initialConversationId }: InboxViewProps) {
  const [conversations, setConversations] = useState<ConversationWithSentiment[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [isCrmOpen, setIsCrmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [activeSentiment, setActiveSentiment] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  
  // Sync state management - track which leads are currently syncing
  const [syncingLeadIds, setSyncingLeadIds] = useState<Set<string>>(new Set());
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const realtimeConnectedRef = useRef(false);

  // Fetch conversations from database
  const fetchConversations = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    setError(null);
    
    try {
      const result = await getConversations(activeWorkspace);
      if (result.success && result.data) {
        const converted = result.data.map(convertToComponentFormat);
        setConversations(converted);
        setError(null);
        
        // Set first conversation as active if none selected or current selection not in list
        if (converted.length > 0) {
          const currentExists = converted.some(c => c.id === activeConversationId);
          if (!activeConversationId || !currentExists) {
            setActiveConversationId(converted[0].id);
          }
        } else {
          setActiveConversationId(null);
          setActiveConversation(null);
        }
      } else {
        // Query failed or no data
        console.error("[InboxView] getConversations failed:", result.error);
        setError(result.error || "Failed to load conversations");
        setConversations([]);
        setActiveConversationId(null);
        setActiveConversation(null);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[InboxView] Error fetching conversations:", errorMsg);
      setError(errorMsg);
      setConversations([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeConversationId, activeWorkspace]);

  // Fetch full conversation when active conversation changes
  const fetchActiveConversation = useCallback(async () => {
    if (!activeConversationId) {
      setActiveConversation(null);
      return;
    }

    const result = await getConversation(activeConversationId);
    if (result.success && result.data) {
      const baseConv = conversations.find((c) => c.id === activeConversationId);
      if (baseConv) {
        setActiveConversation({
          ...baseConv,
          messages: result.data.messages,
        });
      }
    }
  }, [activeConversationId, conversations]);

  // Sync a single conversation
  const handleSyncConversation = useCallback(async (leadId: string) => {
    // Add to syncing set
    setSyncingLeadIds(prev => new Set(prev).add(leadId));
    
    try {
      const result = await syncConversationHistory(leadId);
      
      if (result.success) {
        const imported = result.importedCount || 0;
        const healed = result.healedCount || 0;
        const hasChanges = imported > 0 || healed > 0;

        if (hasChanges) {
          const parts = [];
          if (imported > 0) parts.push(`${imported} new`);
          if (healed > 0) parts.push(`${healed} fixed`);
          
          toast.success(`Synced: ${parts.join(", ")}`, {
            description: `Total messages in GHL: ${result.totalMessages}`
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
  const handleSyncAll = useCallback(async () => {
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
      const result = await syncAllConversations(activeWorkspace);
      
      if (result.success) {
        const { totalLeads, totalImported, totalHealed, totalDraftsGenerated, errors } = result;
        
        if (totalImported > 0 || totalHealed > 0 || totalDraftsGenerated > 0) {
          const parts = [];
          if (totalImported > 0) parts.push(`${totalImported} new messages`);
          if (totalHealed > 0) parts.push(`${totalHealed} fixed`);
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

  // Refetch when workspace changes
  useEffect(() => {
    fetchConversations(true);
    setActiveSentiment("all"); // Reset sentiment filter when workspace changes
  }, [activeWorkspace]);

  // Handle initial conversation selection (e.g., from CRM "Open in Master Inbox")
  useEffect(() => {
    if (initialConversationId) {
      setActiveConversationId(initialConversationId);
    }
  }, [initialConversationId]);

  // Fetch active conversation when selection changes
  useEffect(() => {
    fetchActiveConversation();
  }, [fetchActiveConversation]);

  // Set up realtime subscriptions
  useEffect(() => {
    console.log("[Realtime] Setting up subscriptions...");

    const messagesChannel = subscribeToMessages((payload) => {
      console.log("[Realtime] New message received:", payload);
      realtimeConnectedRef.current = true;
      setIsLive(true);
      fetchConversations();
    });

    const leadsChannel = subscribeToLeads((payload) => {
      console.log("[Realtime] Lead updated:", payload);
      realtimeConnectedRef.current = true;
      setIsLive(true);
      fetchConversations();
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
  }, [fetchConversations]);

  // Set up polling as fallback
  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    pollingRef.current = setInterval(() => {
      console.log("[Polling] Refreshing conversations...");
      fetchConversations();
    }, POLLING_INTERVAL);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [fetchConversations]);

  // Filter conversations by channel, filter, and sentiment
  const filteredConversations = conversations.filter((conv) => {
    // Filter by channel - check if the lead has messages on that channel
    if (activeChannel !== "all" && !conv.channels.includes(activeChannel as any)) return false;
    if (activeFilter === "attention" && !conv.requiresAttention) return false;
    if (activeFilter === "drafts" && !conv.hasAiDraft) return false;
    // Filter by sentiment tag
    if (activeSentiment !== "all" && conv.sentimentTag !== activeSentiment) return false;
    return true;
  });

  // Check if current conversation is syncing
  const isCurrentConversationSyncing = activeConversationId 
    ? syncingLeadIds.has(activeConversationId) 
    : false;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-4">
          <div className="p-4 rounded-full bg-destructive/10 w-fit mx-auto">
            <WifiOff className="h-12 w-12 text-destructive" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-destructive">Error loading conversations</h3>
            <p className="text-sm text-muted-foreground max-w-md font-mono bg-muted p-2 rounded mt-2">
              {error}
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              If you recently updated the schema, run: <code className="bg-muted px-1 rounded">npx prisma db push</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state when no conversations
  if (conversations.length === 0) {
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
      {/* Live indicator */}
      <div className="absolute top-2 right-2 z-10">
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
        onSelectConversation={setActiveConversationId}
        activeSentiment={activeSentiment}
        onSentimentChange={setActiveSentiment}
        syncingLeadIds={syncingLeadIds}
        onSyncAll={handleSyncAll}
        isSyncingAll={isSyncingAll}
      />
      <ActionStation
        conversation={activeConversation}
        onToggleCrm={() => setIsCrmOpen(!isCrmOpen)}
        isCrmOpen={isCrmOpen}
        isSyncing={isCurrentConversationSyncing}
        onSync={handleSyncConversation}
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
