"use client"

import { cn } from "@/lib/utils"
import type { Conversation } from "@/lib/mock-data"
import { Mail, MessageSquare, Linkedin, AlertCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatDistanceToNow } from "date-fns"

interface ConversationCardProps {
  conversation: Conversation
  isActive: boolean
  onClick: () => void
}

const platformIcons = {
  email: Mail,
  sms: MessageSquare,
  linkedin: Linkedin,
}

const classificationStyles = {
  "meeting-requested": {
    label: "Meeting Requested",
    className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  },
  "not-interested": { label: "Not Interested", className: "bg-muted text-muted-foreground border-muted" },
  "out-of-office": { label: "Out of Office", className: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
  "follow-up": { label: "Follow Up", className: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  new: { label: "New", className: "bg-primary/10 text-primary border-primary/20" },
}

export function ConversationCard({ conversation, isActive, onClick }: ConversationCardProps) {
  const PlatformIcon = platformIcons[conversation.platform]
  const classification = classificationStyles[conversation.classification]

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-4 text-left transition-colors",
        "hover:bg-accent/50",
        isActive ? "border-primary bg-accent" : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground truncate">{conversation.lead.name}</h3>
            {conversation.requiresAttention && <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />}
          </div>
          <p className="text-sm text-muted-foreground truncate">{conversation.lead.company}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <PlatformIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(conversation.lastMessageTime, { addSuffix: true })}
          </span>
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{conversation.lastMessage}</p>

      <div className="mt-3 flex items-center gap-2">
        <Badge variant="outline" className={cn("text-xs", classification.className)}>
          {classification.label}
        </Badge>
        {conversation.hasAiDraft && (
          <Badge variant="outline" className="text-xs border-primary/20 bg-primary/10 text-primary">
            AI Draft Ready
          </Badge>
        )}
      </div>
    </button>
  )
}
