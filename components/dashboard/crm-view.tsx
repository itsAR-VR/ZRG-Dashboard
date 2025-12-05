"use client"

import { useState, useEffect } from "react"
import {
  Search,
  Filter,
  Download,
  Plus,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Mail,
  Phone,
  MoreHorizontal,
  Building2,
  Globe,
  Clock,
  Loader2,
  MessageSquare,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { getCRMLeads, updateLeadStatus, deleteLead, type CRMLeadData } from "@/actions/crm-actions"
import { mockLeads, type Lead } from "@/lib/mock-data"

type LeadStatus = "new" | "qualified" | "meeting-booked" | "not-interested" | "blacklisted"

const statusColors: Record<LeadStatus, string> = {
  new: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  qualified: "bg-green-500/10 text-green-500 border-green-500/20",
  "meeting-booked": "bg-primary/10 text-primary border-primary/20",
  "not-interested": "bg-muted text-muted-foreground border-muted",
  blacklisted: "bg-destructive/10 text-destructive border-destructive/20",
}

const statusLabels: Record<LeadStatus, string> = {
  new: "New",
  qualified: "Qualified",
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
}

function LeadDetailSheet({ lead, open, onClose, onStatusChange }: LeadDetailSheetProps) {
  if (!lead) return null

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[450px] sm:max-w-[450px]">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl">{lead.name}</SheetTitle>
            <LeadScoreBadge score={lead.leadScore} />
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div>
            <p className="text-muted-foreground">{lead.title || "No title"}</p>
            <p className="flex items-center gap-1 text-primary">
              {lead.company}
            </p>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="font-semibold text-sm uppercase text-muted-foreground tracking-wider">Contact Info</h4>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{lead.email || "No email"}</span>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{lead.phone || "No phone"}</span>
              </div>
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
                <SelectItem value="meeting-booked">Meeting Booked</SelectItem>
                <SelectItem value="not-interested">Not Interested</SelectItem>
                <SelectItem value="blacklisted">Blacklisted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-4">
            <Button className="flex-1" disabled={!lead.email}>
              <Mail className="h-4 w-4 mr-2" />
              Send Email
            </Button>
            <Button variant="outline" className="flex-1 bg-transparent" disabled={!lead.phone}>
              <Phone className="h-4 w-4 mr-2" />
              Call
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function CRMView() {
  const [leads, setLeads] = useState<CRMLeadData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [useMockData, setUseMockData] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [sortField, setSortField] = useState<"name" | "leadScore" | "company">("leadScore")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  const [selectedLead, setSelectedLead] = useState<CRMLeadData | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Fetch leads on mount
  useEffect(() => {
    async function fetchLeads() {
      setIsLoading(true)
      const result = await getCRMLeads()
      
      if (result.success && result.data && result.data.length > 0) {
        setLeads(result.data)
        setUseMockData(false)
      } else {
        // Fall back to mock data
        const mockCrmLeads: CRMLeadData[] = mockLeads.map((l) => ({
          id: l.id,
          name: l.name,
          email: l.email,
          phone: l.phone,
          company: l.company,
          title: l.title,
          status: l.status,
          leadScore: l.leadScore,
          sentimentTag: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          messageCount: 0,
        }))
        setLeads(mockCrmLeads)
        setUseMockData(true)
      }
      
      setIsLoading(false)
    }

    fetchLeads()
  }, [])

  const filteredLeads = leads
    .filter((lead) => {
      const matchesSearch =
        lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (lead.email?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
      const matchesStatus = statusFilter === "all" || lead.status === statusFilter
      return matchesSearch && matchesStatus
    })
    .sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal
      }
      return 0
    })

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  const handleStatusChange = async (id: string, status: LeadStatus) => {
    // Optimistic update
    setLeads(leads.map((l) => (l.id === id ? { ...l, status } : l)))
    if (selectedLead?.id === id) {
      setSelectedLead({ ...selectedLead, status })
    }
    
    // Persist to database if not using mock data
    if (!useMockData) {
      await updateLeadStatus(id, status)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this lead?")) return
    
    setLeads(leads.filter((l) => l.id !== id))
    
    if (!useMockData) {
      await deleteLead(id)
    }
  }

  const openLeadDetail = (lead: CRMLeadData) => {
    setSelectedLead(lead)
    setSheetOpen(true)
  }

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

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">CRM / Leads</h1>
            <p className="text-muted-foreground">
              {useMockData ? "Showing demo data" : `${leads.length} leads from database`}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search leads..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
              <SelectItem value="meeting-booked">Meeting Booked</SelectItem>
              <SelectItem value="not-interested">Not Interested</SelectItem>
              <SelectItem value="blacklisted">Blacklisted</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="flex-1 overflow-hidden">
          <div className="overflow-auto h-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("name")}>
                    <div className="flex items-center gap-1">
                      Name <SortIcon field="name" />
                    </div>
                  </TableHead>
                  <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("company")}>
                    <div className="flex items-center gap-1">
                      Company <SortIcon field="company" />
                    </div>
                  </TableHead>
                  <TableHead>Sentiment</TableHead>
                  <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort("leadScore")}>
                    <div className="flex items-center gap-1">
                      Score <SortIcon field="leadScore" />
                    </div>
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLeads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No leads found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLeads.map((lead) => (
                    <TableRow
                      key={lead.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openLeadDetail(lead)}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium">{lead.name}</p>
                          <p className="text-sm text-muted-foreground">{lead.email || "No email"}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {lead.company}
                        </div>
                      </TableCell>
                      <TableCell>
                        {lead.sentimentTag ? (
                          <Badge variant="outline" className="text-xs">
                            {lead.sentimentTag}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <LeadScoreBadge score={lead.leadScore} />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={lead.status}
                          onValueChange={(value) => {
                            handleStatusChange(lead.id, value as LeadStatus)
                          }}
                        >
                          <SelectTrigger
                            className={`w-[140px] h-8 text-xs ${statusColors[lead.status as LeadStatus] || statusColors.new}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">New</SelectItem>
                            <SelectItem value="qualified">Qualified</SelectItem>
                            <SelectItem value="meeting-booked">Meeting Booked</SelectItem>
                            <SelectItem value="not-interested">Not Interested</SelectItem>
                            <SelectItem value="blacklisted">Blacklisted</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openLeadDetail(lead)}>View Details</DropdownMenuItem>
                            <DropdownMenuItem>Send Email</DropdownMenuItem>
                            <DropdownMenuItem>Schedule Call</DropdownMenuItem>
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(lead.id)
                              }}
                            >
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        <div className="text-sm text-muted-foreground">
          Showing {filteredLeads.length} of {leads.length} leads
        </div>
      </div>

      <LeadDetailSheet
        lead={selectedLead}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onStatusChange={handleStatusChange}
      />
    </div>
  )
}
