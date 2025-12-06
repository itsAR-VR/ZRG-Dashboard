"use client"

import { useState, useTransition, useEffect, useCallback } from "react"
import type { Lead } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
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
  Bot,
  Play,
  Pause,
  XCircle,
  ListTodo,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { updateLeadStatus, snoozeLead, bookMeeting, updateLeadAutomationSettings } from "@/actions/crm-actions"
import { createFollowUpTask } from "@/actions/followup-actions"
import {
  getLeadFollowUpInstances,
  getFollowUpSequences,
  startFollowUpSequence,
  pauseFollowUpInstance,
  resumeFollowUpInstance,
  cancelFollowUpInstance,
  type FollowUpInstanceData,
  type FollowUpSequenceData,
} from "@/actions/followup-sequence-actions"
import {
  updateLeadAutoBookSetting,
  bookMeetingOnGHL,
  getLeadBookingStatus,
  isGHLBookingConfigured,
} from "@/actions/booking-actions"
import { getFormattedAvailabilityForLead } from "@/lib/calendar-availability"
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

  // Follow-up sequence states
  const [followUpInstances, setFollowUpInstances] = useState<FollowUpInstanceData[]>([])
  const [availableSequences, setAvailableSequences] = useState<FollowUpSequenceData[]>([])
  const [isLoadingSequences, setIsLoadingSequences] = useState(false)
  const [sequenceActionInProgress, setSequenceActionInProgress] = useState<string | null>(null)

  // GHL Booking states
  const [autoBookMeetingsEnabled, setAutoBookMeetingsEnabled] = useState(lead.autoBookMeetingsEnabled ?? true)
  const [isBookingDialogOpen, setIsBookingDialogOpen] = useState(false)
  const [availableSlots, setAvailableSlots] = useState<Array<{ datetime: string; label: string }>>([])
  const [isLoadingSlots, setIsLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [isGHLConfigured, setIsGHLConfigured] = useState(false)
  const [existingAppointment, setExistingAppointment] = useState<{
    hasAppointment: boolean;
    bookedSlot?: string;
  }>({ hasAppointment: false })

  // Load follow-up instances and sequences
  const loadFollowUpData = useCallback(async () => {
    if (!lead.clientId) return
    setIsLoadingSequences(true)
    try {
      const [instancesResult, sequencesResult] = await Promise.all([
        getLeadFollowUpInstances(lead.id),
        getFollowUpSequences(lead.clientId),
      ])
      if (instancesResult.success && instancesResult.data) {
        setFollowUpInstances(instancesResult.data)
      }
      if (sequencesResult.success && sequencesResult.data) {
        setAvailableSequences(sequencesResult.data.filter(s => s.isActive))
      }
    } catch (error) {
      console.error("Failed to load follow-up data:", error)
    } finally {
      setIsLoadingSequences(false)
    }
  }, [lead.id, lead.clientId])

  useEffect(() => {
    if (isOpen) {
      loadFollowUpData()
      loadBookingData()
    }
  }, [isOpen, loadFollowUpData])

  // Load booking configuration and status
  const loadBookingData = useCallback(async () => {
    if (!lead.clientId) return
    try {
      const [configResult, statusResult] = await Promise.all([
        isGHLBookingConfigured(lead.clientId),
        getLeadBookingStatus(lead.id),
      ])
      setIsGHLConfigured(configResult)
      setExistingAppointment({
        hasAppointment: statusResult.hasAppointment,
        bookedSlot: statusResult.bookedSlot,
      })
    } catch (error) {
      console.error("Failed to load booking data:", error)
    }
  }, [lead.id, lead.clientId])

  // Load available time slots for booking dialog
  const loadAvailableSlots = async () => {
    if (!lead.clientId) return
    setIsLoadingSlots(true)
    try {
      const slots = await getFormattedAvailabilityForLead(lead.clientId, lead.id)
      setAvailableSlots(slots)
    } catch (error) {
      console.error("Failed to load available slots:", error)
      toast.error("Failed to load available time slots")
    } finally {
      setIsLoadingSlots(false)
    }
  }

  // Handle auto-book toggle
  const handleAutoBookToggle = async (enabled: boolean) => {
    setAutoBookMeetingsEnabled(enabled)
    const result = await updateLeadAutoBookSetting(lead.id, enabled)
    if (result.success) {
      toast.success(`Auto-booking ${enabled ? "enabled" : "disabled"} for this lead`)
      onLeadUpdate?.()
    } else {
      setAutoBookMeetingsEnabled(!enabled) // Revert
      toast.error(result.error || "Failed to update setting")
    }
  }

  // Handle booking via GHL
  const handleBookViaGHL = async () => {
    if (!selectedSlot) {
      toast.error("Please select a time slot")
      return
    }

    setIsBookingMeeting(true)
    try {
      const result = await bookMeetingOnGHL(lead.id, selectedSlot)
      if (result.success) {
        toast.success("Meeting booked successfully!", {
          description: `Appointment ID: ${result.appointmentId}`,
        })
        setCurrentStatus("meeting-booked")
        setIsBookingDialogOpen(false)
        setSelectedSlot(null)
        loadBookingData()
        onLeadUpdate?.()
      } else {
        toast.error(result.error || "Failed to book meeting")
      }
    } finally {
      setIsBookingMeeting(false)
    }
  }

  // Open booking dialog
  const handleOpenBookingDialog = () => {
    setIsBookingDialogOpen(true)
    loadAvailableSlots()
  }

  // Sequence handlers
  const handleStartSequence = async (sequenceId: string) => {
    setSequenceActionInProgress(sequenceId)
    const result = await startFollowUpSequence(lead.id, sequenceId)
    if (result.success) {
      toast.success("Follow-up sequence started")
      loadFollowUpData()
    } else {
      toast.error(result.error || "Failed to start sequence")
    }
    setSequenceActionInProgress(null)
  }

  const handlePauseInstance = async (instanceId: string) => {
    setSequenceActionInProgress(instanceId)
    const result = await pauseFollowUpInstance(instanceId, "manual")
    if (result.success) {
      toast.success("Sequence paused")
      loadFollowUpData()
    } else {
      toast.error(result.error || "Failed to pause sequence")
    }
    setSequenceActionInProgress(null)
  }

  const handleResumeInstance = async (instanceId: string) => {
    setSequenceActionInProgress(instanceId)
    const result = await resumeFollowUpInstance(instanceId)
    if (result.success) {
      toast.success("Sequence resumed")
      loadFollowUpData()
    } else {
      toast.error(result.error || "Failed to resume sequence")
    }
    setSequenceActionInProgress(null)
  }

  const handleCancelInstance = async (instanceId: string) => {
    setSequenceActionInProgress(instanceId)
    const result = await cancelFollowUpInstance(instanceId)
    if (result.success) {
      toast.success("Sequence cancelled")
      loadFollowUpData()
    } else {
      toast.error(result.error || "Failed to cancel sequence")
    }
    setSequenceActionInProgress(null)
  }

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
            <Select
              value={currentStatus}
              onValueChange={(value) => handleStatusChange(value as Lead["status"])}
              disabled={isPending}
            >
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

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Auto-Book Meetings</Label>
                  <p className="text-xs text-muted-foreground">
                    {isGHLConfigured 
                      ? "Auto-book when time is accepted"
                      : "Configure GHL in Settings first"}
                  </p>
                </div>
                <Switch 
                  checked={autoBookMeetingsEnabled}
                  onCheckedChange={handleAutoBookToggle}
                  disabled={isPending || !isGHLConfigured}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Follow-Up Sequences */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Follow-Up Sequences</h4>
            </div>

            {isLoadingSequences ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-3">
                {/* Active instances */}
                {followUpInstances.length > 0 && (
                  <div className="space-y-2">
                    {followUpInstances.map((instance) => (
                      <div key={instance.id} className="p-2.5 rounded-lg border bg-muted/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium truncate">{instance.sequenceName}</span>
                          <Badge
                            variant={instance.status === "active" ? "default" : instance.status === "paused" ? "secondary" : "outline"}
                            className="text-xs"
                          >
                            {instance.status}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Step {instance.currentStep + 1}/{instance.totalSteps}</span>
                          {instance.nextStepDue && instance.status === "active" && (
                            <span>Next: {new Date(instance.nextStepDue).toLocaleDateString()}</span>
                          )}
                          {instance.pausedReason === "lead_replied" && (
                            <span className="text-amber-500">Paused: Lead replied</span>
                          )}
                        </div>
                        {/* Progress bar */}
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full transition-all duration-300",
                              instance.status === "completed" ? "bg-emerald-500" :
                              instance.status === "active" ? "bg-primary" : "bg-muted-foreground"
                            )}
                            style={{ width: `${((instance.currentStep) / instance.totalSteps) * 100}%` }}
                          />
                        </div>
                        {/* Actions */}
                        {instance.status !== "completed" && instance.status !== "cancelled" && (
                          <div className="flex items-center gap-1.5 pt-1">
                            {instance.status === "active" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handlePauseInstance(instance.id)}
                                disabled={sequenceActionInProgress === instance.id}
                              >
                                {sequenceActionInProgress === instance.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Pause className="h-3 w-3 mr-1" />
                                )}
                                Pause
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => handleResumeInstance(instance.id)}
                                disabled={sequenceActionInProgress === instance.id}
                              >
                                {sequenceActionInProgress === instance.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Play className="h-3 w-3 mr-1" />
                                )}
                                Resume
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-destructive hover:text-destructive"
                              onClick={() => handleCancelInstance(instance.id)}
                              disabled={sequenceActionInProgress === instance.id}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Start new sequence */}
                {availableSequences.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Start a sequence:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {availableSequences
                        .filter(seq => !followUpInstances.some(
                          inst => inst.sequenceId === seq.id && inst.status === "active"
                        ))
                        .map((sequence) => (
                          <Button
                            key={sequence.id}
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleStartSequence(sequence.id)}
                            disabled={sequenceActionInProgress === sequence.id}
                          >
                            {sequenceActionInProgress === sequence.id ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3 mr-1" />
                            )}
                            {sequence.name}
                          </Button>
                        ))}
                    </div>
                  </div>
                )}

                {followUpInstances.length === 0 && availableSequences.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    No sequences available. Create one in Settings → Follow-Ups.
                  </p>
                )}
              </div>
            )}
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
              {/* GHL Booking Button */}
              {isGHLConfigured ? (
                <Button 
                  className="w-full justify-start" 
                  size="sm"
                  onClick={handleOpenBookingDialog}
                  disabled={isBookingMeeting || existingAppointment.hasAppointment}
                >
                  {isBookingMeeting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : existingAppointment.hasAppointment ? (
                    <Check className="mr-2 h-4 w-4" />
                  ) : (
                    <Calendar className="mr-2 h-4 w-4" />
                  )}
                  {existingAppointment.hasAppointment 
                    ? `Booked: ${existingAppointment.bookedSlot ? new Date(existingAppointment.bookedSlot).toLocaleDateString() : "Meeting Scheduled"}`
                    : "Book Meeting (GHL)"}
                </Button>
              ) : (
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
              )}
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

      {/* GHL Booking Dialog */}
      <Dialog open={isBookingDialogOpen} onOpenChange={setIsBookingDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Book Meeting for {lead.name}
            </DialogTitle>
            <DialogDescription>
              Select an available time slot to book the meeting on GoHighLevel.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {isLoadingSlots ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No available time slots found.</p>
                <p className="text-xs mt-1">Check calendar link settings.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {availableSlots.map((slot, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedSlot(slot.datetime)}
                    className={cn(
                      "w-full p-3 rounded-lg border text-left transition-all",
                      selectedSlot === slot.datetime
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{slot.label}</span>
                      </div>
                      {selectedSlot === slot.datetime && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 ml-6">
                      {new Date(slot.datetime).toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBookingDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleBookViaGHL} 
              disabled={isBookingMeeting || !selectedSlot}
            >
              {isBookingMeeting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Calendar className="mr-2 h-4 w-4" />
              )}
              Book Appointment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
