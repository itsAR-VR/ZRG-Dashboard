"use client"

import { memo, useState, useMemo, useRef, useCallback, useEffect } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useDebouncedCallback } from "use-debounce"
import type { Conversation } from "@/lib/mock-data"
import { ConversationCard } from "./conversation-card"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Search, RefreshCw, Loader2, ChevronsUp, ChevronsDown, MessageSquare, Inbox, ChevronDown } from "lucide-react"

type SortOption = "recent" | "oldest" | "name-az" | "name-za"

// Estimated card height for virtualization (actual height is measured dynamically)
const ESTIMATED_CARD_HEIGHT = 160
const EMPTY_SMS_CLIENT_OPTIONS: Array<{ id: string; name: string; leadCount: number }> = []
const EMPTY_SYNCING_LEAD_IDS = new Set<string>()

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

// Lead score filter options (Phase 33)
const SCORE_FILTER_OPTIONS = [
  { value: "all", label: "All Scores" },
  { value: "4", label: "4 only (High priority)" },
  { value: "3+", label: "3+ (Good fit)" },
  { value: "2+", label: "2+ (Possible fit)" },
  { value: "1+", label: "1+ (Scored)" },
  { value: "unscored", label: "Unscored" },
  { value: "disqualified", label: "Disqualified" },
] as const

export type ScoreFilter = typeof SCORE_FILTER_OPTIONS[number]["value"]

interface ConversationFeedProps {
  conversations: Conversation[]
  activeConversationId: string | null
  onSelectConversation: (id: string) => void
  onDebouncedSearchChange?: (query: string) => void
  activeSentiments?: string[]
  onSentimentsChange?: (sentiments: string[]) => void
  activeSmsClient?: string
  onSmsClientChange?: (smsClientId: string) => void
  smsClientOptions?: Array<{ id: string; name: string; leadCount: number }>
  smsClientUnattributedCount?: number
  isLoadingSmsClients?: boolean
  // Lead score filter (Phase 33)
  activeScoreFilter?: ScoreFilter
  onScoreFilterChange?: (filter: ScoreFilter) => void
  syncingLeadIds?: Set<string>
  onSyncAll?: (forceReclassify: boolean) => Promise<void>
  isSyncingAll?: boolean
  onReanalyzeAllSentiments?: (leadIds: string[]) => Promise<void>
  isReanalyzingAllSentiments?: boolean
  autoFollowUpsOnReplyEnabled?: boolean
  onToggleAutoFollowUpsOnReply?: (enabled: boolean) => Promise<void>
  isTogglingAutoFollowUpsOnReply?: boolean
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
}

export const ConversationFeed = memo(function ConversationFeed({
  conversations,
  activeConversationId,
  onSelectConversation,
  onDebouncedSearchChange,
  activeSentiments = [],
  onSentimentsChange,
  activeSmsClient = "all",
  onSmsClientChange,
  smsClientOptions = EMPTY_SMS_CLIENT_OPTIONS,
  smsClientUnattributedCount = 0,
  isLoadingSmsClients = false,
  activeScoreFilter = "all",
  onScoreFilterChange,
  syncingLeadIds = EMPTY_SYNCING_LEAD_IDS,
  onSyncAll,
  isSyncingAll = false,
  onReanalyzeAllSentiments,
  isReanalyzingAllSentiments = false,
  autoFollowUpsOnReplyEnabled = false,
  onToggleAutoFollowUpsOnReply,
  isTogglingAutoFollowUpsOnReply = false,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: ConversationFeedProps) {
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [sortBy, setSortBy] = useState<SortOption>("recent")
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const isServerSearch = Boolean(onDebouncedSearchChange)
  
  // Ref for virtualization
  const parentRef = useRef<HTMLDivElement>(null)

  // Debounced search
  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    if (!isServerSearch) setDebouncedSearch(value)
    onDebouncedSearchChange?.(value)
  }, 300)

  useEffect(() => {
    if (typeof window === "undefined") return

    const updateViewport = () => {
      const nextIsMobile = window.innerWidth < 768
      setIsMobile(nextIsMobile)
      setFiltersOpen(!nextIsMobile)
      if (!nextIsMobile) {
        setSidebarOpen(false)
      }
    }

    updateViewport()
    window.addEventListener("resize", updateViewport)
    return () => window.removeEventListener("resize", updateViewport)
  }, [])

  useEffect(() => {
    if (isMobile && !activeConversationId) {
      setSidebarOpen(true)
    }
  }, [isMobile, activeConversationId])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value)
    debouncedSetSearch(e.target.value)
  }, [debouncedSetSearch])

  // Filter conversations by search query
  const filteredConversations = useMemo(() => {
    // Inbox search is server-side; client-side filtering causes flicker / incorrect counts while fetching.
    if (isServerSearch) return conversations
    if (!debouncedSearch) return conversations
    
    const searchLower = debouncedSearch.toLowerCase()
    return conversations.filter(
      (conv) =>
        conv.lead.name.toLowerCase().includes(searchLower) ||
        (conv.lead.email || "").toLowerCase().includes(searchLower) ||
        conv.lead.company.toLowerCase().includes(searchLower) ||
        (conv.lead.smsCampaignName || "").toLowerCase().includes(searchLower) ||
        conv.lastMessage.toLowerCase().includes(searchLower) ||
        (conv.lastSubject && conv.lastSubject.toLowerCase().includes(searchLower)),
    )
  }, [conversations, debouncedSearch, isServerSearch])

  const messageTimeById = useMemo(() => {
    const byId = new Map<string, number>()
    for (const conversation of filteredConversations) {
      byId.set(conversation.id, new Date(conversation.lastMessageTime).getTime())
    }
    return byId
  }, [filteredConversations])

  // Sort filtered conversations
  const sortedConversations = useMemo(() => {
    const sorted = [...filteredConversations]
    
    switch (sortBy) {
      case "recent":
        return sorted.sort((a, b) => 
          (messageTimeById.get(b.id) ?? 0) - (messageTimeById.get(a.id) ?? 0)
        )
      case "oldest":
        return sorted.sort((a, b) => 
          (messageTimeById.get(a.id) ?? 0) - (messageTimeById.get(b.id) ?? 0)
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
  }, [filteredConversations, sortBy, messageTimeById])

  // Setup virtualizer with dynamic height measurement
  const rowVirtualizer = useVirtualizer({
    count: hasMore ? sortedConversations.length + 1 : sortedConversations.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => {
      if (index >= sortedConversations.length) return "load-more"
      return sortedConversations[index]?.id ?? `conversation-${index}`
    },
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

  const sentimentTriggerLabel =
    activeSentiments.length === 0 ? "All Sentiments" : `${activeSentiments.length} selected`

  const toggleSentiment = useCallback((value: string, checked: boolean) => {
    if (!onSentimentsChange) return
    const next = new Set(activeSentiments)
    if (checked) next.add(value)
    else next.delete(value)

    // Preserve stable UI ordering (same as SENTIMENT_OPTIONS order)
    const ordered = SENTIMENT_OPTIONS
      .filter((o) => o.value !== "all" && next.has(o.value))
      .map((o) => o.value)

    onSentimentsChange(ordered)
  }, [activeSentiments, onSentimentsChange])

  const activeFiltersCount =
    (searchInput.trim() ? 1 : 0) +
    (activeSentiments.length > 0 ? 1 : 0) +
    (activeSmsClient !== "all" ? 1 : 0) +
    (activeScoreFilter !== "all" ? 1 : 0) +
    (sortBy !== "recent" ? 1 : 0)

  const hasActiveFilters = activeFiltersCount > 0

  const clearFilters = useCallback(() => {
    setSearchInput("")
    if (!isServerSearch) setDebouncedSearch("")
    onDebouncedSearchChange?.("")
    onSentimentsChange?.([])
    onSmsClientChange?.("all")
    onScoreFilterChange?.("all")
    setSortBy("recent")
  }, [
    isServerSearch,
    onDebouncedSearchChange,
    onScoreFilterChange,
    onSentimentsChange,
    onSmsClientChange,
  ])

  const handleSelectConversation = useCallback((id: string) => {
    onSelectConversation(id)
    setSidebarOpen(false)
  }, [onSelectConversation])

  const feedContent = (
    <div className="flex h-full flex-col">
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

        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} className="space-y-3">
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="h-11 w-full justify-between md:hidden">
              <span>Filters</span>
              <div className="flex items-center gap-2">
                {activeFiltersCount > 0 && <Badge variant="secondary">{activeFiltersCount}</Badge>}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    filtersOpen && "rotate-180"
                  )}
                />
              </div>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3">
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="flex-1 justify-between text-xs"
                    type="button"
                  >
                    <span className="truncate">{sentimentTriggerLabel}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuCheckboxItem
                    checked={activeSentiments.length === 0}
                    onCheckedChange={(checked) => {
                      if (checked) onSentimentsChange?.([])
                    }}
                  >
                    All Sentiments
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  {SENTIMENT_OPTIONS.filter((o) => o.value !== "all").map((option) => (
                    <DropdownMenuCheckboxItem
                      key={option.value}
                      checked={activeSentiments.includes(option.value)}
                      onCheckedChange={(checked) => toggleSentiment(option.value, Boolean(checked))}
                    >
                      {option.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
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

            {/* Lead score filter (Phase 33) */}
            {onScoreFilterChange && (
              <Select
                value={activeScoreFilter}
                onValueChange={(v) => onScoreFilterChange(v as ScoreFilter)}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue placeholder="Lead Score" />
                </SelectTrigger>
                <SelectContent>
                  {SCORE_FILTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
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
                  className="min-h-11 min-w-11"
                  onClick={jumpToTop}
                  aria-label="Jump to top"
                >
                  <ChevronsUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-11 min-w-11"
                  onClick={jumpToBottom}
                  aria-label="Jump to bottom"
                >
                  <ChevronsDown className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground ml-2">
                  {sortedConversations.length} conversations
                </span>
              </div>
            </div>

            {/* Sync / Re-analyze All */}
            {onSyncAll && activeCount > 0 && (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => onSyncAll(false)}
                  disabled={isSyncingAll || isReanalyzingAllSentiments}
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
                {onReanalyzeAllSentiments && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => onReanalyzeAllSentiments(filteredConversations.map((c) => c.id))}
                    disabled={isSyncingAll || isReanalyzingAllSentiments}
                    title="Re-analyze sentiment tags using existing message history (no sync)"
                  >
                    {isReanalyzingAllSentiments ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                        Re-analyzing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-3 w-3 mr-1.5" />
                        Re-analyze All Sentiments ({activeCount})
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* Workspace switch: Auto-enable follow-ups on positive inbound EMAIL replies */}
            {onToggleAutoFollowUpsOnReply && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <span id="auto-followups-reply-label" className="text-sm">Auto Follow-ups (Positive Replies)</span>
                  <p className="text-xs text-muted-foreground">
                    Auto-enroll leads after a positive inbound email reply
                  </p>
                </div>
                <Switch
                  id="auto-followups-reply-switch"
                  aria-labelledby="auto-followups-reply-label"
                  checked={autoFollowUpsOnReplyEnabled}
                  disabled={isTogglingAutoFollowUpsOnReply}
                  onCheckedChange={(v) => onToggleAutoFollowUpsOnReply(v)}
                />
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Virtualized Conversation List */}
      <div 
        ref={parentRef}
        className="flex-1 overflow-y-auto p-3"
      >
        {sortedConversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Inbox className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">No conversations found</h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-[240px]">
              {hasActiveFilters
                ? "Try adjusting your filters to see more results."
                : "New conversations will appear here when leads respond."}
            </p>
            {hasActiveFilters && (
              <Button variant="link" onClick={clearFilters} className="mt-2">
                Clear all filters
              </Button>
            )}
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
                    onClick={() => handleSelectConversation(conversation.id)}
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

  return (
    <>
      {isMobile ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="fixed bottom-4 left-4 z-40 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open conversation list"
          >
            <MessageSquare className="h-5 w-5" />
          </Button>
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-80 p-0">
              {feedContent}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <div className="flex h-full w-80 flex-col border-r border-border bg-background">
          {feedContent}
        </div>
      )}
    </>
  )
})

// Preserve a readable name for production component stacks (webpack minification renames functions).
;(ConversationFeed as any).displayName = "ConversationFeed"

ConversationFeed.displayName = "ConversationFeed"
