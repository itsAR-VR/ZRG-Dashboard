"use client"

import { useRef, useEffect, useState } from "react"
import type { Conversation } from "@/lib/mock-data"
import { aiDrafts as mockAiDrafts } from "@/lib/mock-data"
import { ChatMessage } from "./chat-message"
import { AiDraftZone } from "./ai-draft-zone"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { ExternalLink, PanelRightOpen, Mail, MapPin, Send, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { sendMessage, getPendingDrafts, approveAndSendDraft, rejectDraft } from "@/actions/message-actions"
import { toast } from "sonner"

interface ActionStationProps {
  conversation: Conversation | null
  onToggleCrm: () => void
  isCrmOpen: boolean
}

interface AIDraft {
  id: string
  content: string
  status: string
  createdAt: Date
}

export function ActionStation({ conversation, onToggleCrm, isCrmOpen }: ActionStationProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [composeMessage, setComposeMessage] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [drafts, setDrafts] = useState<AIDraft[]>([])
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [conversation?.messages])

  // Fetch real AI drafts when conversation changes
  useEffect(() => {
    async function fetchDrafts() {
      if (!conversation) {
        setDrafts([])
        return
      }

      setIsLoadingDrafts(true)
      const result = await getPendingDrafts(conversation.id)
      if (result.success && result.data) {
        setDrafts(result.data as AIDraft[])
      } else {
        setDrafts([])
      }
      setIsLoadingDrafts(false)
    }

    fetchDrafts()
  }, [conversation?.id])

  const handleSendMessage = async () => {
    if (!composeMessage.trim() || !conversation) return

    setIsSending(true)
    const result = await sendMessage(conversation.id, composeMessage)
    
    if (result.success) {
      toast.success("Message sent!")
      setComposeMessage("")
    } else {
      toast.error(result.error || "Failed to send message")
    }
    
    setIsSending(false)
  }

  const handleApproveDraft = async (draftId: string, content: string) => {
    setIsSending(true)
    const result = await approveAndSendDraft(draftId, content)
    
    if (result.success) {
      toast.success("Draft approved and sent!")
      // Remove the approved draft from the list
      setDrafts(drafts.filter(d => d.id !== draftId))
    } else {
      toast.error(result.error || "Failed to send draft")
    }
    
    setIsSending(false)
  }

  const handleRejectDraft = async (draftId: string) => {
    const result = await rejectDraft(draftId)
    
    if (result.success) {
      toast.success("Draft rejected")
      setDrafts(drafts.filter(d => d.id !== draftId))
    } else {
      toast.error(result.error || "Failed to reject draft")
    }
  }

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background text-muted-foreground">
        Select a conversation to view details
      </div>
    )
  }

  const { lead } = conversation
  
  // Use real drafts if available, otherwise fall back to mock
  const currentDraft = drafts.length > 0 
    ? { content: drafts[0].content, draftId: drafts[0].id }
    : mockAiDrafts[conversation.id]

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
          <Button variant={isCrmOpen ? "secondary" : "outline"} size="sm" onClick={onToggleCrm}>
            <PanelRightOpen className="mr-2 h-4 w-4" />
            CRM
          </Button>
        </div>
      </header>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {conversation.messages && conversation.messages.length > 0 ? (
          conversation.messages.map((message) => (
            <ChatMessage key={message.id} message={message} leadName={lead.name} />
          ))
        ) : (
          <div className="text-center text-muted-foreground py-8">
            No messages yet
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* AI Draft Zone - Only show if we have a draft */}
      {currentDraft && (
        <AiDraftZone
          initialDraft={currentDraft}
          onApprove={(content) => {
            if (drafts.length > 0) {
              handleApproveDraft(drafts[0].id, content)
            } else {
              // For mock drafts, just send the message directly
              handleSendMessage()
            }
          }}
          onReject={() => {
            if (drafts.length > 0) {
              handleRejectDraft(drafts[0].id)
            }
          }}
          isLoading={isSending}
        />
      )}

      {/* Compose Box - Only show if no AI draft */}
      {!currentDraft && (
        <div className="border-t border-border p-4">
          <div className="flex gap-2">
            <Textarea
              placeholder="Type your message..."
              value={composeMessage}
              onChange={(e) => setComposeMessage(e.target.value)}
              className="min-h-[80px] resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
              }}
            />
            <Button 
              onClick={handleSendMessage} 
              disabled={!composeMessage.trim() || isSending}
              className="self-end"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      )}
    </div>
  )
}
