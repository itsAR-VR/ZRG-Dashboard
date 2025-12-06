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

// Extended classification styles for all sentiment tags
const classificationStyles: Record<string, { label: string; className: string }> = {
  // AI Sentiment Tags (from OpenAI classification)
  "meeting-requested": {
    label: "Meeting Requested",
    className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  },
  "call-requested": {
    label: "Call Requested",
    className: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  },
  "not-interested": {
    label: "Not Interested",
    className: "bg-muted text-muted-foreground border-muted",
  },
  "out-of-office": {
    label: "Out of Office",
    className: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  },
  "follow-up": {
    label: "Follow Up",
    className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  "information-requested": {
    label: "Info Requested",
    className: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  },
  "blacklist": {
    label: "Blacklist",
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
  "positive": {
    label: "Positive",
    className: "bg-green-500/10 text-green-500 border-green-500/20",
  },
  "neutral": {
    label: "Neutral",
    className: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  },
  "new": {
    label: "New",
    className: "bg-primary/10 text-primary border-primary/20",
  },
}

// Get classification style with fallback
function getClassificationStyle(classification: string) {
  // Try direct match first
  if (classificationStyles[classification]) {
    return classificationStyles[classification]
  }
  
  // Try lowercase match
  const lowerClass = classification.toLowerCase().replace(/\s+/g, "-")
  if (classificationStyles[lowerClass]) {
    return classificationStyles[lowerClass]
  }
  
  // Default to "new" style
  return classificationStyles["new"]
}

export function ConversationCard({ conversation, isActive, onClick }: ConversationCardProps) {
  const PlatformIcon = platformIcons[conversation.platform]
  const classification = getClassificationStyle(conversation.classification)
  const preview =
    conversation.platform === "email" && conversation.lastSubject
      ? `${conversation.lastSubject} — ${conversation.lastMessage}`
      : conversation.lastMessage

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

      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{preview}</p>

      <div className="mt-3 flex items-center gap-2">
        <Badge variant="outline" className="text-xs border-border text-muted-foreground">
          {conversation.platform === "email" ? "Email" : conversation.platform.toUpperCase()}
        </Badge>
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
