"use client"

import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface SecretInputProps extends React.ComponentProps<typeof Input> {
  revealLabel?: string
  hideLabel?: string
}

export function SecretInput({
  className,
  revealLabel = "Show secret",
  hideLabel = "Hide secret",
  ...props
}: SecretInputProps) {
  const [showSecret, setShowSecret] = useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        type={showSecret ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
        onClick={() => setShowSecret((prev) => !prev)}
        aria-label={showSecret ? hideLabel : revealLabel}
      >
        {showSecret ? (
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Eye className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  )
}
