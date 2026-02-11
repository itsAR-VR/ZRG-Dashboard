"use client"

import { useRef, useEffect, useState, useMemo, useCallback } from "react"
import type { Conversation, Channel } from "@/lib/mock-data"
import { ChatMessage } from "./chat-message"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Calendar, ExternalLink, PanelRightOpen, Mail, MapPin, Send, Loader2, Sparkles, RotateCcw, RefreshCw, X, Check, History, MessageSquare, Linkedin, UserCheck, UserPlus, Clock, AlertCircle, AlertTriangle, Moon, Plus, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { sendMessage, sendEmailMessage, sendLinkedInMessage, getPendingDrafts, approveAndSendDraft, rejectDraft, regenerateDraft, fastRegenerateDraft, refreshDraftAvailability, checkLinkedInStatus, type LinkedInStatusResult } from "@/actions/message-actions"
import { validateEmail, formatEmailParticipant, normalizeOptionalEmail } from "@/lib/email-participants"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getCalendarLinkForLead } from "@/actions/settings-actions"
import { toast } from "sonner"
import { useUser } from "@/contexts/user-context"
import { useSearchParams } from "next/navigation"

interface ActionStationProps {
  conversation: Conversation | null
  onToggleCrm: () => void
  isCrmOpen: boolean
  isSyncing?: boolean
  onSync?: (leadId: string) => Promise<void>
  isReanalyzingSentiment?: boolean
  onReanalyzeSentiment?: (leadId: string) => Promise<void>
  isLoadingMessages?: boolean
}

interface AIDraft {
  id: string
  content: string
  status: string
  createdAt: Date
  channel?: "sms" | "email" | "linkedin"
  autoSendEvaluatedAt?: Date | null
  autoSendConfidence?: number | null
  autoSendThreshold?: number | null
  autoSendReason?: string | null
  autoSendAction?: string | null
  autoSendSlackNotified?: boolean | null
}

const CHANNEL_ICONS = {
  sms: MessageSquare,
  email: Mail,
  linkedin: Linkedin,
} as const;

const CHANNEL_LABELS = {
  sms: "SMS",
  email: "Email",
  linkedin: "LinkedIn",
} as const;

type EmailRecipientOption = {
  email: string
  name: string | null
}

function getSendFailureMessage(channel: Channel): string {
  if (channel === "linkedin") return "LinkedIn send failed. Check connection status and try again."
  if (channel === "email") return "Email send failed. Check recipient details and try again."
  return "SMS send failed. Please try again."
}

// Phase 50: Email recipient editor for CC management
interface EmailRecipientEditorProps {
  toEmail: string
  toOptions: EmailRecipientOption[]
  onToEmailChange: (email: string) => void
  toDisabled?: boolean
  toDisabledReason?: string | null
  ccList: string[]
  onCcChange: (cc: string[]) => void
  ccInput: string
  onCcInputChange: (value: string) => void
  disabled?: boolean
}

function EmailRecipientEditor({
  toEmail,
  toOptions,
  onToEmailChange,
  toDisabled = false,
  toDisabledReason = null,
  ccList,
  onCcChange,
  ccInput,
  onCcInputChange,
  disabled = false,
}: EmailRecipientEditorProps) {
  const toFieldId = "email-recipient-to"
  const toWarningId = "email-recipient-warning"
  const ccInputId = "email-recipient-cc"

  const handleAddCc = () => {
    const trimmed = ccInput.trim().toLowerCase()
    if (trimmed && validateEmail(trimmed) && !ccList.some(e => e.toLowerCase() === trimmed)) {
      onCcChange([...ccList, trimmed])
      onCcInputChange("")
    }
  }

  const handleRemoveCc = (email: string) => {
    onCcChange(ccList.filter(e => e.toLowerCase() !== email.toLowerCase()))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleAddCc()
    }
  }

  return (
    <div className="text-xs border rounded-md p-3 mb-3 bg-muted/30 space-y-2">
      {/* To field (editable single-select) */}
      <div className="flex items-center gap-2">
        <span className="font-medium text-muted-foreground w-8">To:</span>
        <div className="flex-1">
          <Select
            value={toEmail || undefined}
            onValueChange={onToEmailChange}
            disabled={disabled || toDisabled || toOptions.length === 0}
          >
            <SelectTrigger
              id={toFieldId}
              className="h-7 text-xs"
              aria-label="To recipient"
              aria-describedby={!toEmail ? toWarningId : undefined}
            >
              <SelectValue placeholder="Select recipient" />
            </SelectTrigger>
            <SelectContent>
              {toOptions.map((opt) => (
                <SelectItem key={opt.email} value={opt.email}>
                  {formatEmailParticipant(opt.email, opt.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {toDisabledReason ? <div className="ml-10 text-[11px] text-muted-foreground">{toDisabledReason}</div> : null}

      {/* CC field (editable) */}
      <div className="flex items-start gap-2">
        <span className="font-medium text-muted-foreground w-8 pt-1">CC:</span>
        <div className="flex-1 flex flex-wrap gap-1.5 items-center">
          {ccList.map((email) => (
            <Badge
              key={email}
              variant="outline"
              className="font-normal pr-1 gap-1"
            >
              {email}
              {!disabled && (
                <button
                  onClick={() => handleRemoveCc(email)}
                  className="hover:bg-destructive/20 rounded-full p-0.5"
                  type="button"
                  aria-label="Remove CC recipient"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
          {!disabled && (
            <div className="flex items-center gap-1">
              <Input
                id={ccInputId}
                type="email"
                placeholder="Add CC..."
                value={ccInput}
                onChange={(e) => onCcInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-6 w-32 text-xs"
                aria-label="CC recipient"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAddCc}
                disabled={!ccInput.trim() || !validateEmail(ccInput.trim())}
                className="h-6 w-6 p-0"
                aria-label="Add CC recipient"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          )}
          {ccList.length === 0 && disabled && (
            <span className="text-muted-foreground">None</span>
          )}
        </div>
      </div>
      {!toEmail && (
        <div id={toWarningId} className="flex items-center gap-1.5 text-xs text-amber-600">
          <AlertCircle className="h-3.5 w-3.5" />
          Select a recipient to send email
        </div>
      )}
    </div>
  )
}

export function ActionStation({ 
  conversation, 
  onToggleCrm, 
  isCrmOpen, 
  isSyncing = false, 
  onSync, 
  isReanalyzingSentiment = false,
  onReanalyzeSentiment,
  isLoadingMessages = false,
}: ActionStationProps) {
  const searchParams = useSearchParams()
  const deepLinkedDraftId = searchParams.get("draftId")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const shouldScrollRef = useRef(true)
  const prevConversationIdRef = useRef<string | null>(null)
  const prevMessageCountRef = useRef(0)
  const draftFetchSeqRef = useRef(0)
  const conversationMessagesRef = useRef<Conversation["messages"]>([])
  const composeMessageRef = useRef("")
  const originalDraftRef = useRef("")
  const [composeMessage, setComposeMessage] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [isRegeneratingFast, setIsRegeneratingFast] = useState(false)
  const [isRegeneratingFull, setIsRegeneratingFull] = useState(false)
  const [isRefreshingAvailability, setIsRefreshingAvailability] = useState(false)
  const [drafts, setDrafts] = useState<AIDraft[]>([])
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false)
  const [hasAiDraft, setHasAiDraft] = useState(false)
  const [originalDraft, setOriginalDraft] = useState("")
  const [fastRegenCycleSeed, setFastRegenCycleSeed] = useState<string | null>(null)
  const [fastRegenCount, setFastRegenCount] = useState(0)
  const [activeChannel, setActiveChannel] = useState<Channel>("sms")
  const [linkedInStatus, setLinkedInStatus] = useState<LinkedInStatusResult | null>(null)
  const [isLoadingLinkedInStatus, setIsLoadingLinkedInStatus] = useState(false)
  const [connectionNote, setConnectionNote] = useState("")
  // Phase 50: CC recipient editing state
  const [ccRecipients, setCcRecipients] = useState<string[]>([])
  const [ccInput, setCcInput] = useState("")
  // Phase 74: Editable To recipient (single-select)
  const [toEmail, setToEmail] = useState("")
  const [hasEditedTo, setHasEditedTo] = useState(false)
  const { user } = useUser()

  const isRegenerating = isRegeneratingFast || isRegeneratingFull
  
  // Determine current channel type
  const isEmail = activeChannel === "email"
  const isLinkedIn = activeChannel === "linkedin"
  
  // Get available channels for this conversation
  const channels = conversation?.channels || ["sms"]
  const availableChannels = conversation?.availableChannels || ["sms"]
  
  // Check if LinkedIn is available (lead has linkedinUrl)
  const hasLinkedIn = conversation?.lead?.linkedinUrl !== undefined && conversation?.lead?.linkedinUrl !== null
  const isLinkedInSendBlocked = isLinkedIn && !hasLinkedIn
  
  // Calculate message counts per channel
  const messageCounts = useMemo(() => {
    const counts: Record<Channel, number> = { sms: 0, email: 0, linkedin: 0 }
    if (!conversation?.messages) return counts
    
    for (const msg of conversation.messages) {
      const ch = msg.channel || "sms"
      counts[ch] = (counts[ch] || 0) + 1
    }
    return counts
  }, [conversation?.messages])
  
  // Filter messages by active channel
  const filteredMessages = useMemo(() => {
    if (!conversation?.messages) return []
    return conversation.messages.filter(msg => (msg.channel || "sms") === activeChannel)
  }, [conversation?.messages, activeChannel])

  const latestInboundEmail = useMemo(() => {
    if (!conversation?.messages?.length) return null

    let latest: Conversation["messages"][number] | null = null
    let latestAt = 0

    for (const message of conversation.messages) {
      if (message.direction !== "inbound" || message.channel !== "email") continue
      const ts = new Date(message.timestamp).getTime()
      if (!Number.isFinite(ts)) continue
      if (!latest || ts > latestAt) {
        latest = message
        latestAt = ts
      }
    }

    return latest
  }, [conversation?.messages])

  const emailThreadProvider = useMemo(() => {
    const replyId = typeof latestInboundEmail?.emailBisonReplyId === "string" ? latestInboundEmail.emailBisonReplyId : ""
    if (!replyId) return null
    if (replyId.startsWith("instantly:")) return "instantly"
    if (replyId.startsWith("smartlead:")) return "smartlead"
    return "emailbison"
  }, [latestInboundEmail?.emailBisonReplyId])

  const toOptions = useMemo<EmailRecipientOption[]>(() => {
    const lead = conversation?.lead
    if (!lead?.email) return []

    const options: EmailRecipientOption[] = []
    const seen = new Set<string>()

    const push = (email: string | null | undefined, name: string | null | undefined) => {
      const normalized = normalizeOptionalEmail(email)
      if (!normalized) return
      if (seen.has(normalized)) return
      seen.add(normalized)
      options.push({ email: normalized, name: name?.trim() ? name.trim() : null })
    }

    // Prefer the current replier (if set), then latest inbound sender, then lead primary.
    push(lead.currentReplierEmail, lead.currentReplierName)
    push(latestInboundEmail?.fromEmail, latestInboundEmail?.fromName ?? null)
    push(lead.email, lead.name)

    // Include alternates as valid selectable recipients (names unknown).
    for (const alt of lead.alternateEmails || []) {
      push(alt, null)
    }

    return options
  }, [
    conversation?.lead,
    latestInboundEmail?.fromEmail,
    latestInboundEmail?.fromName,
  ])

  const selectedToName = useMemo(() => {
    const normalized = normalizeOptionalEmail(toEmail)
    if (!normalized) return null
    return toOptions.find((opt) => opt.email === normalized)?.name ?? null
  }, [toEmail, toOptions])

  const toDisabledReason =
    emailThreadProvider === "instantly" ? "Instantly replies do not support overriding the To recipient." : null
  
  // Reset active channel when conversation changes
  useEffect(() => {
    if (conversation?.primaryChannel) {
      setActiveChannel(conversation.primaryChannel)
    } else if (channels.length > 0) {
      setActiveChannel(channels[0])
    }
  }, [conversation?.id, conversation?.primaryChannel, channels])

  // Reset editable To selection when switching conversations
  useEffect(() => {
    setHasEditedTo(false)
  }, [conversation?.id])

  // Initialize default To selection (unless the user has explicitly edited it).
  useEffect(() => {
    if (!conversation || activeChannel !== "email") return
    if (hasEditedTo) return
    const next = toOptions[0]?.email || ""
    if (next !== toEmail) setToEmail(next)
  }, [conversation, activeChannel, hasEditedTo, toOptions, toEmail])

  useEffect(() => {
    conversationMessagesRef.current = conversation?.messages || []
  }, [conversation?.messages])

  useEffect(() => {
    composeMessageRef.current = composeMessage
  }, [composeMessage])

  useEffect(() => {
    originalDraftRef.current = originalDraft
  }, [originalDraft])

  // Phase 50: Initialize CC recipients from latest inbound email when channel/conversation/messages change
  // Use conversation?.messages directly (not ref) so CC updates when new emails arrive
  useEffect(() => {
    const messages = conversation?.messages || []
    if (activeChannel === "email" && messages.length > 0) {
      const latestInbound = messages
        .filter(m => m.direction === "inbound" && m.channel === "email")
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0]

      if (latestInbound?.cc?.length) {
        setCcRecipients(latestInbound.cc)
      } else {
        setCcRecipients([])
      }
    } else {
      setCcRecipients([])
    }
    setCcInput("")
  }, [conversation?.id, conversation?.messages, activeChannel])

  // Scroll to bottom only on initial load or when user sends a message
  // NOT during background polling updates to preserve scroll position
  useEffect(() => {
    const currentConversationId = conversation?.id || null
    const currentMessageCount = conversation?.messages?.length || 0
    
    // Scroll when:
    // 1. Conversation changed (user switched conversations)
    // 2. Message count increased AND shouldScrollRef is true (user sent a message)
    const conversationChanged = currentConversationId !== prevConversationIdRef.current
    const messageAdded = currentMessageCount > prevMessageCountRef.current
    
    if (conversationChanged) {
      // Always scroll when switching conversations
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
      shouldScrollRef.current = false
    } else if (messageAdded && shouldScrollRef.current) {
      // Only scroll for new messages if explicitly requested (e.g., user sent a message)
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
      shouldScrollRef.current = false
    }
    
    // Update refs for next comparison
    prevConversationIdRef.current = currentConversationId
    prevMessageCountRef.current = currentMessageCount
  }, [conversation?.id, conversation?.messages])

  const fetchLinkedInStatus = useCallback(
    async (isCancelled?: () => boolean) => {
      const cancelled = () => Boolean(isCancelled?.())
      const conversationId = conversation?.id ?? null

      if (!conversationId || activeChannel !== "linkedin" || !hasLinkedIn) {
        if (cancelled()) return
        setLinkedInStatus(null)
        return
      }

      if (cancelled()) return
      setIsLoadingLinkedInStatus(true)
      try {
        const result = await checkLinkedInStatus(conversationId)
        if (cancelled()) return
        setLinkedInStatus(result)
      } catch (error) {
        if (cancelled()) return
        console.error("[ActionStation] Failed to fetch LinkedIn status:", error)
        setLinkedInStatus({
          success: false,
          error: "Network issue while checking LinkedIn status",
          connectionStatus: "NOT_CONNECTED",
          canSendDM: false,
          canSendInMail: false,
          hasOpenProfile: false,
          inMailBalance: null,
        })
      } finally {
        if (!cancelled()) {
          setIsLoadingLinkedInStatus(false)
        }
      }
    },
    [conversation?.id, activeChannel, hasLinkedIn]
  )

  // Fetch LinkedIn connection status when LinkedIn tab is active
  useEffect(() => {
    let cancelled = false
    void fetchLinkedInStatus(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [fetchLinkedInStatus])

  // Fetch real AI drafts when conversation or active channel changes
  useEffect(() => {
    let cancelled = false
    const requestSeq = draftFetchSeqRef.current + 1
    draftFetchSeqRef.current = requestSeq

    async function fetchDrafts() {
      if (!conversation) {
        setDrafts([])
        setComposeMessage("")
        setHasAiDraft(false)
        setOriginalDraft("")
        setFastRegenCycleSeed(null)
        setFastRegenCount(0)
        return
      }

      console.log("[ActionStation] Fetching drafts for conversation:", conversation.id, "channel:", activeChannel)
      setIsLoadingDrafts(true)
      const result = await getPendingDrafts(conversation.id, activeChannel)
      if (cancelled || requestSeq !== draftFetchSeqRef.current) return
      console.log("[ActionStation] Draft fetch result:", result)
      
      if (result.success && result.data && result.data.length > 0) {
        const draftData = result.data as AIDraft[]
        // If we were deep-linked from Slack, prefer the referenced draft to avoid mismatch.
        const preferredDrafts =
          deepLinkedDraftId && draftData.some((draft) => draft.id === deepLinkedDraftId)
            ? [...draftData].sort((a, b) => (a.id === deepLinkedDraftId ? -1 : b.id === deepLinkedDraftId ? 1 : 0))
            : draftData
        console.log("[ActionStation] Found drafts:", preferredDrafts.length, "First draft:", preferredDrafts[0]?.content?.substring(0, 50))
        setDrafts(preferredDrafts)
        const nextDraftContent = preferredDrafts[0].content
        const canAutoPopulate =
          !composeMessageRef.current.trim() || composeMessageRef.current === originalDraftRef.current
        if (canAutoPopulate) {
          setComposeMessage(nextDraftContent)
          setOriginalDraft(nextDraftContent)
        }
        setHasAiDraft(true)
        setFastRegenCycleSeed(preferredDrafts[0].id)
        setFastRegenCount(0)
      } else {
        // No drafts found
        console.log("[ActionStation] No drafts found")
        setComposeMessage("")
        setOriginalDraft("")
        setHasAiDraft(false)
        setDrafts([])
        setFastRegenCycleSeed(null)
        setFastRegenCount(0)
      }
      if (!cancelled && requestSeq === draftFetchSeqRef.current) {
        setIsLoadingDrafts(false)
      }
    }

    fetchDrafts()
    return () => {
      cancelled = true
    }
  }, [conversation?.id, activeChannel, deepLinkedDraftId, conversation?.lead?.sentimentTag])

  const handleSendMessage = async () => {
    if (isSending || isRegenerating) return
    if (!composeMessage.trim() || !conversation) return
    if (isLinkedInSendBlocked) {
      toast.error("No LinkedIn profile found for this lead.")
      return
    }
    if (isEmail && !toEmail) {
      toast.error("Select a recipient before sending.")
      return
    }

    setIsSending(true)
    
    let result
    if (isLinkedIn) {
      // Send via LinkedIn/Unipile with optional connection note
      result = await sendLinkedInMessage(
        conversation.id, 
        composeMessage, 
        connectionNote || undefined  // Use custom note if provided
      )
      if (result.success) {
        const messageType = result.messageType === "dm" ? "DM" : 
                           result.messageType === "inmail" ? "InMail" : 
                           result.messageType === "connection_request" ? "Connection Request" : "message"
        toast.success(`LinkedIn ${messageType} sent!`)
        setConnectionNote("") // Clear connection note after sending
      }
    } else if (isEmail) {
      // Manual email reply (no AI draft required)
      // Phase 50: Pass CC recipients to send action
      result = await sendEmailMessage(conversation.id, composeMessage, {
        cc: ccRecipients,
        ...(hasEditedTo ? { toEmail, toName: selectedToName } : {}),
      })
      if (result.success) {
        toast.success("Email sent!")
      }
    } else {
      // Regular SMS send
      result = await sendMessage(conversation.id, composeMessage)
      if (result.success) {
        toast.success("Message sent!")
      }
    }
    
    if (result.success) {
      setComposeMessage("")
      setDrafts([])
      setHasAiDraft(false)
      setOriginalDraft("")
      // Scroll to bottom to show the sent message
      shouldScrollRef.current = true
    } else {
      toast.error(result.error || getSendFailureMessage(activeChannel))
    }
    
    setIsSending(false)
  }

  const handleApproveAndSend = async () => {
    if (isSending || isRegenerating) return
    if (!composeMessage.trim() || !conversation) return
    if (isLinkedInSendBlocked) {
      toast.error("No LinkedIn profile found for this lead.")
      return
    }
    if (isEmail && !toEmail) {
      toast.error("Select a recipient before sending.")
      return
    }

    if (isEmail && drafts.length === 0) {
      toast.error("No email draft available to approve.")
      return
    }

    setIsSending(true)
    
    // If we have a real AI draft, approve it
    // Phase 50: Pass CC recipients to draft approval for email channel
    if (drafts.length > 0) {
      const result = await approveAndSendDraft(
        drafts[0].id,
        composeMessage,
        isEmail
          ? {
              cc: ccRecipients,
              ...(hasEditedTo ? { toEmail, toName: selectedToName } : {}),
            }
          : undefined
      )
      if (result.success) {
        toast.success("Draft approved and sent!")
        setComposeMessage("")
        setDrafts([])
        setHasAiDraft(false)
        setOriginalDraft("")
        // Scroll to bottom to show the sent message
        shouldScrollRef.current = true
      } else {
        toast.error(result.error || getSendFailureMessage(activeChannel))
      }
    } else {
      // Fallback to regular send
      const result = await sendMessage(conversation.id, composeMessage)
      if (result.success) {
        toast.success("Message sent!")
        setComposeMessage("")
        setHasAiDraft(false)
        setOriginalDraft("")
        // Scroll to bottom to show the sent message
        shouldScrollRef.current = true
      } else {
        toast.error(result.error || getSendFailureMessage(activeChannel))
      }
    }
    
    setIsSending(false)
  }

  const handleInsertCalendarLink = async () => {
    if (!conversation) return
    try {
      const result = await getCalendarLinkForLead(conversation.id)
      if (!result.success || !result.url) {
        toast.error(result.error || "No calendar link configured")
        return
      }

      setComposeMessage((prev) => {
        const needsGap = prev.trim().length > 0 && !prev.endsWith("\n")
        const separator = needsGap ? "\n\n" : ""
        return `${prev}${separator}${result.url}`
      })
    } catch (error) {
      console.error("[ActionStation] Failed to insert calendar link:", error)
      toast.error("Failed to insert calendar link")
    }
  }

  const handleRejectDraft = async () => {
    if (drafts.length > 0) {
      const result = await rejectDraft(drafts[0].id)
      if (result.success) {
        toast.success("Draft rejected")
        setDrafts([])
      } else {
        toast.error(result.error || "Failed to reject draft")
      }
    }
    setComposeMessage("")
    setHasAiDraft(false)
    setOriginalDraft("")
  }

  const handleFastRegenerateDraft = async () => {
    if (!conversation) return

    setIsRegeneratingFast(true)

    const cycleSeed = fastRegenCycleSeed || drafts[0]?.id || null
    const regenCount = fastRegenCount

    const result = await fastRegenerateDraft(
      conversation.id,
      activeChannel,
      activeChannel === "email" && cycleSeed ? { cycleSeed, regenCount } : undefined
    )

    if (result.success && result.data) {
      toast.success("Fast regenerated!")
      setDrafts([
        {
          id: result.data.id,
          content: result.data.content,
          status: "pending",
          createdAt: new Date(),
        },
      ])
      setComposeMessage(result.data.content)
      setOriginalDraft(result.data.content)
      setHasAiDraft(true)
      if (activeChannel === "email" && cycleSeed) {
        setFastRegenCycleSeed(cycleSeed)
        setFastRegenCount(regenCount + 1)
      }
    } else {
      toast.error(result.error || "Failed to regenerate draft")
    }

    setIsRegeneratingFast(false)
  }

  const handleFullRegenerateDraft = async () => {
    if (!conversation) return

    setIsRegeneratingFull(true)

    const result = await regenerateDraft(conversation.id, activeChannel)

    if (result.success && result.data) {
      toast.success("New AI draft generated!")
      setDrafts([
        {
          id: result.data.id,
          content: result.data.content,
          status: "pending",
          createdAt: new Date(),
        },
      ])
      setComposeMessage(result.data.content)
      setOriginalDraft(result.data.content)
      setHasAiDraft(true)
      setFastRegenCycleSeed(result.data.id)
      setFastRegenCount(0)
    } else {
      toast.error(result.error || "Failed to generate draft")
    }

    setIsRegeneratingFull(false)
  }

  const handleRefreshAvailability = async () => {
    if (!drafts.length) return

    setIsRefreshingAvailability(true)

    const result = await refreshDraftAvailability(drafts[0].id, composeMessage)

    if (result.success && result.content) {
      const count = result.newSlots?.length || 0
      if (count === 0) {
        toast.info("Availability times are already current")
      } else {
        toast.success(`Refreshed ${count} time${count === 1 ? "" : "s"}`)
      }
      setComposeMessage(result.content)
      setOriginalDraft(result.content)
      setDrafts(prev => prev.map(d =>
        d.id === drafts[0].id ? { ...d, content: result.content! } : d
      ))
    } else {
      if (result.error?.includes("No time options found")) {
        toast.warning(result.error)
      } else {
        toast.error(result.error || "Failed to refresh availability")
      }
    }

    setIsRefreshingAvailability(false)
  }

  const handleResetDraft = () => {
    setComposeMessage(originalDraft)
  }

  const handleSyncHistory = async () => {
    if (!conversation) return

    // Use parent's sync handler if provided (works for both SMS and Email)
    if (onSync) {
      await onSync(conversation.id)
    }
  }

  const handleReanalyzeSentiment = async () => {
    if (!conversation) return
    if (onReanalyzeSentiment) {
      await onReanalyzeSentiment(conversation.id)
    }
  }

  const isEdited = hasAiDraft && composeMessage !== originalDraft

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background text-muted-foreground">
        Select a conversation to view details
      </div>
    )
  }

  const { lead } = conversation
  const subjectLine = conversation.lastSubject
  const workspaceName = lead.company
  const smsClient = lead.smsCampaignName?.trim() || null
  const isSmsAccountWorkspace = ["owen", "uday 18th", "uday18th", "u-day 18th"].includes(
    workspaceName.toLowerCase()
  )
  const workspaceLabel = smsClient
    ? `${workspaceName} • Client: ${smsClient}`
    : isSmsAccountWorkspace
      ? `${workspaceName} • Client: Unattributed`
      : workspaceName

  const getScoreColor = (score: number) => {
    if (score >= 80) return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
    if (score >= 50) return "bg-amber-500/10 text-amber-500 border-amber-500/20"
    return "bg-destructive/10 text-destructive border-destructive/20"
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{lead.name}</h2>
              <Badge variant="outline" className={cn("text-xs", getScoreColor(lead.leadScore))}>
                Score: {lead.leadScore}
              </Badge>
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
            <p className="text-sm text-muted-foreground">
              {lead.title ? `${lead.title} at ` : ""}
              {lead.website ? (
                <a
                  href={lead.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {workspaceLabel}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span>{workspaceLabel}</span>
              )}
            </p>
            {subjectLine && (
              <p className="text-xs text-muted-foreground mt-1">Subject: {subjectLine}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-4 mr-4 text-sm text-muted-foreground">
            {lead.email && (
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                {lead.email}
              </span>
            )}
            {lead.timezone && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {lead.timezone}
              </span>
            )}
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleSyncHistory}
            disabled={isSyncing || isReanalyzingSentiment}
            title={isEmail ? "Sync email conversation from EmailBison" : "Sync conversation history from GHL"}
            className="h-11 min-h-[44px]"
          >
            {isSyncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <History className="mr-2 h-4 w-4" />
            )}
            Sync
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReanalyzeSentiment}
            disabled={isSyncing || isReanalyzingSentiment}
            title="Re-analyze sentiment for this conversation"
            className="h-11 min-h-[44px]"
          >
            {isReanalyzingSentiment ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Re-analyze Sentiment
          </Button>
          <Button
            variant={isCrmOpen ? "secondary" : "outline"}
            size="sm"
            onClick={onToggleCrm}
            className="h-11 min-h-[44px]"
          >
            <PanelRightOpen className="mr-2 h-4 w-4" />
            CRM
          </Button>
        </div>
      </header>

      {/* Channel Tabs */}
      {channels.length > 0 && (
        <div className="border-b border-border px-6 py-2 bg-muted/30">
          <Tabs value={activeChannel} onValueChange={(v) => setActiveChannel(v as Channel)}>
            <TabsList className="h-11">
              {availableChannels.map((ch) => {
                const Icon = CHANNEL_ICONS[ch]
                const count = messageCounts[ch]
                const hasMessages = count > 0
                
                // LinkedIn is now enabled if lead has linkedinUrl
                const isLinkedInChannel = ch === "linkedin"
                const linkedInEnabled = isLinkedInChannel ? (hasLinkedIn || hasMessages) : true
                
                return (
                  <TabsTrigger 
                    key={ch} 
                    value={ch}
                    disabled={isLinkedInChannel ? (!linkedInEnabled && ch !== activeChannel) : false}
                    className={cn(
                      "text-xs gap-1.5 px-3 min-h-[44px]",
                      isLinkedInChannel && !linkedInEnabled && "opacity-50"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {CHANNEL_LABELS[ch]}
                    {hasMessages && (
                      <Badge 
                        variant="secondary" 
                        className="ml-1 h-4 px-1 text-[10px] font-normal"
                      >
                        {count}
                      </Badge>
                    )}
                    {ch === "linkedin" && !linkedInEnabled && (
                      <span className="text-[10px] text-muted-foreground ml-1">(no profile)</span>
                    )}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* LinkedIn Status Bar */}
      {isLinkedIn && hasLinkedIn && (
        <div className="border-b border-border px-6 py-2 bg-muted/20 flex items-center gap-3 flex-wrap">
          {isLoadingLinkedInStatus ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking LinkedIn status...
            </div>
          ) : linkedInStatus?.success ? (
            <>
              {/* Connection Status Badge */}
              <Badge 
                variant="outline" 
                className={cn(
                  "text-xs gap-1",
                  linkedInStatus.connectionStatus === "CONNECTED" && "bg-green-500/10 text-green-600 border-green-500/30",
                  linkedInStatus.connectionStatus === "PENDING" && "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
                  linkedInStatus.connectionStatus === "NOT_CONNECTED" && "bg-muted text-muted-foreground"
                )}
              >
                {linkedInStatus.connectionStatus === "CONNECTED" && (
                  <>
                    <UserCheck className="h-3 w-3" />
                    Connected
                  </>
                )}
                {linkedInStatus.connectionStatus === "PENDING" && (
                  <>
                    <Clock className="h-3 w-3" />
                    Connection Pending
                  </>
                )}
                {linkedInStatus.connectionStatus === "NOT_CONNECTED" && (
                  <>
                    <UserPlus className="h-3 w-3" />
                    Not Connected
                  </>
                )}
              </Badge>

              {/* Open Profile Badge */}
              {linkedInStatus.hasOpenProfile && (
                <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/30">
                  Open Profile
                </Badge>
              )}

              {/* InMail Balance */}
              {linkedInStatus.inMailBalance && (
                <span className="text-xs text-muted-foreground">
                  {linkedInStatus.inMailBalance.available} InMails available
                </span>
              )}

              {/* Messaging hint */}
              <span className="text-xs font-medium text-muted-foreground ml-auto">
                {linkedInStatus.canSendDM && "Will send DM"}
                {!linkedInStatus.canSendDM && linkedInStatus.canSendInMail && "Will send InMail"}
                {!linkedInStatus.canSendDM && !linkedInStatus.canSendInMail && "Will send Connection Request"}
              </span>
            </>
          ) : linkedInStatus?.error ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              <span>Unable to check LinkedIn status.</span>
              <span className="text-muted-foreground/80">{linkedInStatus.error}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  void fetchLinkedInStatus()
                }}
                disabled={isLoadingLinkedInStatus}
              >
                Retry
              </Button>
              <span className="text-[11px] text-muted-foreground/80">Send mode unknown until status is available.</span>
            </div>
          ) : null}
        </div>
      )}

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isLoadingMessages ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredMessages.length > 0 ? (
          filteredMessages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              leadName={lead.name}
              leadEmail={lead.email}
              userName={user?.fullName || "You"}
              userAvatar={user?.avatarUrl}
            />
          ))
        ) : (
          <div className="text-center text-muted-foreground py-8">
            <div className="space-y-2">
              <p>No {CHANNEL_LABELS[activeChannel]} messages yet</p>
              {channels.length > 1 && (
                <p className="text-xs">
                  Try switching to another channel to see other messages
                </p>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Compose Box with integrated AI Draft */}
      <div className="border-t border-border p-4">
        <div className="sr-only" role="status" aria-live="polite">
          {isLoadingDrafts ? "Loading drafts. " : ""}
          {isRegenerating ? "Regenerating draft. " : ""}
          {isSending ? "Sending message." : ""}
        </div>

        {/* Compose with AI button - shown when no draft exists */}
        {!hasAiDraft && (
          <div className="flex justify-end mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleFullRegenerateDraft}
              disabled={isRegenerating || isLoadingDrafts}
              className="text-xs"
            >
              {isLoadingDrafts ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : isRegeneratingFull ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              )}
              {isLoadingDrafts ? "Loading draft..." : "Compose with AI"}
            </Button>
          </div>
        )}

        {/* Phase 50: Email Recipient Editor - shown when email channel is active */}
        {isEmail && lead?.email && (
          <EmailRecipientEditor
            toEmail={toEmail}
            toOptions={toOptions}
            onToEmailChange={(email) => {
              setHasEditedTo(true)
              setToEmail(email)
            }}
            toDisabled={emailThreadProvider === "instantly"}
            toDisabledReason={toDisabledReason}
            ccList={ccRecipients}
            onCcChange={setCcRecipients}
            ccInput={ccInput}
            onCcInputChange={setCcInput}
            disabled={isSending}
          />
        )}
        {isEmail && !lead?.email ? (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            No recipient email found for this lead. Add an email in CRM before sending.
          </div>
        ) : null}
        {isLinkedInSendBlocked ? (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            LinkedIn send is unavailable because this lead has no LinkedIn profile.
          </div>
        ) : null}

        {/* Connection Note Field - shown when LinkedIn is active and not connected */}
        {isLinkedIn && linkedInStatus?.success && linkedInStatus.connectionStatus === "NOT_CONNECTED" && (
          <div className="mb-3 p-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Connection Request Note</span>
              <span className="text-[10px] text-muted-foreground">(max 300 chars)</span>
            </div>
            <Textarea
              placeholder="Add a personalized note for your connection request... (optional - message will be used if empty)"
              value={connectionNote}
              onChange={(e) => setConnectionNote(e.target.value.slice(0, 300))}
              className="min-h-[60px] text-sm resize-none bg-background"
            />
            <div className="flex justify-end mt-1">
              <span className={cn(
                "text-[10px]",
                connectionNote.length > 280 ? "text-amber-500" : "text-muted-foreground"
              )}>
                {connectionNote.length}/300
              </span>
            </div>
          </div>
        )}

        {/* AI Draft indicator and actions */}
        {hasAiDraft && (
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center gap-1.5 text-xs text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              <span className="font-medium">AI Suggested Reply</span>
            </div>
            {isEdited && (
              <span className="text-xs text-muted-foreground">(edited)</span>
            )}
            <div className="flex-1" />
            {isEdited && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetDraft}
                className="h-6 px-2 text-xs text-muted-foreground"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            )}
          </div>
        )}

        {/* Phase 70: Show auto-send confidence + reasoning for drafts requiring review */}
        {hasAiDraft && drafts[0]?.autoSendAction === "needs_review" ? (
          <Alert variant="destructive" className="mb-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="flex items-center justify-between">
              <span>AI Auto-Send Needs Review</span>
              {typeof drafts[0].autoSendConfidence === "number" ? (
                <Badge variant="outline" className="ml-2">
                  {Math.round(drafts[0].autoSendConfidence * 100)}% confidence
                </Badge>
              ) : null}
            </AlertTitle>
            <AlertDescription className="mt-2 text-foreground">
              <p className="text-sm">
                {drafts[0].autoSendReason || "This draft needs manual review before sending."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleRejectDraft}
                  disabled={isSending || isRegenerating}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleApproveAndSend}
                  disabled={!composeMessage.trim() || isSending || isRegenerating || (isEmail && !toEmail) || isLinkedInSendBlocked}
                >
                  Approve & Send
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        
        <div className="flex gap-2">
          <Textarea
            placeholder="Type your message..."
            value={composeMessage}
            onChange={(e) => setComposeMessage(e.target.value)}
            className={cn(
              "min-h-[80px] resize-none",
              hasAiDraft && "border-primary/30 bg-primary/5"
            )}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.key === "Process") return
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                if (isSending || isRegenerating) return
                if (isEmail && !toEmail) {
                  toast.error("Select a recipient before sending.")
                  return
                }
                if (hasAiDraft) {
                  handleApproveAndSend()
                } else {
                  handleSendMessage()
                }
              }
            }}
          />
          
          {/* Action buttons */}
          <div className="flex flex-col gap-1.5 self-end">
            {hasAiDraft ? (
              <>
                {/* Insert calendar link */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleInsertCalendarLink}
                  disabled={isSending || isRegenerating}
                  className="h-11 w-11 min-h-[44px] min-w-[44px]"
                  aria-label="Insert calendar link"
                >
                  <Calendar className="h-4 w-4" />
                </Button>

                {/* Refresh Availability button */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleRefreshAvailability}
                  disabled={isSending || isRegenerating || isRefreshingAvailability}
                  className="h-11 w-11 min-h-[44px] min-w-[44px]"
                  aria-label="Refresh availability times"
                  title="Refresh availability times"
                >
                  {isRefreshingAvailability ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Clock className="h-4 w-4" />
                  )}
                </Button>

                {/* Reject button */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleRejectDraft}
                  disabled={isSending || isRegenerating}
                  className="h-11 w-11 min-h-[44px] min-w-[44px]"
                  aria-label="Reject draft"
                >
                  <X className="h-4 w-4" />
                </Button>

                {/* Fast regen + full regen */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFastRegenerateDraft}
                  disabled={isSending || isRegenerating}
                  className="h-11 px-3 min-h-[44px]"
                  title="Fast regenerate (rewrite previous draft)"
                >
                  {isRegeneratingFast ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  Fast Regen
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFullRegenerateDraft}
                  disabled={isSending || isRegenerating}
                  className="h-11 px-3 min-h-[44px]"
                  title="Full regenerate (rebuild full context)"
                >
                  {isRegeneratingFull ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Full Regen
                </Button>
                
                {/* Approve & Send button */}
                <Button 
                  onClick={handleApproveAndSend} 
                  disabled={!composeMessage.trim() || isSending || isRegenerating || (isEmail && !toEmail) || isLinkedInSendBlocked}
                  className="h-11 px-3 min-h-[44px]"
                  title="Approve and send"
                >
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Check className="h-4 w-4 mr-1" />
                      <Send className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </>
            ) : (
              /* Regular send button when no AI draft */
              <>
                {/* Insert calendar link */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleInsertCalendarLink}
                  disabled={isSending || isRegenerating}
                  className="h-11 w-11 min-h-[44px] min-w-[44px]"
                  aria-label="Insert calendar link"
                >
                  <Calendar className="h-4 w-4" />
                </Button>

                <Button 
                  onClick={handleSendMessage} 
                  disabled={!composeMessage.trim() || isSending || isRegenerating || (isEmail && !toEmail) || isLinkedInSendBlocked}
                  className="h-11 px-3 min-h-[44px]"
                >
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      {isLinkedIn && <Linkedin className="h-4 w-4 mr-2" />}
                      {!isLinkedIn && <Send className="h-4 w-4 mr-2" />}
                      Send
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
