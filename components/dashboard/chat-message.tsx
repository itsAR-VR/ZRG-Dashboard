"use client"

import { cn } from "@/lib/utils"
import type { Message } from "@/lib/mock-data"
import { format } from "date-fns"
import { Bot, Mail, User, UserCircle } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useState } from "react"
import { safeLinkifiedHtmlFromText } from "@/lib/safe-html"
import { formatEmailParticipant } from "@/lib/email-participants"

function decodeBasicHtmlEntities(input: string): string {
  return input
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

function htmlToPlainTextPreservingAnchorHrefs(html: string): string {
  const withoutScripts = (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")

  const anchorsPreserved = withoutScripts.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const label = decodeBasicHtmlEntities(String(inner || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
    const hrefText = decodeBasicHtmlEntities(String(href || "")).trim()
    if (!hrefText) return label || ""
    return label ? `${label} (${hrefText})` : hrefText
  })

  const withBreaks = anchorsPreserved
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")

  const noTags = withBreaks.replace(/<[^>]+>/g, "")
  const decoded = decodeBasicHtmlEntities(noTags)

  return decoded.replace(/\n{3,}/g, "\n\n").trim()
}

interface ChatMessageProps {
  message: Message
  leadName?: string
  leadEmail?: string
  userName?: string
  userAvatar?: string | null
}

// Phase 50: Email participant header for displaying From/To/CC on email messages
interface EmailParticipantHeaderProps {
  message: Message
  leadName?: string
  leadEmail?: string
  isInbound: boolean
}

function EmailParticipantHeader({
  message,
  leadName,
  leadEmail,
  isInbound,
}: EmailParticipantHeaderProps) {
  // Only show for email channel
  if (message.channel !== "email") return null

  // Determine From/To based on direction
  const from = isInbound
    ? formatEmailParticipant(message.fromEmail || leadEmail || "Unknown", message.fromName || leadName)
    : formatEmailParticipant(message.fromEmail || "You", message.fromName)

  const to = isInbound
    ? formatEmailParticipant(message.toEmail || "You", message.toName)
    : formatEmailParticipant(message.toEmail || leadEmail || "Unknown", message.toName || leadName)

  const ccList = message.cc || []
  const bccList = message.bcc || []

  return (
    <div className="text-xs text-muted-foreground space-y-0.5 mb-2 pb-2 border-b border-border/50">
      <div>
        <span className="font-medium text-foreground/70">From:</span>{" "}
        <span>{from}</span>
      </div>
      <div>
        <span className="font-medium text-foreground/70">To:</span>{" "}
        <span>{to}</span>
      </div>
      {ccList.length > 0 && (
        <div>
          <span className="font-medium text-foreground/70">CC:</span>{" "}
          <span>{ccList.join(", ")}</span>
        </div>
      )}
      {bccList.length > 0 && (
        <div>
          <span className="font-medium text-foreground/70">BCC:</span>{" "}
          <span>{bccList.join(", ")}</span>
        </div>
      )}
    </div>
  )
}

export function ChatMessage({ message, leadName, leadEmail, userName = "You", userAvatar }: ChatMessageProps) {
  // Map sender types
  const isLead = message.sender === "lead"
  const isHuman = message.sender === "human"
  const isAi = message.sender === "ai"
  const isCampaign = message.source === "inboxxia_campaign"
  const isEmail = message.channel === "email" || !!message.subject
  const [showOriginal, setShowOriginal] = useState(false)

  const config = isLead
    ? {
        label: leadName || "Lead",
        icon: UserCircle,
        avatarClass: "bg-blue-500/10 text-blue-500",
        bubbleClass: "bg-muted",
        align: "left" as const,
      }
    : isAi
      ? {
          label: isCampaign ? "Campaign" : "AI",
          icon: isCampaign ? Mail : Bot,
          avatarClass: "bg-emerald-500/10 text-emerald-600",
          bubbleClass: "bg-emerald-500/10 border border-emerald-500/20",
          align: "right" as const,
        }
      : {
          label: userName,
          icon: User,
          avatarClass: "bg-primary/10 text-primary",
          bubbleClass: "bg-primary/10 border border-primary/20",
          align: "right" as const,
        }

  const Icon = config.icon
  const isRight = config.align === "right"

  // Get initials for avatar fallback
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const originalText = message.rawText
    ? message.rawText
    : message.rawHtml
      ? htmlToPlainTextPreservingAnchorHrefs(message.rawHtml)
      : ""

  return (
    <div className={cn("flex gap-3", isRight && "flex-row-reverse")}>
      <Avatar className={cn("h-8 w-8 shrink-0", !userAvatar && config.avatarClass)}>
        {isHuman && userAvatar ? (
          <AvatarImage src={userAvatar} alt={userName} />
        ) : null}
        <AvatarFallback className={config.avatarClass}>
          {isHuman ? getInitials(userName) : <Icon className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      <div className={cn("flex max-w-[70%] flex-col gap-1", isRight && "items-end")}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground/60">{format(message.timestamp, "MMM d, h:mm a")}</span>
        </div>
        <div className={cn("rounded-lg px-4 py-2.5 space-y-1", config.bubbleClass)}>
          {/* Phase 50: Email participant header */}
          <EmailParticipantHeader
            message={message}
            leadName={leadName}
            leadEmail={leadEmail}
            isInbound={isLead}
          />
          {isEmail && message.subject && (
            <p className="text-xs font-semibold text-foreground">Subject: {message.subject}</p>
          )}
          {showOriginal && (message.rawHtml || message.rawText) ? (
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-64 overflow-auto">
              {originalText}
            </pre>
          ) : (
            <div
              className="text-sm leading-relaxed text-foreground whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: safeLinkifiedHtmlFromText(message.content || "") }}
            />
          )}
          {isEmail && (message.rawHtml || message.rawText) && (
            <button
              className="text-[11px] text-primary hover:underline"
              onClick={() => setShowOriginal((prev) => !prev)}
            >
              {showOriginal ? "Hide Original" : "Show Original"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
