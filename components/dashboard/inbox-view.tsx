"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ConversationFeed } from "./conversation-feed";
import { ActionStation } from "./action-station";
import { CrmDrawer } from "./crm-drawer";
import { getConversations, getConversation, type ConversationData } from "@/actions/lead-actions";
import { subscribeToMessages, subscribeToLeads, unsubscribe } from "@/lib/supabase";
import { Loader2, Wifi, WifiOff, Inbox } from "lucide-react";
import { type Conversation, type Lead } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";

interface InboxViewProps {
  activeChannel: string;
  activeFilter: string;
  activeWorkspace: string | null;
}

// Polling interval in milliseconds (30 seconds)
const POLLING_INTERVAL = 30000;

// Convert DB conversation to component format
function convertToComponentFormat(conv: ConversationData): Conversation {
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
      status: conv.lead.status as Lead["status"],
      qualification: {
        budget: false,
        authority: false,
        need: false,
        timing: false,
      },
    },
    platform: conv.platform,
    classification: (conv.sentimentTag?.toLowerCase().replace(/\s+/g, "-") || conv.classification) as Conversation["classification"],
    lastMessage: conv.lastMessage,
    lastMessageTime: new Date(conv.lastMessageTime),
    messages: [],
    hasAiDraft: conv.hasAiDraft,
    requiresAttention: conv.requiresAttention,
  };
}

export function InboxView({ activeChannel, activeFilter, activeWorkspace }: InboxViewProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [isCrmOpen, setIsCrmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const realtimeConnectedRef = useRef(false);

  // Fetch conversations from database
  const fetchConversations = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    
    try {
      const result = await getConversations(activeWorkspace);
      if (result.success && result.data) {
        const converted = result.data.map(convertToComponentFormat);
        setConversations(converted);
        
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
        // No data - show empty state
        setConversations([]);
        setActiveConversationId(null);
        setActiveConversation(null);
      }
    } catch (error) {
      console.error("Error fetching conversations:", error);
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

  // Refetch when workspace changes
  useEffect(() => {
    fetchConversations(true);
  }, [activeWorkspace]);

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

  // Filter conversations by channel and filter
  const filteredConversations = conversations.filter((conv) => {
    if (activeChannel !== "all" && conv.platform !== activeChannel) return false;
    if (activeFilter === "attention" && !conv.requiresAttention) return false;
    if (activeFilter === "drafts" && !conv.hasAiDraft) return false;
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
      />
      <ActionStation
        conversation={activeConversation}
        onToggleCrm={() => setIsCrmOpen(!isCrmOpen)}
        isCrmOpen={isCrmOpen}
      />
      {activeConversation && (
        <CrmDrawer
          lead={activeConversation.lead}
          isOpen={isCrmOpen}
          onClose={() => setIsCrmOpen(false)}
        />
      )}
    </>
  );
}
