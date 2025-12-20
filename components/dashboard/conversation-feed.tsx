"use client"

import { useState, useMemo, useRef, useCallback } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useDebouncedCallback } from "use-debounce"
import type { Conversation } from "@/lib/mock-data"
import { ConversationCard } from "./conversation-card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Search, RefreshCw, Loader2, ChevronsUp, ChevronsDown } from "lucide-react"

type SortOption = "recent" | "oldest" | "name-az" | "name-za"

// Estimated card height for virtualization (actual height is measured dynamically)
const ESTIMATED_CARD_HEIGHT = 160

// Available sentiment tags for filtering
const SENTIMENT_OPTIONS = [
  { value: "all", label: "All Sentiments" },
  { value: "Meeting Requested", label: "Meeting Requested" },
  { value: "Call Requested", label: "Call Requested" },
  { value: "Information Requested", label: "Info Requested" },
  { value: "Interested", label: "Interested" },
  { value: "Not Interested", label: "Not Interested" },
  { value: "Blacklist", label: "Blacklist" },
  { value: "Follow Up", label: "Follow Up" },
  { value: "Out of Office", label: "Out of Office" },
  { value: "Automated Reply", label: "Automated Reply" },
  { value: "Neutral", label: "Neutral" },
] as const

interface ConversationFeedProps {
  conversations: Conversation[]
  activeConversationId: string | null
  onSelectConversation: (id: string) => void
  activeSentiment?: string
  onSentimentChange?: (sentiment: string) => void
  activeSmsClient?: string
  onSmsClientChange?: (smsClientId: string) => void
  smsClientOptions?: Array<{ id: string; name: string; leadCount: number }>
  smsClientUnattributedCount?: number
  isLoadingSmsClients?: boolean
  syncingLeadIds?: Set<string>
  onSyncAll?: (forceReclassify: boolean) => Promise<void>
  isSyncingAll?: boolean
  onEnableAutoFollowUpsForAttentionLeads?: () => Promise<void>
  isEnablingAutoFollowUps?: boolean
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
}

export function ConversationFeed({ 
  conversations, 
  activeConversationId, 
  onSelectConversation,
  activeSentiment = "all",
  onSentimentChange,
  activeSmsClient = "all",
  onSmsClientChange,
  smsClientOptions = [],
  smsClientUnattributedCount = 0,
  isLoadingSmsClients = false,
  syncingLeadIds = new Set(),
  onSyncAll,
  isSyncingAll = false,
  onEnableAutoFollowUpsForAttentionLeads,
  isEnablingAutoFollowUps = false,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: ConversationFeedProps) {
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [sortBy, setSortBy] = useState<SortOption>("recent")
  const [reanalyzeSentiments, setReanalyzeSentiments] = useState(false)
  
  // Ref for virtualization
  const parentRef = useRef<HTMLDivElement>(null)

  // Debounced search
  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    setDebouncedSearch(value)
  }, 300)

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value)
    debouncedSetSearch(e.target.value)
  }, [debouncedSetSearch])

  // Filter conversations by search query
  const filteredConversations = useMemo(() => {
    if (!debouncedSearch) return conversations
    
    const searchLower = debouncedSearch.toLowerCase()
    return conversations.filter(
      (conv) =>
        conv.lead.name.toLowerCase().includes(searchLower) ||
        conv.lead.company.toLowerCase().includes(searchLower) ||
        (conv.lead.smsCampaignName || "").toLowerCase().includes(searchLower) ||
        conv.lastMessage.toLowerCase().includes(searchLower) ||
        (conv.lastSubject && conv.lastSubject.toLowerCase().includes(searchLower)),
    )
  }, [conversations, debouncedSearch])

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

  // Setup virtualizer with dynamic height measurement
  const rowVirtualizer = useVirtualizer({
    count: hasMore ? sortedConversations.length + 1 : sortedConversations.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 5,
  })

  // Quick jump functions
  const jumpToTop = useCallback(() => {
    rowVirtualizer.scrollToIndex(0)
  }, [rowVirtualizer])

  const jumpToBottom = useCallback(() => {
    rowVirtualizer.scrollToIndex(sortedConversations.length - 1)
  }, [rowVirtualizer, sortedConversations.length])

  // Count active conversations for sync all button
  const activeCount = filteredConversations.length

  return (
    <div className="flex h-full w-80 flex-col border-r border-border bg-background">
      {/* Search & Filters */}
      <div className="space-y-3 border-b border-border p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchInput}
            onChange={handleSearchChange}
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

        {/* SMS sub-client filter (workspace-only) */}
        {onSmsClientChange && (
          <Select
            value={activeSmsClient}
            onValueChange={onSmsClientChange}
            disabled={isLoadingSmsClients}
          >
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="Client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              <SelectItem value="unattributed">
                Unattributed{smsClientUnattributedCount ? ` (${smsClientUnattributedCount})` : ""}
              </SelectItem>
              {smsClientOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{c.leadCount ? ` (${c.leadCount})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        
        {/* Quick jump buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-7 w-7"
              onClick={jumpToTop} 
              title="Jump to top"
            >
              <ChevronsUp className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              className="h-7 w-7" 
              onClick={jumpToBottom} 
              title="Jump to bottom"
            >
              <ChevronsDown className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground ml-2">
              {sortedConversations.length} conversations
            </span>
          </div>
        </div>
        
        {/* Sync All Button with Re-analyze option */}
        {onSyncAll && activeCount > 0 && (
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => onSyncAll(reanalyzeSentiments)}
              disabled={isSyncingAll}
            >
              {isSyncingAll ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                  Syncing All...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3 mr-1.5" />
                  Sync All ({activeCount})
                </>
              )}
            </Button>
            <div className="flex items-center gap-2">
              <Checkbox
                id="reanalyze-sentiments"
                checked={reanalyzeSentiments}
                onCheckedChange={(checked) => setReanalyzeSentiments(checked === true)}
                disabled={isSyncingAll}
              />
              <Label 
                htmlFor="reanalyze-sentiments" 
                className="text-xs text-muted-foreground cursor-pointer"
              >
                Re-analyze sentiments
              </Label>
            </div>
          </div>
        )}

        {/* Bulk-enable Auto Follow-ups for attention/positive leads */}
        {onEnableAutoFollowUpsForAttentionLeads && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => onEnableAutoFollowUpsForAttentionLeads()}
            disabled={isEnablingAutoFollowUps}
          >
            {isEnablingAutoFollowUps ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Enabling Auto Follow-ups...
              </>
            ) : (
              "Enable Auto Follow-ups (Attention)"
            )}
          </Button>
        )}
      </div>

      {/* Virtualized Conversation List */}
      <div 
        ref={parentRef}
        className="flex-1 overflow-y-auto p-3"
      >
        {sortedConversations.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No conversations found
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const isLoadMoreRow = virtualRow.index >= sortedConversations.length

              if (isLoadMoreRow) {
                return (
                  <div
                    key="load-more"
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute top-0 left-0 w-full flex items-center justify-center py-4"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {isLoadingMore ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : hasMore && onLoadMore ? (
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={onLoadMore}
                      >
                        Load more
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">End of list</span>
                    )}
                  </div>
                )
              }

              const conversation = sortedConversations[virtualRow.index]

              return (
                <div
                  key={conversation.id}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    padding: "4px 0",
                  }}
                >
                  <ConversationCard
                    conversation={conversation}
                    isActive={activeConversationId === conversation.id}
                    onClick={() => onSelectConversation(conversation.id)}
                    isSyncing={syncingLeadIds.has(conversation.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
