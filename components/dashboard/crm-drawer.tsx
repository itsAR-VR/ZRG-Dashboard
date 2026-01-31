"use client"

import { useState, useTransition, useEffect, useCallback } from "react"
import type { Lead } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { 
  Mail, 
  Phone, 
  Globe, 
  Clock, 
  Calendar, 
  BellOff, 
  Moon,
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
  Users,
  Linkedin,
  Sparkles,
  Building2,
  MapPin,
  ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { BookingMonthAvailabilityPicker } from "@/components/dashboard/booking-month-availability-picker"
import { bookMeeting, snoozeLead, snoozeLeadUntil, updateLeadAutomationSettings, updateLeadSentimentTag, updateLeadStatus } from "@/actions/crm-actions"
import { createFollowUpTask } from "@/actions/followup-actions"
import { promoteAlternateContactToPrimary, requestPromoteAlternateContactToPrimary } from "@/actions/lead-actions"
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
  getLeadBookingStatusEnhanced,
  getLeadAppointmentHistory,
  isGHLBookingConfigured,
  getBookingAvailabilityForLead,
  getGhlCalendarMismatchInfo,
} from "@/actions/booking-actions"
import type { AppointmentHistoryItem } from "@/actions/booking-actions"
import { refreshAndEnrichLead } from "@/actions/enrichment-actions"
import { useEnrichmentPolling } from "@/hooks/use-enrichment-polling"
import { toast } from "sonner"
import { toDisplayPhone } from "@/lib/phone-utils"
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
import { SENTIMENT_TAGS, type SentimentTag } from "@/lib/sentiment-shared"
import { LeadScoreBadge } from "./lead-score-badge"

interface CrmDrawerProps {
  lead: Lead
  viewerRole?: "OWNER" | "ADMIN" | "INBOX_MANAGER" | "SETTER" | null
  isOpen: boolean
  onClose: () => void
  onLeadUpdate?: () => void
}

const statusOptions = [
  { value: "new", label: "New Lead" },
  { value: "qualified", label: "Qualified" },
  { value: "unqualified", label: "Unqualified" },
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

const MANUAL_SENTIMENT_TAGS = SENTIMENT_TAGS.filter((tag) => tag !== "Snoozed") as readonly SentimentTag[]

function normalizeSentimentTag(tag: string | null | undefined): SentimentTag {
  const match = MANUAL_SENTIMENT_TAGS.find((t) => t === tag)
  return match || "New"
}

export function CrmDrawer({ lead, viewerRole, isOpen, onClose, onLeadUpdate }: CrmDrawerProps) {
  const [isPending, startTransition] = useTransition()
  const [promotionAction, setPromotionAction] = useState<{ email: string; mode: "promote" | "request" } | null>(null)
  const [currentStatus, setCurrentStatus] = useState(lead.status)
  const [currentSentimentTag, setCurrentSentimentTag] = useState<SentimentTag>(
    normalizeSentimentTag(lead.sentimentTag)
  )
  const [isSnoozeDialogOpen, setIsSnoozeDialogOpen] = useState(false)
  const [isFollowUpDialogOpen, setIsFollowUpDialogOpen] = useState(false)
  const [followUpMessage, setFollowUpMessage] = useState("")
  const [isBookingMeeting, setIsBookingMeeting] = useState(false)
  const [isSnoozing, setIsSnoozing] = useState(false)
  const [customSnoozeAt, setCustomSnoozeAt] = useState("")
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
  const [availableSlots, setAvailableSlots] = useState<Array<{ datetime: string; label: string; offeredCount: number }>>([])
  const [isLoadingSlots, setIsLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [isGHLConfigured, setIsGHLConfigured] = useState(false)
  const [existingAppointment, setExistingAppointment] = useState<{
    hasAppointment: boolean;
    bookedSlot?: string;
    appointmentCount?: number;
  }>({ hasAppointment: false, appointmentCount: 0 })
  const [appointmentHistory, setAppointmentHistory] = useState<AppointmentHistoryItem[]>([])
  const [appointmentHistoryError, setAppointmentHistoryError] = useState<string | null>(null)
  const [isLoadingAppointmentHistory, setIsLoadingAppointmentHistory] = useState(false)

  // Enrichment state
  const [isEnriching, setIsEnriching] = useState(false)

  const isAdmin = viewerRole === "OWNER" || viewerRole === "ADMIN"
  const isSetter = viewerRole === "SETTER"
  const alternateEmails = (lead.alternateEmails ?? []).filter((email) => {
    if (!email) return false
    const primaryEmailLower = (lead.email ?? "").toLowerCase()
    return email.toLowerCase() !== primaryEmailLower
  })

  const handlePromoteContact = async (email: string) => {
    const confirmed = window.confirm(
      `Make ${email} the primary contact? The current email will be saved as an alternate.`
    )
    if (!confirmed) return

    setPromotionAction({ email, mode: "promote" })
    try {
      const result = await promoteAlternateContactToPrimary(lead.id, email)
      if (result.success) {
        toast.success("Contact promoted to primary")
        onLeadUpdate?.()
      } else {
        toast.error(result.error || "Failed to promote contact")
      }
    } catch (error) {
      console.error("Promotion failed:", error)
      toast.error("Failed to promote contact")
    } finally {
      setPromotionAction(null)
    }
  }

  const handleRequestPromoteContact = async (email: string) => {
    const confirmed = window.confirm(
      `Request to make ${email} the primary contact? An admin must approve this change.`
    )
    if (!confirmed) return

    setPromotionAction({ email, mode: "request" })
    try {
      const result = await requestPromoteAlternateContactToPrimary(lead.id, email)
      if (result.success) {
        toast.success(result.message || "Request sent to admin")
      } else {
        toast.error(result.error || "Failed to request promotion")
      }
    } catch (error) {
      console.error("Request failed:", error)
      toast.error("Failed to request promotion")
    } finally {
      setPromotionAction(null)
    }
  }

  // Keep local state in sync when the selected lead changes or refreshes.
  useEffect(() => {
    setCurrentStatus(lead.status)
    setCurrentSentimentTag(normalizeSentimentTag(lead.sentimentTag))
    setAutoReplyEnabled(lead.autoReplyEnabled || false)
    setAutoFollowUpEnabled(lead.autoFollowUpEnabled || false)
    setAutoBookMeetingsEnabled(lead.autoBookMeetingsEnabled ?? true)
  }, [
    lead.id,
    lead.status,
    lead.sentimentTag,
    lead.autoReplyEnabled,
    lead.autoFollowUpEnabled,
    lead.autoBookMeetingsEnabled,
  ])
  
  // Enrichment polling hook for manual enrichment
  const { startPolling, isPolling } = useEnrichmentPolling({
    leadId: lead.id,
    onComplete: (result) => {
      // Build toast message based on what was found
      const found: string[] = []
      const notFound: string[] = []
      
      if (result.phone) {
        found.push(`Phone: ${result.phone}`)
      } else {
        notFound.push("phone")
      }
      
      if (result.linkedinUrl) {
        found.push(`LinkedIn: ${result.linkedinUrl.replace("https://linkedin.com/in/", "")}`)
      } else {
        notFound.push("LinkedIn")
      }
      
      if (found.length > 0 && notFound.length > 0) {
        // Partial results
        toast.success("Enrichment complete", {
          description: `Found ${found.join(". ")}. No ${notFound.join(" or ")} found.`
        })
      } else if (found.length > 0) {
        // All found
        toast.success("Enrichment complete", {
          description: `Found ${found.join(". ")}`
        })
      } else {
        // Nothing found
        toast.info("No phone or LinkedIn found")
      }
      
      onLeadUpdate?.() // Refresh lead data in UI
    },
    onTimeout: () => {
      toast.warning("No results yet", {
        description: "Check Clay table for details"
      })
    }
  })

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

  // Load booking configuration and status
  const loadBookingData = useCallback(async () => {
    if (!lead.clientId) return
    try {
      const [configResult, statusResult] = await Promise.all([
        isGHLBookingConfigured(lead.clientId),
        getLeadBookingStatusEnhanced(lead.id),
      ])
      setIsGHLConfigured(configResult)
      setExistingAppointment({
        hasAppointment: statusResult.hasAppointment,
        bookedSlot: statusResult.bookedSlot,
        appointmentCount: statusResult.appointmentCount,
      })

      setAppointmentHistoryError(null)
      if (statusResult.appointmentCount > 0) {
        setIsLoadingAppointmentHistory(true)
        const historyResult = await getLeadAppointmentHistory(lead.id, { limit: 12 })
        if (historyResult.success) {
          setAppointmentHistory(historyResult.appointments)
        } else {
          setAppointmentHistory([])
          setAppointmentHistoryError(historyResult.error || "Failed to load appointment history")
        }
      } else {
        setAppointmentHistory([])
      }
    } catch (error) {
      console.error("Failed to load booking data:", error)
      setAppointmentHistory([])
      setAppointmentHistoryError("Failed to load appointment history")
    } finally {
      setIsLoadingAppointmentHistory(false)
    }
  }, [lead.id, lead.clientId])

  useEffect(() => {
    if (isOpen) {
      loadFollowUpData()
      loadBookingData()
    }
  }, [isOpen, loadFollowUpData, loadBookingData])

  // Load available time slots for booking dialog
  const loadAvailableSlots = async () => {
    if (!lead.clientId) return
    setIsLoadingSlots(true)
    try {
      const [slots, mismatch] = await Promise.all([
        getBookingAvailabilityForLead(lead.clientId, lead.id),
        getGhlCalendarMismatchInfo(lead.clientId),
      ])

      setAvailableSlots(slots)

      if (mismatch.success && mismatch.mismatch) {
        toast.warning("Calendar mismatch detected", {
          description:
            "Availability is pulled from the default Calendar Link, but booking uses the workspace's GHL Default Calendar. Update Settings to align them.",
        })
      }
    } catch (error) {
      console.error("Failed to load available slots:", error)
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to load available time slots"
      toast.error(message)
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
      case "unqualified":
        return "bg-slate-500/10 text-slate-500 border-slate-500/30"
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

  const handleSentimentChange = async (nextTag: SentimentTag) => {
    const previousTag = currentSentimentTag
    setCurrentSentimentTag(nextTag)

    startTransition(async () => {
      const result = await updateLeadSentimentTag(lead.id, nextTag)
      if (result.success) {
        toast.success("Sentiment updated successfully")
        onLeadUpdate?.()
      } else {
        toast.error(result.error || "Failed to update sentiment")
        setCurrentSentimentTag(previousTag)
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
        setCustomSnoozeAt("")
        onLeadUpdate?.()
      } else {
        toast.error(result.error || "Failed to snooze lead")
      }
    } finally {
      setIsSnoozing(false)
    }
  }

  const handleCustomSnooze = async () => {
    const raw = customSnoozeAt.trim()
    if (!raw) {
      toast.error("Pick a date/time to snooze until")
      return
    }

    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) {
      toast.error("Invalid date/time")
      return
    }

    setIsSnoozing(true)
    try {
      const result = await snoozeLeadUntil(lead.id, dt.toISOString())
      if (result.success && result.snoozedUntil) {
        toast.success(`Lead snoozed until ${result.snoozedUntil.toLocaleString()}`)
        setIsSnoozeDialogOpen(false)
        setCustomSnoozeAt("")
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

  // Enrichment handler with status checking
  const handleEnrichLead = async () => {
    // Check if already enriched or not_needed
    if (lead.enrichmentStatus === "enriched" || lead.enrichmentStatus === "not_needed") {
      toast.info("Lead already enriched", {
        description: "Phone and LinkedIn data is already up to date."
      })
      return
    }
    
    // Check if enrichment is already in progress
    if (lead.enrichmentStatus === "pending") {
      toast.info("Enrichment already in progress", {
        description: "Results will update when Clay responds."
      })
      return
    }
    
    setIsEnriching(true)
    try {
      const result = await refreshAndEnrichLead(lead.id)
      
      if (result.success) {
        // Build success message
        const updates: string[] = []
        
        if (result.fromEmailBison.linkedinUrl) {
          updates.push("LinkedIn URL")
        }
        if (result.fromEmailBison.phone) {
          updates.push("Phone")
        }
        if (result.fromEmailBison.companyName) {
          updates.push("Company")
        }
        if (result.fromEmailBison.companyWebsite) {
          updates.push("Website")
        }
        
        const clayTriggers: string[] = []
        if (result.clayTriggered.linkedin) {
          clayTriggers.push("LinkedIn")
        }
        if (result.clayTriggered.phone) {
          clayTriggers.push("Phone")
        }
        
        // Show different toast based on what happened
        if (clayTriggers.length > 0) {
          // Clay enrichment was triggered - show that it's been sent
          toast.success("Clay enrichment sent", {
            description: `Looking for: ${clayTriggers.join(", ")}. Results will update shortly.`
          })
          // Start polling for results
          startPolling()
        } else if (updates.length > 0) {
          // Found data without needing Clay
          toast.success("Enrichment complete", {
            description: `Found: ${updates.join(", ")}`
          })
        } else {
          // Nothing new found
          toast.info("Lead data is up to date")
        }
        
        onLeadUpdate?.() // Refresh the lead data in the UI
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

  // Manual enrichment rules:
  // - Available for EmailBison leads (has emailBisonLeadId)
  // - DISABLED for sentiment tags: Not Interested, Blacklist, Neutral
  // - ENABLED for all other sentiments including new/no sentiment
  // - Disabled if already enriched/pending (handled in handleEnrichLead)
  const BLOCKED_SENTIMENTS = ["Not Interested", "Blacklist", "Neutral"]
  const isBlockedSentiment = BLOCKED_SENTIMENTS.includes(lead.sentimentTag || "")
  const isAlreadyEnriched = lead.enrichmentStatus === "enriched" || lead.enrichmentStatus === "not_needed"
  const isEnrichmentPending = lead.enrichmentStatus === "pending"
  const canEnrich = !!lead.emailBisonLeadId && !isBlockedSentiment
  const enrichmentDisabledReason = !lead.emailBisonLeadId 
    ? "No EmailBison lead ID" 
    : isBlockedSentiment 
      ? `Enrichment blocked for "${lead.sentimentTag}" sentiment` 
      : isEnrichmentPending
        ? "Enrichment in progress"
        : isAlreadyEnriched
          ? "Already enriched"
          : null

  const workspaceName = lead.company
  const smsClient = lead.smsCampaignName?.trim() || null
  const isSmsAccountWorkspace = ["owen", "uday 18th", "uday18th", "u-day 18th"].includes(
    workspaceName.toLowerCase()
  )
  const workspaceLine = smsClient
    ? `${workspaceName} • Client: ${smsClient}`
    : isSmsAccountWorkspace
      ? `${workspaceName} • Client: Unattributed`
      : workspaceName

  const formatAppointmentDateTime = (iso: string | null): string => {
    if (!iso) return "Unknown time"
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return "Unknown time"
    return d.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  }

  const getAppointmentStatusLabel = (status: string): string => {
    switch (status) {
      case "CONFIRMED":
        return "Confirmed"
      case "CANCELED":
        return "Canceled"
      case "RESCHEDULED":
        return "Rescheduled"
      case "SHOWED":
        return "Showed"
      case "NO_SHOW":
        return "No-show"
      default:
        return status
    }
  }

  const getAppointmentStatusBadgeClass = (status: string): string => {
    switch (status) {
      case "CONFIRMED":
        return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
      case "CANCELED":
        return "border-red-500/30 bg-red-500/10 text-red-600"
      case "RESCHEDULED":
        return "border-orange-500/30 bg-orange-500/10 text-orange-600"
      case "SHOWED":
        return "border-blue-500/30 bg-blue-500/10 text-blue-600"
      case "NO_SHOW":
        return "border-slate-500/30 bg-slate-500/10 text-slate-600"
      default:
        return "border-border bg-muted text-muted-foreground"
    }
  }

  return (
    <>
      <aside className="w-80 shrink-0 border-l border-border bg-card overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold text-foreground">Lead Details</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close lead details">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4 space-y-6">
          {/* Contact Info */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contact</h4>
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
                      lead.enrichmentStatus === "failed" && "text-red-500 border-red-500/30 bg-red-500/10",
                      lead.enrichmentStatus === "not_needed" && "text-muted-foreground"
                    )}
                  >
                    {lead.enrichmentStatus === "enriched" ? "Enriched" :
                     lead.enrichmentStatus === "pending" ? (
                       <span className="flex items-center gap-1">
                         <Loader2 className="h-3 w-3 animate-spin" />
                         Enriching...
                       </span>
                     ) :
                     lead.enrichmentStatus === "not_found" ? "Not Found" :
                     lead.enrichmentStatus === "failed" ? "Failed" :
                     lead.enrichmentStatus === "not_needed" ? "Complete" : lead.enrichmentStatus}
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center gap-3 text-sm">
                <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-foreground truncate">{workspaceLine}</span>
              </div>

              {/* Email - only show if present */}
              {lead.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground truncate">{lead.email}</span>
                </div>
              )}

              {lead.currentReplierEmail && (
                <div className="flex items-center gap-3 text-sm">
                  <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Current replier</span>
                    <Badge variant="secondary">
                      {lead.currentReplierName || lead.currentReplierEmail}
                    </Badge>
                  </div>
                </div>
              )}

              {alternateEmails.length > 0 && (
                <div className="rounded-md border border-muted/50 bg-muted/30 p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    Other Contacts in Thread
                  </div>
                  <div className="space-y-2">
                    {alternateEmails.map((email) => {
                      const normalized = email.toLowerCase()
                      const isCurrent =
                        lead.currentReplierEmail?.toLowerCase() === normalized
                      const isPromoting =
                        promotionAction?.email === email && promotionAction.mode === "promote"
                      const isRequesting =
                        promotionAction?.email === email && promotionAction.mode === "request"
                      const isBusy = promotionAction?.email === email

                      return (
                        <div key={email} className="flex items-center justify-between gap-3 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-foreground">{email}</span>
                            {isCurrent && (
                              <Badge variant="secondary" className="text-[10px]">
                                Current replier
                              </Badge>
                            )}
                          </div>
                          {isAdmin ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isPending || isBusy}
                              onClick={() => handlePromoteContact(email)}
                            >
                              {isPromoting ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-2" />
                              ) : null}
                              {isPromoting ? "Promoting" : "Make Primary"}
                            </Button>
                          ) : isSetter ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isPending || isBusy}
                              onClick={() => handleRequestPromoteContact(email)}
                            >
                              {isRequesting ? (
                                <Loader2 className="h-3 w-3 animate-spin mr-2" />
                              ) : null}
                              {isRequesting ? "Requesting" : "Request Primary"}
                            </Button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              
              {/* Phone - ALWAYS show */}
              <div className="flex items-center gap-3 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                {lead.phone ? (
                  <span className="text-foreground">{toDisplayPhone(lead.phone) ?? lead.phone}</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground italic">No number found</span>
                    {lead.enrichmentStatus === "pending" && (
                      <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                    )}
                  </span>
                )}
              </div>
              
              {/* LinkedIn - ALWAYS show */}
              <div className="flex items-center gap-3 text-sm">
                <Linkedin className="h-4 w-4 text-[#0A66C2] shrink-0" />
                {lead.linkedinUrl ? (
                  <a
                    href={lead.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline truncate"
                  >
                    {lead.linkedinUrl.replace("https://linkedin.com/in/", "")}
                  </a>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground italic">No LinkedIn found</span>
                    {lead.enrichmentStatus === "pending" && (
                      <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                    )}
                  </span>
                )}
              </div>
              
              {/* Website - optional */}
              {(lead.website || lead.companyWebsite) && (
                <div className="flex items-center gap-3 text-sm">
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a
                    href={lead.companyWebsite || lead.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline truncate"
                  >
                    {(lead.companyWebsite || lead.website).replace("https://", "").replace("http://", "")}
                  </a>
                </div>
              )}
              
              {/* Company Name - optional */}
              {lead.companyName && (
                <div className="flex items-center gap-3 text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{lead.companyName}</span>
                </div>
              )}
              
              {/* Company State - optional */}
              {lead.companyState && (
                <div className="flex items-center gap-3 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{lead.companyState}</span>
                </div>
              )}
              
              {/* Timezone - optional */}
              {lead.timezone && (
                <div className="flex items-center gap-3 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{lead.timezone}</span>
                </div>
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

          {/* Sentiment */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Sentiment</h4>
            <Select
              value={currentSentimentTag}
              onValueChange={(value) => handleSentimentChange(value as SentimentTag)}
              disabled={isPending}
            >
              <SelectTrigger className="w-full">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_SENTIMENT_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Sets the lead&apos;s sentiment tag for filtering and automation.
            </p>
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
                  <Label htmlFor="auto-reply-enabled-switch" className="text-sm font-medium">Auto Replies</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically send AI drafts
                  </p>
                </div>
                <Switch
                  id="auto-reply-enabled-switch"
                  checked={autoReplyEnabled}
                  onCheckedChange={(val) => handleAutomationChange("autoReplyEnabled", val)}
                  disabled={isPending}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-followup-enabled-switch" className="text-sm font-medium">Auto Follow-ups</Label>
                  <p className="text-xs text-muted-foreground">
                    Enable automated follow-ups
                  </p>
                </div>
                <Switch
                  id="auto-followup-enabled-switch"
                  checked={autoFollowUpEnabled}
                  onCheckedChange={(val) => handleAutomationChange("autoFollowUpEnabled", val)}
                  disabled={isPending}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-book-meetings-enabled-switch" className="text-sm font-medium">Auto-Book Meetings</Label>
                  <p className="text-xs text-muted-foreground">
                    {isGHLConfigured
                      ? "Auto-book when time is accepted"
                      : "Configure GHL in Settings first"}
                  </p>
                </div>
                <Switch
                  id="auto-book-meetings-enabled-switch"
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
                        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                          <div className="flex items-center justify-between">
                            <span>Step {instance.currentStep + 1}/{instance.totalSteps}</span>
                            <span>Started: {new Date(instance.startedAt).toLocaleDateString()}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            {instance.nextStepDue && instance.status === "active" && (
                              <span>Next: {new Date(instance.nextStepDue).toLocaleDateString()}</span>
                            )}
	                            {instance.pausedReason === "lead_replied" && (
	                              <span className="text-amber-500">Paused: Lead replied (reply to resume)</span>
	                            )}
                          </div>
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

          {/* Appointments */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Appointments</h4>
              {typeof existingAppointment.appointmentCount === "number" && existingAppointment.appointmentCount > 0 ? (
                <Badge variant="outline" className="text-[10px]">
                  {existingAppointment.appointmentCount} total
                </Badge>
              ) : null}
            </div>

            {isLoadingAppointmentHistory ? (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading appointment history…
              </p>
            ) : appointmentHistoryError ? (
              <p className="text-xs text-destructive">{appointmentHistoryError}</p>
            ) : appointmentHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No appointment history found.</p>
            ) : (
              <div className="space-y-2">
                {appointmentHistory.map((apt) => (
                  <div key={apt.id} className="rounded-md border border-border bg-muted/30 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] shrink-0", getAppointmentStatusBadgeClass(apt.status))}
                        >
                          {getAppointmentStatusLabel(apt.status)}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground shrink-0">{apt.provider}</span>
                        <span className="text-[10px] text-muted-foreground truncate">{apt.source}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatAppointmentDateTime(apt.createdAt)}
                      </span>
                    </div>

                    <div className="mt-1 text-xs">
                      <span className="text-muted-foreground">Start:</span>{" "}
                      <span className="text-foreground">{formatAppointmentDateTime(apt.startAt)}</span>
                    </div>

                    {apt.canceledAt ? (
                      <div className="mt-1 text-xs">
                        <span className="text-muted-foreground">Canceled:</span>{" "}
                        <span className="text-red-600">{formatAppointmentDateTime(apt.canceledAt)}</span>
                      </div>
                    ) : null}

                    {apt.cancelReason ? (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{apt.cancelReason}</p>
                    ) : null}

                    {apt.rescheduledFromId ? (
                      <p className="mt-1 text-[10px] text-orange-600">
                        Linked reschedule (best-effort)
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Lead Score */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Overall Score</h4>
              <LeadScoreBadge score={lead.overallScore} size="md" showTooltip scoredAt={lead.scoredAt} />
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</h4>
            <div className="space-y-2">
              {/* Open in Go High-Level Button */}
              <Button 
                className="w-full justify-start" 
                size="sm"
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
                <ExternalLink className="mr-2 h-4 w-4" />
                Open in Go High-Level
              </Button>

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
              <Button 
                variant="outline" 
                className="w-full justify-start bg-transparent" 
                size="sm"
                onClick={handleEnrichLead}
                disabled={isEnriching || isPolling || !canEnrich}
                title={enrichmentDisabledReason || (isPolling ? "Waiting for results..." : undefined)}
              >
                {isEnriching || isPolling ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {isEnriching ? "Enriching..." : isPolling ? "Polling..." : "Enrich Lead"}
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

            <Separator className="my-2" />

            <div className="grid gap-2">
              <Label htmlFor="custom-snooze">Custom snooze until</Label>
              <Input
                id="custom-snooze"
                type="datetime-local"
                value={customSnoozeAt}
                onChange={(e) => setCustomSnoozeAt(e.target.value)}
                disabled={isSnoozing}
              />
              <Button
                variant="default"
                className="w-full justify-start"
                onClick={handleCustomSnooze}
                disabled={isSnoozing || !customSnoozeAt.trim()}
              >
                {isSnoozing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <AlarmClock className="mr-2 h-4 w-4" />
                )}
                Snooze until date/time
              </Button>
            </div>
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
        <DialogContent className="w-[98vw] sm:max-w-6xl">
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
              <BookingMonthAvailabilityPicker
                slots={availableSlots}
                selectedSlot={selectedSlot}
                onSelectSlot={setSelectedSlot}
              />
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
