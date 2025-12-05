"use client"

import { useRef, useEffect } from "react"
import type { Conversation } from "@/lib/mock-data"
import { aiDrafts } from "@/lib/mock-data"
import { ChatMessage } from "./chat-message"
import { AiDraftZone } from "./ai-draft-zone"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, PanelRightOpen, Mail, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"

interface ActionStationProps {
  conversation: Conversation | null
  onToggleCrm: () => void
  isCrmOpen: boolean
}

export function ActionStation({ conversation, onToggleCrm, isCrmOpen }: ActionStationProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [conversation?.messages])

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background text-muted-foreground">
        Select a conversation to view details
      </div>
    )
  }

  const { lead } = conversation
  const aiDraft = aiDrafts[conversation.id]

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
              {lead.title} at{" "}
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {lead.company}
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-4 mr-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              {lead.email}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {lead.timezone}
            </span>
          </div>
          <Button variant={isCrmOpen ? "secondary" : "outline"} size="sm" onClick={onToggleCrm}>
            <PanelRightOpen className="mr-2 h-4 w-4" />
            CRM
          </Button>
        </div>
      </header>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {conversation.messages.map((message) => (
          <ChatMessage key={message.id} message={message} leadName={lead.name} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* AI Draft Zone */}
      {aiDraft && (
        <AiDraftZone
          initialDraft={aiDraft}
          onApprove={(content) => console.log("Approved:", content)}
          onReject={() => console.log("Rejected")}
        />
      )}
    </div>
  )
}
