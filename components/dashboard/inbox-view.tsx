"use client";

import { useState, useEffect, useCallback } from "react";
import { ConversationFeed } from "./conversation-feed";
import { ActionStation } from "./action-station";
import { CrmDrawer } from "./crm-drawer";
import { getConversations, getConversation, type ConversationData } from "@/actions/lead-actions";
import { subscribeToMessages, subscribeToLeads, unsubscribe } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { mockConversations, type Conversation, type Lead } from "@/lib/mock-data";

interface InboxViewProps {
  activeChannel: string;
  activeFilter: string;
}

// Convert DB conversation to mock format for compatibility
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
    classification: conv.classification as Conversation["classification"],
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

  // Fetch conversations from database
  const fetchConversations = useCallback(async () => {
    try {
      const result = await getConversations();
      if (result.success && result.data && result.data.length > 0) {
        const converted = result.data.map(convertToMockFormat);
        setConversations(converted);
        setUseMockData(false);
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
    fetchConversations();
  }, [fetchConversations]);

  // Fetch active conversation when selection changes
  useEffect(() => {
    fetchActiveConversation();
  }, [fetchActiveConversation]);

  // Set up realtime subscriptions
  useEffect(() => {
    if (useMockData) return;

    // Subscribe to new messages
    const messagesChannel = subscribeToMessages(() => {
      // Refresh conversations when new message arrives
      fetchConversations();
    });

    // Subscribe to lead updates
    const leadsChannel = subscribeToLeads(() => {
      // Refresh conversations when lead is updated
      fetchConversations();
    });

    return () => {
      unsubscribe(messagesChannel);
      unsubscribe(leadsChannel);
    };
  }, [useMockData, fetchConversations]);

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

