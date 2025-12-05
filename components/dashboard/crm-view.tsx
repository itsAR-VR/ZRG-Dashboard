"use client"

import { useState } from "react"
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
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { mockLeads, type Lead } from "@/lib/mock-data"

const statusColors: Record<Lead["status"], string> = {
  new: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  qualified: "bg-green-500/10 text-green-500 border-green-500/20",
  "meeting-booked": "bg-primary/10 text-primary border-primary/20",
  blacklisted: "bg-destructive/10 text-destructive border-destructive/20",
}

const statusLabels: Record<Lead["status"], string> = {
  new: "New",
  qualified: "Qualified",
  "meeting-booked": "Meeting Booked",
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
  lead: Lead | null
  open: boolean
  onClose: () => void
  onStatusChange: (id: string, status: Lead["status"]) => void
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
            <p className="text-muted-foreground">{lead.title}</p>
            <a
              href={lead.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline"
            >
              {lead.company}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="font-semibold text-sm uppercase text-muted-foreground tracking-wider">Contact Info</h4>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{lead.email}</span>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{lead.phone}</span>
              </div>
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <a
                  href={lead.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  {lead.website.replace(/^https?:\/\//, "")}
                </a>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{lead.timezone}</span>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="font-semibold text-sm uppercase text-muted-foreground tracking-wider">BANT Qualification</h4>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(lead.qualification).map(([key, value]) => (
                <div
                  key={key}
                  className={`flex items-center gap-2 p-3 rounded-lg border ${value ? "bg-green-500/5 border-green-500/20" : "bg-muted/50"}`}
                >
                  <Checkbox checked={value} disabled />
                  <span className="text-sm capitalize font-medium">{key}</span>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="font-semibold text-sm uppercase text-muted-foreground tracking-wider">Status</h4>
            <Select value={lead.status} onValueChange={(value) => onStatusChange(lead.id, value as Lead["status"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
                <SelectItem value="meeting-booked">Meeting Booked</SelectItem>
                <SelectItem value="blacklisted">Blacklisted</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-4">
            <Button className="flex-1">
              <Mail className="h-4 w-4 mr-2" />
              Send Email
            </Button>
            <Button variant="outline" className="flex-1 bg-transparent">
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
  const [leads, setLeads] = useState(mockLeads)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [sortField, setSortField] = useState<"name" | "leadScore" | "company">("leadScore")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const filteredLeads = leads
    .filter((lead) => {
      const matchesSearch =
        lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.email.toLowerCase().includes(searchQuery.toLowerCase())
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

  const handleStatusChange = (id: string, status: Lead["status"]) => {
    setLeads(leads.map((l) => (l.id === id ? { ...l, status } : l)))
    if (selectedLead?.id === id) {
      setSelectedLead({ ...selectedLead, status })
    }
  }

  const openLeadDetail = (lead: Lead) => {
    setSelectedLead(lead)
    setSheetOpen(true)
  }

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null
    return sortDirection === "asc" ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">CRM / Leads</h1>
            <p className="text-muted-foreground">Manage and track your leads</p>
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
                  <TableHead>Title</TableHead>
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
                {filteredLeads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openLeadDetail(lead)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{lead.name}</p>
                        <p className="text-sm text-muted-foreground">{lead.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {lead.company}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{lead.title}</TableCell>
                    <TableCell>
                      <LeadScoreBadge score={lead.leadScore} />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={lead.status}
                        onValueChange={(value) => {
                          handleStatusChange(lead.id, value as Lead["status"])
                        }}
                      >
                        <SelectTrigger
                          className={`w-[140px] h-8 text-xs ${statusColors[lead.status]}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">New</SelectItem>
                          <SelectItem value="qualified">Qualified</SelectItem>
                          <SelectItem value="meeting-booked">Meeting Booked</SelectItem>
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
                          <DropdownMenuItem className="text-destructive">Remove</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
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
