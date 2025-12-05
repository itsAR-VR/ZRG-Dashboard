"use client"

import { cn } from "@/lib/utils"
import type { Message } from "@/lib/mock-data"
import { format } from "date-fns"
import { Bot, User, UserCircle } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

interface ChatMessageProps {
  message: Message
  leadName?: string
}

const senderConfig = {
  lead: {
    label: "Lead",
    icon: UserCircle,
    avatarClass: "bg-blue-500/10 text-blue-500",
    bubbleClass: "bg-muted",
    align: "left" as const,
  },
  ai: {
    label: "AI Assistant",
    icon: Bot,
    avatarClass: "bg-primary/10 text-primary",
    bubbleClass: "bg-primary/10 border border-primary/20",
    align: "right" as const,
  },
  human: {
    label: "You",
    icon: User,
    avatarClass: "bg-emerald-500/10 text-emerald-500",
    bubbleClass: "bg-emerald-500/10 border border-emerald-500/20",
    align: "right" as const,
  },
}

export function ChatMessage({ message, leadName }: ChatMessageProps) {
  const config = senderConfig[message.sender]
  const Icon = config.icon
  const isRight = config.align === "right"

  return (
    <div className={cn("flex gap-3", isRight && "flex-row-reverse")}>
      <Avatar className={cn("h-8 w-8 shrink-0", config.avatarClass)}>
        <AvatarFallback className={config.avatarClass}>
          <Icon className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>

      <div className={cn("flex max-w-[70%] flex-col gap-1", isRight && "items-end")}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {message.sender === "lead" && leadName ? leadName : config.label}
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
