"use client"

import { cn } from "@/lib/utils"
import type { Message } from "@/lib/mock-data"
import { format } from "date-fns"
import { Bot, User, UserCircle } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

interface ChatMessageProps {
  message: Message
  leadName?: string
  userName?: string
  userAvatar?: string | null
}

export function ChatMessage({ message, leadName, userName = "You", userAvatar }: ChatMessageProps) {
  // Map sender types
  const isOutbound = message.sender === "ai" || message.sender === "human"
  const isLead = message.sender === "lead"

  const config = isLead
    ? {
        label: leadName || "Lead",
        icon: UserCircle,
        avatarClass: "bg-blue-500/10 text-blue-500",
        bubbleClass: "bg-muted",
        align: "left" as const,
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

  return (
    <div className={cn("flex gap-3", isRight && "flex-row-reverse")}>
      <Avatar className={cn("h-8 w-8 shrink-0", !userAvatar && config.avatarClass)}>
        {isOutbound && userAvatar ? (
          <AvatarImage src={userAvatar} alt={userName} />
        ) : null}
        <AvatarFallback className={config.avatarClass}>
          {isOutbound ? getInitials(userName) : <Icon className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      <div className={cn("flex max-w-[70%] flex-col gap-1", isRight && "items-end")}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground/60">{format(message.timestamp, "MMM d, h:mm a")}</span>
        </div>
        <div className={cn("rounded-lg px-4 py-2.5", config.bubbleClass)}>
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    </div>
  )
}
