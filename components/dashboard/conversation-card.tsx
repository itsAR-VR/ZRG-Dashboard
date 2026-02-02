"use client"

import { cn } from "@/lib/utils"
import type { Conversation } from "@/lib/mock-data"
import { Mail, MessageSquare, Linkedin, AlertCircle, AlertTriangle, Loader2, Moon, UserCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatDistanceToNow } from "date-fns"
import { LeadScoreBadge } from "./lead-score-badge"

/**
 * Extract first name from email (e.g., "vanessa@company.com" -> "Vanessa")
 */
function getFirstNameFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const localPart = email.split("@")[0];
  if (!localPart) return null;
  // Capitalize first letter
  return localPart.charAt(0).toUpperCase() + localPart.slice(1).toLowerCase();
}

interface ConversationCardProps {
  conversation: Conversation
  isActive: boolean
  onClick: () => void
  isSyncing?: boolean
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
    className: "bg-[color:var(--sentiment-meeting-requested-bg)] text-[color:var(--sentiment-meeting-requested)] border-[color:var(--sentiment-meeting-requested-border)]",
  },
  "call-requested": {
    label: "Call Requested",
    className: "bg-[color:var(--sentiment-call-requested-bg)] text-[color:var(--sentiment-call-requested)] border-[color:var(--sentiment-call-requested-border)]",
  },
  "not-interested": {
    label: "Not Interested",
    className: "bg-[color:var(--sentiment-not-interested-bg)] text-[color:var(--sentiment-not-interested)] border-[color:var(--sentiment-not-interested-border)]",
  },
  "out-of-office": {
    label: "Out of Office",
    className: "bg-[color:var(--sentiment-out-of-office-bg)] text-[color:var(--sentiment-out-of-office)] border-[color:var(--sentiment-out-of-office-border)]",
  },
  "automated-reply": {
    label: "Automated Reply",
    className: "bg-[color:var(--sentiment-automated-reply-bg)] text-[color:var(--sentiment-automated-reply)] border-[color:var(--sentiment-automated-reply-border)]",
  },
  "follow-up": {
    label: "Follow Up",
    className: "bg-[color:var(--sentiment-follow-up-bg)] text-[color:var(--sentiment-follow-up)] border-[color:var(--sentiment-follow-up-border)]",
  },
  "information-requested": {
    label: "Info Requested",
    className: "bg-[color:var(--sentiment-information-requested-bg)] text-[color:var(--sentiment-information-requested)] border-[color:var(--sentiment-information-requested-border)]",
  },
  "interested": {
    label: "Interested",
    className: "bg-[color:var(--sentiment-interested-bg)] text-[color:var(--sentiment-interested)] border-[color:var(--sentiment-interested-border)]",
  },
  "blacklist": {
    label: "Blacklist",
    className: "bg-[color:var(--sentiment-blacklist-bg)] text-[color:var(--sentiment-blacklist)] border-[color:var(--sentiment-blacklist-border)]",
  },
  "positive": {
    label: "Positive",
    className: "bg-[color:var(--sentiment-positive-bg)] text-[color:var(--sentiment-positive)] border-[color:var(--sentiment-positive-border)]",
  },
  "neutral": {
    label: "Neutral",
    className: "bg-[color:var(--sentiment-neutral-bg)] text-[color:var(--sentiment-neutral)] border-[color:var(--sentiment-neutral-border)]",
  },
  "new": {
    label: "New",
    className: "bg-[color:var(--sentiment-new-bg)] text-[color:var(--sentiment-new)] border-[color:var(--sentiment-new-border)]",
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

export function ConversationCard({ conversation, isActive, onClick, isSyncing = false }: ConversationCardProps) {
  // Use primaryChannel with fallback to platform for backward compatibility
  const primaryChannel = conversation.primaryChannel || conversation.platform || "sms"
  const PrimaryIcon = platformIcons[primaryChannel]
  const channels = conversation.channels || [primaryChannel]
  const classification = getClassificationStyle(conversation.classification)
  const preview =
    (primaryChannel === "email" || channels.includes("email")) && conversation.lastSubject
      ? `${conversation.lastSubject} — ${conversation.lastMessage}`
      : conversation.lastMessage
  const followUpBlockedReason = conversation.lead.followUpBlockedReason
  const followUpBlockedLabel = followUpBlockedReason
    ? followUpBlockedReason.startsWith("missing_lead_data")
      ? "Follow-ups blocked — missing lead data"
      : "Follow-ups blocked — missing setup"
    : null
  const workspaceName = conversation.lead.company
  const smsClient = conversation.lead.smsCampaignName?.trim() || null
  const workspaceLine = smsClient
    ? `${workspaceName} • Client: ${smsClient}`
    : workspaceName

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-4 text-left transition-colors relative",
        "hover:bg-accent/50",
        isActive ? "border-primary bg-accent" : "border-border bg-card",
        isSyncing && "opacity-75",
      )}
    >
      {/* Syncing indicator overlay */}
      {isSyncing && (
        <div className="absolute top-2 right-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        </div>
      )}
      
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground truncate">{conversation.lead.name}</h3>
            <LeadScoreBadge
              score={conversation.lead.overallScore}
              size="sm"
              showTooltip
              scoredAt={conversation.lead.scoredAt}
            />
            {conversation.requiresAttention && <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />}
          </div>
          <p className="text-sm text-muted-foreground truncate">{workspaceLine}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {/* Show all channel icons if multiple channels */}
          {!isSyncing && (
            <div className="flex gap-0.5">
              {channels.map((ch) => {
                const Icon = platformIcons[ch]
                return <Icon key={ch} className="h-3.5 w-3.5 text-muted-foreground" />
              })}
            </div>
          )}
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(conversation.lastMessageTime, { addSuffix: true })}
          </span>
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{preview}</p>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {/* Show channel badges for all active channels */}
        {channels.map((ch) => (
          <Badge 
            key={ch}
            variant="outline" 
            className="text-xs border-border text-muted-foreground"
          >
            {ch === "email" ? "Email" : ch.toUpperCase()}
          </Badge>
        ))}
        {conversation.lead.smsDndActive ? (
          <Badge
            variant="outline"
            className="text-xs border-amber-500/30 bg-amber-500/10 text-amber-600"
            title="SMS DND detected in GoHighLevel"
          >
            <Moon className="h-3 w-3 mr-1" />
            DND
          </Badge>
        ) : null}
        {followUpBlockedLabel ? (
          <Badge
            variant="outline"
            className="text-xs border-amber-500/30 bg-amber-500/10 text-amber-600"
            title={followUpBlockedReason || undefined}
          >
            <AlertTriangle className="h-3 w-3 mr-1" />
            {followUpBlockedLabel}
          </Badge>
        ) : null}
        <Badge variant="outline" className={cn("text-xs", classification.className)}>
          {classification.label}
        </Badge>
        {isSyncing ? (
          <Badge variant="outline" className="text-xs border-blue-500/20 bg-blue-500/10 text-blue-500">
            Syncing...
          </Badge>
        ) : conversation.hasAiDraft ? (
          <Badge variant="outline" className="text-xs border-primary/20 bg-primary/10 text-primary">
            AI Draft Ready
          </Badge>
        ) : null}
        {/* Setter assignment badge (Phase 43) */}
        {conversation.lead.assignedToEmail ? (
          <Badge
            variant="outline"
            className="text-xs border-violet-500/20 bg-violet-500/10 text-violet-500"
            title={`Assigned to ${conversation.lead.assignedToEmail}`}
          >
            <UserCheck className="h-3 w-3 mr-1" />
            {getFirstNameFromEmail(conversation.lead.assignedToEmail)}
          </Badge>
        ) : null}
      </div>
    </button>
  )
}
