"use client"

import { useState } from "react"
import { Send, RotateCcw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface AiDraftZoneProps {
  initialDraft: string
  onApprove: (content: string) => void
  onReject: () => void
}

export function AiDraftZone({ initialDraft, onApprove, onReject }: AiDraftZoneProps) {
  const [draft, setDraft] = useState(initialDraft)
  const [isEdited, setIsEdited] = useState(false)

  const handleDraftChange = (value: string) => {
    setDraft(value)
    setIsEdited(value !== initialDraft)
  }

  const handleReset = () => {
    setDraft(initialDraft)
    setIsEdited(false)
  }

  return (
    <div className="border-t border-border bg-card p-4">
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-sm font-medium text-foreground">AI Suggested Reply</span>
          {isEdited && <span className="text-xs text-muted-foreground">(edited)</span>}
        </div>

        <Textarea
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          className="min-h-[120px] resize-none border-none bg-transparent p-0 text-sm leading-relaxed focus-visible:ring-0"
          placeholder="AI is generating a response..."
        />

        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={!isEdited}
            className="text-muted-foreground"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onReject}>
              Reject / Rewrite
            </Button>
            <Button size="sm" onClick={() => onApprove(draft)}>
              <Send className="mr-2 h-4 w-4" />
              Approve & Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
