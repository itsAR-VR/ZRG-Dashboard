"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useDebouncedCallback } from "use-debounce"
import {
  Search,
  Filter,
  Download,
  Plus,
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  MoreHorizontal,
  Building2,
  Clock,
  Loader2,
  MessageSquare,
  Users,
  ExternalLink,
  Linkedin,
  Globe,
  MapPin,
  Sparkles,
  ChevronsUp,
  ChevronsDown,
  RefreshCw,
  Moon,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { toDisplayPhone } from "@/lib/phone-utils"
import { 
  getCRMLeadsCursor, 
  updateLeadStatus, 
  deleteLead, 
  type CRMLeadData,
  type CRMLeadsCursorOptions 
} from "@/actions/crm-actions"
import { refreshAndEnrichLead } from "@/actions/enrichment-actions"
import { subscribeToLeads, unsubscribe } from "@/lib/supabase"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type LeadStatus = "new" | "qualified" | "unqualified" | "meeting-booked" | "not-interested" | "blacklisted"

const statusColors: Record<LeadStatus, string> = {
  new: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  qualified: "bg-green-500/10 text-green-500 border-green-500/20",
  unqualified: "bg-slate-500/10 text-slate-500 border-slate-500/20",
  "meeting-booked": "bg-primary/10 text-primary border-primary/20",
  "not-interested": "bg-muted text-muted-foreground border-muted",
  blacklisted: "bg-destructive/10 text-destructive border-destructive/20",
}

const statusLabels: Record<LeadStatus, string> = {
  new: "New",
  qualified: "Qualified",
  unqualified: "Unqualified",
  "meeting-booked": "Meeting Booked",
  "not-interested": "Not Interested",
  blacklisted: "Blacklisted",
}

function LeadScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "text-green-500" : score >= 50 ? "text-yellow-500" : "text-red-500"
  const bg = score >= 80 ? "bg-green-500/10" : score >= 50 ? "bg-yellow-500/10" : "bg-red-500/10"
  return (
    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold ${color} ${bg}`}>
      {score}
    </span>
  )
}

interface LeadDetailSheetProps {
  lead: CRMLeadData | null
  open: boolean
  onClose: () => void
  onStatusChange: (id: string, status: LeadStatus) => void
  onOpenInInbox?: (leadId: string) => void
  onLeadUpdate?: () => void
}

function LeadDetailSheet({ lead, open, onClose, onStatusChange, onOpenInInbox, onLeadUpdate }: LeadDetailSheetProps) {
  const [isEnriching, setIsEnriching] = useState(false)

  if (!lead) return null

  const smsClient = lead.smsCampaignName?.trim() || null
  const isSmsAccountWorkspace = ["owen", "uday 18th", "uday18th", "u-day 18th"].includes(
    lead.company.toLowerCase()
  )
  const smsClientLine = smsClient
    ? `Client: ${smsClient}`
    : isSmsAccountWorkspace
      ? "Client: Unattributed"
      : null

  // Manual enrichment rules:
  // - Available for EmailBison leads (has emailBisonLeadId)
  // - DISABLED for sentiment tags: Not Interested, Blacklist, Neutral
  // - ENABLED for all other sentiments including new/no sentiment
  // - Can force re-enrich even if LinkedIn/phone already exist
  const BLOCKED_SENTIMENTS = ["Not Interested", "Blacklist", "Neutral"]
  const isBlockedSentiment = BLOCKED_SENTIMENTS.includes(lead.sentimentTag || "")
  const canEnrich = !!lead.emailBisonLeadId && !isBlockedSentiment
  const enrichmentDisabledReason = !lead.emailBisonLeadId 
    ? "No EmailBison lead ID" 
    : isBlockedSentiment 
      ? `Enrichment blocked for "${lead.sentimentTag}" sentiment` 
      : null

  const handleEnrichLead = async () => {
    setIsEnriching(true)
    try {
      const result = await refreshAndEnrichLead(lead.id)
      
      if (result.success) {
        const updates: string[] = []
        if (result.fromEmailBison.linkedinUrl) updates.push("LinkedIn URL")
        if (result.fromEmailBison.phone) updates.push("Phone")
        if (result.fromEmailBison.companyName) updates.push("Company")
        
        const clayTriggers: string[] = []
        if (result.clayTriggered.linkedin) clayTriggers.push("LinkedIn")
        if (result.clayTriggered.phone) clayTriggers.push("Phone")
        
        let message = ""
        if (updates.length > 0) message += `Found: ${updates.join(", ")}. `
        if (clayTriggers.length > 0) message += `Clay enrichment triggered for: ${clayTriggers.join(", ")}`
        if (!message) message = "Lead data is up to date"
        
        toast.success("Enrichment complete", { description: message })
        onLeadUpdate?.()
      } else {
        toast.error("Enrichment failed", { description: result.error })
      }
    } catch (error) {
      toast.error("Enrichment failed", { 
        description: error instanceof Error ? error.message : "Unknown error" 
      })
    } finally {
      setIsEnriching(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[450px] sm:max-w-[450px]">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl">{lead.name}</SheetTitle>
            <LeadScoreBadge score={lead.leadScore} />
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6 px-6">
          <div>
            <p className="text-muted-foreground">{lead.title || "No title"}</p>
            <p className="flex items-center gap-1 text-primary">
              {lead.company}
            </p>
            {smsClientLine && (
              <p className="text-sm text-muted-foreground">{smsClientLine}</p>
            )}
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm uppercase text-muted-foreground tracking-wider">Contact Info</h4>
              <div className="flex items-center gap-2">
                {lead.smsDndActive ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-amber-500/30 bg-amber-500/10 text-amber-600"
                    title="SMS DND detected in GoHighLevel"
                  >
                    <Moon className="h-3 w-3 mr-1" />
                    DND
                  </Badge>
                ) : null}
                {lead.enrichmentStatus && (
                  <Badge 
                    variant="outline" 
                    className={cn(
                      "text-[10px]",
                    lead.enrichmentStatus === "enriched" && "text-green-500 border-green-500/30 bg-green-500/10",
                    lead.enrichmentStatus === "pending" && "text-amber-500 border-amber-500/30 bg-amber-500/10",
                    lead.enrichmentStatus === "not_found" && "text-red-500 border-red-500/30 bg-red-500/10",
                    lead.enrichmentStatus === "not_needed" && "text-muted-foreground"
                  )}
                >
                    {lead.enrichmentStatus === "enriched" ? "Enriched" :
                     lead.enrichmentStatus === "pending" ? "Pending" :
                     lead.enrichmentStatus === "not_found" ? "Not Found" :
                     lead.enrichmentStatus === "not_needed" ? "Complete" : lead.enrichmentStatus}
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{lead.email || "No email"}</span>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{lead.phone ? toDisplayPhone(lead.phone) ?? lead.phone : "No phone"}</span>
              </div>
              {lead.linkedinUrl && (
                <div className="flex items-center gap-3">
                  <Linkedin className="h-4 w-4 text-[#0A66C2]" />
                  <a
                    href={lead.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline truncate"
                  >
                    {lead.linkedinUrl.replace("https://linkedin.com/in/", "")}
                  </a>
                </div>
              )}
              {lead.companyWebsite && (
                <div className="flex items-center gap-3">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={lead.companyWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline truncate"
                  >
                    {lead.companyWebsite.replace("https://", "").replace("http://", "")}
                  </a>
                </div>
              )}
              {lead.companyName && (
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{lead.companyName}</span>
                </div>
              )}
              {lead.companyState && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{lead.companyState}</span>
                </div>
              )}
              <div className="flex items-center gap-3">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{lead.messageCount} messages</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  Last updated: {new Date(lead.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="font-semibold text-sm uppercase text-muted-foreground tracking-wider">Sentiment</h4>
            <Badge variant="outline" className="text-sm">
              {lead.sentimentTag || "No sentiment"}
            </Badge>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="font-semibold text-sm uppercase text-muted-foreground tracking-wider">Status</h4>
            <Select 
              value={lead.status} 
              onValueChange={(value) => onStatusChange(lead.id, value as LeadStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="unqualified">Unqualified</SelectItem>
                <SelectItem value="meeting-booked">Meeting Booked</SelectItem>
                <SelectItem value="not-interested">Not Interested</SelectItem>
                <SelectItem value="blacklisted">Blacklisted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="pt-4 space-y-2">
            <Button 
              className="w-full" 
              onClick={() => {
                if (lead.ghlContactId && lead.ghlLocationId) {
                  window.open(
                    `https://app.gohighlevel.com/v2/location/${lead.ghlLocationId}/contacts/detail/${lead.ghlContactId}`,
                    '_blank'
                  )
                }
              }}
              disabled={!lead.ghlContactId || !lead.ghlLocationId}
              title={!lead.ghlContactId ? "No GHL contact linked" : !lead.ghlLocationId ? "No GHL location configured" : undefined}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in Go High-Level
            </Button>
            <Button 
              variant="outline"
              className="w-full" 
              onClick={() => {
                onOpenInInbox?.(lead.id)
                onClose()
              }}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in Master Inbox
            </Button>
            <Button 
              variant="outline"
              className="w-full" 
              onClick={handleEnrichLead}
              disabled={isEnriching || !canEnrich}
              title={enrichmentDisabledReason || undefined}
            >
              {isEnriching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {isEnriching ? "Enriching..." : "Enrich Lead"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Row height for virtualization (increased for better spacing with two-line content)
const ROW_HEIGHT = 80

interface CRMViewProps {
  activeWorkspace?: string | null
  onOpenInInbox?: (leadId: string) => void
}

export function CRMView({ activeWorkspace, onOpenInInbox }: CRMViewProps) {
  // Search state with debouncing
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  
  // Filter states
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [sortField, setSortField] = useState<"firstName" | "leadScore" | "updatedAt">("updatedAt")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  
  // UI states
  const [selectedLead, setSelectedLead] = useState<CRMLeadData | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [newLeadCount, setNewLeadCount] = useState(0)
  
  // Refs for virtualization
  const parentRef = useRef<HTMLDivElement>(null)

  // Debounced search callback
  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    setDebouncedSearch(value)
  }, 300)

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value)
    debouncedSetSearch(e.target.value)
  }

  // Query options for infinite query
  const queryOptions: CRMLeadsCursorOptions = useMemo(() => ({
    clientId: activeWorkspace,
    search: debouncedSearch || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    sortField,
    sortDirection,
    limit: 50,
  }), [activeWorkspace, debouncedSearch, statusFilter, sortField, sortDirection])

  // Infinite query for leads
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["crm-leads", queryOptions],
    queryFn: async ({ pageParam }) => {
      const result = await getCRMLeadsCursor({
        ...queryOptions,
        cursor: pageParam as string | null,
      })
      if (!result.success) {
        throw new Error(result.error || "Failed to fetch leads")
      }
      return result
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30000, // 30 seconds
  })

  // Flatten all pages into a single array
  const allLeads = useMemo(() => {
    return data?.pages.flatMap((page) => page.leads) || []
  }, [data])

  // Sync selectedLead with latest data when allLeads changes
  useEffect(() => {
    if (selectedLead && allLeads.length > 0) {
      const updated = allLeads.find(l => l.id === selectedLead.id)
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedLead)) {
        setSelectedLead(updated)
      }
    }
  }, [allLeads, selectedLead?.id])

  // Setup virtualizer
  const rowVirtualizer = useVirtualizer({
    count: hasNextPage ? allLeads.length + 1 : allLeads.length, // +1 for load more row
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  // Load more when scrolling near the end
  // Note: We use virtualItems length change as a proxy for scroll position changes
  const virtualItems = rowVirtualizer.getVirtualItems()
  const lastVirtualItem = virtualItems.at(-1)
  
  useEffect(() => {
    if (!lastVirtualItem) return

    if (
      lastVirtualItem.index >= allLeads.length - 1 &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      fetchNextPage()
    }
  }, [lastVirtualItem?.index, hasNextPage, isFetchingNextPage, allLeads.length, fetchNextPage])

  // Subscribe to realtime lead updates
  useEffect(() => {
    const channel = subscribeToLeads((payload) => {
      if (payload.eventType === "INSERT") {
        setNewLeadCount((prev) => prev + 1)
      }
    })
    return () => unsubscribe(channel)
  }, [])

  // Handle sort change
  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  // Handle status change
  const handleStatusChange = async (id: string, status: LeadStatus) => {
    await updateLeadStatus(id, status)
    refetch()
  }

  // Handle delete
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this lead?")) return
    await deleteLead(id)
    refetch()
  }

  // Open lead detail sheet
  const openLeadDetail = (lead: CRMLeadData) => {
    setSelectedLead(lead)
    setSheetOpen(true)
  }

  // Quick jump functions
  const jumpToTop = () => {
    rowVirtualizer.scrollToIndex(0)
  }

  const jumpToBottom = () => {
    // Scroll to the last currently loaded item
    // With cursor pagination, we can't efficiently jump to the absolute end
    // of a 50K+ dataset, so we scroll to whatever is currently loaded
    if (allLeads.length > 0) {
      rowVirtualizer.scrollToIndex(allLeads.length - 1)
      // If there are more pages, the infinite scroll will automatically load them
      // as the user continues scrolling
    }
  }

  // Handle new leads badge click
  const handleNewLeadsClick = () => {
    setNewLeadCount(0)
    refetch()
    jumpToTop()
  }

  // Sort icon component
  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null
    return sortDirection === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <p className="text-destructive">Error: {error?.message}</p>
        <Button variant="outline" onClick={() => refetch()} className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  // Empty state
  if (allLeads.length === 0 && !debouncedSearch && statusFilter === "all") {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b px-6 py-4">
          <h1 className="text-2xl font-bold">CRM / Leads</h1>
          <p className="text-muted-foreground">Manage your leads and contacts</p>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto">
              <Users className="h-12 w-12 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">No leads yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {activeWorkspace 
                  ? "This workspace doesn't have any leads yet. Leads will appear here when they start messaging."
                  : "Select a workspace to view its leads, or wait for incoming messages from your GHL integrations."
                }
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">CRM / Leads</h1>
            <p className="text-muted-foreground">
              {allLeads.length} leads loaded {hasNextPage && "(scroll for more)"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* New leads badge */}
            {newLeadCount > 0 && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleNewLeadsClick}
                className="bg-primary/10 border-primary/30 text-primary"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {newLeadCount} new lead{newLeadCount > 1 ? "s" : ""} - Click to refresh
              </Button>
            )}
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Lead
            </Button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4 flex-1 overflow-hidden flex flex-col">
        {/* Search and filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search leads..."
              className="pl-9"
              value={searchInput}
              onChange={handleSearchChange}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="qualified">Qualified</SelectItem>
              <SelectItem value="unqualified">Unqualified</SelectItem>
              <SelectItem value="meeting-booked">Meeting Booked</SelectItem>
              <SelectItem value="not-interested">Not Interested</SelectItem>
              <SelectItem value="blacklisted">Blacklisted</SelectItem>
            </SelectContent>
          </Select>
          
          {/* Quick jump buttons */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={jumpToTop} title="Jump to top">
              <ChevronsUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={jumpToBottom} title="Jump to bottom">
              <ChevronsDown className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Virtualized table */}
          <Card className="flex-1 overflow-hidden">
            {/* Table header */}
            <div className="border-b bg-muted/30">
              <div className="flex items-center h-12 px-4">
              <div 
                className="flex-[3] min-w-[200px] cursor-pointer hover:bg-muted/50 px-2 py-1 rounded flex items-center gap-1"
                onClick={() => handleSort("firstName")}
              >
                Name <SortIcon field="firstName" />
              </div>
              <div className="flex-[2] min-w-[150px]">Workspace / Client</div>
              <div className="w-[150px]">Sentiment</div>
              <div 
                className="w-[80px] cursor-pointer hover:bg-muted/50 px-2 py-1 rounded flex items-center gap-1"
                onClick={() => handleSort("leadScore")}
              >
                Score <SortIcon field="leadScore" />
              </div>
              <div className="w-[160px]">Status</div>
              <div className="w-[50px] text-right">Actions</div>
            </div>
          </div>
          
          {/* Virtualized rows */}
          <div
            ref={parentRef}
            className="overflow-auto"
            style={{ height: "calc(100% - 48px)" }}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const isLoadMoreRow = virtualRow.index >= allLeads.length

                if (isLoadMoreRow) {
                  return (
                    <div
                      key="load-more"
                      className="absolute top-0 left-0 w-full flex items-center justify-center"
                      style={{
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {isFetchingNextPage ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : hasNextPage ? (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => fetchNextPage()}
                        >
                          Load more
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground">End of list</span>
                      )}
                    </div>
                  )
                }

                const lead = allLeads[virtualRow.index]

                return (
                  <div
                    key={lead.id}
                    className="absolute top-0 left-0 w-full flex items-center px-4 border-b hover:bg-muted/50 cursor-pointer"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    onClick={() => openLeadDetail(lead)}
                  >
                    {/* Name */}
                    <div className="flex-[3] min-w-[200px] pr-2">
                      <p className="font-medium truncate">{lead.name}</p>
                      <p className="text-sm text-muted-foreground truncate">{lead.email || "No email"}</p>
                    </div>
                    
                    {/* Company */}
                    <div className="flex-[2] min-w-[150px] flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate">{lead.company}</div>
                        {lead.smsCampaignName ? (
                          <div className="text-xs text-muted-foreground truncate">
                            Client: {lead.smsCampaignName}
                          </div>
                        ) : ["owen", "uday 18th", "uday18th", "u-day 18th"].includes(lead.company.toLowerCase()) ? (
                          <div className="text-xs text-muted-foreground truncate">
                            Client: Unattributed
                          </div>
                        ) : null}
                      </div>
                    </div>
                    
                    {/* Sentiment */}
                    <div className="w-[150px]">
                      <div className="flex flex-wrap items-center gap-1">
                        {lead.sentimentTag ? (
                          <Badge variant="outline" className="text-xs">
                            {lead.sentimentTag}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                        {lead.smsDndActive ? (
                          <Badge
                            variant="outline"
                            className="text-xs border-amber-500/30 bg-amber-500/10 text-amber-600"
                            title="SMS DND detected in GoHighLevel"
                          >
                            <Moon className="h-3 w-3 mr-1" />
                            DND
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    
                    {/* Score */}
                    <div className="w-[80px]">
                      <LeadScoreBadge score={lead.leadScore} />
                    </div>
                    
                    {/* Status */}
                    <div className="w-[160px]" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={lead.status}
                        onValueChange={(value) => handleStatusChange(lead.id, value as LeadStatus)}
                      >
                        <SelectTrigger
                          className={`w-[140px] h-8 text-xs ${statusColors[lead.status as LeadStatus] || statusColors.new}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">New</SelectItem>
                          <SelectItem value="qualified">Qualified</SelectItem>
                          <SelectItem value="unqualified">Unqualified</SelectItem>
                          <SelectItem value="meeting-booked">Meeting Booked</SelectItem>
                          <SelectItem value="not-interested">Not Interested</SelectItem>
                          <SelectItem value="blacklisted">Blacklisted</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {/* Actions */}
                    <div className="w-[50px] text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openLeadDetail(lead)}>
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onOpenInInbox?.(lead.id)}>
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Open in Master Inbox
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            className="text-destructive"
                            onClick={() => handleDelete(lead.id)}
                          >
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>

        {/* Footer info */}
        <div className="text-sm text-muted-foreground flex items-center justify-between">
          <span>
            Showing {allLeads.length} leads {hasNextPage && "(more available)"}
          </span>
          {isFetchingNextPage && (
            <span className="flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading more...
            </span>
          )}
        </div>
      </div>

      <LeadDetailSheet
        lead={selectedLead}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onStatusChange={handleStatusChange}
        onOpenInInbox={onOpenInInbox}
        onLeadUpdate={() => refetch()}
      />
    </div>
  )
}
