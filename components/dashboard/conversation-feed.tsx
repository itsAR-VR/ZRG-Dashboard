"use client"

import { useState, useMemo } from "react"
import type { Conversation } from "@/lib/mock-data"
import { ConversationCard } from "./conversation-card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, RefreshCw, Loader2 } from "lucide-react"

type SortOption = "recent" | "oldest" | "name-az" | "name-za"

// Available sentiment tags for filtering
const SENTIMENT_OPTIONS = [
  { value: "all", label: "All Sentiments" },
  { value: "Meeting Requested", label: "Meeting Requested" },
  { value: "Call Requested", label: "Call Requested" },
  { value: "Information Requested", label: "Info Requested" },
  { value: "Not Interested", label: "Not Interested" },
  { value: "Blacklist", label: "Blacklist" },
  { value: "Follow Up", label: "Follow Up" },
  { value: "Out of Office", label: "Out of Office" },
  { value: "Positive", label: "Positive" },
  { value: "Neutral", label: "Neutral" },
] as const

interface ConversationFeedProps {
  conversations: Conversation[]
  activeConversationId: string | null
  onSelectConversation: (id: string) => void
  activeSentiment?: string
  onSentimentChange?: (sentiment: string) => void
  syncingLeadIds?: Set<string>
  onSyncAll?: () => Promise<void>
  isSyncingAll?: boolean
}

export function ConversationFeed({ 
  conversations, 
  activeConversationId, 
  onSelectConversation,
  activeSentiment = "all",
  onSentimentChange,
  syncingLeadIds = new Set(),
  onSyncAll,
  isSyncingAll = false,
}: ConversationFeedProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [sortBy, setSortBy] = useState<SortOption>("recent")

  // Filter conversations by search query
  const filteredConversations = useMemo(() => {
    return conversations.filter(
      (conv) =>
        conv.lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        conv.lead.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
        conv.lastMessage.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (conv.lastSubject && conv.lastSubject.toLowerCase().includes(searchQuery.toLowerCase())),
    )
  }, [conversations, searchQuery])

  // Sort filtered conversations
  const sortedConversations = useMemo(() => {
    const sorted = [...filteredConversations]
    
    switch (sortBy) {
      case "recent":
        return sorted.sort((a, b) => 
          new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
        )
      case "oldest":
        return sorted.sort((a, b) => 
          new Date(a.lastMessageTime).getTime() - new Date(b.lastMessageTime).getTime()
        )
      case "name-az":
        return sorted.sort((a, b) => 
          a.lead.name.localeCompare(b.lead.name)
        )
      case "name-za":
        return sorted.sort((a, b) => 
          b.lead.name.localeCompare(a.lead.name)
        )
      default:
        return sorted
    }
  }, [filteredConversations, sortBy])

  // Count SMS conversations for sync all button
  const smsCount = conversations.filter(c => c.channels?.includes("sms")).length

  return (
    <div className="flex h-full w-80 flex-col border-r border-border bg-background">
      {/* Search & Filters */}
      <div className="space-y-3 border-b border-border p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="flex-1 text-xs">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most Recent</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="name-az">Name A-Z</SelectItem>
              <SelectItem value="name-za">Name Z-A</SelectItem>
            </SelectContent>
          </Select>
          <Select 
            value={activeSentiment} 
            onValueChange={onSentimentChange}
          >
            <SelectTrigger className="flex-1 text-xs">
              <SelectValue placeholder="Sentiment" />
            </SelectTrigger>
            <SelectContent>
              {SENTIMENT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Sync All Button */}
        {onSyncAll && smsCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={onSyncAll}
            disabled={isSyncingAll}
          >
            {isSyncingAll ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Syncing All SMS...
              </>
            ) : (
              <>
                <RefreshCw className="h-3 w-3 mr-1.5" />
                Sync All SMS ({smsCount})
              </>
            )}
          </Button>
        )}
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {sortedConversations.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">No conversations found</div>
        ) : (
          sortedConversations.map((conversation) => (
            <ConversationCard
              key={conversation.id}
              conversation={conversation}
              isActive={activeConversationId === conversation.id}
              onClick={() => onSelectConversation(conversation.id)}
              isSyncing={syncingLeadIds.has(conversation.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}
