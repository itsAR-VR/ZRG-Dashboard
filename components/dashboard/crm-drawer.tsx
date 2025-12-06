"use client"

import { useState, useTransition } from "react"
import type { Lead } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { 
  Mail, 
  Phone, 
  Globe, 
  Clock, 
  Calendar, 
  BellOff, 
  Edit3, 
  X, 
  Loader2,
  Check,
  AlarmClock,
  Bot
} from "lucide-react"
import { cn } from "@/lib/utils"
import { updateLeadStatus, snoozeLead, bookMeeting, updateLeadAutomationSettings } from "@/actions/crm-actions"
import { createFollowUpTask } from "@/actions/followup-actions"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface CrmDrawerProps {
  lead: Lead
  isOpen: boolean
  onClose: () => void
  onLeadUpdate?: () => void
}

const statusOptions = [
  { value: "new", label: "New Lead" },
  { value: "qualified", label: "Qualified" },
  { value: "meeting-booked", label: "Meeting Booked" },
  { value: "meeting-requested", label: "Meeting Requested" },
  { value: "information-requested", label: "Information Requested" },
  { value: "call-requested", label: "Call Requested" },
  { value: "not-interested", label: "Not Interested" },
  { value: "blacklisted", label: "Blacklisted" },
]

const snoozeOptions = [
  { value: 1, label: "1 day" },
  { value: 2, label: "2 days" },
  { value: 3, label: "3 days" },
  { value: 7, label: "1 week" },
  { value: 14, label: "2 weeks" },
]

export function CrmDrawer({ lead, isOpen, onClose, onLeadUpdate }: CrmDrawerProps) {
  const [isPending, startTransition] = useTransition()
  const [currentStatus, setCurrentStatus] = useState(lead.status)
  const [isSnoozeDialogOpen, setIsSnoozeDialogOpen] = useState(false)
  const [isFollowUpDialogOpen, setIsFollowUpDialogOpen] = useState(false)
  const [followUpMessage, setFollowUpMessage] = useState("")
  const [isBookingMeeting, setIsBookingMeeting] = useState(false)
  const [isSnoozing, setIsSnoozing] = useState(false)
  const [isCreatingFollowUp, setIsCreatingFollowUp] = useState(false)
  
  // Automation states
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(lead.autoReplyEnabled || false)
  const [autoFollowUpEnabled, setAutoFollowUpEnabled] = useState(lead.autoFollowUpEnabled || false)

  if (!isOpen) return null

  const getStatusColor = (status: string) => {
    switch (status) {
      case "meeting-booked":
        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
      case "meeting-requested":
        return "bg-blue-500/10 text-blue-500 border-blue-500/30"
      case "qualified":
        return "bg-blue-500/10 text-blue-500 border-blue-500/30"
      case "information-requested":
        return "bg-amber-500/10 text-amber-500 border-amber-500/30"
      case "call-requested":
        return "bg-purple-500/10 text-purple-500 border-purple-500/30"
      case "not-interested":
        return "bg-orange-500/10 text-orange-500 border-orange-500/30"
      case "blacklisted":
        return "bg-destructive/10 text-destructive border-destructive/30"
      default:
        return "bg-muted text-muted-foreground border-border"
    }
  }

  const handleStatusChange = async (newStatus: Lead["status"]) => {
    setCurrentStatus(newStatus)
    startTransition(async () => {
      const result = await updateLeadStatus(lead.id, newStatus)
      if (result.success) {
        toast.success("Status updated successfully")
        onLeadUpdate?.()
      } else {
        toast.error(result.error || "Failed to update status")
        setCurrentStatus(lead.status) // Revert on error
      }
    })
  }

  const handleAutomationChange = async (key: "autoReplyEnabled" | "autoFollowUpEnabled", value: boolean) => {
    // Optimistic update
    if (key === "autoReplyEnabled") setAutoReplyEnabled(value)
    if (key === "autoFollowUpEnabled") setAutoFollowUpEnabled(value)

    startTransition(async () => {
      const result = await updateLeadAutomationSettings(lead.id, { [key]: value })
      if (result.success) {
        toast.success(`${key === "autoReplyEnabled" ? "Auto-reply" : "Auto-follow-up"} settings updated`)
        onLeadUpdate?.()
      } else {
        toast.error(result.error || "Failed to update settings")
        // Revert
        if (key === "autoReplyEnabled") setAutoReplyEnabled(!value)
        if (key === "autoFollowUpEnabled") setAutoFollowUpEnabled(!value)
      }
    })
  }

  const handleBookMeeting = async () => {
    setIsBookingMeeting(true)
    try {
      const result = await bookMeeting(lead.id)
      if (result.success) {
        toast.success("Meeting booked! Status updated.")
        setCurrentStatus("meeting-booked")
        onLeadUpdate?.()
      } else {
        toast.error(result.error || "Failed to book meeting")
      }
    } finally {
      setIsBookingMeeting(false)
    }
  }

  const handleSnooze = async (days: number) => {
    setIsSnoozing(true)
    try {
      const result = await snoozeLead(lead.id, days)
      if (result.success && result.snoozedUntil) {
        toast.success(`Lead snoozed until ${result.snoozedUntil.toLocaleDateString()}`)
        setIsSnoozeDialogOpen(false)
        onLeadUpdate?.()
      } else {
        toast.error(result.error || "Failed to snooze lead")
      }
    } finally {
      setIsSnoozing(false)
    }
  }

  const handleCreateFollowUp = async () => {
    setIsCreatingFollowUp(true)
    try {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)

      const result = await createFollowUpTask({
        leadId: lead.id,
        type: "sms",
        dueDate: tomorrow,
        suggestedMessage: followUpMessage || undefined,
      })

      if (result.success) {
        toast.success("Follow-up task created!")
        setIsFollowUpDialogOpen(false)
        setFollowUpMessage("")
        onLeadUpdate?.()
      } else {
        toast.error(result.error || "Failed to create follow-up")
      }
    } finally {
      setIsCreatingFollowUp(false)
    }
  }

  return (
    <>
      <aside className="w-80 shrink-0 border-l border-border bg-card overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold text-foreground">Lead Details</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 space-y-6">
          {/* Contact Info */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contact</h4>
            <div className="space-y-2.5">
              {lead.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground truncate">{lead.email}</span>
                </div>
              )}
              {lead.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{lead.phone}</span>
                </div>
              )}
              {lead.website && (
                <div className="flex items-center gap-3 text-sm">
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a
                    href={lead.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline truncate"
                  >
                    {lead.website.replace("https://", "")}
                  </a>
                </div>
              )}
              {lead.timezone && (
                <div className="flex items-center gap-3 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{lead.timezone}</span>
                </div>
              )}
              {!lead.email && !lead.phone && !lead.website && !lead.timezone && (
                <p className="text-sm text-muted-foreground italic">No contact info available</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Status */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</h4>
            <Select value={currentStatus} onValueChange={handleStatusChange} disabled={isPending}>
              <SelectTrigger className={cn("w-full", getStatusColor(currentStatus))}>
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Automation */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Automation</h4>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Auto Replies</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically send AI drafts
                  </p>
                </div>
                <Switch 
                  checked={autoReplyEnabled}
                  onCheckedChange={(val) => handleAutomationChange("autoReplyEnabled", val)}
                  disabled={isPending}
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Auto Follow-ups</Label>
                  <p className="text-xs text-muted-foreground">
                    Enable automated follow-ups
                  </p>
                </div>
                <Switch 
                  checked={autoFollowUpEnabled}
                  onCheckedChange={(val) => handleAutomationChange("autoFollowUpEnabled", val)}
                  disabled={isPending}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Lead Score */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Lead Score</h4>
              <span className="text-xs font-medium text-primary">{lead.leadScore}/100</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-300" 
                style={{ width: `${lead.leadScore}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Score based on engagement and sentiment
            </p>
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</h4>
            <div className="space-y-2">
              <Button 
                className="w-full justify-start" 
                size="sm"
                onClick={handleBookMeeting}
                disabled={isBookingMeeting || currentStatus === "meeting-booked"}
              >
                {isBookingMeeting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : currentStatus === "meeting-booked" ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Calendar className="mr-2 h-4 w-4" />
                )}
                {currentStatus === "meeting-booked" ? "Meeting Booked" : "Book Meeting"}
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start bg-transparent" 
                size="sm"
                onClick={() => setIsSnoozeDialogOpen(true)}
              >
                <BellOff className="mr-2 h-4 w-4" />
                Snooze Lead
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start bg-transparent" 
                size="sm"
                onClick={() => setIsFollowUpDialogOpen(true)}
              >
                <Edit3 className="mr-2 h-4 w-4" />
                Manual Follow-up
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Snooze Dialog */}
      <Dialog open={isSnoozeDialogOpen} onOpenChange={setIsSnoozeDialogOpen}>
        <DialogContent className="sm:max-w-[350px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlarmClock className="h-5 w-5" />
              Snooze Lead
            </DialogTitle>
            <DialogDescription>
              Hide this lead from your inbox for a period of time.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            {snoozeOptions.map((option) => (
              <Button
                key={option.value}
                variant="outline"
                className="w-full justify-start"
                onClick={() => handleSnooze(option.value)}
                disabled={isSnoozing}
              >
                {isSnoozing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <BellOff className="mr-2 h-4 w-4" />
                )}
                {option.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Follow-up Dialog */}
      <Dialog open={isFollowUpDialogOpen} onOpenChange={setIsFollowUpDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5" />
              Create Follow-up Task
            </DialogTitle>
            <DialogDescription>
              Schedule a follow-up for {lead.name}. The task will be due tomorrow at 9 AM.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="message">Suggested Message (optional)</Label>
              <Textarea
                id="message"
                placeholder="Add notes or a suggested message for this follow-up..."
                value={followUpMessage}
                onChange={(e) => setFollowUpMessage(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFollowUpDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateFollowUp} disabled={isCreatingFollowUp}>
              {isCreatingFollowUp ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Calendar className="mr-2 h-4 w-4" />
              )}
              Create Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
