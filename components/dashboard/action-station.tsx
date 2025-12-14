"use client"

import { useRef, useEffect, useState, useMemo } from "react"
import type { Conversation, Channel } from "@/lib/mock-data"
import { ChatMessage } from "./chat-message"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ExternalLink, PanelRightOpen, Mail, MapPin, Send, Loader2, Sparkles, RotateCcw, RefreshCw, X, Check, History, MessageSquare, Linkedin, UserCheck, UserPlus, Clock, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { sendMessage, sendLinkedInMessage, getPendingDrafts, approveAndSendDraft, rejectDraft, regenerateDraft, checkLinkedInStatus, type LinkedInStatusResult } from "@/actions/message-actions"
import { toast } from "sonner"
import { useUser } from "@/contexts/user-context"

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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const shouldScrollRef = useRef(true)
  const prevConversationIdRef = useRef<string | null>(null)
  const prevMessageCountRef = useRef(0)
  const [composeMessage, setComposeMessage] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [drafts, setDrafts] = useState<AIDraft[]>([])
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false)
  const [hasAiDraft, setHasAiDraft] = useState(false)
  const [originalDraft, setOriginalDraft] = useState("")
  const [activeChannel, setActiveChannel] = useState<Channel>("sms")
  const [linkedInStatus, setLinkedInStatus] = useState<LinkedInStatusResult | null>(null)
  const [isLoadingLinkedInStatus, setIsLoadingLinkedInStatus] = useState(false)
  const [connectionNote, setConnectionNote] = useState("")
  const { user } = useUser()
  
  // Determine current channel type
  const isEmail = activeChannel === "email"
  const isLinkedIn = activeChannel === "linkedin"
  
  // Get available channels for this conversation
  const channels = conversation?.channels || ["sms"]
  const availableChannels = conversation?.availableChannels || ["sms"]
  
  // Check if LinkedIn is available (lead has linkedinUrl)
  const hasLinkedIn = conversation?.lead?.linkedinUrl !== undefined && conversation?.lead?.linkedinUrl !== null
  
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
  
  // Reset active channel when conversation changes
  useEffect(() => {
    if (conversation?.primaryChannel) {
      setActiveChannel(conversation.primaryChannel)
    } else if (channels.length > 0) {
      setActiveChannel(channels[0])
    }
  }, [conversation?.id, conversation?.primaryChannel, channels])

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

  // Fetch LinkedIn connection status when LinkedIn tab is active
  useEffect(() => {
    async function fetchLinkedInStatus() {
      if (!conversation || activeChannel !== "linkedin" || !hasLinkedIn) {
        setLinkedInStatus(null)
        return
      }

      setIsLoadingLinkedInStatus(true)
      try {
        const result = await checkLinkedInStatus(conversation.id)
        setLinkedInStatus(result)
      } catch (error) {
        console.error("[ActionStation] Failed to fetch LinkedIn status:", error)
        setLinkedInStatus(null)
      } finally {
        setIsLoadingLinkedInStatus(false)
      }
    }

    fetchLinkedInStatus()
  }, [conversation?.id, activeChannel, hasLinkedIn])

  // Fetch real AI drafts when conversation or active channel changes
  useEffect(() => {
    async function fetchDrafts() {
      if (!conversation) {
        setDrafts([])
        setComposeMessage("")
        setHasAiDraft(false)
        setOriginalDraft("")
        return
      }

      console.log("[ActionStation] Fetching drafts for conversation:", conversation.id, "channel:", activeChannel)
      setIsLoadingDrafts(true)
      const result = await getPendingDrafts(conversation.id, activeChannel)
      console.log("[ActionStation] Draft fetch result:", result)
      
      if (result.success && result.data && result.data.length > 0) {
        const draftData = result.data as AIDraft[]
        console.log("[ActionStation] Found drafts:", draftData.length, "First draft:", draftData[0]?.content?.substring(0, 50))
        setDrafts(draftData)
        // Auto-populate the compose box with the AI draft
        setComposeMessage(draftData[0].content)
        setOriginalDraft(draftData[0].content)
        setHasAiDraft(true)
      } else {
        // No drafts found
        console.log("[ActionStation] No drafts found")
        setComposeMessage("")
        setOriginalDraft("")
        setHasAiDraft(false)
        setDrafts([])
      }
      setIsLoadingDrafts(false)
    }

    fetchDrafts()
  }, [conversation?.id, activeChannel])

  const handleSendMessage = async () => {
    if (!composeMessage.trim() || !conversation) return
    if (isEmail) {
      toast.error("Approve and send the email draft instead.")
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
      toast.error(result.error || "Failed to send message")
    }
    
    setIsSending(false)
  }

  const handleApproveAndSend = async () => {
    if (!composeMessage.trim() || !conversation) return

    if (isEmail && drafts.length === 0) {
      toast.error("No email draft available to approve.")
      return
    }

    setIsSending(true)
    
    // If we have a real AI draft, approve it
    if (drafts.length > 0) {
      const result = await approveAndSendDraft(drafts[0].id, composeMessage)
      if (result.success) {
        toast.success("Draft approved and sent!")
        setComposeMessage("")
        setDrafts([])
        setHasAiDraft(false)
        setOriginalDraft("")
        // Scroll to bottom to show the sent message
        shouldScrollRef.current = true
      } else {
        toast.error(result.error || "Failed to send message")
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
        toast.error(result.error || "Failed to send message")
      }
    }
    
    setIsSending(false)
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

  const handleRegenerateDraft = async () => {
    if (!conversation) return

    setIsRegenerating(true)
    
    // Reject existing draft first if any
    if (drafts.length > 0) {
      await rejectDraft(drafts[0].id)
    }
    
    const result = await regenerateDraft(conversation.id, activeChannel)
    
    if (result.success && result.data) {
      toast.success("New AI draft generated!")
      setDrafts([{ 
        id: result.data.id, 
        content: result.data.content, 
        status: "pending", 
        createdAt: new Date() 
      }])
      setComposeMessage(result.data.content)
      setOriginalDraft(result.data.content)
      setHasAiDraft(true)
    } else {
      toast.error(result.error || "Failed to generate draft")
    }
    
    setIsRegenerating(false)
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
                  {lead.company}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span>{lead.company}</span>
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
          >
            {isReanalyzingSentiment ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Re-analyze Sentiment
          </Button>
          <Button variant={isCrmOpen ? "secondary" : "outline"} size="sm" onClick={onToggleCrm}>
            <PanelRightOpen className="mr-2 h-4 w-4" />
            CRM
          </Button>
        </div>
      </header>

      {/* Channel Tabs */}
      {channels.length > 0 && (
        <div className="border-b border-border px-6 py-2 bg-muted/30">
          <Tabs value={activeChannel} onValueChange={(v) => setActiveChannel(v as Channel)}>
            <TabsList className="h-8">
              {availableChannels.map((ch) => {
                const Icon = CHANNEL_ICONS[ch]
                const count = messageCounts[ch]
                const hasMessages = count > 0
                const isActive = channels.includes(ch)
                
                // LinkedIn is now enabled if lead has linkedinUrl
                const linkedInEnabled = ch === "linkedin" ? (hasLinkedIn || hasMessages) : true
                
                return (
                  <TabsTrigger 
                    key={ch} 
                    value={ch}
                    disabled={!isActive && ch !== activeChannel && !linkedInEnabled}
                    className={cn(
                      "text-xs gap-1.5 px-3",
                      !isActive && !linkedInEnabled && "opacity-50"
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
        <div className="border-b border-border px-6 py-2 bg-muted/20 flex items-center gap-4 flex-wrap">
          {isLoadingLinkedInStatus ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking connection status...
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
              <span className="text-xs text-muted-foreground ml-auto">
                {linkedInStatus.canSendDM && "Will send DM"}
                {!linkedInStatus.canSendDM && linkedInStatus.canSendInMail && "Will send InMail"}
                {!linkedInStatus.canSendDM && !linkedInStatus.canSendInMail && "Will send Connection Request"}
              </span>
            </>
          ) : linkedInStatus?.error ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              {linkedInStatus.error}
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
        {/* Compose with AI button - shown when no draft exists */}
        {!hasAiDraft && !isLoadingDrafts && (
          <div className="flex justify-end mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerateDraft}
              disabled={isRegenerating}
              className="text-xs"
            >
              {isRegenerating ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              )}
              Compose with AI
            </Button>
          </div>
        )}

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
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
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
                {/* Reject button */}
                <Button 
                  variant="outline"
                  size="icon"
                  onClick={handleRejectDraft}
                  disabled={isSending || isRegenerating}
                  className="h-8 w-8"
                  title="Reject draft"
                >
                  <X className="h-4 w-4" />
                </Button>
                
                {/* Regenerate button */}
                <Button 
                  variant="outline"
                  size="icon"
                  onClick={handleRegenerateDraft}
                  disabled={isSending || isRegenerating}
                  className="h-8 w-8"
                  title="Regenerate draft"
                >
                  {isRegenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
                
                {/* Approve & Send button */}
                <Button 
                  onClick={handleApproveAndSend} 
                  disabled={!composeMessage.trim() || isSending || isRegenerating}
                  className="h-8 px-3"
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
              <Button 
                onClick={handleSendMessage} 
                disabled={isEmail || !composeMessage.trim() || isSending || isRegenerating}
                className="h-8 px-3"
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
