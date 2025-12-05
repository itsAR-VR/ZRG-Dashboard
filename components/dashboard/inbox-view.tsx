"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ConversationFeed } from "./conversation-feed";
import { ActionStation } from "./action-station";
import { CrmDrawer } from "./crm-drawer";
import { getConversations, getConversation, type ConversationData } from "@/actions/lead-actions";
import { subscribeToMessages, subscribeToLeads, unsubscribe } from "@/lib/supabase";
import { Loader2, Wifi, WifiOff } from "lucide-react";
import { mockConversations, type Conversation, type Lead } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";

interface InboxViewProps {
  activeChannel: string;
  activeFilter: string;
}

// Polling interval in milliseconds (30 seconds)
const POLLING_INTERVAL = 30000;

// Convert DB conversation to component format
function convertToMockFormat(conv: ConversationData): Conversation {
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
    // Use the sentimentTag directly if available, otherwise use classification
    classification: (conv.sentimentTag?.toLowerCase().replace(/\s+/g, "-") || conv.classification) as Conversation["classification"],
    lastMessage: conv.lastMessage,
    lastMessageTime: new Date(conv.lastMessageTime),
    messages: [],
    hasAiDraft: conv.hasAiDraft,
    requiresAttention: conv.requiresAttention,
  };
}

export function InboxView({ activeChannel, activeFilter }: InboxViewProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [isCrmOpen, setIsCrmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [useMockData, setUseMockData] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const realtimeConnectedRef = useRef(false);

  // Fetch conversations from database
  const fetchConversations = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    
    try {
      const result = await getConversations();
      if (result.success && result.data && result.data.length > 0) {
        const converted = result.data.map(convertToMockFormat);
        setConversations(converted);
        setUseMockData(false);
        setLastUpdate(new Date());
        
        // Set first conversation as active if none selected
        if (!activeConversationId && converted.length > 0) {
          setActiveConversationId(converted[0].id);
        }
      } else {
        // Fall back to mock data if no real data
        setConversations(mockConversations);
        setUseMockData(true);
        if (!activeConversationId && mockConversations.length > 0) {
          setActiveConversationId(mockConversations[0].id);
        }
      }
    } catch (error) {
      console.error("Error fetching conversations:", error);
      setConversations(mockConversations);
      setUseMockData(true);
    } finally {
      setIsLoading(false);
    }
  }, [activeConversationId]);

  // Fetch full conversation when active conversation changes
  const fetchActiveConversation = useCallback(async () => {
    if (!activeConversationId) {
      setActiveConversation(null);
      return;
    }

    // If using mock data, find from mock
    if (useMockData) {
      const mock = mockConversations.find((c) => c.id === activeConversationId);
      setActiveConversation(mock || null);
      return;
    }

    // Otherwise fetch from DB
    const result = await getConversation(activeConversationId);
    if (result.success && result.data) {
      // Find the base conversation from our list
      const baseConv = conversations.find((c) => c.id === activeConversationId);
      if (baseConv) {
        setActiveConversation({
          ...baseConv,
          messages: result.data.messages,
        });
      }
    }
  }, [activeConversationId, useMockData, conversations]);

  // Initial data fetch
  useEffect(() => {
    fetchConversations(true);
  }, []);

  // Fetch active conversation when selection changes
  useEffect(() => {
    fetchActiveConversation();
  }, [fetchActiveConversation]);

  // Set up realtime subscriptions - ALWAYS try to connect
  useEffect(() => {
    console.log("[Realtime] Setting up subscriptions...");

    // Subscribe to new messages
    const messagesChannel = subscribeToMessages((payload) => {
      console.log("[Realtime] New message received:", payload);
      realtimeConnectedRef.current = true;
      setIsLive(true);
      fetchConversations();
    });

    // Subscribe to lead updates
    const leadsChannel = subscribeToLeads((payload) => {
      console.log("[Realtime] Lead updated:", payload);
      realtimeConnectedRef.current = true;
      setIsLive(true);
      fetchConversations();
    });

    // Check connection status after a delay
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

  // Set up polling as fallback (always active, but less frequent if realtime works)
  useEffect(() => {
    // Clear existing polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    // Set up polling
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
