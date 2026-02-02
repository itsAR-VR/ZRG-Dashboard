"use client"

import { useState, useEffect, useLayoutEffect, useCallback } from "react"
import {
  Mail,
  Send,
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
  Pencil,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SecretInput } from "@/components/ui/secret-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { IntegrationsManager } from "./settings/integrations-manager"
import { AiCampaignAssignmentPanel } from "./settings/ai-campaign-assignment"
import { BookingProcessManager } from "./settings/booking-process-manager"
import { BookingProcessReference } from "./settings/booking-process-reference"
import { AiPersonaManager } from "./settings/ai-persona-manager"
import { BulkDraftRegenerationCard } from "./settings/bulk-draft-regeneration"
import { ClientPortalUsersManager } from "./settings/client-portal-users-manager"
import { WorkspaceMembersManager } from "./settings/workspace-members-manager"
// Note: FollowUpSequenceManager moved to Follow-ups view
import { cn } from "@/lib/utils"
import { getWorkspaceAdminStatus, getWorkspaceCapabilities } from "@/actions/access-actions"
import {
  getSlackApprovalRecipients,
  getSlackBotTokenStatus,
  getSlackMembers,
  listSlackChannelsForWorkspace,
  refreshSlackMembersCache,
  updateSlackApprovalRecipients,
  updateSlackBotToken,
} from "@/actions/slack-integration-actions"
import { getResendConfigStatus, updateResendConfig } from "@/actions/resend-integration-actions"
import { SENTIMENT_TAGS, type SentimentTag } from "@/lib/sentiment-shared"
import type { SlackApprovalRecipient } from "@/lib/auto-send/get-approval-recipients"
import type { WorkspaceCapabilities } from "@/lib/workspace-capabilities"
import {
  getClientEmailBisonBaseHost,
  getEmailBisonBaseHosts,
  setClientEmailBisonBaseHost,
  type EmailBisonBaseHostRow,
} from "@/actions/emailbison-base-host-actions"
import { previewEmailBisonAvailabilitySlotSentenceForWorkspace } from "@/actions/emailbison-availability-slot-actions"
import {
  getUserSettings,
  updateUserSettings,
  addKnowledgeAsset,
  uploadKnowledgeAssetFile,
  addWebsiteKnowledgeAsset,
  retryWebsiteKnowledgeAssetIngestion,
  deleteKnowledgeAsset,
  getCalendarLinks,
  addCalendarLink,
  updateCalendarLink,
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
  getPromptOverrides,
  savePromptOverride,
  resetPromptOverride,
  getPromptSnippetOverrides,
  savePromptSnippetOverride,
  resetPromptSnippetOverride,
  getSnippetRegistry,
  type AiObservabilityWindow,
  type AiPromptTemplatePublic,
  type ObservabilitySummary,
  type PromptOverrideRecord,
  type PromptSnippetOverrideRecord,
  type SnippetRegistryEntry,
} from "@/actions/ai-observability-actions"
import {
  listAiPersonas,
  getAiPersona,
  type AiPersonaSummary,
  type AiPersonaData,
} from "@/actions/ai-persona-actions"
import {
  fetchGHLCalendarsForWorkspace,
  fetchGHLUsersForWorkspace,
  testGHLConnectionForWorkspace,
  setWorkspaceAutoBookEnabled,
  getGhlCalendarMismatchInfo,
  getCalendlyCalendarMismatchInfo,
  type GHLCalendar,
  type GHLUser,
} from "@/actions/booking-actions"
import {
  ensureCalendlyWebhookSubscriptionForWorkspace,
  getCalendlyIntegrationStatusForWorkspace,
  testCalendlyConnectionForWorkspace,
} from "@/actions/calendly-actions"
import { backfillNoResponseFollowUpsForAwaitingReplyLeads } from "@/actions/crm-actions"
import { toast } from "sonner"
import { useUser } from "@/contexts/user-context"

const EMAILBISON_BASE_HOST_DEFAULT_VALUE = "__DEFAULT__"
const GHL_SAME_AS_DEFAULT_CALENDAR = "__SAME_AS_DEFAULT__"
const AUTO_SEND_SCHEDULE_DAYS = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
]

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type AutoSendHolidayState = {
  presetEnabled: boolean
  excludedPresetDates: string[]
  additionalBlackoutDates: string[]
  additionalBlackoutDateRanges: Array<{ start: string; end: string }>
}

const DEFAULT_AUTO_SEND_HOLIDAYS: AutoSendHolidayState = {
  presetEnabled: false,
  excludedPresetDates: [],
  additionalBlackoutDates: [],
  additionalBlackoutDateRanges: [],
}

const normalizeDateList = (input: unknown): string[] => {
  if (!Array.isArray(input)) return []
  const filtered = input.filter((value) => typeof value === "string" && DATE_PATTERN.test(value)) as string[]
  return Array.from(new Set(filtered)).sort()
}

const normalizeDateRanges = (input: unknown): Array<{ start: string; end: string }> => {
  if (!Array.isArray(input)) return []
  const ranges = new Map<string, { start: string; end: string }>()

  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const start = typeof record.start === "string" && DATE_PATTERN.test(record.start) ? record.start : null
    const end = typeof record.end === "string" && DATE_PATTERN.test(record.end) ? record.end : null
    if (!start || !end) continue
    const normalizedStart = start <= end ? start : end
    const normalizedEnd = start <= end ? end : start
    ranges.set(`${normalizedStart}:${normalizedEnd}`, { start: normalizedStart, end: normalizedEnd })
  }

  return Array.from(ranges.values()).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
}

function coerceAutoSendCustomSchedule(input: unknown): { days: number[]; startTime: string; endTime: string; holidays: AutoSendHolidayState } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const days = Array.isArray(record.days)
    ? record.days.filter((d) => typeof d === "number" && d >= 0 && d <= 6)
    : []
  const startTime = typeof record.startTime === "string" ? record.startTime : null
  const endTime = typeof record.endTime === "string" ? record.endTime : null
  if (!startTime || !endTime || days.length === 0) return null

  let holidays = { ...DEFAULT_AUTO_SEND_HOLIDAYS }
  if (record.holidays && typeof record.holidays === "object" && !Array.isArray(record.holidays)) {
    const holidayRecord = record.holidays as Record<string, unknown>
    holidays = {
      presetEnabled: holidayRecord.preset === "US_FEDERAL_PLUS_COMMON",
      excludedPresetDates: normalizeDateList(holidayRecord.excludedPresetDates),
      additionalBlackoutDates: normalizeDateList(holidayRecord.additionalBlackoutDates),
      additionalBlackoutDateRanges: normalizeDateRanges(holidayRecord.additionalBlackoutDateRanges),
    }
  }

  return { days, startTime, endTime, holidays }
}

interface SettingsViewProps {
  activeWorkspace?: string | null
  activeTab?: string
  onTabChange?: (tab: string) => void
  onWorkspacesChange?: (
    workspaces: Array<{
      id: string;
      name: string;
      ghlLocationId: string | null;
      hasDefaultCalendarLink?: boolean;
      brandName?: string | null;
      brandLogoUrl?: string | null;
      hasConnectedAccounts?: boolean;
    }>
  ) => void
}

function extractCalendlyEventTypeUuidFromUri(input: string | null | undefined): string | null {
  const raw = typeof input === "string" ? input.trim() : ""
  if (!raw) return null

  try {
    const url = new URL(raw)
    const parts = url.pathname.split("/").filter(Boolean)
    const idx = parts.findIndex((p) => p === "event_types")
    if (idx !== -1 && parts[idx + 1]) return parts[idx + 1]!
  } catch {
    // ignore non-URL inputs
  }

  const match = raw.match(/event_types\/([^/?#]+)/i)
  return match?.[1] ?? null
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
    idealCustomerProfile: "",  // ICP for lead scoring (Phase 33)
  })

  const [insightsChatSettings, setInsightsChatSettings] = useState({
    model: "gpt-5-mini",
    reasoningEffort: "medium",
    enableCampaignChanges: false,
    enableExperimentWrites: false,
    enableFollowupPauses: false,
  })

  // Draft generation model settings (Phase 30)
  const [draftGenerationSettings, setDraftGenerationSettings] = useState({
    model: "gpt-5.1",
    reasoningEffort: "medium",
  })

  // Qualification questions state
  const [qualificationQuestions, setQualificationQuestions] = useState<QualificationQuestion[]>([])
  const [newQuestion, setNewQuestion] = useState("")
  const [qualificationQuestionsOpen, setQualificationQuestionsOpen] = useState(false)

  // Knowledge assets state
  const [knowledgeAssets, setKnowledgeAssets] = useState<KnowledgeAssetData[]>([])
  const [newAssetName, setNewAssetName] = useState("")
  const [newAssetContent, setNewAssetContent] = useState("")
  const [newAssetType, setNewAssetType] = useState<"text" | "url" | "file">("text")
  const [newAssetFile, setNewAssetFile] = useState<File | null>(null)
  const [addAssetOpen, setAddAssetOpen] = useState(false)

  // Company/Outreach context state
  const [companyContext, setCompanyContext] = useState({
    companyName: "",
    targetResult: "",
  })

  // Calendar links state
  const [calendarLinks, setCalendarLinks] = useState<CalendarLinkData[]>([])
  const [newCalendarName, setNewCalendarName] = useState("")
  const [newCalendarUrl, setNewCalendarUrl] = useState("")
  const [newCalendarPublicUrl, setNewCalendarPublicUrl] = useState("")
  const [isAddingCalendar, setIsAddingCalendar] = useState(false)
  const [calendarLinkEditOpen, setCalendarLinkEditOpen] = useState(false)
  const [calendarLinkEditDraft, setCalendarLinkEditDraft] = useState<{
    id: string
    name: string
    url: string
    publicUrl: string
  } | null>(null)
  const [isUpdatingCalendarLink, setIsUpdatingCalendarLink] = useState(false)

  // Meeting Booking state (GHL or Calendly)
  const [meetingBooking, setMeetingBooking] = useState({
    meetingBookingProvider: "ghl" as "ghl" | "calendly",
    ghlDefaultCalendarId: "",
    ghlDirectBookCalendarId: "",
    ghlAssignedUserId: "",
    autoBookMeetings: false,
    meetingDurationMinutes: 30,
    meetingTitle: "Intro to {companyName}",
    calendlyEventTypeLink: "",
    calendlyEventTypeUri: "",
    calendlyDirectBookEventTypeLink: "",
    calendlyDirectBookEventTypeUri: "",
  })
  const [ghlCalendars, setGhlCalendars] = useState<GHLCalendar[]>([])
  const [ghlUsers, setGhlUsers] = useState<GHLUser[]>([])
  const [isLoadingGhlData, setIsLoadingGhlData] = useState(false)
  const [ghlConnectionStatus, setGhlConnectionStatus] = useState<"unknown" | "connected" | "error">("unknown")
  const [calendlyIntegration, setCalendlyIntegration] = useState<{
    hasAccessToken: boolean
    hasWebhookSubscription: boolean
    organizationUri: string | null
    userUri: string | null
  } | null>(null)
  const [isLoadingCalendlyData, setIsLoadingCalendlyData] = useState(false)
  const [calendlyConnectionStatus, setCalendlyConnectionStatus] = useState<"unknown" | "connected" | "error">("unknown")
  const [calendarMismatchInfo, setCalendarMismatchInfo] = useState<{
    mismatch: boolean
    ghlDefaultCalendarId: string | null
    calendarLinkGhlCalendarId: string | null
    lastError: string | null
  } | null>(null)
  const [calendlyCalendarMismatchInfo, setCalendlyCalendarMismatchInfo] = useState<{
    mismatch: boolean
    calendlyEventTypeUuid: string | null
    calendarLinkCalendlyEventTypeUuid: string | null
    lastError: string | null
  } | null>(null)

  const [availability, setAvailability] = useState({
    timezone: "America/New_York",
    startTime: "09:00",
    endTime: "17:00",
  })

  const [calendarHealth, setCalendarHealth] = useState({
    enabled: true,
    minSlots: 10,
  })

  const [autoSendSchedule, setAutoSendSchedule] = useState({
    mode: "ALWAYS" as "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM",
    customDays: [1, 2, 3, 4, 5],
    customStartTime: "09:00",
    customEndTime: "17:00",
    holidays: { ...DEFAULT_AUTO_SEND_HOLIDAYS },
  })
  const [holidayExcludedPresetDate, setHolidayExcludedPresetDate] = useState("")
  const [holidayBlackoutDate, setHolidayBlackoutDate] = useState("")
  const [holidayBlackoutRangeStart, setHolidayBlackoutRangeStart] = useState("")
  const [holidayBlackoutRangeEnd, setHolidayBlackoutRangeEnd] = useState("")

  const [notifications, setNotifications] = useState({
    emailDigest: true,
    slackAlerts: true,
  })

  type NotificationMode = "off" | "realtime" | "daily"
  type NotificationDestination = "slack" | "email" | "sms"
  type SentimentNotificationRule = {
    mode: NotificationMode
    destinations: Record<NotificationDestination, boolean>
  }
  type SentimentNotificationRules = Record<SentimentTag, SentimentNotificationRule>

  const buildDefaultNotificationRules = (): SentimentNotificationRules => {
    return SENTIMENT_TAGS.reduce((acc, tag) => {
      acc[tag] = {
        mode: "off",
        destinations: { slack: false, email: false, sms: false },
      }
      return acc
    }, {} as SentimentNotificationRules)
  }

  const coerceNotificationRules = (raw: unknown): SentimentNotificationRules => {
    const defaults = buildDefaultNotificationRules()
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults

    const out: SentimentNotificationRules = { ...defaults }
    for (const [key, value] of Object.entries(raw)) {
      if (!SENTIMENT_TAGS.includes(key as SentimentTag)) continue
      if (!value || typeof value !== "object" || Array.isArray(value)) continue

      const modeRaw = (value as any).mode
      const mode: NotificationMode = modeRaw === "realtime" || modeRaw === "daily" || modeRaw === "off" ? modeRaw : "off"

      const destinationsRaw = (value as any).destinations
      const destinations: Record<NotificationDestination, boolean> = {
        slack: Boolean(destinationsRaw?.slack),
        email: Boolean(destinationsRaw?.email),
        sms: Boolean(destinationsRaw?.sms),
      }

      out[key as SentimentTag] = { mode, destinations }
    }

    return out
  }

  const [notificationCenter, setNotificationCenter] = useState<{
    emails: string[]
    phones: string[]
    slackChannelIds: string[]
    dailyDigestTime: string
    sentimentRules: SentimentNotificationRules
  }>({
    emails: [],
    phones: [],
    slackChannelIds: [],
    dailyDigestTime: "09:00",
    sentimentRules: buildDefaultNotificationRules(),
  })

  const [newNotificationEmail, setNewNotificationEmail] = useState("")
  const [newNotificationPhone, setNewNotificationPhone] = useState("")

  // Slack integration (bot token + channel selector)
  const [slackTokenStatus, setSlackTokenStatus] = useState<{
    configured: boolean
    masked: string | null
  } | null>(null)
  const [slackTokenDraft, setSlackTokenDraft] = useState("")
  const [slackIntegrationError, setSlackIntegrationError] = useState<string | null>(null)
  const [isSavingSlackToken, setIsSavingSlackToken] = useState(false)
  const [slackChannels, setSlackChannels] = useState<
    Array<{ id: string; name: string; is_private?: boolean; is_member?: boolean }>
  >([])
  const [isLoadingSlackChannels, setIsLoadingSlackChannels] = useState(false)
  const [slackChannelToAdd, setSlackChannelToAdd] = useState("")
  const [slackMembers, setSlackMembers] = useState<SlackApprovalRecipient[]>([])
  const [selectedApprovalRecipients, setSelectedApprovalRecipients] = useState<SlackApprovalRecipient[]>([])
  const [isLoadingSlackMembers, setIsLoadingSlackMembers] = useState(false)

  // Resend integration (per-workspace)
  const [resendStatus, setResendStatus] = useState<{
    configured: boolean
    maskedApiKey: string | null
    fromEmail: string | null
  } | null>(null)
  const [resendApiKeyDraft, setResendApiKeyDraft] = useState("")
  const [resendFromEmailDraft, setResendFromEmailDraft] = useState("")
  const [isSavingResend, setIsSavingResend] = useState(false)
  const [resendIntegrationError, setResendIntegrationError] = useState<string | null>(null)

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
  const [isWorkspaceAdmin, setIsWorkspaceAdmin] = useState(false)
  const [workspaceCapabilities, setWorkspaceCapabilities] = useState<WorkspaceCapabilities | null>(null)
  const [aiObsWindow, setAiObsWindow] = useState<AiObservabilityWindow>("24h")
  const [aiObs, setAiObs] = useState<ObservabilitySummary | null>(null)
  const [aiObsLoading, setAiObsLoading] = useState(false)
  const [canViewAiObs, setCanViewAiObs] = useState(false)
  const [aiObsError, setAiObsError] = useState<string | null>(null)

  // EmailBison base host (per active workspace)
  const [emailBisonBaseHosts, setEmailBisonBaseHosts] = useState<EmailBisonBaseHostRow[]>([])
  const [emailBisonBaseHostId, setEmailBisonBaseHostId] = useState<string>("")
  const [emailBisonBaseHostLoading, setEmailBisonBaseHostLoading] = useState(false)
  const [emailBisonBaseHostSaving, setEmailBisonBaseHostSaving] = useState(false)
  const [emailBisonBaseHostError, setEmailBisonBaseHostError] = useState<string | null>(null)
  const [emailBisonBaseHostOpen, setEmailBisonBaseHostOpen] = useState(false)

  // EmailBison first-touch availability_slot (per workspace)
  const [emailBisonAvailabilitySlot, setEmailBisonAvailabilitySlot] = useState({
    enabled: true,
    includeWeekends: false,
    count: 2,
    preferWithinDays: 5,
    template: "",
  })
  const [emailBisonAvailabilitySlotPreview, setEmailBisonAvailabilitySlotPreview] = useState<{
    variableName: string
    sentence: string | null
    slotUtcIso: string[]
    slotLabels: string[]
    timeZone: string
  } | null>(null)
  const [emailBisonAvailabilitySlotPreviewLoading, setEmailBisonAvailabilitySlotPreviewLoading] = useState(false)
  const [emailBisonAvailabilitySlotPreviewError, setEmailBisonAvailabilitySlotPreviewError] = useState<string | null>(null)

  const [aiPromptsOpen, setAiPromptsOpen] = useState(false)
  const [aiPromptTemplates, setAiPromptTemplates] = useState<AiPromptTemplatePublic[] | null>(null)
  const [aiPromptsLoading, setAiPromptsLoading] = useState(false)
  // Prompt override editing state (Phase 47)
  const [promptOverrides, setPromptOverrides] = useState<Map<string, string>>(new Map())
  const [editingPrompt, setEditingPrompt] = useState<{
    promptKey: string
    role: string
    index: number
  } | null>(null)
  const [editContent, setEditContent] = useState("")
  const [savingOverride, setSavingOverride] = useState(false)
  // Snippet override state (Phase 47f)
  const [snippetOverrides, setSnippetOverrides] = useState<Map<string, string>>(new Map())
  const [expandedSnippets, setExpandedSnippets] = useState<Set<string>>(new Set())
  const [editingSnippet, setEditingSnippet] = useState<string | null>(null)
  const [snippetEditContent, setSnippetEditContent] = useState("")
  const [savingSnippet, setSavingSnippet] = useState(false)
  // Variables tab state (Phase 47h)
  const [promptModalTab, setPromptModalTab] = useState<"prompts" | "variables">("prompts")
  const [snippetRegistry, setSnippetRegistry] = useState<SnippetRegistryEntry[] | null>(null)
  // Persona context state (Phase 47j)
  const [personaList, setPersonaList] = useState<AiPersonaSummary[] | null>(null)
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null)
  const [selectedPersonaDetails, setSelectedPersonaDetails] = useState<AiPersonaData | null>(null)
  const [personaLoading, setPersonaLoading] = useState(false)

  const isClientPortalUser = Boolean(workspaceCapabilities?.isClientPortalUser)
  const canViewAiObservability = Boolean(workspaceCapabilities?.canViewAiObservability)

  const resetAiPromptModalState = useCallback(() => {
    setAiPromptTemplates(null)
    setPromptOverrides(new Map())
    setEditingPrompt(null)
    setEditContent("")
    setSnippetOverrides(new Map())
    setExpandedSnippets(new Set())
    setEditingSnippet(null)
    setSnippetEditContent("")
    setPromptModalTab("prompts")
    setSnippetRegistry(null)
    setPersonaList(null)
    setSelectedPersonaId(null)
    setSelectedPersonaDetails(null)
    setAiPromptsLoading(false)
  }, [])

  // Prevent prompt editor state from leaking across workspaces (Phase 47 follow-up)
  useLayoutEffect(() => {
    resetAiPromptModalState()
  }, [activeWorkspace, resetAiPromptModalState])

  // Load settings when workspace changes
  useEffect(() => {
    async function loadSettings() {
      setIsLoading(true)
      const [result, adminStatus, capabilitiesResult] = await Promise.all([
        getUserSettings(activeWorkspace),
        activeWorkspace ? getWorkspaceAdminStatus(activeWorkspace) : Promise.resolve({ success: true, isAdmin: false }),
        activeWorkspace ? getWorkspaceCapabilities(activeWorkspace) : Promise.resolve({ success: true, capabilities: null }),
      ])

      const capabilities = capabilitiesResult.success ? capabilitiesResult.capabilities ?? null : null
      setWorkspaceCapabilities(capabilities)
      setIsWorkspaceAdmin(Boolean(adminStatus.success && adminStatus.isAdmin) && !capabilities?.isClientPortalUser)
      setSlackIntegrationError(null)
      setSlackChannels([])
      setSlackChannelToAdd("")
      setSlackMembers([])
      setSelectedApprovalRecipients([])
      setResendIntegrationError(null)
      setResendApiKeyDraft("")
      setResendFromEmailDraft("")
      setEmailBisonAvailabilitySlotPreview(null)
      setEmailBisonAvailabilitySlotPreviewError(null)
      
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
          idealCustomerProfile: result.data.idealCustomerProfile || "",
        })
        setInsightsChatSettings({
          model: result.data.insightsChatModel || "gpt-5-mini",
          reasoningEffort: result.data.insightsChatReasoningEffort || "medium",
          enableCampaignChanges: result.data.insightsChatEnableCampaignChanges ?? false,
          enableExperimentWrites: result.data.insightsChatEnableExperimentWrites ?? false,
          enableFollowupPauses: result.data.insightsChatEnableFollowupPauses ?? false,
        })
        setDraftGenerationSettings({
          model: result.data.draftGenerationModel || "gpt-5.1",
          reasoningEffort: result.data.draftGenerationReasoningEffort || "medium",
        })
        setCompanyContext({
          companyName: result.data.companyName || "",
          targetResult: result.data.targetResult || "",
        })
        setAvailability({
          timezone: result.data.timezone || "America/New_York",
          startTime: result.data.workStartTime || "09:00",
          endTime: result.data.workEndTime || "17:00",
        })
        setCalendarHealth({
          enabled: result.data.calendarHealthEnabled ?? true,
          minSlots:
            typeof result.data.calendarHealthMinSlots === "number" && Number.isFinite(result.data.calendarHealthMinSlots)
              ? result.data.calendarHealthMinSlots
              : 10,
        })
        const customSchedule = coerceAutoSendCustomSchedule(result.data.autoSendCustomSchedule)
        const holidays = customSchedule?.holidays ?? DEFAULT_AUTO_SEND_HOLIDAYS
        setAutoSendSchedule({
          mode: (result.data.autoSendScheduleMode as "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM") || "ALWAYS",
          customDays: customSchedule?.days ?? [1, 2, 3, 4, 5],
          customStartTime: customSchedule?.startTime || result.data.workStartTime || "09:00",
          customEndTime: customSchedule?.endTime || result.data.workEndTime || "17:00",
          holidays: {
            presetEnabled: holidays.presetEnabled,
            excludedPresetDates: [...holidays.excludedPresetDates],
            additionalBlackoutDates: [...holidays.additionalBlackoutDates],
            additionalBlackoutDateRanges: [...holidays.additionalBlackoutDateRanges],
          },
        })
        setNotifications({
          emailDigest: result.data.emailDigest,
          slackAlerts: result.data.slackAlerts,
        })
        setNotificationCenter({
          emails: result.data.notificationEmails ?? [],
          phones: result.data.notificationPhones ?? [],
          slackChannelIds: result.data.notificationSlackChannelIds ?? [],
          dailyDigestTime: result.data.notificationDailyDigestTime || "09:00",
          sentimentRules: coerceNotificationRules(result.data.notificationSentimentRules),
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
          meetingBookingProvider: result.data.meetingBookingProvider || "ghl",
          ghlDefaultCalendarId: result.data.ghlDefaultCalendarId || "",
          ghlDirectBookCalendarId: result.data.ghlDirectBookCalendarId || "",
          ghlAssignedUserId: result.data.ghlAssignedUserId || "",
          autoBookMeetings: result.data.autoBookMeetings,
          meetingDurationMinutes: result.data.meetingDurationMinutes,
          meetingTitle: result.data.meetingTitle || "Intro to {companyName}",
          calendlyEventTypeLink: result.data.calendlyEventTypeLink || "",
          calendlyEventTypeUri: result.data.calendlyEventTypeUri || "",
          calendlyDirectBookEventTypeLink: result.data.calendlyDirectBookEventTypeLink || "",
          calendlyDirectBookEventTypeUri: result.data.calendlyDirectBookEventTypeUri || "",
        })

        setEmailBisonAvailabilitySlot({
          enabled: result.data.emailBisonFirstTouchAvailabilitySlotEnabled ?? true,
          includeWeekends: result.data.emailBisonAvailabilitySlotIncludeWeekends ?? false,
          count: result.data.emailBisonAvailabilitySlotCount ?? 2,
          preferWithinDays: result.data.emailBisonAvailabilitySlotPreferWithinDays ?? 5,
          template: result.data.emailBisonAvailabilitySlotTemplate || "",
        })
      }

      if (activeWorkspace && adminStatus.success && adminStatus.isAdmin) {
        const slack = await getSlackBotTokenStatus(activeWorkspace)
        if (slack.success) {
          setSlackTokenStatus({
            configured: Boolean(slack.configured),
            masked: slack.masked ?? null,
          })
        } else {
          setSlackTokenStatus(null)
        }
      } else {
        setSlackTokenStatus(null)
      }

      if (activeWorkspace && adminStatus.success && adminStatus.isAdmin) {
        const [recipientsResult, membersResult] = await Promise.all([
          getSlackApprovalRecipients(activeWorkspace),
          getSlackMembers(activeWorkspace),
        ])

        if (recipientsResult.success) {
          setSelectedApprovalRecipients(recipientsResult.recipients || [])
        }

        if (membersResult.success) {
          setSlackMembers(membersResult.members || [])
        }
      }

      if (activeWorkspace && adminStatus.success && adminStatus.isAdmin) {
        const resend = await getResendConfigStatus(activeWorkspace)
        if (resend.success) {
          setResendStatus({
            configured: Boolean(resend.configured),
            maskedApiKey: resend.maskedApiKey ?? null,
            fromEmail: resend.fromEmail ?? null,
          })
          setResendFromEmailDraft(resend.fromEmail ?? "")
        } else {
          setResendStatus(null)
        }
      } else {
        setResendStatus(null)
      }

      // Load calendar links
      if (activeWorkspace) {
        const calendarResult = await getCalendarLinks(activeWorkspace)
        if (calendarResult.success && calendarResult.data) {
          setCalendarLinks(calendarResult.data)
        }

        const provider = result?.success && result.data?.meetingBookingProvider ? result.data.meetingBookingProvider : "ghl"
        if (provider === "ghl") {
          try {
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
          } catch (e) {
            console.warn("Failed to load GHL mismatch info:", e)
            setCalendarMismatchInfo(null)
          }
          setCalendlyCalendarMismatchInfo(null)

          // Load GHL calendars and users for meeting booking config
          loadGHLData(activeWorkspace)
        } else {
          setCalendarMismatchInfo(null)
          try {
            const mismatch = await getCalendlyCalendarMismatchInfo(activeWorkspace)
            if (mismatch.success) {
              setCalendlyCalendarMismatchInfo({
                mismatch: mismatch.mismatch ?? false,
                calendlyEventTypeUuid: mismatch.calendlyEventTypeUuid ?? null,
                calendarLinkCalendlyEventTypeUuid: mismatch.calendarLinkCalendlyEventTypeUuid ?? null,
                lastError: mismatch.lastError ?? null,
              })
            } else {
              setCalendlyCalendarMismatchInfo(null)
            }
          } catch (e) {
            console.warn("Failed to load Calendly mismatch info:", e)
            setCalendlyCalendarMismatchInfo(null)
          }
          setGhlCalendars([])
          setGhlUsers([])
          setGhlConnectionStatus("unknown")
          loadCalendlyStatus(activeWorkspace)
        }
      } else {
        setCalendarLinks([])
        setCalendarMismatchInfo(null)
        setCalendlyCalendarMismatchInfo(null)
        setCalendlyIntegration(null)
        setCalendlyConnectionStatus("unknown")
      }
      
      setIsLoading(false)
    }

    loadSettings()
  }, [activeWorkspace])

  // Load EmailBison base host state for the active workspace
  useEffect(() => {
    let cancelled = false

    async function loadEmailBisonBaseHost() {
      if (!activeWorkspace) {
        setEmailBisonBaseHostId("")
        setEmailBisonBaseHostError(null)
        return
      }

      setEmailBisonBaseHostLoading(true)
      setEmailBisonBaseHostError(null)

      const [hostsRes, currentRes] = await Promise.all([
        getEmailBisonBaseHosts(),
        getClientEmailBisonBaseHost(activeWorkspace),
      ])

      if (cancelled) return

      if (hostsRes.success && hostsRes.data) {
        setEmailBisonBaseHosts(hostsRes.data)
      }

      if (currentRes.success && currentRes.data) {
        setEmailBisonBaseHostId(currentRes.data.baseHostId || "")
      } else {
        setEmailBisonBaseHostId("")
        if (currentRes.error) setEmailBisonBaseHostError(currentRes.error)
      }

      setEmailBisonBaseHostLoading(false)
    }

    loadEmailBisonBaseHost()
    return () => {
      cancelled = true
    }
  }, [activeWorkspace])

  async function handleSaveEmailBisonBaseHost() {
    if (!activeWorkspace) return
    if (!isWorkspaceAdmin) {
      toast.error("Only workspace admins can change the EmailBison base host")
      return
    }

    setEmailBisonBaseHostSaving(true)
    try {
      const res = await setClientEmailBisonBaseHost(activeWorkspace, emailBisonBaseHostId || null)
      if (res.success) {
        toast.success("EmailBison base host updated")
        const refreshed = await getClientEmailBisonBaseHost(activeWorkspace)
        if (refreshed.success && refreshed.data) {
          setEmailBisonBaseHostId(refreshed.data.baseHostId || "")
        }
      } else {
        toast.error(res.error || "Failed to update EmailBison base host")
      }
    } finally {
      setEmailBisonBaseHostSaving(false)
    }
  }

  async function handlePreviewEmailBisonAvailabilitySlot() {
    if (!activeWorkspace) {
      toast.error("Select a workspace first")
      return
    }

    setEmailBisonAvailabilitySlotPreview(null)
    setEmailBisonAvailabilitySlotPreviewError(null)
    setEmailBisonAvailabilitySlotPreviewLoading(true)
    try {
      const res = await previewEmailBisonAvailabilitySlotSentenceForWorkspace(activeWorkspace)
      if (!res.success || !res.data) {
        setEmailBisonAvailabilitySlotPreviewError(res.error || "Failed to preview availability_slot")
        return
      }
      setEmailBisonAvailabilitySlotPreview(res.data)
    } catch (e) {
      setEmailBisonAvailabilitySlotPreviewError(e instanceof Error ? e.message : "Failed to preview availability_slot")
    } finally {
      setEmailBisonAvailabilitySlotPreviewLoading(false)
    }
  }

  const refreshAiObservability = useCallback(async () => {
    if (!activeWorkspace) {
      setAiObs(null)
      setCanViewAiObs(false)
      setAiObsError(null)
      return
    }

    if (isClientPortalUser || !canViewAiObservability) {
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
  }, [activeWorkspace, aiObsWindow, canViewAiObservability, isClientPortalUser])

  useEffect(() => {
    refreshAiObservability()
  }, [refreshAiObservability])

  useEffect(() => {
    if (!aiPromptsOpen) return
    if (isClientPortalUser || !canViewAiObservability) return
    if (!activeWorkspace) return
    if (aiPromptTemplates) return

    let cancelled = false
    setAiPromptsLoading(true)

    // Load templates, overrides, snippet overrides, registry, and personas in parallel
    Promise.all([
      getAiPromptTemplates(activeWorkspace),
      getPromptOverrides(activeWorkspace),
      getPromptSnippetOverrides(activeWorkspace),
      getSnippetRegistry(activeWorkspace),
      listAiPersonas(activeWorkspace),
    ])
      .then(([templatesRes, overridesRes, snippetsRes, registryRes, personasRes]) => {
        if (cancelled) return
        if (templatesRes.success && templatesRes.templates) {
          setAiPromptTemplates(templatesRes.templates)
        } else {
          toast.error("Failed to load prompts", { description: templatesRes.error || "Unknown error" })
        }
        // Build override map: "promptKey:role:index" -> content
        if (overridesRes.success && overridesRes.overrides) {
          const map = new Map<string, string>()
          for (const o of overridesRes.overrides) {
            map.set(`${o.promptKey}:${o.role}:${o.index}`, o.content)
          }
          setPromptOverrides(map)
        }
        // Build snippet override map: "snippetKey" -> content
        if (snippetsRes.success && snippetsRes.overrides) {
          const map = new Map<string, string>()
          for (const s of snippetsRes.overrides) {
            map.set(s.snippetKey, s.content)
          }
          setSnippetOverrides(map)
        }
        // Load snippet registry for Variables tab
        if (registryRes.success && registryRes.entries) {
          setSnippetRegistry(registryRes.entries)
        }
        // Load persona list (Phase 47j)
        if (personasRes.success && personasRes.data) {
          setPersonaList(personasRes.data)
          // Auto-select default persona
          const defaultPersona = personasRes.data.find(p => p.isDefault)
          if (defaultPersona) {
            setSelectedPersonaId(defaultPersona.id)
          }
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
  }, [aiPromptsOpen, activeWorkspace, aiPromptTemplates, canViewAiObservability, isClientPortalUser])

  useEffect(() => {
    if (!isClientPortalUser) return
    if (aiPromptsOpen) {
      setAiPromptsOpen(false)
    }
    resetAiPromptModalState()
  }, [aiPromptsOpen, isClientPortalUser, resetAiPromptModalState])

  // Load persona details when selected persona changes (Phase 47j)
  useEffect(() => {
    if (!selectedPersonaId) {
      setSelectedPersonaDetails(null)
      return
    }

    let cancelled = false
    setPersonaLoading(true)

    getAiPersona(selectedPersonaId)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) {
          setSelectedPersonaDetails(res.data)
        }
      })
      .catch(() => {
        if (cancelled) return
        setSelectedPersonaDetails(null)
      })
      .finally(() => {
        if (cancelled) return
        setPersonaLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedPersonaId])

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

  const loadCalendlyStatus = async (clientId: string) => {
    setIsLoadingCalendlyData(true)
    try {
      const result = await getCalendlyIntegrationStatusForWorkspace(clientId)
      if (result.success && result.data) {
        setCalendlyIntegration(result.data)
        setCalendlyConnectionStatus(result.data.hasAccessToken ? "connected" : "unknown")
      } else {
        setCalendlyIntegration(null)
        setCalendlyConnectionStatus("error")
      }
    } catch (error) {
      console.error("Failed to load Calendly status:", error)
      setCalendlyIntegration(null)
      setCalendlyConnectionStatus("error")
    } finally {
      setIsLoadingCalendlyData(false)
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

  const addNotificationEmail = () => {
    const normalized = newNotificationEmail.trim().toLowerCase()
    if (!normalized) return
    setNotificationCenter((prev) => {
      const next = Array.from(new Set([...(prev.emails || []), normalized]))
      return { ...prev, emails: next }
    })
    setNewNotificationEmail("")
    handleChange()
  }

  const removeNotificationEmail = (email: string) => {
    setNotificationCenter((prev) => ({ ...prev, emails: (prev.emails || []).filter((e) => e !== email) }))
    handleChange()
  }

  const addNotificationPhone = () => {
    const normalized = newNotificationPhone.trim()
    if (!normalized) return
    setNotificationCenter((prev) => {
      const next = Array.from(new Set([...(prev.phones || []), normalized]))
      return { ...prev, phones: next }
    })
    setNewNotificationPhone("")
    handleChange()
  }

  const removeNotificationPhone = (phone: string) => {
    setNotificationCenter((prev) => ({ ...prev, phones: (prev.phones || []).filter((p) => p !== phone) }))
    handleChange()
  }

  const handleSaveSlackToken = async () => {
    if (!activeWorkspace) return
    setSlackIntegrationError(null)
    setIsSavingSlackToken(true)
    try {
      const res = await updateSlackBotToken(activeWorkspace, slackTokenDraft || null)
      if (!res.success) {
        setSlackIntegrationError(res.error || "Failed to save Slack token")
        return
      }

      setSlackTokenDraft("")
      const status = await getSlackBotTokenStatus(activeWorkspace)
      if (status.success) {
        setSlackTokenStatus({ configured: Boolean(status.configured), masked: status.masked ?? null })
      }
      toast.success("Slack token saved")
    } catch (e) {
      setSlackIntegrationError(e instanceof Error ? e.message : "Failed to save Slack token")
    } finally {
      setIsSavingSlackToken(false)
    }
  }

  const handleClearSlackToken = async () => {
    if (!activeWorkspace) return
    setSlackIntegrationError(null)
    setIsSavingSlackToken(true)
    try {
      const res = await updateSlackBotToken(activeWorkspace, null)
      if (!res.success) {
        setSlackIntegrationError(res.error || "Failed to clear Slack token")
        return
      }
      setSlackTokenDraft("")
      setSlackTokenStatus({ configured: false, masked: null })
      setSlackChannels([])
      toast.success("Slack token cleared")
    } catch (e) {
      setSlackIntegrationError(e instanceof Error ? e.message : "Failed to clear Slack token")
    } finally {
      setIsSavingSlackToken(false)
    }
  }

  const handleSaveResendConfig = async () => {
    if (!activeWorkspace) return
    setResendIntegrationError(null)
    setIsSavingResend(true)
    try {
      const apiKey = resendApiKeyDraft.trim()
      const fromEmail = resendFromEmailDraft.trim()

      const res = await updateResendConfig(activeWorkspace, {
        ...(apiKey ? { apiKey } : {}),
        fromEmail: fromEmail || null,
      })

      if (!res.success) {
        setResendIntegrationError(res.error || "Failed to save Resend config")
        return
      }

      setResendApiKeyDraft("")
      const status = await getResendConfigStatus(activeWorkspace)
      if (status.success) {
        setResendStatus({
          configured: Boolean(status.configured),
          maskedApiKey: status.maskedApiKey ?? null,
          fromEmail: status.fromEmail ?? null,
        })
        setResendFromEmailDraft(status.fromEmail ?? "")
      }

      toast.success("Resend config saved")
    } catch (e) {
      setResendIntegrationError(e instanceof Error ? e.message : "Failed to save Resend config")
    } finally {
      setIsSavingResend(false)
    }
  }

  const handleClearResendConfig = async () => {
    if (!activeWorkspace) return
    setResendIntegrationError(null)
    setIsSavingResend(true)
    try {
      const res = await updateResendConfig(activeWorkspace, { apiKey: null, fromEmail: null })
      if (!res.success) {
        setResendIntegrationError(res.error || "Failed to clear Resend config")
        return
      }

      setResendStatus({ configured: false, maskedApiKey: null, fromEmail: null })
      setResendApiKeyDraft("")
      setResendFromEmailDraft("")
      toast.success("Resend config cleared")
    } catch (e) {
      setResendIntegrationError(e instanceof Error ? e.message : "Failed to clear Resend config")
    } finally {
      setIsSavingResend(false)
    }
  }

  const handleLoadSlackChannels = async () => {
    if (!activeWorkspace) return
    setSlackIntegrationError(null)
    setIsLoadingSlackChannels(true)
    try {
      const res = await listSlackChannelsForWorkspace(activeWorkspace)
      if (!res.success) {
        setSlackIntegrationError(res.error || "Failed to load Slack channels")
        return
      }
      setSlackChannels(res.channels || [])
    } catch (e) {
      setSlackIntegrationError(e instanceof Error ? e.message : "Failed to load Slack channels")
    } finally {
      setIsLoadingSlackChannels(false)
    }
  }

  const handleRefreshSlackMembers = async () => {
    if (!activeWorkspace) return
    setIsLoadingSlackMembers(true)
    try {
      const res = await refreshSlackMembersCache(activeWorkspace)
      if (!res.success) {
        toast.error(res.error || "Failed to refresh Slack members")
        return
      }
      setSlackMembers(res.members || [])
      toast.success("Slack members refreshed")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh Slack members")
    } finally {
      setIsLoadingSlackMembers(false)
    }
  }

  const toggleApprovalRecipient = (member: SlackApprovalRecipient) => {
    setSelectedApprovalRecipients((prev) => {
      const exists = prev.some((r) => r.id === member.id)
      if (exists) {
        return prev.filter((r) => r.id !== member.id)
      }
      return [...prev, member]
    })
    handleChange()
  }

  const handleAddSlackChannel = () => {
    const channelId = slackChannelToAdd.trim()
    if (!channelId) return
    setNotificationCenter((prev) => {
      const next = Array.from(new Set([...(prev.slackChannelIds || []), channelId]))
      return { ...prev, slackChannelIds: next }
    })
    setSlackChannelToAdd("")
    handleChange()
  }

  const handleRemoveSlackChannel = (channelId: string) => {
    setNotificationCenter((prev) => ({
      ...prev,
      slackChannelIds: (prev.slackChannelIds || []).filter((id) => id !== channelId),
    }))
    handleChange()
  }

  // Track changes
  const handleChange = () => {
    if (isClientPortalUser) return
    setHasChanges(true)
  }

  useEffect(() => {
    if (isClientPortalUser) {
      setHasChanges(false)
    }
  }, [isClientPortalUser])

  // Save all settings
  const handleSaveSettings = async () => {
    if (isClientPortalUser) {
      toast.info("Settings are read-only. Request changes from ZRG.")
      return
    }
    setIsSaving(true)

    const toNullableText = (value: string | null | undefined) => {
      const trimmed = value?.trim()
      return trimmed ? value : null
    }
    const normalizedCustomDays = autoSendSchedule.customDays.length > 0
      ? Array.from(new Set(autoSendSchedule.customDays)).sort()
      : [1, 2, 3, 4, 5]

    const normalizedExcludedPresetDates = normalizeDateList(autoSendSchedule.holidays.excludedPresetDates)
    const normalizedAdditionalBlackoutDates = normalizeDateList(autoSendSchedule.holidays.additionalBlackoutDates)
    const normalizedAdditionalBlackoutRanges = normalizeDateRanges(autoSendSchedule.holidays.additionalBlackoutDateRanges)

    const holidayPayload =
      autoSendSchedule.holidays.presetEnabled ||
      normalizedExcludedPresetDates.length > 0 ||
      normalizedAdditionalBlackoutDates.length > 0 ||
      normalizedAdditionalBlackoutRanges.length > 0
        ? {
            ...(autoSendSchedule.holidays.presetEnabled ? { preset: "US_FEDERAL_PLUS_COMMON" } : {}),
            ...(normalizedExcludedPresetDates.length > 0 ? { excludedPresetDates: normalizedExcludedPresetDates } : {}),
            ...(normalizedAdditionalBlackoutDates.length > 0 ? { additionalBlackoutDates: normalizedAdditionalBlackoutDates } : {}),
            ...(normalizedAdditionalBlackoutRanges.length > 0 ? { additionalBlackoutDateRanges: normalizedAdditionalBlackoutRanges } : {}),
          }
        : undefined

    const customSchedulePayload = autoSendSchedule.mode === "CUSTOM"
      ? {
          version: 1,
          days: normalizedCustomDays,
          startTime: autoSendSchedule.customStartTime,
          endTime: autoSendSchedule.customEndTime,
          ...(holidayPayload ? { holidays: holidayPayload } : {}),
        }
      : null
    
    const payload: Partial<UserSettingsData> = {
      aiPersonaName: toNullableText(aiPersona.name),
      aiTone: aiPersona.tone,
      aiGreeting: toNullableText(aiPersona.greeting),
      aiSmsGreeting: toNullableText(aiPersona.smsGreeting),
      aiSignature: toNullableText(aiPersona.signature),
      aiGoals: toNullableText(aiPersona.goals),
      serviceDescription: toNullableText(aiPersona.serviceDescription),
      idealCustomerProfile: toNullableText(aiPersona.idealCustomerProfile),
      companyName: toNullableText(companyContext.companyName),
      targetResult: toNullableText(companyContext.targetResult),
      qualificationQuestions: qualificationQuestions.length > 0 
        ? JSON.stringify(qualificationQuestions) 
        : null,
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
      ghlDirectBookCalendarId: meetingBooking.ghlDirectBookCalendarId || null,
      ghlAssignedUserId: meetingBooking.ghlAssignedUserId || null,
      autoBookMeetings: meetingBooking.autoBookMeetings,
      meetingDurationMinutes: meetingBooking.meetingDurationMinutes,
      meetingTitle: meetingBooking.meetingTitle || null,
      meetingBookingProvider: meetingBooking.meetingBookingProvider,
      calendlyEventTypeLink: toNullableText(meetingBooking.calendlyEventTypeLink),
      calendlyEventTypeUri: toNullableText(meetingBooking.calendlyEventTypeUri),
      calendlyDirectBookEventTypeLink: toNullableText(meetingBooking.calendlyDirectBookEventTypeLink),
      calendlyDirectBookEventTypeUri: toNullableText(meetingBooking.calendlyDirectBookEventTypeUri),
    }

    if (isWorkspaceAdmin) {
      payload.autoSendScheduleMode = autoSendSchedule.mode
      payload.autoSendCustomSchedule = customSchedulePayload
      payload.calendarHealthEnabled = calendarHealth.enabled
      payload.calendarHealthMinSlots = calendarHealth.minSlots
      payload.insightsChatModel = insightsChatSettings.model
      payload.insightsChatReasoningEffort = insightsChatSettings.reasoningEffort
      payload.insightsChatEnableCampaignChanges = insightsChatSettings.enableCampaignChanges
      payload.insightsChatEnableExperimentWrites = insightsChatSettings.enableExperimentWrites
      payload.insightsChatEnableFollowupPauses = insightsChatSettings.enableFollowupPauses
      // Draft generation settings (Phase 30)
      payload.draftGenerationModel = draftGenerationSettings.model
      payload.draftGenerationReasoningEffort = draftGenerationSettings.reasoningEffort
      // Notification Center (Phase 52d)
      payload.notificationEmails = notificationCenter.emails
      payload.notificationPhones = notificationCenter.phones
      payload.notificationSlackChannelIds = notificationCenter.slackChannelIds
      payload.notificationSentimentRules = notificationCenter.sentimentRules as any
      payload.notificationDailyDigestTime = notificationCenter.dailyDigestTime

      // EmailBison first-touch availability_slot (Phase 55/61)
      payload.emailBisonFirstTouchAvailabilitySlotEnabled = emailBisonAvailabilitySlot.enabled
      payload.emailBisonAvailabilitySlotIncludeWeekends = emailBisonAvailabilitySlot.includeWeekends
      payload.emailBisonAvailabilitySlotCount = emailBisonAvailabilitySlot.count
      payload.emailBisonAvailabilitySlotPreferWithinDays = emailBisonAvailabilitySlot.preferWithinDays
      payload.emailBisonAvailabilitySlotTemplate = toNullableText(emailBisonAvailabilitySlot.template)
    }

    const result = await updateUserSettings(activeWorkspace, payload)

    let approvalRecipientsResult: { success: boolean; error?: string } | null = null
    if (result.success && isWorkspaceAdmin && activeWorkspace) {
      approvalRecipientsResult = await updateSlackApprovalRecipients(activeWorkspace, selectedApprovalRecipients)
    }

    if (result.success && (approvalRecipientsResult?.success ?? true)) {
      toast.success("Settings saved", {
        description: "Your settings have been saved successfully.",
      })
      setHasChanges(false)
    } else {
      toast.error("Error", {
        description: approvalRecipientsResult?.error || result.error || "Failed to save settings.",
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

  const getWorkspaceTimeZone = () => settings?.timezone || "America/New_York"

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
    if (!newAssetName.trim()) {
      toast.error("Please provide a name for the asset")
      return
    }

    if (newAssetType === "file") {
      if (!activeWorkspace) {
        toast.error("No workspace selected")
        return
      }
      if (!newAssetFile) {
        toast.error("Please select a file to upload")
        return
      }

      const formData = new FormData()
      formData.append("clientId", activeWorkspace)
      formData.append("name", newAssetName.trim())
      formData.append("file", newAssetFile)

      const result = await uploadKnowledgeAssetFile(formData)
      if (result.success && result.asset) {
        setKnowledgeAssets(prev => [result.asset!, ...prev])
        setNewAssetName("")
        setNewAssetContent("")
        setNewAssetFile(null)
        toast.success("File uploaded and processed")
      } else {
        toast.error(result.error || "Failed to upload file")
      }
      return
    }

    if (!newAssetContent.trim()) {
      toast.error("Please provide content for the asset")
      return
    }

    if (newAssetType === "url") {
      if (!activeWorkspace) {
        toast.error("No workspace selected")
        return
      }

      const formData = new FormData()
      formData.append("clientId", activeWorkspace)
      formData.append("name", newAssetName.trim())
      formData.append("url", newAssetContent.trim())

      toast.message("Scraping website…", { description: "This can take up to a couple minutes." })

      const result = await addWebsiteKnowledgeAsset(formData)
      if (result.success && result.asset) {
        setKnowledgeAssets(prev => [result.asset!, ...prev])
        setNewAssetName("")
        setNewAssetContent("")
        if (result.warning) {
          toast.message("Website saved", { description: result.warning })
        } else {
          toast.success("Website ingested")
        }
      } else {
        toast.error(result.error || "Failed to ingest website")
      }
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
  }, [activeWorkspace, newAssetName, newAssetContent, newAssetFile, newAssetType])

  const handleDeleteAsset = useCallback(async (assetId: string) => {
    const result = await deleteKnowledgeAsset(assetId)
    if (result.success) {
      setKnowledgeAssets(prev => prev.filter(a => a.id !== assetId))
      toast.success("Asset deleted")
    } else {
      toast.error(result.error || "Failed to delete asset")
    }
  }, [])

  const handleRetryWebsiteAsset = useCallback(async (assetId: string) => {
    toast.message("Retrying website scrape…", { description: "This can take up to a couple minutes." })
    const result = await retryWebsiteKnowledgeAssetIngestion(assetId)
    if (result.success && result.asset) {
      setKnowledgeAssets(prev => prev.map(a => a.id === assetId ? result.asset! : a))
      toast.success("Website refreshed")
    } else {
      toast.error(result.error || "Failed to refresh website")
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
      publicUrl: newCalendarPublicUrl.trim() || null,
      setAsDefault: calendarLinks.length === 0,
    })

    if (result.success) {
      // Reload calendar links
      const calendarResult = await getCalendarLinks(activeWorkspace)
      if (calendarResult.success && calendarResult.data) {
        setCalendarLinks(calendarResult.data)
      }
      if (meetingBooking.meetingBookingProvider === "ghl") {
        try {
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
        } catch (e) {
          console.warn("Failed to refresh GHL mismatch info:", e)
          setCalendarMismatchInfo(null)
        }
        setCalendlyCalendarMismatchInfo(null)
      } else {
        try {
          const mismatch = await getCalendlyCalendarMismatchInfo(activeWorkspace)
          if (mismatch.success) {
            setCalendlyCalendarMismatchInfo({
              mismatch: mismatch.mismatch ?? false,
              calendlyEventTypeUuid: mismatch.calendlyEventTypeUuid ?? null,
              calendarLinkCalendlyEventTypeUuid: mismatch.calendarLinkCalendlyEventTypeUuid ?? null,
              lastError: mismatch.lastError ?? null,
            })
          } else {
            setCalendlyCalendarMismatchInfo(null)
          }
        } catch (e) {
          console.warn("Failed to refresh Calendly mismatch info:", e)
          setCalendlyCalendarMismatchInfo(null)
        }
        setCalendarMismatchInfo(null)
      }
      setNewCalendarName("")
      setNewCalendarUrl("")
      setNewCalendarPublicUrl("")
      toast.success("Calendar link added")
    } else {
      toast.error(result.error || "Failed to add calendar link")
    }
    setIsAddingCalendar(false)
  }, [activeWorkspace, newCalendarName, newCalendarPublicUrl, newCalendarUrl, calendarLinks.length, meetingBooking.meetingBookingProvider])

  const handleOpenCalendarLinkEditor = useCallback((link: CalendarLinkData) => {
    setCalendarLinkEditDraft({
      id: link.id,
      name: link.name,
      url: link.url,
      publicUrl: link.publicUrl || "",
    })
    setCalendarLinkEditOpen(true)
  }, [])

  const handleCloseCalendarLinkEditor = useCallback(() => {
    setCalendarLinkEditOpen(false)
    setCalendarLinkEditDraft(null)
  }, [])

  const handleUpdateCalendarLink = useCallback(async () => {
    if (!activeWorkspace) {
      toast.error("No workspace selected")
      return
    }
    if (!calendarLinkEditDraft) return
    if (!calendarLinkEditDraft.name.trim() || !calendarLinkEditDraft.url.trim()) {
      toast.error("Please provide both name and availability URL")
      return
    }

    setIsUpdatingCalendarLink(true)
    const result = await updateCalendarLink(calendarLinkEditDraft.id, {
      name: calendarLinkEditDraft.name.trim(),
      url: calendarLinkEditDraft.url.trim(),
      publicUrl: calendarLinkEditDraft.publicUrl.trim() || null,
    })

    if (result.success) {
      const calendarResult = await getCalendarLinks(activeWorkspace)
      if (calendarResult.success && calendarResult.data) {
        setCalendarLinks(calendarResult.data)
      }

      if (meetingBooking.meetingBookingProvider === "ghl") {
        try {
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
        } catch (e) {
          console.warn("Failed to refresh GHL mismatch info:", e)
          setCalendarMismatchInfo(null)
        }
        setCalendlyCalendarMismatchInfo(null)
      } else {
        try {
          const mismatch = await getCalendlyCalendarMismatchInfo(activeWorkspace)
          if (mismatch.success) {
            setCalendlyCalendarMismatchInfo({
              mismatch: mismatch.mismatch ?? false,
              calendlyEventTypeUuid: mismatch.calendlyEventTypeUuid ?? null,
              calendarLinkCalendlyEventTypeUuid: mismatch.calendarLinkCalendlyEventTypeUuid ?? null,
              lastError: mismatch.lastError ?? null,
            })
          } else {
            setCalendlyCalendarMismatchInfo(null)
          }
        } catch (e) {
          console.warn("Failed to refresh Calendly mismatch info:", e)
          setCalendlyCalendarMismatchInfo(null)
        }
        setCalendarMismatchInfo(null)
      }

      toast.success("Calendar link updated")
      handleCloseCalendarLinkEditor()
    } else {
      toast.error(result.error || "Failed to update calendar link")
    }
    setIsUpdatingCalendarLink(false)
  }, [activeWorkspace, calendarLinkEditDraft, handleCloseCalendarLinkEditor, meetingBooking.meetingBookingProvider])

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
      if (meetingBooking.meetingBookingProvider === "ghl") {
        try {
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
        } catch (e) {
          console.warn("Failed to refresh GHL mismatch info:", e)
          setCalendarMismatchInfo(null)
        }
        setCalendlyCalendarMismatchInfo(null)
      } else {
        try {
          const mismatch = await getCalendlyCalendarMismatchInfo(activeWorkspace)
          if (mismatch.success) {
            setCalendlyCalendarMismatchInfo({
              mismatch: mismatch.mismatch ?? false,
              calendlyEventTypeUuid: mismatch.calendlyEventTypeUuid ?? null,
              calendarLinkCalendlyEventTypeUuid: mismatch.calendarLinkCalendlyEventTypeUuid ?? null,
              lastError: mismatch.lastError ?? null,
            })
          } else {
            setCalendlyCalendarMismatchInfo(null)
          }
        } catch (e) {
          console.warn("Failed to refresh Calendly mismatch info:", e)
          setCalendlyCalendarMismatchInfo(null)
        }
        setCalendarMismatchInfo(null)
      }
      toast.success("Calendar link deleted")
    } else {
      toast.error(result.error || "Failed to delete calendar link")
    }
  }, [activeWorkspace, meetingBooking.meetingBookingProvider])

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
      if (meetingBooking.meetingBookingProvider === "ghl") {
        try {
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
        } catch (e) {
          console.warn("Failed to refresh GHL mismatch info:", e)
          setCalendarMismatchInfo(null)
        }
        setCalendlyCalendarMismatchInfo(null)
      } else {
        try {
          const mismatch = await getCalendlyCalendarMismatchInfo(activeWorkspace)
          if (mismatch.success) {
            setCalendlyCalendarMismatchInfo({
              mismatch: mismatch.mismatch ?? false,
              calendlyEventTypeUuid: mismatch.calendlyEventTypeUuid ?? null,
              calendarLinkCalendlyEventTypeUuid: mismatch.calendarLinkCalendlyEventTypeUuid ?? null,
              lastError: mismatch.lastError ?? null,
            })
          } else {
            setCalendlyCalendarMismatchInfo(null)
          }
        } catch (e) {
          console.warn("Failed to refresh Calendly mismatch info:", e)
          setCalendlyCalendarMismatchInfo(null)
        }
        setCalendarMismatchInfo(null)
      }
      toast.success("Default calendar updated")
    } else {
      toast.error(result.error || "Failed to set default")
    }
  }, [activeWorkspace, meetingBooking.meetingBookingProvider])

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
  const currentEmailBisonBaseHost = emailBisonBaseHostId
    ? emailBisonBaseHosts.find((row) => row.id === emailBisonBaseHostId)
    : null
  const emailBisonBaseHostLabel = currentEmailBisonBaseHost
    ? `${currentEmailBisonBaseHost.host}${currentEmailBisonBaseHost.label ? ` — ${currentEmailBisonBaseHost.label}` : ""}`
    : "Default (EMAILBISON_BASE_URL / send.meetinboxxia.com)"

  if (isLoading || isUserLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
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
          {hasChanges && !isClientPortalUser && (
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
          <TabsList className="grid w-full max-w-4xl grid-cols-5">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="ai">AI Personality</TabsTrigger>
            <TabsTrigger value="booking">Booking</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>

          {isClientPortalUser ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-amber-200">
                  <Lock className="h-5 w-5 text-amber-200" />
                  Read-only settings
                </CardTitle>
                <CardDescription className="text-amber-200/70">
                  Settings are read-only for client portal users. Request changes from ZRG.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {/* General Settings */}
          <TabsContent value="general" className="space-y-6">
            <fieldset disabled={isClientPortalUser} className="space-y-6">
            {settings?.autoFollowUpsOnReply ? (() => {
              const missing: string[] = []
              const senderName = (aiPersona.name || "").trim()
              const companyName = (companyContext.companyName || "").trim()
              const targetResult = (companyContext.targetResult || "").trim()
              const hasDefaultCalendar = calendarLinks.some((l) => l.isDefault)
              const hasQualificationQuestions = qualificationQuestions.some((q) => (q.question || "").trim())

              if (!senderName) missing.push("Sender name (AI Persona)")
              if (!companyName) missing.push("Company name")
              if (!targetResult) missing.push("Target result/outcome ({result})")
              if (!hasDefaultCalendar) missing.push("Default calendar link")
              if (!hasQualificationQuestions) missing.push("Qualification questions")

              if (missing.length === 0) return null

              return (
                <Card className="border-amber-500/30 bg-amber-500/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-amber-200" />
                      <span className="text-amber-200">Follow-ups blocked — setup incomplete</span>
                    </CardTitle>
                    <CardDescription className="text-amber-200/70">
                      Follow-ups will not send until these are configured. You need to set these things up correctly in order for the platform to function.
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

            <div className="flex items-center gap-2 mt-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Account
              </h3>
              <Separator className="flex-1" />
            </div>

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

            <div className="flex items-center gap-2 mt-6">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Scheduling
              </h3>
              <Separator className="flex-1" />
            </div>

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
                      <SelectGroup>
                        <SelectLabel>Universal</SelectLabel>
                        <SelectItem value="UTC">UTC</SelectItem>
                      </SelectGroup>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Americas</SelectLabel>
                        <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                        <SelectItem value="America/Chicago">Central (CT)</SelectItem>
                        <SelectItem value="America/Denver">Mountain (MT)</SelectItem>
                        <SelectItem value="America/Phoenix">Arizona (MST)</SelectItem>
                        <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
                        <SelectItem value="America/Anchorage">Alaska (AKT)</SelectItem>
                        <SelectItem value="Pacific/Honolulu">Hawaii (HT)</SelectItem>
                      </SelectGroup>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Europe</SelectLabel>
                        <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
                        <SelectItem value="Europe/Dublin">Dublin (GMT/BST)</SelectItem>
                        <SelectItem value="Europe/Paris">Paris (CET)</SelectItem>
                        <SelectItem value="Europe/Berlin">Berlin (CET)</SelectItem>
                      </SelectGroup>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Asia Pacific</SelectLabel>
                        <SelectItem value="Asia/Dubai">Dubai (GST)</SelectItem>
                        <SelectItem value="Asia/Kolkata">India (IST)</SelectItem>
                        <SelectItem value="Asia/Singapore">Singapore (SGT)</SelectItem>
                        <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                        <SelectItem value="Australia/Sydney">Sydney (AEST)</SelectItem>
                      </SelectGroup>
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

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  AI Auto-Send Schedule
                </CardTitle>
                <CardDescription>Control when AI auto-sends are allowed to run</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isWorkspaceAdmin ? (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Only workspace admins can edit auto-send schedules and holiday blackouts.
                  </div>
                ) : null}
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="schedule-mode">
                    <AccordionTrigger>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        <span>Schedule Mode</span>
                        <Badge variant="secondary" className="ml-2">
                          {autoSendSchedule.mode === "ALWAYS"
                            ? "Always On"
                            : autoSendSchedule.mode === "BUSINESS_HOURS"
                              ? "Business Hours"
                              : "Custom"}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Schedule mode</Label>
                          <Select
                            value={autoSendSchedule.mode}
                            onValueChange={(v) => {
                              setAutoSendSchedule((prev) => ({
                                ...prev,
                                mode: v as "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM",
                              }))
                              handleChange()
                            }}
                          >
                            <SelectTrigger disabled={!isWorkspaceAdmin}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ALWAYS">Always (24/7)</SelectItem>
                              <SelectItem value="BUSINESS_HOURS">Business hours (workspace)</SelectItem>
                              <SelectItem value="CUSTOM">Custom schedule</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {autoSendSchedule.mode === "BUSINESS_HOURS" ? (
                          <p className="text-xs text-muted-foreground">
                            Uses the workspace timezone and working hours above.
                          </p>
                        ) : null}

                        {autoSendSchedule.mode === "CUSTOM" ? (
                          <div className="space-y-3">
                            <div className="space-y-2">
                              <Label>Active days</Label>
                              <div className="flex flex-wrap items-center gap-3">
                                {AUTO_SEND_SCHEDULE_DAYS.map((day) => (
                                  <label key={day.value} className="flex items-center gap-2 text-sm">
                                    <Checkbox
                                      checked={autoSendSchedule.customDays.includes(day.value)}
                                      disabled={!isWorkspaceAdmin}
                                      onCheckedChange={(v) => {
                                        const checked = v === true
                                        setAutoSendSchedule((prev) => {
                                          const exists = prev.customDays.includes(day.value)
                                          const nextDays = checked
                                            ? (exists ? prev.customDays : [...prev.customDays, day.value])
                                            : prev.customDays.filter((d) => d !== day.value)
                                          return { ...prev, customDays: nextDays }
                                        })
                                        handleChange()
                                      }}
                                    />
                                    {day.label}
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <Label>Start Time</Label>
                                <Input
                                  type="time"
                                  value={autoSendSchedule.customStartTime}
                                  disabled={!isWorkspaceAdmin}
                                  onChange={(e) => {
                                    setAutoSendSchedule((prev) => ({ ...prev, customStartTime: e.target.value }))
                                    handleChange()
                                  }}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>End Time</Label>
                                <Input
                                  type="time"
                                  value={autoSendSchedule.customEndTime}
                                  disabled={!isWorkspaceAdmin}
                                  onChange={(e) => {
                                    setAutoSendSchedule((prev) => ({ ...prev, customEndTime: e.target.value }))
                                    handleChange()
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="holidays">
                    <AccordionTrigger>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        <span>Holiday Settings</span>
                        <Badge variant="outline" className="ml-2">
                          {autoSendSchedule.holidays.excludedPresetDates.length +
                            autoSendSchedule.holidays.additionalBlackoutDates.length +
                            autoSendSchedule.holidays.additionalBlackoutDateRanges.length} exclusions
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3">
                        <div>
                          <Label>Holiday blackouts</Label>
                          <p className="text-xs text-muted-foreground">
                            Skip auto-sends on holidays. Campaign overrides can add extra blackouts.
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={autoSendSchedule.holidays.presetEnabled}
                            disabled={!isWorkspaceAdmin}
                            onCheckedChange={(v) => {
                              const checked = v === true
                              setAutoSendSchedule((prev) => ({
                                ...prev,
                                holidays: { ...prev.holidays, presetEnabled: checked },
                              }))
                              handleChange()
                            }}
                          />
                          <span className="text-sm">Use US federal + common holidays (no observed dates)</span>
                        </div>

                        {autoSendSchedule.holidays.presetEnabled ? (
                          <div className="space-y-2">
                            <Label className="text-sm">Exclude preset dates</Label>
                            <div className="flex flex-wrap gap-2">
                              <Input
                                type="date"
                                value={holidayExcludedPresetDate}
                                disabled={!isWorkspaceAdmin}
                                onChange={(e) => setHolidayExcludedPresetDate(e.target.value)}
                              />
                              <Button
                                variant="outline"
                                disabled={!isWorkspaceAdmin || !holidayExcludedPresetDate}
                                onClick={() => {
                                  if (!holidayExcludedPresetDate) return
                                  setAutoSendSchedule((prev) => ({
                                    ...prev,
                                    holidays: {
                                      ...prev.holidays,
                                      excludedPresetDates: normalizeDateList([
                                        ...prev.holidays.excludedPresetDates,
                                        holidayExcludedPresetDate,
                                      ]),
                                    },
                                  }))
                                  setHolidayExcludedPresetDate("")
                                  handleChange()
                                }}
                              >
                                Add
                              </Button>
                            </div>
                            {autoSendSchedule.holidays.excludedPresetDates.length > 0 ? (
                              <div className="space-y-2">
                                {autoSendSchedule.holidays.excludedPresetDates.map((date) => (
                                  <div key={date} className="flex items-center justify-between rounded-lg border p-2">
                                    <span className="text-sm">{date}</span>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                      onClick={() => {
                                        setAutoSendSchedule((prev) => ({
                                          ...prev,
                                          holidays: {
                                            ...prev.holidays,
                                            excludedPresetDates: prev.holidays.excludedPresetDates.filter((d) => d !== date),
                                          },
                                        }))
                                        handleChange()
                                      }}
                                      disabled={!isWorkspaceAdmin}
                                      aria-label="Remove excluded holiday"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">No excluded holiday dates.</p>
                            )}
                          </div>
                        ) : null}

                        <div className="space-y-2">
                          <Label className="text-sm">Additional blackout dates</Label>
                          <div className="flex flex-wrap gap-2">
                            <Input
                              type="date"
                              value={holidayBlackoutDate}
                              disabled={!isWorkspaceAdmin}
                              onChange={(e) => setHolidayBlackoutDate(e.target.value)}
                            />
                            <Button
                              variant="outline"
                              disabled={!isWorkspaceAdmin || !holidayBlackoutDate}
                              onClick={() => {
                                if (!holidayBlackoutDate) return
                                setAutoSendSchedule((prev) => ({
                                  ...prev,
                                  holidays: {
                                    ...prev.holidays,
                                    additionalBlackoutDates: normalizeDateList([
                                      ...prev.holidays.additionalBlackoutDates,
                                      holidayBlackoutDate,
                                    ]),
                                  },
                                }))
                                setHolidayBlackoutDate("")
                                handleChange()
                              }}
                            >
                              Add
                            </Button>
                          </div>
                          {autoSendSchedule.holidays.additionalBlackoutDates.length > 0 ? (
                            <div className="space-y-2">
                              {autoSendSchedule.holidays.additionalBlackoutDates.map((date) => (
                                <div key={date} className="flex items-center justify-between rounded-lg border p-2">
                                  <span className="text-sm">{date}</span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => {
                                      setAutoSendSchedule((prev) => ({
                                        ...prev,
                                        holidays: {
                                          ...prev.holidays,
                                          additionalBlackoutDates: prev.holidays.additionalBlackoutDates.filter((d) => d !== date),
                                        },
                                      }))
                                      handleChange()
                                    }}
                                    disabled={!isWorkspaceAdmin}
                                    aria-label="Remove blackout date"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">No additional blackout dates.</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">Additional blackout ranges</Label>
                          <div className="flex flex-wrap gap-2">
                            <Input
                              type="date"
                              value={holidayBlackoutRangeStart}
                              disabled={!isWorkspaceAdmin}
                              onChange={(e) => setHolidayBlackoutRangeStart(e.target.value)}
                            />
                            <Input
                              type="date"
                              value={holidayBlackoutRangeEnd}
                              disabled={!isWorkspaceAdmin}
                              onChange={(e) => setHolidayBlackoutRangeEnd(e.target.value)}
                            />
                            <Button
                              variant="outline"
                              disabled={!isWorkspaceAdmin || !holidayBlackoutRangeStart || !holidayBlackoutRangeEnd}
                              onClick={() => {
                                if (!holidayBlackoutRangeStart || !holidayBlackoutRangeEnd) return
                                setAutoSendSchedule((prev) => ({
                                  ...prev,
                                  holidays: {
                                    ...prev.holidays,
                                    additionalBlackoutDateRanges: normalizeDateRanges([
                                      ...prev.holidays.additionalBlackoutDateRanges,
                                      { start: holidayBlackoutRangeStart, end: holidayBlackoutRangeEnd },
                                    ]),
                                  },
                                }))
                                setHolidayBlackoutRangeStart("")
                                setHolidayBlackoutRangeEnd("")
                                handleChange()
                              }}
                            >
                              Add
                            </Button>
                          </div>
                          {autoSendSchedule.holidays.additionalBlackoutDateRanges.length > 0 ? (
                            <div className="space-y-2">
                              {autoSendSchedule.holidays.additionalBlackoutDateRanges.map((range) => (
                                <div key={`${range.start}-${range.end}`} className="flex items-center justify-between rounded-lg border p-2">
                                  <span className="text-sm">
                                    {range.start} → {range.end}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                    onClick={() => {
                                      setAutoSendSchedule((prev) => ({
                                        ...prev,
                                        holidays: {
                                          ...prev.holidays,
                                          additionalBlackoutDateRanges: prev.holidays.additionalBlackoutDateRanges.filter(
                                            (r) => !(r.start === range.start && r.end === range.end)
                                          ),
                                        },
                                      }))
                                      handleChange()
                                    }}
                                    disabled={!isWorkspaceAdmin}
                                    aria-label="Remove blackout range"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">No blackout ranges.</p>
                          )}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>

            <div className="flex items-center gap-2 mt-6">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Company Profile
              </h3>
              <Separator className="flex-1" />
            </div>

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
                    Used in messages as {"{companyName}"} - e.g., &quot;Hey John - Sarah from {"{companyName}"} again&quot;
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
                    Used in messages as {"{result}"} - e.g., &quot;in case you were still interested in {"{result}"}&quot;
                  </p>
                </div>

                <Separator />

                {/* ICP - Ideal Customer Profile (Phase 39g - workspace-level) */}
                <div className="space-y-2">
                  <Label htmlFor="idealCustomerProfile" className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Ideal Customer Profile (ICP)
                  </Label>
                  <Textarea
                    id="idealCustomerProfile"
                    placeholder="Job titles, company size, industry, pain points, buying signals..."
                    value={aiPersona.idealCustomerProfile}
                    onChange={(e) => {
                      setAiPersona({ ...aiPersona, idealCustomerProfile: e.target.value })
                      handleChange()
                    }}
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Describes your ideal buyer persona. Used by lead scoring to assess fit and intent.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center gap-2 mt-6">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Calendar Links
              </h3>
              <Separator className="flex-1" />
            </div>

            {/* Calendar Links */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Calendar Links
                </CardTitle>
                <CardDescription>
                  Availability slots are fetched from the availability URL. Messages use the public booking link when set (otherwise the availability URL).
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
                            {link.publicUrl ? (
                              <Badge variant="outline" className="text-xs">
                                Public override
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">Availability: {link.url}</p>
                          {link.publicUrl ? (
                            <p className="text-xs text-muted-foreground truncate">Public: {link.publicUrl}</p>
                          ) : null}
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
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleOpenCalendarLinkEditor(link)}
                            aria-label="Edit calendar link"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteCalendarLink(link.id)}
                            aria-label="Delete calendar link"
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
                      <Label className="text-xs">Availability URL</Label>
                      <Input
                        placeholder="https://calendly.com/..."
                        value={newCalendarUrl}
                        onChange={(e) => setNewCalendarUrl(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs">Public booking link (optional)</Label>
                      <Input
                        placeholder="https://book.yourdomain.com/..."
                        value={newCalendarPublicUrl}
                        onChange={(e) => setNewCalendarPublicUrl(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        If set, this link is used everywhere we send a booking link to leads.
                      </p>
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

                <Dialog
                  open={calendarLinkEditOpen}
                  onOpenChange={(open) => {
                    if (!open) handleCloseCalendarLinkEditor()
                    setCalendarLinkEditOpen(open)
                  }}
                >
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Edit Calendar Link</DialogTitle>
                      <DialogDescription>
                        Update the availability URL (used for slot fetching) and the public booking link (used in messages).
                      </DialogDescription>
                    </DialogHeader>

                    {calendarLinkEditDraft ? (
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Name</Label>
                          <Input
                            value={calendarLinkEditDraft.name}
                            onChange={(e) =>
                              setCalendarLinkEditDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                            }
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Availability URL</Label>
                          <Input
                            value={calendarLinkEditDraft.url}
                            onChange={(e) =>
                              setCalendarLinkEditDraft((prev) => (prev ? { ...prev, url: e.target.value } : prev))
                            }
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Public booking link (optional)</Label>
                          <Input
                            value={calendarLinkEditDraft.publicUrl}
                            onChange={(e) =>
                              setCalendarLinkEditDraft((prev) =>
                                prev ? { ...prev, publicUrl: e.target.value } : prev
                              )
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            If set, this link replaces any booking link URLs in AI drafts and follow-up messages.
                          </p>
                        </div>

                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            onClick={handleCloseCalendarLinkEditor}
                            disabled={isUpdatingCalendarLink}
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={handleUpdateCalendarLink}
                            disabled={
                              isUpdatingCalendarLink ||
                              !calendarLinkEditDraft.name.trim() ||
                              !calendarLinkEditDraft.url.trim()
                            }
                          >
                            {isUpdatingCalendarLink ? (
                              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            ) : null}
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Calendar Health Check
                </CardTitle>
                <CardDescription>
                  Weekly check counts available slots in the next 7 days (weekdays only) during your workspace working hours.
                  If below the threshold, we post a Slack alert to your Notification Center Slack channels.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isWorkspaceAdmin ? (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Only workspace admins can edit calendar health settings.
                  </div>
                ) : null}

                <div className="flex items-center justify-between">
                  <div>
                    <p id="calendar-health-enabled-label" className="font-medium">Weekly calendar health alerts</p>
                    <p className="text-sm text-muted-foreground">Alert when your booking calendars have too few slots</p>
                  </div>
                  <Switch
                    id="calendar-health-enabled-switch"
                    aria-labelledby="calendar-health-enabled-label"
                    checked={calendarHealth.enabled}
                    disabled={!isWorkspaceAdmin}
                    onCheckedChange={(v) => {
                      setCalendarHealth((prev) => ({ ...prev, enabled: v }))
                      handleChange()
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="calendarHealthMinSlots">Minimum slots (next 7 days)</Label>
                    <Input
                      id="calendarHealthMinSlots"
                      type="number"
                      min={0}
                      max={500}
                      value={String(calendarHealth.minSlots)}
                      disabled={!isWorkspaceAdmin || !calendarHealth.enabled}
                      onChange={(e) => {
                        const next = Number.parseInt(e.target.value, 10)
                        if (!Number.isFinite(next)) return
                        setCalendarHealth((prev) => ({ ...prev, minSlots: Math.max(0, Math.min(500, next)) }))
                        handleChange()
                      }}
                    />
                    <p className="text-xs text-muted-foreground">Default is 10. Counts only weekday slots within your working hours.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Window used</Label>
                    <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                      <div>Timezone: {availability.timezone}</div>
                      <div>Hours: {availability.startTime}–{availability.endTime}</div>
                      <div>Days: Mon–Fri (next 7 days)</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center gap-2 mt-6">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Notifications
              </h3>
              <Separator className="flex-1" />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notifications
                </CardTitle>
                <CardDescription>Configure how you receive alerts</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p id="email-digest-label" className="font-medium">Daily Digests</p>
                    <p className="text-sm text-muted-foreground">Send daily summaries for sentiments set to “Daily”</p>
                  </div>
                  <Switch
                    id="email-digest-switch"
                    aria-labelledby="email-digest-label"
                    checked={notifications.emailDigest}
                    onCheckedChange={(v) => {
                      setNotifications({ ...notifications, emailDigest: v })
                      handleChange()
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs">Daily digest time (workspace timezone)</Label>
                    <Input
                      type="time"
                      value={notificationCenter.dailyDigestTime}
                      onChange={(e) => {
                        setNotificationCenter({ ...notificationCenter, dailyDigestTime: e.target.value })
                        handleChange()
                      }}
                      disabled={!isWorkspaceAdmin}
                    />
                    <p className="text-xs text-muted-foreground">Digests send within ~10 minutes of this time</p>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p id="slack-alerts-label" className="font-medium">Slack Alerts</p>
                      <p className="text-sm text-muted-foreground">Master switch for Slack notifications</p>
                    </div>
                    <Switch
                      id="slack-alerts-switch"
                      aria-labelledby="slack-alerts-label"
                      checked={notifications.slackAlerts}
                      onCheckedChange={(v) => {
                        setNotifications({ ...notifications, slackAlerts: v })
                        handleChange()
                      }}
                    />
                  </div>
                </div>

                {!isWorkspaceAdmin ? (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Only workspace admins can edit Notification Center recipients and sentiment rules.
                  </div>
                ) : null}

                <div className="space-y-3">
                  <div>
                    <p className="font-medium">Notification emails</p>
                    <p className="text-sm text-muted-foreground">Used for realtime email alerts and daily digests</p>
                    <p className="text-xs text-muted-foreground">Delivery uses Resend (configure in Integrations).</p>
                  </div>

                  <div className="flex gap-2">
                    <Input
                      placeholder="name@company.com"
                      value={newNotificationEmail}
                      onChange={(e) => setNewNotificationEmail(e.target.value)}
                      disabled={!isWorkspaceAdmin}
                    />
                    <Button
                      variant="outline"
                      onClick={addNotificationEmail}
                      disabled={!isWorkspaceAdmin || !newNotificationEmail.trim()}
                    >
                      Add
                    </Button>
                  </div>

                  {notificationCenter.emails.length > 0 ? (
                    <div className="space-y-2">
                      {notificationCenter.emails.map((email) => (
                        <div key={email} className="flex items-center justify-between rounded-lg border p-2">
                          <p className="text-sm">{email}</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeNotificationEmail(email)}
                            disabled={!isWorkspaceAdmin}
                            aria-label="Remove notification email"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No notification emails configured</p>
                  )}
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Notification phone numbers</p>
                      <p className="text-sm text-muted-foreground">Phone/SMS notifications are coming soon</p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      Coming soon
                    </Badge>
                  </div>

                  <div className="flex gap-2">
                    <Input
                      placeholder="+1 555 123 4567"
                      value={newNotificationPhone}
                      onChange={(e) => setNewNotificationPhone(e.target.value)}
                      disabled={!isWorkspaceAdmin}
                    />
                    <Button
                      variant="outline"
                      onClick={addNotificationPhone}
                      disabled={!isWorkspaceAdmin || !newNotificationPhone.trim()}
                    >
                      Add
                    </Button>
                  </div>

                  {notificationCenter.phones.length > 0 ? (
                    <div className="space-y-2">
                      {notificationCenter.phones.map((phone) => (
                        <div key={phone} className="flex items-center justify-between rounded-lg border p-2">
                          <p className="text-sm">{phone}</p>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeNotificationPhone(phone)}
                            disabled={!isWorkspaceAdmin}
                            aria-label="Remove notification phone"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No notification phone numbers configured</p>
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <div>
                    <p className="font-medium">Sentiment triggers</p>
                    <p className="text-sm text-muted-foreground">
                      Realtime sends an alert per lead; Daily includes the sentiment in the daily digest.
                    </p>
                  </div>

                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Sentiment</TableHead>
                          <TableHead className="w-[140px]">Mode</TableHead>
                          <TableHead>Destinations</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {SENTIMENT_TAGS.map((tag) => {
                          const rule = notificationCenter.sentimentRules[tag]
                          return (
                            <TableRow key={tag}>
                              <TableCell className="font-medium">{tag}</TableCell>
                              <TableCell>
                                <Select
                                  value={rule.mode}
                                  onValueChange={(v) => {
                                    setNotificationCenter((prev) => ({
                                      ...prev,
                                      sentimentRules: {
                                        ...prev.sentimentRules,
                                        [tag]: { ...prev.sentimentRules[tag], mode: v as NotificationMode },
                                      },
                                    }))
                                    handleChange()
                                  }}
                                  disabled={!isWorkspaceAdmin}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="off">Off</SelectItem>
                                    <SelectItem value="realtime">Realtime</SelectItem>
                                    <SelectItem value="daily">Daily</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap items-center gap-4">
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      checked={rule.destinations.slack}
                                      onCheckedChange={(v) => {
                                        setNotificationCenter((prev) => ({
                                          ...prev,
                                          sentimentRules: {
                                            ...prev.sentimentRules,
                                            [tag]: {
                                              ...prev.sentimentRules[tag],
                                              destinations: {
                                                ...prev.sentimentRules[tag].destinations,
                                                slack: v === true,
                                              },
                                            },
                                          },
                                        }))
                                        handleChange()
                                      }}
                                      disabled={!isWorkspaceAdmin}
                                    />
                                    <span className="text-xs text-muted-foreground">Slack</span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      checked={rule.destinations.email}
                                      onCheckedChange={(v) => {
                                        setNotificationCenter((prev) => ({
                                          ...prev,
                                          sentimentRules: {
                                            ...prev.sentimentRules,
                                            [tag]: {
                                              ...prev.sentimentRules[tag],
                                              destinations: {
                                                ...prev.sentimentRules[tag].destinations,
                                                email: v === true,
                                              },
                                            },
                                          },
                                        }))
                                        handleChange()
                                      }}
                                      disabled={!isWorkspaceAdmin}
                                    />
                                    <span className="text-xs text-muted-foreground">Email</span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <Checkbox checked={false} disabled />
                                    <span className="text-xs text-muted-foreground">Phone (soon)</span>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>
            </fieldset>
          </TabsContent>

          {/* Integrations */}
          <TabsContent value="integrations" className="space-y-6">
            <fieldset disabled={isClientPortalUser} className="space-y-6">
            {/* GHL Workspaces - Dynamic Multi-Tenancy */}
            <IntegrationsManager onWorkspacesChange={onWorkspacesChange} />

            {/* Slack (bot token + channel selector) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--brand-slack-bg)]">
                    <MessageSquare className="h-5 w-5 text-[color:var(--brand-slack)]" />
                  </div>
                  <span>Slack Notifications</span>
                </CardTitle>
                <CardDescription>Send notifications to a selected Slack channel using a bot token</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!activeWorkspace ? (
                  <p className="text-sm text-muted-foreground">Select a workspace to configure Slack.</p>
                ) : !isWorkspaceAdmin ? (
                  <p className="text-sm text-muted-foreground">Only workspace admins can change Slack settings.</p>
                ) : (
                  <>
                    {slackIntegrationError ? <div className="text-sm text-destructive">{slackIntegrationError}</div> : null}

                    <Accordion type="multiple" defaultValue={["bot-config"]} className="w-full">
                      <AccordionItem value="bot-config">
                        <AccordionTrigger>
                          <div className="flex items-center gap-2">
                            <Bot className="h-4 w-4" />
                            <span>Bot Configuration</span>
                            {slackTokenStatus?.configured ? (
                              <Badge variant="secondary" className="ml-2">Connected</Badge>
                            ) : null}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-2">
                            <Label>Slack Bot Token</Label>
                            <div className="flex gap-2">
                              <SecretInput
                                placeholder={slackTokenStatus?.configured ? slackTokenStatus.masked || "Configured" : "xoxb-..."}
                                value={slackTokenDraft}
                                onChange={(e) => setSlackTokenDraft(e.target.value)}
                              />
                              <Button
                                variant="outline"
                                onClick={handleSaveSlackToken}
                                disabled={isSavingSlackToken || !slackTokenDraft.trim()}
                              >
                                {isSavingSlackToken ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                                Save
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={handleClearSlackToken}
                                disabled={isSavingSlackToken || !slackTokenStatus?.configured}
                              >
                                Clear
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Required scopes: <code>chat:write</code>, <code>channels:read</code>, <code>groups:read</code>,{" "}
                              <code>users:read</code>, <code>im:write</code>. The bot must be invited to private channels.
                            </p>
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="channels">
                        <AccordionTrigger>
                          <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4" />
                            <span>Notification Channels</span>
                            <Badge variant="outline" className="ml-2">
                              {notificationCenter.slackChannelIds.length} selected
                            </Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <Label>Notification channels</Label>
                                <p className="text-xs text-muted-foreground">Selected channels receive Slack notifications</p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleLoadSlackChannels}
                                disabled={isLoadingSlackChannels || !slackTokenStatus?.configured}
                              >
                                {isLoadingSlackChannels ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                                Refresh channels
                              </Button>
                            </div>

                            <div className="flex gap-2">
                              <Select
                                value={slackChannelToAdd}
                                onValueChange={(v) => setSlackChannelToAdd(v)}
                                disabled={!slackTokenStatus?.configured || isLoadingSlackChannels || slackChannels.length === 0}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={slackChannels.length > 0 ? "Select a channel" : "Load channels first"} />
                                </SelectTrigger>
                                <SelectContent>
                                  {slackChannels.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                      {(c.is_private ? "🔒 " : "#") + c.name + (c.is_member === false ? " (invite bot)" : "")}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button variant="outline" onClick={handleAddSlackChannel} disabled={!slackChannelToAdd}>
                                Add
                              </Button>
                            </div>

                            {notificationCenter.slackChannelIds.length > 0 ? (
                              <div className="space-y-2">
                                {notificationCenter.slackChannelIds.map((id) => {
                                  const name = slackChannels.find((c) => c.id === id)?.name
                                  return (
                                    <div key={id} className="flex items-center justify-between rounded-lg border p-2">
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium truncate">{name ? `#${name}` : id}</p>
                                        <p className="text-xs text-muted-foreground truncate">{id}</p>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => handleRemoveSlackChannel(id)}
                                        aria-label="Remove Slack channel"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  )
                                })}
                                <p className="text-xs text-muted-foreground">
                                  Channel selection is saved with the workspace settings (click “Save Changes”).
                                </p>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">No Slack channels selected yet</p>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="recipients">
                        <AccordionTrigger>
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            <span>Approval Recipients</span>
                            <Badge variant="outline" className="ml-2">
                              {selectedApprovalRecipients.length} members
                            </Badge>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <Label>AI Auto-Send Approval Recipients</Label>
                                <p className="text-xs text-muted-foreground">
                                  Team members who receive Slack DMs when AI auto-send needs human review
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleRefreshSlackMembers}
                                disabled={isLoadingSlackMembers || !slackTokenStatus?.configured}
                              >
                                {isLoadingSlackMembers ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                                Refresh members
                              </Button>
                            </div>

                            {!slackTokenStatus?.configured ? (
                              <p className="text-xs text-muted-foreground">
                                Configure a Slack bot token above to select approval recipients.
                              </p>
                            ) : slackMembers.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No members loaded. Click “Refresh members” to pull your Slack workspace members.
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {slackMembers.map((member) => {
                                  const isSelected = selectedApprovalRecipients.some((r) => r.id === member.id)
                                  return (
                                    <button
                                      key={member.id}
                                      type="button"
                                      onClick={() => toggleApprovalRecipient(member)}
                                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                                        isSelected
                                          ? "border-primary bg-primary/10 text-primary"
                                          : "border-muted hover:border-primary/50"
                                      }`}
                                    >
                                      <Avatar className="h-5 w-5">
                                        <AvatarImage src={member.avatarUrl || undefined} />
                                        <AvatarFallback>{member.displayName?.slice(0, 1) || "?"}</AvatarFallback>
                                      </Avatar>
                                      <span className="max-w-[140px] truncate">{member.displayName}</span>
                                      {isSelected ? <Check className="h-3 w-3" /> : null}
                                    </button>
                                  )
                                })}
                              </div>
                            )}

                            {slackTokenStatus?.configured && slackMembers.length > 0 && selectedApprovalRecipients.length === 0 ? (
                              <p className="text-xs text-amber-600 dark:text-amber-400">
                                No recipients selected. AI auto-send review DMs will be skipped for this workspace.
                              </p>
                            ) : null}

                            {selectedApprovalRecipients.length > 0 ? (
                              <p className="text-xs text-muted-foreground">
                                {selectedApprovalRecipients.length} recipient
                                {selectedApprovalRecipients.length > 1 ? "s" : ""} selected
                              </p>
                            ) : null}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Resend (per-workspace email notifications) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                    <Send className="h-5 w-5 text-foreground" />
                  </div>
                  <span>Resend (Email Notifications)</span>
                </CardTitle>
                <CardDescription>Configure Resend credentials for Notification Center email alerts</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!activeWorkspace ? (
                  <p className="text-sm text-muted-foreground">Select a workspace to configure Resend.</p>
                ) : !isWorkspaceAdmin ? (
                  <p className="text-sm text-muted-foreground">Only workspace admins can change Resend settings.</p>
                ) : (
                  <>
                    {resendIntegrationError ? <div className="text-sm text-destructive">{resendIntegrationError}</div> : null}

                    <div className="space-y-2">
                      <Label>Resend API Key</Label>
                      <div className="flex gap-2">
                        <SecretInput
                          placeholder={resendStatus?.maskedApiKey || "re_..."}
                          value={resendApiKeyDraft}
                          onChange={(e) => setResendApiKeyDraft(e.target.value)}
                        />
                        <Button
                          variant="outline"
                          onClick={handleSaveResendConfig}
                          disabled={isSavingResend || (!resendApiKeyDraft.trim() && resendFromEmailDraft.trim() === (resendStatus?.fromEmail ?? ""))}
                        >
                          {isSavingResend ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={handleClearResendConfig}
                          disabled={isSavingResend || (!resendStatus?.maskedApiKey && !resendStatus?.fromEmail)}
                        >
                          Clear
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Keep this secret. Resend email notifications require both an API key and a verified “From” email.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>From Email</Label>
                      <Input
                        type="email"
                        placeholder="notifications@yourdomain.com"
                        value={resendFromEmailDraft}
                        onChange={(e) => setResendFromEmailDraft(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        This must be a verified sender in Resend for the workspace’s white-label domain.
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* EmailBison base host (per workspace) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--brand-emailbison-bg)]">
                    <Mail className="h-5 w-5 text-[color:var(--brand-emailbison)]" />
                  </div>
                  <span>EmailBison Base Host</span>
                </CardTitle>
                <CardDescription>
                  Required for white-label EmailBison accounts. Set the correct send domain for the selected workspace.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!activeWorkspace ? (
                  <p className="text-sm text-muted-foreground">Select a workspace to configure EmailBison.</p>
                ) : !isWorkspaceAdmin ? (
                  <p className="text-sm text-muted-foreground">Only workspace admins can change this setting.</p>
                ) : (
                  <>
                    {emailBisonBaseHostError && (
                      <div className="text-sm text-destructive">{emailBisonBaseHostError}</div>
                    )}

                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Current base host</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {emailBisonBaseHostLoading ? "Loading…" : emailBisonBaseHostLabel}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setEmailBisonBaseHostOpen(true)}>
                        Manage hosts
                      </Button>
                    </div>

                    <Dialog open={emailBisonBaseHostOpen} onOpenChange={setEmailBisonBaseHostOpen}>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>EmailBison Base Hosts</DialogTitle>
                          <DialogDescription>
                            Required for white-label EmailBison accounts. Choose the send domain for this workspace.
                          </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>EmailBison Base Host</Label>
                            <Select
                              value={emailBisonBaseHostId}
                              onValueChange={(value) =>
                                setEmailBisonBaseHostId(value === EMAILBISON_BASE_HOST_DEFAULT_VALUE ? "" : value)
                              }
                            >
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={
                                    emailBisonBaseHostLoading
                                      ? "Loading…"
                                      : "Default (EMAILBISON_BASE_URL / send.meetinboxxia.com)"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={EMAILBISON_BASE_HOST_DEFAULT_VALUE}>
                                  Default (EMAILBISON_BASE_URL / send.meetinboxxia.com)
                                </SelectItem>
                                {emailBisonBaseHosts.map((row) => (
                                  <SelectItem key={row.id} value={row.id}>
                                    {row.host}
                                    {row.label ? ` — ${row.label}` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              Example: Founders Club should use <code className="bg-background px-1 py-0.5 rounded">send.foundersclubsend.com</code>.
                            </p>
                          </div>

                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setEmailBisonBaseHostOpen(false)}
                              disabled={emailBisonBaseHostSaving}
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={async () => {
                                await handleSaveEmailBisonBaseHost()
                                setEmailBisonBaseHostOpen(false)
                              }}
                              disabled={emailBisonBaseHostLoading || emailBisonBaseHostSaving}
                            >
                              {emailBisonBaseHostSaving ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4 mr-2" />
                              )}
                              Save
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </>
                )}
              </CardContent>
            </Card>

            {/* EmailBison first-touch availability_slot (per workspace) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--brand-emailbison-bg)]">
                    <Mail className="h-5 w-5 text-[color:var(--brand-emailbison)]" />
                  </div>
                  <span>EmailBison First-Touch Times</span>
                </CardTitle>
                <CardDescription>
                  Controls the <code className="bg-background px-1 py-0.5 rounded">availability_slot</code> custom variable injected
                  ~15 minutes before the first outbound EmailBison email.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!activeWorkspace ? (
                  <p className="text-sm text-muted-foreground">Select a workspace to configure EmailBison.</p>
                ) : (
                  <>
                    {!isWorkspaceAdmin ? (
                      <p className="text-sm text-muted-foreground">Only workspace admins can change these settings.</p>
                    ) : null}

                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <Label>Enable injection</Label>
                        <p className="text-xs text-muted-foreground">
                          When enabled, the system sets the EmailBison lead custom variable{" "}
                          <code className="bg-background px-1 py-0.5 rounded">availability_slot</code>.
                        </p>
                      </div>
                      <Switch
                        checked={emailBisonAvailabilitySlot.enabled}
                        disabled={!isWorkspaceAdmin}
                        onCheckedChange={(checked) => {
                          setEmailBisonAvailabilitySlot((prev) => ({ ...prev, enabled: checked }))
                          handleChange()
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Options to offer</Label>
                        <Select
                          value={String(emailBisonAvailabilitySlot.count)}
                          onValueChange={(value) => {
                            const parsed = Number.parseInt(value, 10)
                            setEmailBisonAvailabilitySlot((prev) => ({
                              ...prev,
                              count: Number.isFinite(parsed) ? parsed : prev.count,
                            }))
                            handleChange()
                          }}
                        >
                          <SelectTrigger disabled={!isWorkspaceAdmin}>
                            <SelectValue placeholder="2" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 time</SelectItem>
                            <SelectItem value="2">2 times</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Prefer within (days)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={30}
                          value={emailBisonAvailabilitySlot.preferWithinDays}
                          disabled={!isWorkspaceAdmin}
                          onChange={(e) => {
                            const parsed = Number.parseInt(e.target.value || "", 10)
                            setEmailBisonAvailabilitySlot((prev) => ({
                              ...prev,
                              preferWithinDays: Number.isFinite(parsed) ? parsed : prev.preferWithinDays,
                            }))
                            handleChange()
                          }}
                        />
                      </div>

                      <div className="flex items-start justify-between gap-4 rounded border px-3 py-2">
                        <div className="space-y-1">
                          <Label>Include weekends</Label>
                          <p className="text-xs text-muted-foreground">Allow Saturday/Sunday options in the pool.</p>
                        </div>
                        <Switch
                          checked={emailBisonAvailabilitySlot.includeWeekends}
                          disabled={!isWorkspaceAdmin}
                          onCheckedChange={(checked) => {
                            setEmailBisonAvailabilitySlot((prev) => ({ ...prev, includeWeekends: checked }))
                            handleChange()
                          }}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Sentence template (optional)</Label>
                      <Textarea
                        value={emailBisonAvailabilitySlot.template}
                        disabled={!isWorkspaceAdmin}
                        onChange={(e) => {
                          setEmailBisonAvailabilitySlot((prev) => ({ ...prev, template: e.target.value }))
                          handleChange()
                        }}
                        placeholder="does {{option1}} or {{option2}} work for you?"
                      />
                      <p className="text-xs text-muted-foreground">
                        Placeholders: <code className="bg-background px-1 py-0.5 rounded">&#123;&#123;option1&#125;&#125;</code>,{" "}
                        <code className="bg-background px-1 py-0.5 rounded">&#123;&#123;option2&#125;&#125;</code>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePreviewEmailBisonAvailabilitySlot}
                        disabled={emailBisonAvailabilitySlotPreviewLoading}
                      >
                        {emailBisonAvailabilitySlotPreviewLoading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Eye className="h-4 w-4 mr-2" />
                        )}
                        Preview current value
                      </Button>
                      <p className="text-xs text-muted-foreground">Uses cached availability (refreshed every minute).</p>
                    </div>

                    {emailBisonAvailabilitySlotPreviewError ? (
                      <div className="text-sm text-destructive">{emailBisonAvailabilitySlotPreviewError}</div>
                    ) : null}

                    {emailBisonAvailabilitySlotPreview ? (
                      <div className="rounded border p-3 space-y-2">
                        <div className="text-xs text-muted-foreground">
                          Variable:{" "}
                          <code className="bg-background px-1 py-0.5 rounded">{emailBisonAvailabilitySlotPreview.variableName}</code>{" "}
                          · Timezone:{" "}
                          <code className="bg-background px-1 py-0.5 rounded">{emailBisonAvailabilitySlotPreview.timeZone}</code>
                        </div>

                        <div className="text-sm">
                          {emailBisonAvailabilitySlotPreview.sentence ? (
                            <span className="font-medium">{emailBisonAvailabilitySlotPreview.sentence}</span>
                          ) : (
                            <span className="text-muted-foreground">No value (disabled, missing cache, or no slots available).</span>
                          )}
                        </div>

                        {emailBisonAvailabilitySlotPreview.slotLabels.length > 0 ? (
                          <ul className="ml-4 list-disc text-xs text-muted-foreground">
                            {emailBisonAvailabilitySlotPreview.slotLabels.map((label) => (
                              <li key={label}>{label}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Meeting Booking Configuration */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Meeting Booking
                </CardTitle>
                <CardDescription>
                  Configure automatic meeting booking via GoHighLevel or Calendly
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Provider Selection */}
                <div className="space-y-2">
                  <Label>Booking Provider</Label>
                  <Select
                    value={meetingBooking.meetingBookingProvider}
                    onValueChange={async (v) => {
                      const provider = v as "ghl" | "calendly"
                      setMeetingBooking((prev) => ({ ...prev, meetingBookingProvider: provider }))
                      handleChange()
                      if (provider === "ghl" && activeWorkspace) {
                        try {
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
                        } catch (e) {
                          console.warn("Failed to refresh GHL mismatch info:", e)
                          setCalendarMismatchInfo(null)
                        }
                        setCalendlyCalendarMismatchInfo(null)
                        loadGHLData(activeWorkspace)
                      } else {
                        setCalendarMismatchInfo(null)
                        setGhlCalendars([])
                        setGhlUsers([])
                        setGhlConnectionStatus("unknown")
                        if (provider === "calendly" && activeWorkspace) {
                          try {
                            const mismatch = await getCalendlyCalendarMismatchInfo(activeWorkspace)
                            if (mismatch.success) {
                              setCalendlyCalendarMismatchInfo({
                                mismatch: mismatch.mismatch ?? false,
                                calendlyEventTypeUuid: mismatch.calendlyEventTypeUuid ?? null,
                                calendarLinkCalendlyEventTypeUuid: mismatch.calendarLinkCalendlyEventTypeUuid ?? null,
                                lastError: mismatch.lastError ?? null,
                              })
                            } else {
                              setCalendlyCalendarMismatchInfo(null)
                            }
                          } catch (e) {
                            console.warn("Failed to refresh Calendly mismatch info:", e)
                            setCalendlyCalendarMismatchInfo(null)
                          }
                          loadCalendlyStatus(activeWorkspace)
                        } else {
                          setCalendlyCalendarMismatchInfo(null)
                          setCalendlyIntegration(null)
                          setCalendlyConnectionStatus("unknown")
                        }
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ghl">GoHighLevel</SelectItem>
                      <SelectItem value="calendly">Calendly</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Auto-booking will schedule using the selected provider.
                  </p>
                </div>

                {meetingBooking.meetingBookingProvider === "ghl" ? (
                  <>
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

                        <div className="space-y-2">
                          <Label>Direct Book Calendar (No Questions)</Label>
                          <Select
                            value={meetingBooking.ghlDirectBookCalendarId || GHL_SAME_AS_DEFAULT_CALENDAR}
                            onValueChange={(v) => {
                              setMeetingBooking((prev) => ({
                                ...prev,
                                ghlDirectBookCalendarId: v === GHL_SAME_AS_DEFAULT_CALENDAR ? "" : v,
                              }))
                              handleChange()
                            }}
                            disabled={ghlCalendars.length === 0}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Same as default" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={GHL_SAME_AS_DEFAULT_CALENDAR}>Same as default</SelectItem>
                              {ghlCalendars.map((cal) => (
                                <SelectItem key={cal.id} value={cal.id}>
                                  {cal.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Used when the lead hasn’t answered qualification questions (optional).
                          </p>
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
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {/* Calendly Connection Status */}
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2 rounded-lg ${
                            calendlyIntegration?.hasAccessToken
                              ? "bg-green-500/10"
                              : calendlyConnectionStatus === "error"
                                ? "bg-red-500/10"
                                : "bg-muted"
                          }`}
                        >
                          {isLoadingCalendlyData ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          ) : calendlyIntegration?.hasAccessToken ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : (
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {calendlyIntegration?.hasAccessToken ? "Calendly Token Configured" : "Calendly Not Connected"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {calendlyIntegration?.hasWebhookSubscription
                              ? "Webhook subscription configured"
                              : "Webhook subscription not configured"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            if (!activeWorkspace) return
                            setIsLoadingCalendlyData(true)
                            try {
                              const res = await testCalendlyConnectionForWorkspace(activeWorkspace)
                              if (res.success) {
                                toast.success("Calendly connected")
                                setCalendlyConnectionStatus("connected")
                              } else {
                                toast.error("Calendly connection failed", { description: res.error || "Unknown error" })
                                setCalendlyConnectionStatus("error")
                              }
                            } catch (e) {
                              toast.error("Calendly connection failed", {
                                description: e instanceof Error ? e.message : "Unknown error",
                              })
                              setCalendlyConnectionStatus("error")
                            } finally {
                              setIsLoadingCalendlyData(false)
                              loadCalendlyStatus(activeWorkspace)
                            }
                          }}
                          disabled={!activeWorkspace || isLoadingCalendlyData}
                        >
                          {isLoadingCalendlyData ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test Connection"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            if (!activeWorkspace) return
                            setIsLoadingCalendlyData(true)
                            try {
                              const res = await ensureCalendlyWebhookSubscriptionForWorkspace(activeWorkspace)
                              if (res.success) {
                                toast.success("Calendly webhooks configured")
                              } else {
                                toast.error("Failed to configure Calendly webhooks", {
                                  description: res.error || "Unknown error",
                                })
                              }
                            } catch (e) {
                              toast.error("Failed to configure Calendly webhooks", {
                                description: e instanceof Error ? e.message : "Unknown error",
                              })
                            } finally {
                              setIsLoadingCalendlyData(false)
                              loadCalendlyStatus(activeWorkspace)
                            }
                          }}
                          disabled={!activeWorkspace || isLoadingCalendlyData}
                        >
                          {isLoadingCalendlyData ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ensure Webhooks"}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border p-4 bg-muted/30">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-lg bg-muted p-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-medium">Calendly Booking</p>
                          <p className="text-xs text-muted-foreground">
                            Configure a Calendly event type to enable scheduling via Calendly. (Access token + webhooks are configured in the workspace integrations.)
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Calendly Event Type Link (With Questions)</Label>
                      <Input
                        placeholder="https://calendly.com/yourname/intro-call"
                        value={meetingBooking.calendlyEventTypeLink}
                        onChange={(e) => {
                          setMeetingBooking((prev) => ({ ...prev, calendlyEventTypeLink: e.target.value }))
                          if (!meetingBooking.calendlyEventTypeUri.trim()) {
                            setCalendlyCalendarMismatchInfo((prev) =>
                              prev ? { ...prev, calendlyEventTypeUuid: null, mismatch: false } : prev
                            )
                          }
                          handleChange()
                        }}
                        onBlur={async () => {
                          if (!activeWorkspace) return
                          try {
                            const mismatch = await getCalendlyCalendarMismatchInfo(activeWorkspace)
                            if (mismatch.success) {
                              setCalendlyCalendarMismatchInfo({
                                mismatch: mismatch.mismatch ?? false,
                                calendlyEventTypeUuid: mismatch.calendlyEventTypeUuid ?? null,
                                calendarLinkCalendlyEventTypeUuid: mismatch.calendarLinkCalendlyEventTypeUuid ?? null,
                                lastError: mismatch.lastError ?? null,
                              })
                            } else {
                              setCalendlyCalendarMismatchInfo(null)
                            }
                          } catch (e) {
                            console.warn("Failed to refresh Calendly mismatch info:", e)
                          }
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Use a specific event type link (not just the profile link) so booking + availability match.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Event Type URI (advanced)</Label>
                      <Input
                        placeholder="https://api.calendly.com/event_types/..."
                        value={meetingBooking.calendlyEventTypeUri}
                        onChange={(e) => {
                          const nextUri = e.target.value
                          setMeetingBooking((prev) => ({ ...prev, calendlyEventTypeUri: e.target.value }))
                          setCalendlyCalendarMismatchInfo((prev) => {
                            if (!prev) return prev
                            const uuid = extractCalendlyEventTypeUuidFromUri(nextUri)
                            return {
                              ...prev,
                              calendlyEventTypeUuid: uuid,
                              mismatch:
                                !!uuid &&
                                !!prev.calendarLinkCalendlyEventTypeUuid &&
                                uuid !== prev.calendarLinkCalendlyEventTypeUuid,
                            }
                          })
                          handleChange()
                        }}
                        onBlur={async () => {
                          if (!activeWorkspace) return
                          try {
                            const mismatch = await getCalendlyCalendarMismatchInfo(activeWorkspace)
                            if (mismatch.success) {
                              setCalendlyCalendarMismatchInfo({
                                mismatch: mismatch.mismatch ?? false,
                                calendlyEventTypeUuid: mismatch.calendlyEventTypeUuid ?? null,
                                calendarLinkCalendlyEventTypeUuid: mismatch.calendarLinkCalendlyEventTypeUuid ?? null,
                                lastError: mismatch.lastError ?? null,
                              })
                            } else {
                              setCalendlyCalendarMismatchInfo(null)
                            }
                          } catch (e) {
                            console.warn("Failed to refresh Calendly mismatch info:", e)
                          }
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional. If provided, this is used directly for scheduling.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Calendly Event Type Link (Direct Book - No Questions)</Label>
                      <Input
                        placeholder="https://calendly.com/yourname/intro-call"
                        value={meetingBooking.calendlyDirectBookEventTypeLink}
                        onChange={(e) => {
                          setMeetingBooking((prev) => ({ ...prev, calendlyDirectBookEventTypeLink: e.target.value }))
                          handleChange()
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Used when the lead hasn’t answered qualification questions. Falls back to the “with questions” event type if it has no required questions.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Direct Book Event Type URI (advanced)</Label>
                      <Input
                        placeholder="https://api.calendly.com/event_types/..."
                        value={meetingBooking.calendlyDirectBookEventTypeUri}
                        onChange={(e) => {
                          setMeetingBooking((prev) => ({ ...prev, calendlyDirectBookEventTypeUri: e.target.value }))
                          handleChange()
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional. If provided, this is used directly for direct booking (no questions).
                      </p>
                    </div>

                    {calendlyCalendarMismatchInfo?.mismatch && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                        <p className="font-medium text-amber-700">
                          Warning: Calendar Link & Booking Event differ
                        </p>
                        <p className="mt-1 text-amber-700/90">
                          Slots shown come from your default Calendar Link, but bookings will be created on the configured Calendly event type.
                        </p>
                        <p className="mt-2 text-amber-700/90">
                          Link event: <span className="font-mono">{calendlyCalendarMismatchInfo.calendarLinkCalendlyEventTypeUuid}</span>
                          <br />
                          Booking event: <span className="font-mono">{calendlyCalendarMismatchInfo.calendlyEventTypeUuid}</span>
                        </p>
                      </div>
                    )}

                    {calendlyCalendarMismatchInfo?.lastError && (
                      <p className="text-xs text-muted-foreground">
                        Availability status: {calendlyCalendarMismatchInfo.lastError}
                      </p>
                    )}

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
                  </>
                )}

                <Separator />

                {/* Auto-Book Toggle */}
                <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                  <div className="space-y-1">
                    <Label htmlFor="auto-book-meetings-switch" className="text-base font-medium">Auto-Book Meetings</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically book meetings when leads accept a time slot.
                      When enabled, all leads will have auto-booking on by default.
                    </p>
                  </div>
                  <Switch
                    id="auto-book-meetings-switch"
                    checked={meetingBooking.autoBookMeetings}
                    onCheckedChange={handleAutoBookToggle}
                  />
                </div>
              </CardContent>
            </Card>

            </fieldset>
          </TabsContent>

          {/* AI Personality */}
          <TabsContent value="ai" className="space-y-6">
            <fieldset disabled={isClientPortalUser} className="space-y-6">
            {/* AI Personas Manager (Phase 39) */}
            {isClientPortalUser ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="h-5 w-5" />
                    AI Personality (Read-only)
                  </CardTitle>
                  <CardDescription>Request changes from ZRG.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Sender name</div>
                    <div className="font-medium">{aiPersona.name || "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Tone</div>
                    <div className="font-medium">{aiPersona.tone || "—"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-muted-foreground">Greeting</div>
                    <div className="font-mono text-xs whitespace-pre-wrap">{aiPersona.greeting || "—"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-muted-foreground">SMS Greeting</div>
                    <div className="font-mono text-xs whitespace-pre-wrap">{aiPersona.smsGreeting || "—"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-muted-foreground">Signature</div>
                    <div className="font-mono text-xs whitespace-pre-wrap">{aiPersona.signature || "—"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-muted-foreground">Goals</div>
                    <div className="text-xs whitespace-pre-wrap">{aiPersona.goals || "—"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-muted-foreground">Service description</div>
                    <div className="text-xs whitespace-pre-wrap">{aiPersona.serviceDescription || "—"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-muted-foreground">Ideal customer profile</div>
                    <div className="text-xs whitespace-pre-wrap">{aiPersona.idealCustomerProfile || "—"}</div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <AiPersonaManager activeWorkspace={activeWorkspace} />
            )}

            {/* Workspace-Level Settings Card (Qualification Questions, Knowledge Assets) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="h-5 w-5" />
                  Workspace Settings
                </CardTitle>
                <CardDescription>
                  Settings shared across all personas (qualification questions, knowledge assets)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Qualification Questions */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">Qualification Questions</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Questions the AI should ask to qualify leads. These will be woven into conversations naturally.
                  </p>

                  <Collapsible open={qualificationQuestionsOpen} onOpenChange={setQualificationQuestionsOpen}>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Current questions</Label>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm">
                          {qualificationQuestionsOpen ? "Collapse" : "Add Questions"}
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 ml-2 transition-transform",
                              qualificationQuestionsOpen && "rotate-180"
                            )}
                          />
                        </Button>
                      </CollapsibleTrigger>
                    </div>

                    {/* Existing questions */}
                    <div className="space-y-2 mt-3">
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
                              aria-label="Delete qualification question"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <CollapsibleContent>
                      <div className="flex gap-2 mt-4">
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
                      <p className="text-xs text-muted-foreground mt-2">
                        Examples: &quot;What is your current monthly budget for this solution?&quot;, &quot;Who else is involved in this decision?&quot;
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                </div>

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
                              {asset.type === "url"
                                ? (() => {
                                    const source =
                                      asset.fileUrl ||
                                      ((asset.textContent || "").trim().startsWith("http") ? asset.textContent : "")
                                    const summary = asset.fileUrl ? asset.textContent : null
                                    if (source && !summary) {
                                      return `${source} — Pending extraction`
                                    }
                                    if (source && summary) {
                                      const s = summary.trim()
                                      return `${source} — ${s.slice(0, 80)}${s.length > 80 ? "..." : ""}`
                                    }
                                    return source || asset.textContent || ""
                                  })()
                                : asset.textContent
                                  ? `${asset.textContent.slice(0, 100)}${asset.textContent.length > 100 ? "..." : ""}`
                                  : "No extracted text yet"}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {asset.type}
                          </Badge>
                          {asset.type === "url" && !asset.textContent && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => handleRetryWebsiteAsset(asset.id)}
                              aria-label="Retry website scrape"
                            >
                              <RefreshCcw className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteAsset(asset.id)}
                            aria-label="Delete asset"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Add new asset */}
                  <div className="space-y-3">
                    <Dialog open={addAssetOpen} onOpenChange={setAddAssetOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="w-full">
                          <Plus className="h-4 w-4 mr-2" />
                          Add Knowledge Asset
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[520px]">
                        <DialogHeader>
                          <DialogTitle>Add Knowledge Asset</DialogTitle>
                          <DialogDescription>
                            Add documents, text snippets, or URLs that the AI can reference when generating responses.
                          </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-3">
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
                              <Select
                                value={newAssetType}
                                onValueChange={(v) => setNewAssetType(v as "text" | "url" | "file")}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="text">Text Snippet</SelectItem>
                                  <SelectItem value="url">Website (Scrape)</SelectItem>
                                  <SelectItem value="file">File Upload</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">
                              {newAssetType === "file" ? "File" : newAssetType === "url" ? "URL" : "Content"}
                            </Label>
                            {newAssetType === "file" ? (
                              <div className="space-y-2">
                                <Input
                                  type="file"
                                  accept=".pdf,.docx,.txt,.md,image/*"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0] || null
                                    setNewAssetFile(f)
                                  }}
                                />
                                {newAssetFile ? (
                                  <p className="text-xs text-muted-foreground">
                                    Selected: {newAssetFile.name} ({Math.round(newAssetFile.size / 1024)} KB)
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <Textarea
                                placeholder={newAssetType === "url"
                                  ? "https://example.com/pricing"
                                  : "Paste content here that the AI can reference..."
                                }
                                value={newAssetContent}
                                onChange={(e) => setNewAssetContent(e.target.value)}
                                rows={3}
                              />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {newAssetType === "url"
                              ? "Website scraping uses Crawl4AI. If not configured, this will error until a Crawl4AI runner is available."
                              : "Supported: PDF, DOCX, TXT/MD, and images. Uploaded files are processed into concise notes for AI."}
                          </p>
                        </div>

                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={() => setAddAssetOpen(false)}>
                            Cancel
                          </Button>
                          <Button
                            onClick={handleAddAsset}
                            disabled={
                              !newAssetName.trim() ||
                              (newAssetType === "file" ? !newAssetFile : !newAssetContent.trim())
                            }
                          >
                            <Plus className="h-4 w-4 mr-1.5" />
                            Add Asset
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
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
                      <div className="space-y-0.5">
                        <span id="auto-approve-meetings-label" className="text-sm">Auto-approve meeting confirmations</span>
                        <p className="text-xs text-muted-foreground">
                          Automatically confirm meeting acceptances when the lead is clear.
                        </p>
                      </div>
                      <Switch
                        id="auto-approve-meetings-switch"
                        aria-labelledby="auto-approve-meetings-label"
                        checked={automationRules.autoApproveMeetings}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, autoApproveMeetings: v })
                          handleChange()
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="space-y-0.5">
                        <span id="flag-uncertain-replies-label" className="text-sm">Flag uncertain responses for review</span>
                        <p className="text-xs text-muted-foreground">
                          Sends drafts for review when confidence is low or intent is ambiguous.
                        </p>
                      </div>
                      <Switch
                        id="flag-uncertain-replies-switch"
                        aria-labelledby="flag-uncertain-replies-label"
                        checked={automationRules.flagUncertainReplies}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, flagUncertainReplies: v })
                          handleChange()
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="space-y-0.5">
                        <span id="pause-for-ooo-label" className="text-sm">Pause sequences for Out-of-Office replies</span>
                        <p className="text-xs text-muted-foreground">
                          Prevents follow-ups from sending while the lead is away.
                        </p>
                      </div>
                      <Switch
                        id="pause-for-ooo-switch"
                        aria-labelledby="pause-for-ooo-label"
                        checked={automationRules.pauseForOOO}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, pauseForOOO: v })
                          handleChange()
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="space-y-0.5">
                        <span id="auto-blacklist-label" className="text-sm">Auto-blacklist explicit opt-outs</span>
                        <p className="text-xs text-muted-foreground">
                          Immediately blacklists leads who clearly request to stop.
                        </p>
                      </div>
                      <Switch
                        id="auto-blacklist-switch"
                        aria-labelledby="auto-blacklist-label"
                        checked={automationRules.autoBlacklist}
                        onCheckedChange={(v) => {
                          setAutomationRules({ ...automationRules, autoBlacklist: v })
                          handleChange()
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="space-y-0.5">
                        <span id="airtable-mode-label" className="text-sm">Airtable Mode</span>
                        <p className="text-xs text-muted-foreground">
                          Email is handled externally; default sequences become SMS/LinkedIn-only.
                        </p>
                      </div>
                      <Switch
                        id="airtable-mode-switch"
                        aria-labelledby="airtable-mode-label"
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

            <Card className={cn(
              "border-2",
              isFollowUpsPaused ? "border-amber-500/50 bg-amber-500/5" : "border-border"
            )}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      isFollowUpsPaused ? "bg-amber-500/20" : "bg-muted"
                    )}>
                      {isFollowUpsPaused ? (
                        <PauseCircle className="h-5 w-5 text-amber-500" />
                      ) : (
                        <PlayCircle className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-base">Follow-Up Sequences</CardTitle>
                      <CardDescription>
                        {isFollowUpsPaused
                          ? `Paused until ${followUpsPausedUntil ? formatWorkspaceDateTime(followUpsPausedUntil) : "manual resume"}`
                          : "Sequences are running normally"}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant={isFollowUpsPaused ? "destructive" : "secondary"}>
                    {isFollowUpsPaused ? "Paused" : "Active"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {isFollowUpsPaused ? (
                  <Button
                    onClick={() => handleResumeWorkspaceFollowUps()}
                    variant="outline"
                    disabled={!activeWorkspace || isPausingFollowUps}
                    className="w-full"
                  >
                    Resume Follow-ups
                  </Button>
                ) : (
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
                    <span className="text-sm text-muted-foreground">days</span>
                    <Button
                      variant="outline"
                      disabled={!activeWorkspace || isPausingFollowUps}
                      onClick={() => handlePauseWorkspaceFollowUps()}
                    >
                      Pause
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Campaign Strategist
                </CardTitle>
                <CardDescription>
                  Model + reasoning settings for the Campaign Strategist (read-only v1). Action tools are wired but disabled by default.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Workspace-wide</span>
                    <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isWorkspaceAdmin ? (
                      <>
                        <Lock className="h-4 w-4 text-muted-foreground" />
                        <Badge variant="outline">Locked</Badge>
                      </>
                    ) : (
                      <Badge variant="secondary">Admin</Badge>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Model</Label>
                    <Select
                      value={insightsChatSettings.model}
                      onValueChange={(v) => {
                        const nextModel = v
                        setInsightsChatSettings((prev) => ({
                          ...prev,
                          model: nextModel,
                          reasoningEffort:
                            nextModel === "gpt-5.2"
                              ? prev.reasoningEffort
                              : prev.reasoningEffort === "extra_high"
                                ? "high"
                                : prev.reasoningEffort,
                        }))
                        handleChange()
                      }}
                      disabled={!isWorkspaceAdmin}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gpt-5-mini">GPT-5 Mini (default)</SelectItem>
                        <SelectItem value="gpt-5.1">GPT-5.1</SelectItem>
                        <SelectItem value="gpt-5.2">GPT-5.2</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Used by the Insights Console and background summaries.</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Reasoning Effort</Label>
                    <Select
                      value={insightsChatSettings.reasoningEffort}
                      onValueChange={(v) => {
                        setInsightsChatSettings((prev) => ({ ...prev, reasoningEffort: v }))
                        handleChange()
                      }}
                      disabled={!isWorkspaceAdmin}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        {insightsChatSettings.model === "gpt-5.2" ? (
                          <SelectItem value="extra_high">Extra High (GPT-5.2 only)</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Higher effort improves quality but increases latency/cost.</p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-0.5">
                      <span id="enable-campaign-changes-label" className="text-sm">Enable campaign changes (future)</span>
                      <p className="text-xs text-muted-foreground">Allow the chatbot to change campaign response mode (disabled in v1).</p>
                    </div>
                    <Switch
                      id="enable-campaign-changes-switch"
                      aria-labelledby="enable-campaign-changes-label"
                      checked={insightsChatSettings.enableCampaignChanges}
                      disabled={!isWorkspaceAdmin}
                      onCheckedChange={(v) => {
                        setInsightsChatSettings((prev) => ({ ...prev, enableCampaignChanges: v }))
                        handleChange()
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-0.5">
                      <span id="enable-experiment-writes-label" className="text-sm">Enable experiment writes (future)</span>
                      <p className="text-xs text-muted-foreground">Allow the chatbot to create experiments with human approval (disabled in v1).</p>
                    </div>
                    <Switch
                      id="enable-experiment-writes-switch"
                      aria-labelledby="enable-experiment-writes-label"
                      checked={insightsChatSettings.enableExperimentWrites}
                      disabled={!isWorkspaceAdmin}
                      onCheckedChange={(v) => {
                        setInsightsChatSettings((prev) => ({ ...prev, enableExperimentWrites: v }))
                        handleChange()
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="space-y-0.5">
                      <span id="enable-followup-pauses-label" className="text-sm">Enable follow-up pauses (future)</span>
                      <p className="text-xs text-muted-foreground">Allow the chatbot to pause follow-ups with human approval (disabled in v1).</p>
                    </div>
                    <Switch
                      id="enable-followup-pauses-switch"
                      aria-labelledby="enable-followup-pauses-label"
                      checked={insightsChatSettings.enableFollowupPauses}
                      disabled={!isWorkspaceAdmin}
                      onCheckedChange={(v) => {
                        setInsightsChatSettings((prev) => ({ ...prev, enableFollowupPauses: v }))
                        handleChange()
                      }}
                    />
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div className="space-y-1">
                    <div className="font-medium">Read-only v1</div>
                    <p className="text-xs text-muted-foreground">
                      The Insights Console does not execute writes yet. These toggles are scaffolding for future controlled rollouts.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Email Draft Generation Model (Phase 30) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Email Draft Generation
                </CardTitle>
                <CardDescription>
                  Configure the AI model used for generating email draft responses.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                  <div className="space-y-0.5">
                    <span className="text-sm font-medium">Workspace-wide</span>
                    <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isWorkspaceAdmin ? (
                      <>
                        <Lock className="h-4 w-4 text-muted-foreground" />
                        <Badge variant="outline">Locked</Badge>
                      </>
                    ) : (
                      <Badge variant="secondary">Admin</Badge>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Model</Label>
                    <Select
                      value={draftGenerationSettings.model}
                      onValueChange={(v) => {
                        const nextModel = v
                        setDraftGenerationSettings((prev) => ({
                          ...prev,
                          model: nextModel,
                          reasoningEffort:
                            nextModel === "gpt-5.2"
                              ? prev.reasoningEffort
                              : prev.reasoningEffort === "extra_high"
                                ? "high"
                                : prev.reasoningEffort,
                        }))
                        handleChange()
                      }}
                      disabled={!isWorkspaceAdmin}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gpt-5.1">GPT-5.1 (default)</SelectItem>
                        <SelectItem value="gpt-5.2">GPT-5.2</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      GPT-5.2 offers enhanced reasoning for complex leads.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Reasoning Effort</Label>
                    <Select
                      value={draftGenerationSettings.reasoningEffort}
                      onValueChange={(v) => {
                        setDraftGenerationSettings((prev) => ({ ...prev, reasoningEffort: v }))
                        handleChange()
                      }}
                      disabled={!isWorkspaceAdmin}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium (Recommended)</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        {draftGenerationSettings.model === "gpt-5.2" ? (
                          <SelectItem value="extra_high">Extra High (GPT-5.2 only)</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Higher reasoning = better personalization, more tokens.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-lg border bg-blue-500/10 p-3 text-sm">
                  <Sparkles className="h-4 w-4 mt-0.5 text-blue-600" />
                  <div className="space-y-1">
                    <div className="font-medium text-blue-700">Two-Step Drafting</div>
                    <p className="text-xs text-muted-foreground">
                      Email drafts use a two-step pipeline: first analyzing the lead for personalization, then generating a structurally unique response.
                    </p>
                  </div>
                </div>
	              </CardContent>
	            </Card>

            {isWorkspaceAdmin && activeWorkspace && !isClientPortalUser ? (
              <BulkDraftRegenerationCard clientId={activeWorkspace} />
            ) : null}

            {!isClientPortalUser && canViewAiObs ? (
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
                          Token usage + cost estimates across all AI calls (by route/job + feature; 30-day retention)
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
                            <p className="text-sm font-medium">By Route/Job</p>
                            <p className="text-xs text-muted-foreground">
                              Window: {aiObs.window} · Updated:{" "}
                              {new Date(aiObs.rangeEnd).toLocaleString()}
                            </p>
                          </div>

                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Route/Job</TableHead>
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
                              {aiObs.sources.map((s) => (
                                <TableRow key={`${s.source || "unattributed"}:${s.model}`}>
                                  <TableCell className="font-medium">{s.name}</TableCell>
                                  <TableCell className="text-muted-foreground">{s.model}</TableCell>
                                  <TableCell>{new Intl.NumberFormat().format(s.calls)}</TableCell>
                                  <TableCell>
                                    {new Intl.NumberFormat(undefined, { notation: "compact" }).format(s.totalTokens)}
                                  </TableCell>
                                  <TableCell>
                                    {s.estimatedCostUsd === null
                                      ? "—"
                                      : s.estimatedCostUsd.toLocaleString("en-US", {
                                          style: "currency",
                                          currency: "USD",
                                        })}
                                  </TableCell>
                                  <TableCell>{new Intl.NumberFormat().format(s.errors)}</TableCell>
                                  <TableCell>{s.avgLatencyMs ? `${s.avgLatencyMs}ms` : "—"}</TableCell>
                                  <TableCell>
                                    {s.lastUsedAt ? new Date(s.lastUsedAt).toLocaleString() : "—"}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>

                        <Separator />

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">By Feature</p>
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

                <Dialog open={aiPromptsOpen} onOpenChange={(open) => {
                  setAiPromptsOpen(open)
                  if (!open) {
                    resetAiPromptModalState()
                  }
                }}>
                  <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Backend Prompts</DialogTitle>
                      <DialogDescription>
                        View and customize AI prompt templates and variables. Changes apply to this workspace only.
                      </DialogDescription>
                    </DialogHeader>

                    {/* Tab navigation (Phase 47h) */}
                    <div className="flex gap-2 border-b">
                      <button
                        type="button"
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                          promptModalTab === "prompts"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setPromptModalTab("prompts")}
                      >
                        Prompts
                      </button>
                      <button
                        type="button"
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                          promptModalTab === "variables"
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setPromptModalTab("variables")}
                      >
                        Variables
                      </button>
                    </div>

                    {aiPromptsLoading ? (
                      <div className="flex items-center justify-center py-10">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : promptModalTab === "variables" ? (
                      /* Variables Tab Content (Phase 47h + 47j) */
                      <div className="space-y-6 py-4">
                        {/* Persona Context Selector (Phase 47j) */}
                        <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-sm">AI Persona Context</p>
                              <p className="text-xs text-muted-foreground">
                                Drafts use these persona fields: tone, greeting, signature, goals.
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setAiPromptsOpen(false)
                                onTabChange?.("ai")
                              }}
                            >
                              Edit in AI Personality
                            </Button>
                          </div>
                          {personaList && personaList.length > 0 && (
                            <div className="flex items-center gap-3">
                              <Label className="text-xs">Preview persona:</Label>
                              <Select
                                value={selectedPersonaId || ""}
                                onValueChange={(v) => setSelectedPersonaId(v)}
                              >
                                <SelectTrigger className="w-[250px]">
                                  <SelectValue placeholder="Select persona..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {personaList.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.name} {p.isDefault && "(Default)"}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          {personaLoading ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Loading persona details...
                            </div>
                          ) : selectedPersonaDetails ? (
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="text-muted-foreground">Name:</span>{" "}
                                <span className="font-medium">{selectedPersonaDetails.personaName || "-"}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Tone:</span>{" "}
                                <span className="font-medium">{selectedPersonaDetails.tone}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-muted-foreground">Greeting:</span>{" "}
                                <span className="font-mono text-xs">{selectedPersonaDetails.greeting || "-"}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-muted-foreground">Signature:</span>{" "}
                                <span className="font-mono text-xs">{selectedPersonaDetails.signature || "-"}</span>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <Separator />

                        <p className="text-sm text-muted-foreground">
                          Configure global variables used in AI prompt templates.
                        </p>
                        {snippetRegistry && snippetRegistry.length > 0 ? (
                          <div className="space-y-4">
                            {snippetRegistry.map((entry) => (
                              <div key={entry.key} className="border rounded-lg p-4 space-y-2">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-medium text-sm">{entry.label}</p>
                                    <p className="text-xs text-muted-foreground">{entry.description}</p>
                                  </div>
                                  {entry.currentValue !== null && (
                                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                                      Customized
                                    </Badge>
                                  )}
                                </div>

                                {editingSnippet === entry.key ? (
                                  <div className="space-y-2">
                                    {entry.type === "number" ? (
                                      <Input
                                        type="number"
                                        value={snippetEditContent}
                                        onChange={(e) => setSnippetEditContent(e.target.value)}
                                        className="font-mono"
                                      />
                                    ) : (
                                      <Textarea
                                        value={snippetEditContent}
                                        onChange={(e) => setSnippetEditContent(e.target.value)}
                                        className={`font-mono text-xs ${
                                          entry.type === "list" || entry.type === "text" || entry.type === "template"
                                            ? "min-h-[150px]"
                                            : "min-h-[100px]"
                                        }`}
                                        placeholder={entry.type === "list" ? "One item per line..." : undefined}
                                      />
                                    )}
                                    {entry.placeholders && entry.placeholders.length > 0 && (
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>Placeholders:</span>
                                        {entry.placeholders.map((p) => (
                                          <code key={p} className="bg-muted px-1 rounded">{p}</code>
                                        ))}
                                      </div>
                                    )}
                                    <div className="flex justify-end gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          setEditingSnippet(null)
                                          setSnippetEditContent("")
                                        }}
                                      >
                                        Cancel
                                      </Button>
                                      <Button
                                        size="sm"
                                        disabled={savingSnippet || !activeWorkspace}
                                        onClick={async () => {
                                          if (!activeWorkspace) return
                                          setSavingSnippet(true)
                                          const result = await savePromptSnippetOverride(
                                            activeWorkspace,
                                            entry.key,
                                            snippetEditContent
                                          )
                                          if (result.success) {
                                            setSnippetOverrides((prev) => {
                                              const next = new Map(prev)
                                              next.set(entry.key, snippetEditContent)
                                              return next
                                            })
                                            // Update registry
                                            setSnippetRegistry((prev) =>
                                              prev?.map((e) =>
                                                e.key === entry.key
                                                  ? { ...e, currentValue: snippetEditContent }
                                                  : e
                                              ) ?? null
                                            )
                                            setEditingSnippet(null)
                                            setSnippetEditContent("")
                                            toast.success("Variable saved", {
                                              description: `${entry.label} has been updated.`,
                                            })
                                          } else {
                                            toast.error("Error", {
                                              description: result.error || "Failed to save variable",
                                            })
                                          }
                                          setSavingSnippet(false)
                                        }}
                                      >
                                        {savingSnippet ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          "Save"
                                        )}
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <div className="rounded border bg-muted/20 p-2 text-xs max-h-[80px] overflow-y-auto">
                                      <div className="text-muted-foreground whitespace-pre-wrap font-mono">
                                        {entry.currentValue ?? entry.defaultValue}
                                      </div>
                                    </div>
                                    {isWorkspaceAdmin && activeWorkspace && (
                                      <div className="flex items-center gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            setEditingSnippet(entry.key)
                                            setSnippetEditContent(entry.currentValue ?? entry.defaultValue)
                                          }}
                                        >
                                          <Pencil className="h-3 w-3 mr-1" />
                                          Edit
                                        </Button>
                                        {entry.currentValue !== null && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={async () => {
                                              if (!activeWorkspace) return
                                              const result = await resetPromptSnippetOverride(
                                                activeWorkspace,
                                                entry.key
                                              )
                                              if (result.success) {
                                                setSnippetOverrides((prev) => {
                                                  const next = new Map(prev)
                                                  next.delete(entry.key)
                                                  return next
                                                })
                                                setSnippetRegistry((prev) =>
                                                  prev?.map((e) =>
                                                    e.key === entry.key
                                                      ? { ...e, currentValue: null }
                                                      : e
                                                  ) ?? null
                                                )
                                                toast.success("Reset to default", {
                                                  description: `${entry.label} restored to default.`,
                                                })
                                              } else {
                                                toast.error("Error", {
                                                  description: result.error || "Failed to reset variable",
                                                })
                                              }
                                            }}
                                          >
                                            <RotateCcw className="h-3 w-3 mr-1" />
                                            Reset
                                          </Button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">No variables available.</div>
                        )}
                      </div>
                    ) : aiPromptTemplates && aiPromptTemplates.length > 0 ? (
                      /* Prompts Tab Content */
                      <Accordion type="single" collapsible className="w-full">
                        {aiPromptTemplates.map((t) => {
                          // Check if this prompt has any overrides
                          const hasAnyOverride = Array.from(promptOverrides.keys()).some(
                            (key) => key.startsWith(`${t.key}:`)
                          )
                          return (
                            <AccordionItem key={t.key} value={t.key}>
                              <AccordionTrigger>
                                <div className="flex flex-col text-left">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{t.name}</span>
                                    {hasAnyOverride && (
                                      <Badge variant="secondary" className="text-xs">
                                        Modified
                                      </Badge>
                                    )}
                                  </div>
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
                                      {parts.map((p, i) => {
                                        const overrideKey = `${t.key}:${role}:${i}`
                                        const hasOverride = promptOverrides.has(overrideKey)
                                        const displayContent = hasOverride
                                          ? promptOverrides.get(overrideKey)!
                                          : p.content
                                        const isEditing =
                                          editingPrompt?.promptKey === t.key &&
                                          editingPrompt?.role === role &&
                                          editingPrompt?.index === i

                                        return (
                                          <div key={overrideKey} className="space-y-2">
                                            <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-2">
                                                {hasOverride && (
                                                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                                                    Customized
                                                  </Badge>
                                                )}
                                              </div>
                                              <div className="flex items-center gap-1">
                                                {!isEditing && isWorkspaceAdmin && activeWorkspace && (
                                                  <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                      setEditingPrompt({ promptKey: t.key, role, index: i })
                                                      setEditContent(displayContent)
                                                    }}
                                                  >
                                                    <Pencil className="h-3 w-3" />
                                                  </Button>
                                                )}
                                                {hasOverride && !isEditing && isWorkspaceAdmin && activeWorkspace && (
                                                  <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={async () => {
                                                      if (!activeWorkspace) return
                                                      const result = await resetPromptOverride(
                                                        activeWorkspace,
                                                        t.key,
                                                        role,
                                                        i
                                                      )
                                                      if (result.success) {
                                                        setPromptOverrides((prev) => {
                                                          const next = new Map(prev)
                                                          next.delete(overrideKey)
                                                          return next
                                                        })
                                                        toast.success("Reset to default", {
                                                          description: "Prompt restored to original content.",
                                                        })
                                                      } else {
                                                        toast.error("Error", {
                                                          description: result.error || "Failed to reset prompt",
                                                        })
                                                      }
                                                    }}
                                                    title="Reset to default"
                                                  >
                                                    <RotateCcw className="h-3 w-3" />
                                                  </Button>
                                                )}
                                              </div>
                                            </div>

                                            {isEditing ? (
                                              <div className="space-y-2">
                                                <Textarea
                                                  value={editContent}
                                                  onChange={(e) => setEditContent(e.target.value)}
                                                  className="min-h-[200px] font-mono text-xs"
                                                />
                                                <div className="flex justify-end gap-2">
                                                  <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                      setEditingPrompt(null)
                                                      setEditContent("")
                                                    }}
                                                  >
                                                    Cancel
                                                  </Button>
                                                  <Button
                                                    size="sm"
                                                    disabled={savingOverride || !activeWorkspace}
                                                    onClick={async () => {
                                                      if (!activeWorkspace) return
                                                      setSavingOverride(true)
                                                      const result = await savePromptOverride(activeWorkspace, {
                                                        promptKey: t.key,
                                                        role: role as "system" | "assistant" | "user",
                                                        index: i,
                                                        content: editContent,
                                                      })
                                                      if (result.success) {
                                                        setPromptOverrides((prev) => {
                                                          const next = new Map(prev)
                                                          next.set(overrideKey, editContent)
                                                          return next
                                                        })
                                                        setEditingPrompt(null)
                                                        setEditContent("")
                                                        toast.success("Prompt saved", {
                                                          description: "Your changes have been saved.",
                                                        })
                                                      } else {
                                                        toast.error("Error", {
                                                          description: result.error || "Failed to save prompt",
                                                        })
                                                      }
                                                      setSavingOverride(false)
                                                    }}
                                                  >
                                                    {savingOverride ? (
                                                      <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                      "Save"
                                                    )}
                                                  </Button>
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                                                {displayContent}
                                              </div>
                                            )}

                                            {/* Nested Snippet Editor (Phase 47f) */}
                                            {/* Show snippet editor if this message contains {forbiddenTerms} placeholder */}
                                            {displayContent.includes("{forbiddenTerms}") && (
                                              <div className="mt-2 ml-4 border-l-2 border-muted-foreground/20 pl-3">
                                                <button
                                                  type="button"
                                                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                                  onClick={() => {
                                                    setExpandedSnippets((prev) => {
                                                      const next = new Set(prev)
                                                      const key = `${t.key}:forbiddenTerms`
                                                      if (next.has(key)) {
                                                        next.delete(key)
                                                      } else {
                                                        next.add(key)
                                                      }
                                                      return next
                                                    })
                                                  }}
                                                >
                                                  {expandedSnippets.has(`${t.key}:forbiddenTerms`) ? (
                                                    <ChevronDown className="h-3 w-3" />
                                                  ) : (
                                                    <ChevronRight className="h-3 w-3" />
                                                  )}
                                                  <span className="font-mono">{"{forbiddenTerms}"}</span>
                                                  {snippetOverrides.has("forbiddenTerms") && (
                                                    <Badge variant="outline" className="text-[10px] h-4 ml-1 text-amber-600 border-amber-300">
                                                      Customized
                                                    </Badge>
                                                  )}
                                                </button>

                                                {expandedSnippets.has(`${t.key}:forbiddenTerms`) && (
                                                  <div className="mt-2 space-y-2">
                                                    {editingSnippet === "forbiddenTerms" ? (
                                                      <div className="space-y-2">
                                                        <Textarea
                                                          value={snippetEditContent}
                                                          onChange={(e) => setSnippetEditContent(e.target.value)}
                                                          className="min-h-[150px] font-mono text-xs"
                                                          placeholder="One term per line..."
                                                        />
                                                        <div className="flex justify-end gap-2">
                                                          <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                              setEditingSnippet(null)
                                                              setSnippetEditContent("")
                                                            }}
                                                          >
                                                            Cancel
                                                          </Button>
                                                          <Button
                                                            size="sm"
                                                            disabled={savingSnippet || !activeWorkspace}
                                                            onClick={async () => {
                                                              if (!activeWorkspace) return
                                                              setSavingSnippet(true)
                                                              const result = await savePromptSnippetOverride(
                                                                activeWorkspace,
                                                                "forbiddenTerms",
                                                                snippetEditContent
                                                              )
                                                              if (result.success) {
                                                                setSnippetOverrides((prev) => {
                                                                  const next = new Map(prev)
                                                                  next.set("forbiddenTerms", snippetEditContent)
                                                                  return next
                                                                })
                                                                setSnippetRegistry((prev) =>
                                                                  prev?.map((e) =>
                                                                    e.key === "forbiddenTerms"
                                                                      ? { ...e, currentValue: snippetEditContent }
                                                                      : e
                                                                  ) ?? null
                                                                )
                                                                setEditingSnippet(null)
                                                                setSnippetEditContent("")
                                                                toast.success("Snippet saved", {
                                                                  description: "Forbidden terms updated.",
                                                                })
                                                              } else {
                                                                toast.error("Error", {
                                                                  description: result.error || "Failed to save snippet",
                                                                })
                                                              }
                                                              setSavingSnippet(false)
                                                            }}
                                                          >
                                                            {savingSnippet ? (
                                                              <Loader2 className="h-4 w-4 animate-spin" />
                                                            ) : (
                                                              "Save"
                                                            )}
                                                          </Button>
                                                        </div>
                                                      </div>
                                                    ) : (
                                                      <div className="space-y-2">
                                                        <div className="rounded border bg-muted/20 p-2 text-xs max-h-[100px] overflow-y-auto">
                                                          <div className="text-muted-foreground whitespace-pre-wrap">
                                                            {snippetOverrides.get("forbiddenTerms") ||
                                                              snippetRegistry?.find((e) => e.key === "forbiddenTerms")?.defaultValue ||
                                                              "Default forbidden terms not loaded."}
                                                          </div>
                                                        </div>
                                                        {isWorkspaceAdmin && activeWorkspace && (
                                                          <div className="flex items-center gap-1">
                                                            <Button
                                                              variant="ghost"
                                                              size="sm"
                                                              onClick={() => {
                                                                setEditingSnippet("forbiddenTerms")
                                                                setSnippetEditContent(
                                                                  snippetOverrides.get("forbiddenTerms") ||
                                                                    snippetRegistry?.find((e) => e.key === "forbiddenTerms")?.defaultValue ||
                                                                    ""
                                                                )
                                                              }}
                                                            >
                                                              <Pencil className="h-3 w-3 mr-1" />
                                                              Edit
                                                            </Button>
                                                            {snippetOverrides.has("forbiddenTerms") && (
                                                              <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={async () => {
                                                                  if (!activeWorkspace) return
                                                                  const result = await resetPromptSnippetOverride(
                                                                    activeWorkspace,
                                                                    "forbiddenTerms"
                                                                  )
                                                                  if (result.success) {
                                                                    setSnippetOverrides((prev) => {
                                                                      const next = new Map(prev)
                                                                      next.delete("forbiddenTerms")
                                                                      return next
                                                                    })
                                                                    setSnippetRegistry((prev) =>
                                                                      prev?.map((e) =>
                                                                        e.key === "forbiddenTerms"
                                                                          ? { ...e, currentValue: null }
                                                                          : e
                                                                      ) ?? null
                                                                    )
                                                                    toast.success("Reset to default", {
                                                                      description: "Forbidden terms restored to default.",
                                                                    })
                                                                  } else {
                                                                    toast.error("Error", {
                                                                      description: result.error || "Failed to reset snippet",
                                                                    })
                                                                  }
                                                                }}
                                                              >
                                                                <RotateCcw className="h-3 w-3 mr-1" />
                                                                Reset
                                                              </Button>
                                                            )}
                                                          </div>
                                                        )}
                                                      </div>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )
                                })}
                              </AccordionContent>
                            </AccordionItem>
                          )
                        })}
                      </Accordion>
                    ) : (
                      <div className="text-sm text-muted-foreground">No prompt templates available.</div>
                    )}
                  </DialogContent>
                </Dialog>
              </>
            ) : null}
            </fieldset>
          </TabsContent>

          {/* Booking Processes (Phase 36) */}
          <TabsContent value="booking" className="space-y-6">
            <fieldset disabled={isClientPortalUser} className="space-y-6">
            <Alert className="border-amber-500/30 bg-amber-500/5">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <AlertTitle>Booking configuration notes</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                  <li>
                    Process 5 (lead scheduler links) is manual-review for now. We capture the lead&apos;s link and create a task for
                    review with overlap suggestions when possible.
                  </li>
                  <li>
                    Third-party scheduler auto-booking is planned (browser automation). This will ship behind a warning flag.
                  </li>
                </ul>
              </AlertDescription>
            </Alert>

            {/* Booking Processes Reference (Phase 60) */}
            <BookingProcessReference />

            <BookingProcessManager
              activeWorkspace={activeWorkspace}
              qualificationQuestions={qualificationQuestions}
            />

            {/* Campaign Assignment Panel - moved here for booking context */}
            <AiCampaignAssignmentPanel activeWorkspace={activeWorkspace} />

            </fieldset>
          </TabsContent>

          {/* Team Management */}
          <TabsContent value="team" className="space-y-6">
            <fieldset disabled={isClientPortalUser} className="space-y-6">
              {!isClientPortalUser ? (
                <>
                  <WorkspaceMembersManager
                    activeWorkspace={activeWorkspace ?? null}
                    isWorkspaceAdmin={isWorkspaceAdmin}
                  />
                  <ClientPortalUsersManager
                    activeWorkspace={activeWorkspace ?? null}
                    isWorkspaceAdmin={isWorkspaceAdmin}
                  />
                </>
              ) : null}

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
                    <p id="2fa-label" className="font-medium">Two-Factor Authentication</p>
                    <p className="text-sm text-muted-foreground">Require 2FA for all team members</p>
                  </div>
                  <Switch
                    id="2fa-switch"
                    aria-labelledby="2fa-label"
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
            </fieldset>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
