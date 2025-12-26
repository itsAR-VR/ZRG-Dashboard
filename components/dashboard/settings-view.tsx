"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Mail,
  MessageSquare,
  Activity,
  DollarSign,
  RefreshCcw,
  Eye,
  Check,
  Clock,
  Globe,
  Bell,
  Shield,
  Users,
  Bot,
  Sparkles,
  Loader2,
  Save,
  Lock,
  Plus,
  Trash2,
  FileText,
  Link2,
  HelpCircle,
  Briefcase,
  Calendar,
  Building2,
  Target,
  Star,
  AlertTriangle,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { IntegrationsManager } from "./settings/integrations-manager"
// Note: FollowUpSequenceManager moved to Follow-ups view
	import { 
	  getUserSettings, 
	  updateUserSettings, 
	  addKnowledgeAsset,
	  deleteKnowledgeAsset,
	  getCalendarLinks,
	  addCalendarLink,
	  deleteCalendarLink,
	  setDefaultCalendarLink,
	  setAirtableMode,
	  pauseWorkspaceFollowUps,
	  resumeWorkspaceFollowUps,
	  type UserSettingsData,
	  type KnowledgeAssetData,
	  type QualificationQuestion,
	  type CalendarLinkData,
	} from "@/actions/settings-actions"
import {
  getAiObservabilitySummary,
  getAiPromptTemplates,
  type AiObservabilityWindow,
  type AiPromptTemplatePublic,
  type ObservabilitySummary,
} from "@/actions/ai-observability-actions"
import {
  fetchGHLCalendarsForWorkspace,
  fetchGHLUsersForWorkspace,
  testGHLConnectionForWorkspace,
  setWorkspaceAutoBookEnabled,
  getGhlCalendarMismatchInfo,
  type GHLCalendar,
  type GHLUser,
} from "@/actions/booking-actions"
import { backfillNoResponseFollowUpsForAwaitingReplyLeads } from "@/actions/crm-actions"
import { toast } from "sonner"
import { useUser } from "@/contexts/user-context"

interface SettingsViewProps {
  activeWorkspace?: string | null
  activeTab?: string
  onTabChange?: (tab: string) => void
  onWorkspacesChange?: (workspaces: Array<{ id: string; name: string; ghlLocationId: string }>) => void
}

export function SettingsView({ activeWorkspace, activeTab = "general", onTabChange, onWorkspacesChange }: SettingsViewProps) {
  const { user, isLoading: isUserLoading } = useUser()
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Settings state from database
  const [settings, setSettings] = useState<UserSettingsData | null>(null)
  const [isBackfillingFollowUps, setIsBackfillingFollowUps] = useState(false)

  // Local state for form inputs
  const [aiPersona, setAiPersona] = useState({
    name: "",
    tone: "friendly-professional",
    greeting: "Hi {firstName},",  // Email greeting
    smsGreeting: "Hi {firstName},",  // SMS greeting
    signature: "",
    goals: "",
    serviceDescription: "",
  })

  // Qualification questions state
  const [qualificationQuestions, setQualificationQuestions] = useState<QualificationQuestion[]>([])
  const [newQuestion, setNewQuestion] = useState("")

  // Knowledge assets state
  const [knowledgeAssets, setKnowledgeAssets] = useState<KnowledgeAssetData[]>([])
  const [newAssetName, setNewAssetName] = useState("")
  const [newAssetContent, setNewAssetContent] = useState("")
  const [newAssetType, setNewAssetType] = useState<"text" | "url">("text")

  // Company/Outreach context state
  const [companyContext, setCompanyContext] = useState({
    companyName: "",
    targetResult: "",
  })

  // Calendar links state
  const [calendarLinks, setCalendarLinks] = useState<CalendarLinkData[]>([])
  const [newCalendarName, setNewCalendarName] = useState("")
  const [newCalendarUrl, setNewCalendarUrl] = useState("")
  const [isAddingCalendar, setIsAddingCalendar] = useState(false)

  // GHL Meeting Booking state
  const [meetingBooking, setMeetingBooking] = useState({
    ghlDefaultCalendarId: "",
    ghlAssignedUserId: "",
    autoBookMeetings: false,
    meetingDurationMinutes: 30,
    meetingTitle: "Intro to {companyName}",
  })
  const [ghlCalendars, setGhlCalendars] = useState<GHLCalendar[]>([])
  const [ghlUsers, setGhlUsers] = useState<GHLUser[]>([])
  const [isLoadingGhlData, setIsLoadingGhlData] = useState(false)
  const [ghlConnectionStatus, setGhlConnectionStatus] = useState<"unknown" | "connected" | "error">("unknown")
  const [calendarMismatchInfo, setCalendarMismatchInfo] = useState<{
    mismatch: boolean
    ghlDefaultCalendarId: string | null
    calendarLinkGhlCalendarId: string | null
    lastError: string | null
  } | null>(null)

  const [availability, setAvailability] = useState({
    timezone: "America/Los_Angeles",
    startTime: "09:00",
    endTime: "17:00",
  })

  const [notifications, setNotifications] = useState({
    emailDigest: true,
    slackAlerts: true,
  })

	  const [automationRules, setAutomationRules] = useState({
	    autoApproveMeetings: true,
	    flagUncertainReplies: true,
	    pauseForOOO: true,
	    autoBlacklist: true,
	  })

	  const [followUpsPausedUntil, setFollowUpsPausedUntil] = useState<Date | null>(null)
	  const [pauseFollowUpsDays, setPauseFollowUpsDays] = useState("7")
	  const [isPausingFollowUps, setIsPausingFollowUps] = useState(false)

	  const [airtableModeEnabled, setAirtableModeEnabled] = useState(false)
	  const [isApplyingAirtableMode, setIsApplyingAirtableMode] = useState(false)

  // AI observability (admin-only)
  const [aiObsWindow, setAiObsWindow] = useState<AiObservabilityWindow>("24h")
  const [aiObs, setAiObs] = useState<ObservabilitySummary | null>(null)
  const [aiObsLoading, setAiObsLoading] = useState(false)
  const [canViewAiObs, setCanViewAiObs] = useState(false)
  const [aiObsError, setAiObsError] = useState<string | null>(null)

  const [aiPromptsOpen, setAiPromptsOpen] = useState(false)
  const [aiPromptTemplates, setAiPromptTemplates] = useState<AiPromptTemplatePublic[] | null>(null)
  const [aiPromptsLoading, setAiPromptsLoading] = useState(false)

  // Load settings when workspace changes
  useEffect(() => {
    async function loadSettings() {
      setIsLoading(true)
      const result = await getUserSettings(activeWorkspace)
      
      if (result.success && result.data) {
        setSettings(result.data)
        // Populate form state from database
        setAiPersona({
          name: result.data.aiPersonaName || "",
          tone: result.data.aiTone || "friendly-professional",
          greeting: result.data.aiGreeting || "Hi {firstName},",
          smsGreeting: result.data.aiSmsGreeting || result.data.aiGreeting || "Hi {firstName},",
          signature: result.data.aiSignature || "",
          goals: result.data.aiGoals || "",
          serviceDescription: result.data.serviceDescription || "",
        })
        setCompanyContext({
          companyName: result.data.companyName || "",
          targetResult: result.data.targetResult || "",
        })
        setAvailability({
          timezone: result.data.timezone || "America/Los_Angeles",
          startTime: result.data.workStartTime || "09:00",
          endTime: result.data.workEndTime || "17:00",
        })
        setNotifications({
          emailDigest: result.data.emailDigest,
          slackAlerts: result.data.slackAlerts,
        })
	        setAutomationRules({
	          autoApproveMeetings: result.data.autoApproveMeetings,
	          flagUncertainReplies: result.data.flagUncertainReplies,
	          pauseForOOO: result.data.pauseForOOO,
	          autoBlacklist: result.data.autoBlacklist,
	        })
	        setFollowUpsPausedUntil(result.data.followUpsPausedUntil)
	        setAirtableModeEnabled(result.data.airtableMode)
        // Parse qualification questions from JSON
        if (result.data.qualificationQuestions) {
          try {
            setQualificationQuestions(JSON.parse(result.data.qualificationQuestions))
          } catch {
            setQualificationQuestions([])
          }
        } else {
          setQualificationQuestions([])
        }
        // Set knowledge assets
        if (result.knowledgeAssets) {
          setKnowledgeAssets(result.knowledgeAssets)
        }
        // Set meeting booking settings
        setMeetingBooking({
          ghlDefaultCalendarId: result.data.ghlDefaultCalendarId || "",
          ghlAssignedUserId: result.data.ghlAssignedUserId || "",
          autoBookMeetings: result.data.autoBookMeetings,
          meetingDurationMinutes: result.data.meetingDurationMinutes,
          meetingTitle: result.data.meetingTitle || "Intro to {companyName}",
        })
      }

      // Load calendar links
      if (activeWorkspace) {
        const calendarResult = await getCalendarLinks(activeWorkspace)
        if (calendarResult.success && calendarResult.data) {
          setCalendarLinks(calendarResult.data)
        }

        const mismatch = await getGhlCalendarMismatchInfo(activeWorkspace)
        if (mismatch.success) {
          setCalendarMismatchInfo({
            mismatch: mismatch.mismatch ?? false,
            ghlDefaultCalendarId: mismatch.ghlDefaultCalendarId ?? null,
            calendarLinkGhlCalendarId: mismatch.calendarLinkGhlCalendarId ?? null,
            lastError: mismatch.lastError ?? null,
          })
        } else {
          setCalendarMismatchInfo(null)
        }

        // Load GHL calendars and users for meeting booking config
        loadGHLData(activeWorkspace)
      } else {
        setCalendarLinks([])
        setCalendarMismatchInfo(null)
      }
      
      setIsLoading(false)
    }

    loadSettings()
  }, [activeWorkspace])

  const refreshAiObservability = useCallback(async () => {
    if (!activeWorkspace) {
      setAiObs(null)
      setCanViewAiObs(false)
      setAiObsError(null)
      return
    }

    setAiObsLoading(true)
    try {
      const result = await getAiObservabilitySummary(activeWorkspace, aiObsWindow)
      if (result.success && result.data) {
        setAiObs(result.data)
        setCanViewAiObs(true)
        setAiObsError(null)
      } else {
        setAiObs(null)
        const errorMessage = result.error || "Failed to load AI metrics"
        const isAuthError =
          errorMessage.toLowerCase().includes("unauthorized") ||
          errorMessage.toLowerCase().includes("not authenticated")
        if (isAuthError) {
          setCanViewAiObs(false)
        }
        setAiObsError(errorMessage)
      }
    } catch (error) {
      setAiObs(null)
      setAiObsError(error instanceof Error ? error.message : "Failed to load AI metrics")
    } finally {
      setAiObsLoading(false)
    }
  }, [activeWorkspace, aiObsWindow])

  useEffect(() => {
    refreshAiObservability()
  }, [refreshAiObservability])

  useEffect(() => {
    if (!aiPromptsOpen) return
    if (!activeWorkspace) return
    if (aiPromptTemplates) return

    let cancelled = false
    setAiPromptsLoading(true)
    getAiPromptTemplates(activeWorkspace)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.templates) {
          setAiPromptTemplates(result.templates)
        } else {
          toast.error("Failed to load prompts", { description: result.error || "Unknown error" })
        }
      })
      .catch((err) => {
        if (cancelled) return
        toast.error("Failed to load prompts", { description: err instanceof Error ? err.message : "Unknown error" })
      })
      .finally(() => {
        if (cancelled) return
        setAiPromptsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [aiPromptsOpen, activeWorkspace, aiPromptTemplates])

  // Load GHL calendars and users for booking config
  const loadGHLData = async (clientId: string) => {
    setIsLoadingGhlData(true)
    try {
      // Test connection first
      const connectionResult = await testGHLConnectionForWorkspace(clientId)
      if (connectionResult.success) {
        setGhlConnectionStatus("connected")
        
        // Load calendars and users in parallel
        const [calendarsResult, usersResult] = await Promise.all([
          fetchGHLCalendarsForWorkspace(clientId),
          fetchGHLUsersForWorkspace(clientId),
        ])

        if (calendarsResult.success && calendarsResult.calendars) {
          setGhlCalendars(calendarsResult.calendars)
        }
        if (usersResult.success && usersResult.users) {
          setGhlUsers(usersResult.users)
        }
      } else {
        setGhlConnectionStatus("error")
      }
    } catch (error) {
      console.error("Failed to load GHL data:", error)
      setGhlConnectionStatus("error")
    } finally {
      setIsLoadingGhlData(false)
    }
  }

  // Handle auto-book toggle with workspace-level update
  const handleAutoBookToggle = async (enabled: boolean) => {
    if (!activeWorkspace) return
    
    setMeetingBooking(prev => ({ ...prev, autoBookMeetings: enabled }))
    handleChange()

    // When enabling workspace auto-book, set all leads to enabled
    if (enabled) {
      const result = await setWorkspaceAutoBookEnabled(activeWorkspace, true)
      if (result.success) {
        toast.success(`Auto-booking enabled for ${result.updatedCount} leads`)
      }
    }
  }

  // Track changes
  const handleChange = () => {
    setHasChanges(true)
  }

  // Save all settings
  const handleSaveSettings = async () => {
    setIsSaving(true)
    
    const result = await updateUserSettings(activeWorkspace, {
      aiPersonaName: aiPersona.name || undefined,
      aiTone: aiPersona.tone,
      aiGreeting: aiPersona.greeting,
      aiSmsGreeting: aiPersona.smsGreeting,
      aiSignature: aiPersona.signature || undefined,
      aiGoals: aiPersona.goals || undefined,
      serviceDescription: aiPersona.serviceDescription || undefined,
      companyName: companyContext.companyName || undefined,
      targetResult: companyContext.targetResult || undefined,
      qualificationQuestions: qualificationQuestions.length > 0 
        ? JSON.stringify(qualificationQuestions) 
        : undefined,
      autoApproveMeetings: automationRules.autoApproveMeetings,
      flagUncertainReplies: automationRules.flagUncertainReplies,
      pauseForOOO: automationRules.pauseForOOO,
      autoBlacklist: automationRules.autoBlacklist,
      emailDigest: notifications.emailDigest,
      slackAlerts: notifications.slackAlerts,
      timezone: availability.timezone,
      workStartTime: availability.startTime,
      workEndTime: availability.endTime,
      // GHL Meeting Booking settings
      ghlDefaultCalendarId: meetingBooking.ghlDefaultCalendarId || null,
      ghlAssignedUserId: meetingBooking.ghlAssignedUserId || null,
      autoBookMeetings: meetingBooking.autoBookMeetings,
      meetingDurationMinutes: meetingBooking.meetingDurationMinutes,
      meetingTitle: meetingBooking.meetingTitle || null,
    })

    if (result.success) {
      toast.success("Settings saved", {
        description: "Your settings have been saved successfully.",
      })
      setHasChanges(false)
    } else {
      toast.error("Error", {
        description: result.error || "Failed to save settings.",
      })
    }

    setIsSaving(false)
  }

  const handleBackfillFollowUps = async () => {
    if (!activeWorkspace) {
      toast.error("Select a workspace first")
      return
    }

    setIsBackfillingFollowUps(true)
    try {
      const res = await backfillNoResponseFollowUpsForAwaitingReplyLeads(activeWorkspace, { limit: 200 })
      if (!res.success) {
        toast.error(res.error || "Failed to backfill follow-ups")
        return
      }

      toast.success("Backfill complete", {
        description: `Checked ${res.checked ?? 0}, enabled ${res.enabledNow ?? 0}, started ${res.started ?? 0}`,
      })

      // Refresh settings + calendar links so the banner can update without a full reload
      const refreshed = await getUserSettings(activeWorkspace)
      if (refreshed.success && refreshed.data) {
        setSettings(refreshed.data)
      }
      const links = await getCalendarLinks(activeWorkspace)
      if (links.success && links.data) {
        setCalendarLinks(links.data)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to backfill follow-ups")
    } finally {
      setIsBackfillingFollowUps(false)
    }
  }

  const getWorkspaceTimeZone = () => settings?.timezone || "America/Los_Angeles"

  const formatWorkspaceDateTime = (d: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: getWorkspaceTimeZone(),
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d)
  }

  const handlePauseWorkspaceFollowUps = async (daysOverride?: number) => {
    if (!activeWorkspace) {
      toast.error("Select a workspace first")
      return
    }

    const daysRaw = daysOverride ?? Number.parseInt(pauseFollowUpsDays, 10)
    if (!Number.isFinite(daysRaw) || daysRaw <= 0) {
      toast.error("Enter a valid number of days")
      return
    }

    setIsPausingFollowUps(true)
    try {
      const res = await pauseWorkspaceFollowUps(activeWorkspace, daysRaw)
      if (res.success && res.pausedUntil) {
        setFollowUpsPausedUntil(res.pausedUntil)
        toast.success("Follow-ups paused", {
          description: `Paused until ${formatWorkspaceDateTime(res.pausedUntil)}`,
        })
      } else {
        toast.error(res.error || "Failed to pause follow-ups")
      }
    } catch (err) {
      toast.error("Failed to pause follow-ups")
    } finally {
      setIsPausingFollowUps(false)
    }
  }

  const handleResumeWorkspaceFollowUps = async () => {
    if (!activeWorkspace) {
      toast.error("Select a workspace first")
      return
    }

    setIsPausingFollowUps(true)
    try {
      const res = await resumeWorkspaceFollowUps(activeWorkspace)
      if (res.success) {
        setFollowUpsPausedUntil(null)
        toast.success("Follow-ups resumed")
      } else {
        toast.error(res.error || "Failed to resume follow-ups")
      }
    } catch (err) {
      toast.error("Failed to resume follow-ups")
    } finally {
      setIsPausingFollowUps(false)
    }
  }

  const isFollowUpsPaused =
    Boolean(followUpsPausedUntil) && (followUpsPausedUntil as Date).getTime() > Date.now()

  // Qualification question handlers
  const handleAddQuestion = useCallback(() => {
    if (!newQuestion.trim()) return
    const question: QualificationQuestion = {
      id: crypto.randomUUID(),
      question: newQuestion.trim(),
      required: false,
    }
    setQualificationQuestions(prev => [...prev, question])
    setNewQuestion("")
    handleChange()
  }, [newQuestion])

  const handleRemoveQuestion = useCallback((id: string) => {
    setQualificationQuestions(prev => prev.filter(q => q.id !== id))
    handleChange()
  }, [])

  const handleToggleQuestionRequired = useCallback((id: string) => {
    setQualificationQuestions(prev => 
      prev.map(q => q.id === id ? { ...q, required: !q.required } : q)
    )
    handleChange()
  }, [])

  // Knowledge asset handlers
  const handleAddAsset = useCallback(async () => {
    if (!newAssetName.trim() || !newAssetContent.trim()) {
      toast.error("Please provide both name and content for the asset")
      return
    }

    const result = await addKnowledgeAsset(activeWorkspace, {
      name: newAssetName.trim(),
      type: newAssetType,
      textContent: newAssetContent.trim(),
    })

    if (result.success && result.assetId) {
      setKnowledgeAssets(prev => [{
        id: result.assetId!,
        name: newAssetName.trim(),
        type: newAssetType,
        fileUrl: null,
        textContent: newAssetContent.trim(),
        originalFileName: null,
        mimeType: null,
        createdAt: new Date(),
      }, ...prev])
      setNewAssetName("")
      setNewAssetContent("")
      toast.success("Knowledge asset added")
    } else {
      toast.error(result.error || "Failed to add asset")
    }
  }, [activeWorkspace, newAssetName, newAssetContent, newAssetType])

  const handleDeleteAsset = useCallback(async (assetId: string) => {
    const result = await deleteKnowledgeAsset(assetId)
    if (result.success) {
      setKnowledgeAssets(prev => prev.filter(a => a.id !== assetId))
      toast.success("Asset deleted")
    } else {
      toast.error(result.error || "Failed to delete asset")
    }
  }, [])

  // Calendar link handlers
  const handleAddCalendarLink = useCallback(async () => {
    if (!activeWorkspace) {
      toast.error("No workspace selected")
      return
    }
    if (!newCalendarName.trim() || !newCalendarUrl.trim()) {
      toast.error("Please provide both name and URL")
      return
    }

    setIsAddingCalendar(true)
    const result = await addCalendarLink(activeWorkspace, {
      name: newCalendarName.trim(),
      url: newCalendarUrl.trim(),
      setAsDefault: calendarLinks.length === 0,
    })

    if (result.success) {
      // Reload calendar links
      const calendarResult = await getCalendarLinks(activeWorkspace)
      if (calendarResult.success && calendarResult.data) {
        setCalendarLinks(calendarResult.data)
      }
      const mismatch = await getGhlCalendarMismatchInfo(activeWorkspace)
      if (mismatch.success) {
        setCalendarMismatchInfo({
          mismatch: mismatch.mismatch ?? false,
          ghlDefaultCalendarId: mismatch.ghlDefaultCalendarId ?? null,
          calendarLinkGhlCalendarId: mismatch.calendarLinkGhlCalendarId ?? null,
          lastError: mismatch.lastError ?? null,
        })
      }
      setNewCalendarName("")
      setNewCalendarUrl("")
      toast.success("Calendar link added")
    } else {
      toast.error(result.error || "Failed to add calendar link")
    }
    setIsAddingCalendar(false)
  }, [activeWorkspace, newCalendarName, newCalendarUrl, calendarLinks.length])

  const handleDeleteCalendarLink = useCallback(async (linkId: string) => {
    if (!activeWorkspace) {
      toast.error("No workspace selected")
      return
    }
    const result = await deleteCalendarLink(linkId)
    if (result.success) {
      // Reload calendar links
      const calendarResult = await getCalendarLinks(activeWorkspace)
      if (calendarResult.success && calendarResult.data) {
        setCalendarLinks(calendarResult.data)
      }
      const mismatch = await getGhlCalendarMismatchInfo(activeWorkspace)
      if (mismatch.success) {
        setCalendarMismatchInfo({
          mismatch: mismatch.mismatch ?? false,
          ghlDefaultCalendarId: mismatch.ghlDefaultCalendarId ?? null,
          calendarLinkGhlCalendarId: mismatch.calendarLinkGhlCalendarId ?? null,
          lastError: mismatch.lastError ?? null,
        })
      }
      toast.success("Calendar link deleted")
    } else {
      toast.error(result.error || "Failed to delete calendar link")
    }
  }, [activeWorkspace])

  const handleSetDefaultCalendarLink = useCallback(async (linkId: string) => {
    if (!activeWorkspace) {
      toast.error("No workspace selected")
      return
    }
    const result = await setDefaultCalendarLink(activeWorkspace, linkId)
    if (result.success) {
      setCalendarLinks(prev => prev.map(link => ({
        ...link,
        isDefault: link.id === linkId,
      })))
      const mismatch = await getGhlCalendarMismatchInfo(activeWorkspace)
      if (mismatch.success) {
        setCalendarMismatchInfo({
          mismatch: mismatch.mismatch ?? false,
          ghlDefaultCalendarId: mismatch.ghlDefaultCalendarId ?? null,
          calendarLinkGhlCalendarId: mismatch.calendarLinkGhlCalendarId ?? null,
          lastError: mismatch.lastError ?? null,
        })
      }
      toast.success("Default calendar updated")
    } else {
      toast.error(result.error || "Failed to set default")
    }
  }, [activeWorkspace])

  // Get user display info
  const userDisplayName = user?.fullName || user?.email?.split("@")[0] || "User"
  const userEmail = user?.email || ""
  const userAvatar = user?.avatarUrl || ""
  const userProvider = "email"
  const userInitials = userDisplayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  if (isLoading || isUserLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-muted-foreground">Manage your account and preferences</p>
          </div>
          {hasChanges && (
            <Button onClick={handleSaveSettings} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="p-6">
        <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-6">
          <TabsList className="grid w-full max-w-3xl grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="ai">AI Personality</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>

          {/* General Settings */}
          <TabsContent value="general" className="space-y-6">
            {settings?.autoFollowUpsOnReply ? (() => {
              const missing: string[] = []
              const senderName = (aiPersona.name || "").trim()
              const companyName = (companyContext.companyName || "").trim()
              const targetResult = (companyContext.targetResult || "").trim()
              const hasDefaultCalendar = calendarLinks.some((l) => l.isDefault)

              if (!senderName) missing.push("Sender name (AI Persona)")
              if (!companyName) missing.push("Company name")
              if (!targetResult) missing.push("Target result/outcome ({result})")
              if (!hasDefaultCalendar) missing.push("Default calendar link")

              if (missing.length === 0) return null

              return (
                <Card className="border-amber-500/30 bg-amber-500/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-200" />
                      <span className="text-amber-200">Follow-ups are ON, but templates are missing context</span>
                    </CardTitle>
                    <CardDescription className="text-amber-200/70">
                      Follow-up messages may fall back to placeholders or generic wording until these are filled out.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm text-amber-100/80">
                      Missing: {missing.join(", ")}
                      {airtableModeEnabled ? " • Airtable Mode is ON (email steps are skipped in sequences)." : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={handleBackfillFollowUps}
                        disabled={isBackfillingFollowUps}
                      >
                        {isBackfillingFollowUps ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Backfilling…
                          </>
                        ) : (
                          "Backfill follow-ups for awaiting-reply leads"
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })() : null}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Profile
                </CardTitle>
                <CardDescription>Your personal account settings (managed via your login provider)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-20 w-20">
                    {userAvatar ? (
                      <AvatarImage src={userAvatar} alt={userDisplayName} />
                    ) : null}
                    <AvatarFallback className="text-lg">{userInitials}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold text-lg">{userDisplayName}</p>
                    <p className="text-sm text-muted-foreground">{userEmail}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Profile managed by {userProvider} login
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Availability
                </CardTitle>
                <CardDescription>Set your working hours for scheduling</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select
                    value={availability.timezone}
                    onValueChange={(v) => {
                      setAvailability({ ...availability, timezone: v })
                      handleChange()
                    }}
                  >
                    <SelectTrigger>
                      <Globe className="h-4 w-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                      <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                      <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                      <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    <Input
                      type="time"
                      value={availability.startTime}
                      onChange={(e) => {
                        setAvailability({ ...availability, startTime: e.target.value })
                        handleChange()
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <Input
                      type="time"
                      value={availability.endTime}
                      onChange={(e) => {
                        setAvailability({ ...availability, endTime: e.target.value })
                        handleChange()
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Company/Outreach Context */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Company & Outreach Context
                </CardTitle>
                <CardDescription>Used in follow-up templates as {"{companyName}"} and {"{result}"}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    placeholder="e.g., Acme Corp"
                    value={companyContext.companyName}
                    onChange={(e) => {
                      setCompanyContext({ ...companyContext, companyName: e.target.value })
                      handleChange()
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Used in messages as {"{companyName}"} - e.g., "Hey John - Sarah from {"{companyName}"} again"
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetResult" className="flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Target Result/Outcome
                  </Label>
                  <Input
                    id="targetResult"
                    placeholder="e.g., growing your client base"
                    value={companyContext.targetResult}
                    onChange={(e) => {
                      setCompanyContext({ ...companyContext, targetResult: e.target.value })
                      handleChange()
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Used in messages as {"{result}"} - e.g., "in case you were still interested in {"{result}"}"
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Calendar Links */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Calendar Links
                </CardTitle>
                <CardDescription>
                  Booking links used in follow-up messages as {"{calendarLink}"}. The default link is used for {"{availability}"} slots.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Existing calendar links */}
                {calendarLinks.length > 0 ? (
                  <div className="space-y-2">
                    {calendarLinks.map((link) => (
                      <div key={link.id} className="flex items-center gap-3 p-3 rounded-lg border">
                        <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium truncate">{link.name}</p>
                            {link.isDefault && (
                              <Badge variant="outline" className="text-xs text-primary border-primary/30">
                                <Star className="h-3 w-3 mr-1" />
                                Default
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-xs capitalize">
                              {link.type}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{link.url}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          {!link.isDefault && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              onClick={() => handleSetDefaultCalendarLink(link.id)}
                            >
                              Set Default
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteCalendarLink(link.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No calendar links added yet</p>
                    <p className="text-xs">Add a link below to enable {"{calendarLink}"} in follow-ups</p>
                  </div>
                )}

                {/* Add new calendar link */}
                <div className="space-y-3 p-4 rounded-lg border border-dashed">
                  <p className="text-sm font-medium">Add Calendar Link</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Name</Label>
                      <Input
                        placeholder="e.g., Sales Call"
                        value={newCalendarName}
                        onChange={(e) => setNewCalendarName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">URL</Label>
                      <Input
                        placeholder="https://calendly.com/..."
                        value={newCalendarUrl}
                        onChange={(e) => setNewCalendarUrl(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddCalendarLink}
                    disabled={!newCalendarName.trim() || !newCalendarUrl.trim() || isAddingCalendar}
                  >
                    {isAddingCalendar ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-1.5" />
                    )}
                    Add Calendar
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Supports Calendly, HubSpot Meetings, and GoHighLevel calendars
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notifications
                </CardTitle>
                <CardDescription>Configure how you receive alerts</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Email Digest</p>
                    <p className="text-sm text-muted-foreground">Daily summary of activity</p>
                  </div>
                  <Switch
                    checked={notifications.emailDigest}
                    onCheckedChange={(v) => {
                      setNotifications({ ...notifications, emailDigest: v })
                      handleChange()
                    }}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Slack Alerts</p>
                    <p className="text-sm text-muted-foreground">Real-time notifications in Slack</p>
                  </div>
                  <Switch
                    checked={notifications.slackAlerts}
                    onCheckedChange={(v) => {
                      setNotifications({ ...notifications, slackAlerts: v })
                      handleChange()
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Integrations */}
          <TabsContent value="integrations" className="space-y-6">
            {/* GHL Workspaces - Dynamic Multi-Tenancy */}
            <IntegrationsManager onWorkspacesChange={onWorkspacesChange} />

            {/* Meeting Booking Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Meeting Booking
                </CardTitle>
                <CardDescription>
                  Configure automatic meeting booking via GoHighLevel
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Connection Status */}
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      ghlConnectionStatus === "connected" ? "bg-green-500/10" : 
                      ghlConnectionStatus === "error" ? "bg-red-500/10" : "bg-muted"
                    }`}>
                      {isLoadingGhlData ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : ghlConnectionStatus === "connected" ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <HelpCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {ghlConnectionStatus === "connected" 
                          ? "GHL Connected" 
                          : ghlConnectionStatus === "error"
                          ? "GHL Connection Error"
                          : "GHL Connection Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ghlConnectionStatus === "connected" 
                          ? `${ghlCalendars.length} calendar(s) available`
                          : "Configure GHL credentials in workspace settings"}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => activeWorkspace && loadGHLData(activeWorkspace)}
                    disabled={!activeWorkspace || isLoadingGhlData}
                  >
                    {isLoadingGhlData ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Test Connection"
                    )}
                  </Button>
                </div>

                {ghlConnectionStatus === "connected" && (
                  <>
                    <Separator />

                    {/* Calendar Selection */}
                    <div className="space-y-2">
                      <Label>Default GHL Calendar</Label>
                      <Select
                        value={meetingBooking.ghlDefaultCalendarId}
                        onValueChange={(v) => {
                          setMeetingBooking(prev => ({ ...prev, ghlDefaultCalendarId: v }))
                          setCalendarMismatchInfo(prev => prev ? ({
                            ...prev,
                            ghlDefaultCalendarId: v,
                            mismatch: !!prev.calendarLinkGhlCalendarId && prev.calendarLinkGhlCalendarId !== v,
                          }) : prev)
                          handleChange()
                        }}
                        disabled={ghlCalendars.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a calendar for booking" />
                        </SelectTrigger>
                        <SelectContent>
                          {ghlCalendars.map((cal) => (
                            <SelectItem key={cal.id} value={cal.id}>
                              {cal.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Appointments will be created on this calendar
                      </p>

                      {calendarMismatchInfo?.mismatch && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                          <p className="font-medium text-amber-700">
                            Warning: Calendar Link & Booking Calendar differ
                          </p>
                          <p className="mt-1 text-amber-700/90">
                            Slots shown come from your default Calendar Link, but bookings will be created on the selected GHL calendar.
                          </p>
                          <p className="mt-2 text-amber-700/90">
                            Link calendar: <span className="font-mono">{calendarMismatchInfo.calendarLinkGhlCalendarId}</span>
                            <br />
                            Booking calendar: <span className="font-mono">{calendarMismatchInfo.ghlDefaultCalendarId}</span>
                          </p>
                        </div>
                      )}

                      {calendarMismatchInfo?.lastError && (
                        <p className="text-xs text-muted-foreground">
                          Availability status: {calendarMismatchInfo.lastError}
                        </p>
                      )}
                    </div>

                    {/* Assigned User */}
                    <div className="space-y-2">
                      <Label>Assigned Team Member</Label>
                      <Select
                        value={meetingBooking.ghlAssignedUserId}
                        onValueChange={(v) => {
                          setMeetingBooking(prev => ({ ...prev, ghlAssignedUserId: v }))
                          handleChange()
                        }}
                        disabled={ghlUsers.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select team member" />
                        </SelectTrigger>
                        <SelectContent>
                          {ghlUsers.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.name || `${user.firstName} ${user.lastName}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        This person will be assigned to all booked appointments
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Meeting Duration */}
                      <div className="space-y-2">
                        <Label>Meeting Duration</Label>
                        <Select
                          value={String(meetingBooking.meetingDurationMinutes)}
                          onValueChange={(v) => {
                            const minutes = parseInt(v)
                            setMeetingBooking(prev => ({ ...prev, meetingDurationMinutes: minutes }))
                            handleChange()
                            if (minutes !== 30) {
                              toast.error("Only 30-minute meetings are supported for live availability + auto-booking. Set it back to 30.")
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="15">15 minutes</SelectItem>
                            <SelectItem value="30">30 minutes</SelectItem>
                            <SelectItem value="45">45 minutes</SelectItem>
                            <SelectItem value="60">60 minutes</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Meeting Title */}
                      <div className="space-y-2">
                        <Label>Meeting Title Template</Label>
                        <Input
                          value={meetingBooking.meetingTitle}
                          onChange={(e) => {
                            setMeetingBooking(prev => ({ ...prev, meetingTitle: e.target.value }))
                            handleChange()
                          }}
                          placeholder="Intro to {companyName}"
                        />
                        <p className="text-xs text-muted-foreground">
                          Use {"{companyName}"} for your company name
                        </p>
                      </div>
                    </div>

                    <Separator />

                    {/* Auto-Book Toggle */}
                    <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                      <div className="space-y-1">
                        <Label className="text-base font-medium">Auto-Book Meetings</Label>
                        <p className="text-sm text-muted-foreground">
                          Automatically book meetings when leads accept a time slot.
                          When enabled, all leads will have auto-booking on by default.
                        </p>
                      </div>
                      <Switch
                        checked={meetingBooking.autoBookMeetings}
                        onCheckedChange={handleAutoBookToggle}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

          </TabsContent>

          {/* AI Personality */}
          <TabsContent value="ai" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  AI Persona Configuration
                </CardTitle>
                <CardDescription>Customize how the AI represents you in outreach</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="aiName">AI Display Name</Label>
                    <Input
                      id="aiName"
                      value={aiPersona.name}
                      onChange={(e) => {
                        setAiPersona({ ...aiPersona, name: e.target.value })
                        handleChange()
                      }}
                      placeholder="Your name for outreach"
                    />
                    <p className="text-xs text-muted-foreground">The name used in outreach messages</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Communication Tone</Label>
                    <Select 
                      value={aiPersona.tone} 
                      onValueChange={(v) => {
                        setAiPersona({ ...aiPersona, tone: v })
                        handleChange()
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="friendly-professional">Friendly Professional</SelectItem>
                        <SelectItem value="professional">Professional</SelectItem>
                        <SelectItem value="friendly">Friendly</SelectItem>
                        <SelectItem value="casual">Casual</SelectItem>
                        <SelectItem value="formal">Formal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="greeting" className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email Greeting
                    </Label>
                    <Input
                      id="greeting"
                      value={aiPersona.greeting}
                      onChange={(e) => {
                        setAiPersona({ ...aiPersona, greeting: e.target.value })
                        handleChange()
                      }}
                      placeholder="Hi {firstName},"
                    />
                    <p className="text-xs text-muted-foreground">
                      Opening line for email messages
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smsGreeting" className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" />
                      SMS Greeting
                    </Label>
                    <Input
                      id="smsGreeting"
                      value={aiPersona.smsGreeting}
                      onChange={(e) => {
                        setAiPersona({ ...aiPersona, smsGreeting: e.target.value })
                        handleChange()
                      }}
                      placeholder="Hi {firstName},"
                    />
                    <p className="text-xs text-muted-foreground">
                      Opening line for SMS messages
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  Use {"{firstName}"}, {"{lastName}"} as variables in greetings
                </p>

                <div className="space-y-2">
                  <Label htmlFor="signature">Email Signature</Label>
                  <Textarea
                    id="signature"
                    value={aiPersona.signature}
                    onChange={(e) => {
                      setAiPersona({ ...aiPersona, signature: e.target.value })
                      handleChange()
                    }}
                    rows={4}
                    placeholder="Best regards,&#10;Your Name&#10;Company Name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="aiGoals">AI Goals & Strategy</Label>
                  <Textarea
                    id="aiGoals"
                    value={aiPersona.goals}
                    onChange={(e) => {
                      setAiPersona({ ...aiPersona, goals: e.target.value })
                      handleChange()
                    }}
                    rows={4}
                    placeholder="Example: Prioritize booking intro calls within 7 days; keep tone consultative; surface upsell opportunities."
                  />
                  <p className="text-xs text-muted-foreground">
                    Describe the goals/strategy the AI should prioritize. Combined with sentiment to choose responses.
                  </p>
                </div>

                <Separator />

                {/* Service Description */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">Service Description</h4>
                  </div>
                  <Textarea
                    id="serviceDescription"
                    value={aiPersona.serviceDescription}
                    onChange={(e) => {
                      setAiPersona({ ...aiPersona, serviceDescription: e.target.value })
                      handleChange()
                    }}
                    rows={6}
                    placeholder="Describe your business, services, and value proposition. This helps the AI understand what you offer and communicate it effectively to leads.&#10;&#10;Example: We are a B2B SaaS company providing AI-powered sales automation tools. Our main product helps sales teams automate follow-ups, qualify leads, and book more meetings."
                  />
                  <p className="text-xs text-muted-foreground">
                    Provide detailed context about your business so the AI can tailor responses appropriately.
                  </p>
                </div>

                <Separator />

                {/* Qualification Questions */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">Qualification Questions</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Questions the AI should ask to qualify leads. These will be woven into conversations naturally.
                  </p>
                  
                  {/* Existing questions */}
                  <div className="space-y-2">
                    {qualificationQuestions.map((q) => (
                      <div key={q.id} className="flex items-center gap-2 p-3 rounded-lg border">
                        <span className="flex-1 text-sm">{q.question}</span>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Switch
                              checked={q.required}
                              onCheckedChange={() => handleToggleQuestionRequired(q.id)}
                              className="h-4 w-7"
                            />
                            Required
                          </label>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveQuestion(q.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Add new question */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add a qualification question..."
                      value={newQuestion}
                      onChange={(e) => setNewQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          handleAddQuestion()
                        }
                      }}
                    />
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={handleAddQuestion}
                      disabled={!newQuestion.trim()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Examples: "What is your current monthly budget for this solution?", "Who else is involved in this decision?"
                  </p>
                </div>

                <Separator />

                {/* Knowledge Assets */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">Knowledge Assets</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Add documents, text snippets, or URLs that the AI can reference when generating responses.
                  </p>
                  
                  {/* Existing assets */}
                  {knowledgeAssets.length > 0 && (
                    <div className="space-y-2">
                      {knowledgeAssets.map((asset) => (
                        <div key={asset.id} className="flex items-center gap-3 p-3 rounded-lg border">
                          {asset.type === "url" ? (
                            <Link2 className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{asset.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {asset.type === "url" ? asset.textContent : `${asset.textContent?.slice(0, 100)}...`}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {asset.type}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteAsset(asset.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Add new asset */}
                  <div className="space-y-3 p-4 rounded-lg border border-dashed">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Asset Name</Label>
                        <Input
                          placeholder="e.g., Pricing Guide"
                          value={newAssetName}
                          onChange={(e) => setNewAssetName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Type</Label>
                        <Select value={newAssetType} onValueChange={(v) => setNewAssetType(v as "text" | "url")}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Text Snippet</SelectItem>
                            <SelectItem value="url">URL / Link</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {newAssetType === "url" ? "URL" : "Content"}
                      </Label>
                      <Textarea
                        placeholder={newAssetType === "url" 
                          ? "https://example.com/pricing" 
                          : "Paste content here that the AI can reference..."
                        }
                        value={newAssetContent}
                        onChange={(e) => setNewAssetContent(e.target.value)}
                        rows={3}
                      />
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleAddAsset}
                      disabled={!newAssetName.trim() || !newAssetContent.trim()}
                    >
                      <Plus className="h-4 w-4 mr-1.5" />
                      Add Asset
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      File uploads coming soon. For now, paste text content directly.
                    </p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">AI Behavior Rules</h4>
                  </div>
                  <div className="grid gap-3">
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Auto-approve meeting confirmations</span>
                      <Switch 
                        checked={automationRules.autoApproveMeetings}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, autoApproveMeetings: v })
                          handleChange()
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Flag uncertain responses for review</span>
                      <Switch 
                        checked={automationRules.flagUncertainReplies}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, flagUncertainReplies: v })
                          handleChange()
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Pause sequences for Out-of-Office replies</span>
                      <Switch 
                        checked={automationRules.pauseForOOO}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, pauseForOOO: v })
                          handleChange()
                        }}
                      />
                    </div>
                    <div className="p-3 rounded-lg border space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">Pause all follow-ups</span>
                            {isFollowUpsPaused ? (
                              <Badge variant="destructive" className="text-xs">Paused</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">Active</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Blocks auto-enrollment and automated outbound sends. Manual messages are still allowed.
                          </p>
                          {isFollowUpsPaused && followUpsPausedUntil ? (
                            <p className="text-xs text-muted-foreground">
                              Paused until {formatWorkspaceDateTime(followUpsPausedUntil)}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={365}
                            step={1}
                            className="w-[90px]"
                            value={pauseFollowUpsDays}
                            disabled={!activeWorkspace || isPausingFollowUps}
                            onChange={(e) => setPauseFollowUpsDays(e.target.value)}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!activeWorkspace || isPausingFollowUps}
                            onClick={() => handlePauseWorkspaceFollowUps()}
                          >
                            Pause
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!activeWorkspace || isPausingFollowUps || !isFollowUpsPaused}
                            onClick={() => handleResumeWorkspaceFollowUps()}
                          >
                            Resume
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[1, 3, 7, 14].map((d) => (
                          <Button
                            key={d}
                            variant="secondary"
                            size="sm"
                            disabled={!activeWorkspace || isPausingFollowUps}
                            onClick={() => {
                              setPauseFollowUpsDays(String(d))
                              handlePauseWorkspaceFollowUps(d)
                            }}
                          >
                            {d}d
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <span className="text-sm">Auto-blacklist explicit opt-outs</span>
	                      <Switch 
	                        checked={automationRules.autoBlacklist}
	                        onCheckedChange={(v) => {
	                          setAutomationRules({ ...automationRules, autoBlacklist: v })
	                          handleChange()
	                        }}
	                      />
	                    </div>
	                    <div className="flex items-center justify-between p-3 rounded-lg border">
	                      <div className="space-y-0.5">
	                        <span className="text-sm">Airtable Mode</span>
	                        <p className="text-xs text-muted-foreground">
	                          Email is handled externally; default sequences become SMS/LinkedIn-only
	                        </p>
	                      </div>
	                      <Switch 
	                        checked={airtableModeEnabled}
	                        disabled={!activeWorkspace || isApplyingAirtableMode}
	                        onCheckedChange={async (v) => {
	                          if (!activeWorkspace) return

		                          if (v) {
		                            const ok = confirm(
		                              [
		                                "Enable Airtable Mode for this workspace?",
		                                "",
		                                "This will remove email steps from the default follow-up sequences and skip email steps during execution.",
		                                "Turning it off will NOT automatically restore email steps.",
		                              ].join("\n")
		                            )
		                            if (!ok) return
		                          }

	                          setIsApplyingAirtableMode(true)
	                          const previous = airtableModeEnabled
	                          setAirtableModeEnabled(v)
	                          try {
	                            const result = await setAirtableMode(activeWorkspace, v)
		                            if (result.success) {
		                              toast.success("Airtable Mode updated", {
		                                description: v
		                                  ? `Updated ${result.updatedSequences ?? 0} default sequence(s)`
		                                  : "Email steps remain unchanged (manual restore)",
		                              })
		                            } else {
		                              setAirtableModeEnabled(previous)
		                              toast.error(result.error || "Failed to update Airtable Mode")
		                            }
		                          } catch (err) {
		                            setAirtableModeEnabled(previous)
		                            toast.error("Failed to update Airtable Mode")
		                          } finally {
		                            setIsApplyingAirtableMode(false)
		                          }
	                        }}
	                      />
	                    </div>
	                  </div>
	                </div>
	              </CardContent>
	            </Card>

            {canViewAiObs ? (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Activity className="h-5 w-5" />
                          AI Dashboard
                        </CardTitle>
                        <CardDescription>
                          Token usage + cost estimates across all AI calls (30-day retention)
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={aiObsWindow}
                          onValueChange={(v) => setAiObsWindow(v as AiObservabilityWindow)}
                        >
                          <SelectTrigger className="w-[110px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="24h">24h</SelectItem>
                            <SelectItem value="7d">7d</SelectItem>
                            <SelectItem value="30d">30d</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={refreshAiObservability}
                          disabled={aiObsLoading}
                        >
                          <RefreshCcw className="h-4 w-4 mr-2" />
                          Refresh
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAiPromptsOpen(true)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          View Prompts
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {aiObsError ? (
                      <div className="text-sm text-destructive">{aiObsError}</div>
                    ) : null}

                    {aiObsLoading ? (
                      <div className="flex items-center justify-center py-10">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : aiObs ? (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="p-3 rounded-lg border">
                            <p className="text-xs text-muted-foreground">Calls</p>
                            <p className="text-xl font-semibold">
                              {new Intl.NumberFormat().format(aiObs.totals.calls)}
                            </p>
                          </div>
                          <div className="p-3 rounded-lg border">
                            <p className="text-xs text-muted-foreground">Tokens</p>
                            <p className="text-xl font-semibold">
                              {new Intl.NumberFormat(undefined, { notation: "compact" }).format(aiObs.totals.totalTokens)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Intl.NumberFormat(undefined, { notation: "compact" }).format(aiObs.totals.inputTokens)} in /{" "}
                              {new Intl.NumberFormat(undefined, { notation: "compact" }).format(aiObs.totals.outputTokens)} out
                            </p>
                          </div>
                          <div className="p-3 rounded-lg border">
                            <p className="text-xs text-muted-foreground">Estimated Cost</p>
                            <p className="text-xl font-semibold flex items-center gap-2">
                              <DollarSign className="h-4 w-4 text-muted-foreground" />
                              {aiObs.totals.estimatedCostUsd.toLocaleString("en-US", {
                                style: "currency",
                                currency: "USD",
                              })}
                            </p>
                            {!aiObs.totals.costComplete ? (
                              <p className="text-xs text-muted-foreground">Partial (unknown model rates)</p>
                            ) : null}
                          </div>
                          <div className="p-3 rounded-lg border">
                            <p className="text-xs text-muted-foreground">Errors</p>
                            <p className="text-xl font-semibold">
                              {aiObs.totals.calls
                                ? `${Math.round((aiObs.totals.errors / aiObs.totals.calls) * 100)}%`
                                : "0%"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Intl.NumberFormat().format(aiObs.totals.errors)} errors ·{" "}
                              {aiObs.totals.avgLatencyMs ? `${aiObs.totals.avgLatencyMs}ms avg` : "—"}
                            </p>
                          </div>
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">By Feature</p>
                            <p className="text-xs text-muted-foreground">
                              Window: {aiObs.window} · Updated:{" "}
                              {new Date(aiObs.rangeEnd).toLocaleString()}
                            </p>
                          </div>

                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Feature</TableHead>
                                <TableHead>Model</TableHead>
                                <TableHead>Calls</TableHead>
                                <TableHead>Tokens</TableHead>
                                <TableHead>Cost</TableHead>
                                <TableHead>Errors</TableHead>
                                <TableHead>Latency</TableHead>
                                <TableHead>Last Used</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {aiObs.features.map((f) => (
                                <TableRow key={`${f.featureId}:${f.model}`}>
                                  <TableCell className="font-medium">{f.name}</TableCell>
                                  <TableCell className="text-muted-foreground">{f.model}</TableCell>
                                  <TableCell>{new Intl.NumberFormat().format(f.calls)}</TableCell>
                                  <TableCell>
                                    {new Intl.NumberFormat(undefined, { notation: "compact" }).format(f.totalTokens)}
                                  </TableCell>
                                  <TableCell>
                                    {f.estimatedCostUsd === null
                                      ? "—"
                                      : f.estimatedCostUsd.toLocaleString("en-US", {
                                          style: "currency",
                                          currency: "USD",
                                        })}
                                  </TableCell>
                                  <TableCell>{new Intl.NumberFormat().format(f.errors)}</TableCell>
                                  <TableCell>{f.avgLatencyMs ? `${f.avgLatencyMs}ms` : "—"}</TableCell>
                                  <TableCell>
                                    {f.lastUsedAt ? new Date(f.lastUsedAt).toLocaleString() : "—"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">Recent Errors</p>
                            <p className="text-xs text-muted-foreground">Samples only (not a full log)</p>
                          </div>

                          {aiObs.errorSamples?.length ? (
                            <Accordion type="single" collapsible className="w-full">
                              {aiObs.errorSamples.map((group) => (
                                <AccordionItem
                                  key={`${group.featureId}:${group.model}`}
                                  value={`${group.featureId}:${group.model}`}
                                >
                                  <AccordionTrigger>
                                    <div className="flex flex-col text-left">
                                      <span className="font-medium">{group.name}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {group.model} · {new Intl.NumberFormat().format(group.errors)} errors
                                      </span>
                                    </div>
                                  </AccordionTrigger>
                                  <AccordionContent className="space-y-2">
                                    {group.samples.map((sample, index) => {
                                      const message =
                                        sample.message.length > 240
                                          ? `${sample.message.slice(0, 240)}…`
                                          : sample.message;
                                      return (
                                        <div
                                          key={`${group.featureId}:${group.model}:${index}`}
                                          className="rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap"
                                        >
                                          <div className="text-muted-foreground">
                                            {new Date(sample.at).toLocaleString()}
                                          </div>
                                          <div className="mt-1">{message}</div>
                                        </div>
                                      );
                                    })}
                                  </AccordionContent>
                                </AccordionItem>
                              ))}
                            </Accordion>
                          ) : (
                            <div className="text-sm text-muted-foreground">No errors in this window.</div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-muted-foreground">No AI activity in this window yet.</div>
                    )}
                  </CardContent>
                </Card>

                <Dialog open={aiPromptsOpen} onOpenChange={setAiPromptsOpen}>
                  <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Backend Prompts</DialogTitle>
                      <DialogDescription>
                        Template-only view (system / assistant / user). No lead data is shown.
                      </DialogDescription>
                    </DialogHeader>

                    {aiPromptsLoading ? (
                      <div className="flex items-center justify-center py-10">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : aiPromptTemplates && aiPromptTemplates.length > 0 ? (
                      <Accordion type="single" collapsible className="w-full">
                        {aiPromptTemplates.map((t) => (
                          <AccordionItem key={t.key} value={t.key}>
                            <AccordionTrigger>
                              <div className="flex flex-col text-left">
                                <span className="font-medium">{t.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {t.featureId} · {t.model} · {t.apiType}
                                </span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="space-y-4">
                              {t.description ? (
                                <p className="text-sm text-muted-foreground">{t.description}</p>
                              ) : null}

                              {(["system", "assistant", "user"] as const).map((role) => {
                                const parts = t.messages.filter((m) => m.role === role)
                                if (parts.length === 0) return null
                                return (
                                  <div key={role} className="space-y-2">
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      {role}
                                    </p>
                                    {parts.map((p, i) => (
                                      <div
                                        key={`${t.key}:${role}:${i}`}
                                        className="rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap"
                                      >
                                        {p.content}
                                      </div>
                                    ))}
                                  </div>
                                )
                              })}
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    ) : (
                      <div className="text-sm text-muted-foreground">No prompt templates available.</div>
                    )}
                  </DialogContent>
                </Dialog>
              </>
            ) : null}
          </TabsContent>

          {/* Team Management */}
          <TabsContent value="team" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Team Members
                </CardTitle>
                <CardDescription>Manage who has access to this workspace</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="rounded-full bg-muted p-4 mb-4">
                    <Lock className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Team Management Coming Soon</h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Multi-user team management and role-based access control will be available in a future update.
                    Currently, each workspace is tied to your individual account.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Security
                </CardTitle>
                <CardDescription>Security settings for your workspace</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Two-Factor Authentication</p>
                    <p className="text-sm text-muted-foreground">Require 2FA for all team members</p>
                  </div>
                  <Switch 
                    disabled 
                    onCheckedChange={() => toast.info("Coming soon", { description: "2FA will be available in a future update." })}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">SSO (Single Sign-On)</p>
                    <p className="text-sm text-muted-foreground">Enable SAML-based SSO</p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled
                    onClick={() => toast.info("Coming soon", { description: "SSO will be available in a future update." })}
                  >
                    Configure
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
