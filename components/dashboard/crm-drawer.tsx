"use client"

import type { Lead } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Mail, Phone, Globe, Clock, Calendar, BellOff, Edit3, X, DollarSign, Shield, Target, Timer } from "lucide-react"
import { cn } from "@/lib/utils"

interface CrmDrawerProps {
  lead: Lead
  isOpen: boolean
  onClose: () => void
}

const statusOptions = [
  { value: "new", label: "New Lead" },
  { value: "qualified", label: "Qualified" },
  { value: "meeting-booked", label: "Meeting Booked" },
  { value: "blacklisted", label: "Blacklisted" },
]

const qualificationItems = [
  { key: "budget", label: "Budget", icon: DollarSign, description: "Has budget allocated" },
  { key: "authority", label: "Authority", icon: Shield, description: "Decision maker" },
  { key: "need", label: "Need", icon: Target, description: "Has clear pain point" },
  { key: "timing", label: "Timing", icon: Timer, description: "Ready to buy soon" },
] as const

export function CrmDrawer({ lead, isOpen, onClose }: CrmDrawerProps) {
  if (!isOpen) return null

  const getStatusColor = (status: Lead["status"]) => {
    switch (status) {
      case "meeting-booked":
        return "bg-emerald-500/10 text-emerald-500"
      case "qualified":
        return "bg-blue-500/10 text-blue-500"
      case "blacklisted":
        return "bg-destructive/10 text-destructive"
      default:
        return "bg-muted text-muted-foreground"
    }
  }

  const qualificationScore = Object.values(lead.qualification).filter(Boolean).length

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-card overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-semibold text-foreground">Lead Details</h3>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-6">
        {/* Contact Info */}
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contact</h4>
          <div className="space-y-2.5">
            <div className="flex items-center gap-3 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-foreground truncate">{lead.email}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-foreground">{lead.phone}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline truncate"
              >
                {lead.website.replace("https://", "")}
              </a>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-foreground">{lead.timezone}</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Status */}
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</h4>
          <Select defaultValue={lead.status}>
            <SelectTrigger className={cn("w-full", getStatusColor(lead.status))}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* BANT Qualification */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Qualification (BANT)</h4>
            <span className="text-xs font-medium text-primary">{qualificationScore}/4</span>
          </div>
          <div className="space-y-3">
            {qualificationItems.map((item) => {
              const isChecked = lead.qualification[item.key]
              return (
                <div key={item.key} className="flex items-start gap-3">
                  <Checkbox id={item.key} checked={isChecked} className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <Label htmlFor={item.key} className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <item.icon className={cn("h-3.5 w-3.5", isChecked ? "text-primary" : "text-muted-foreground")} />
                      {item.label}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <Separator />

        {/* Actions */}
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</h4>
          <div className="space-y-2">
            <Button className="w-full justify-start" size="sm">
              <Calendar className="mr-2 h-4 w-4" />
              Book Meeting
            </Button>
            <Button variant="outline" className="w-full justify-start bg-transparent" size="sm">
              <BellOff className="mr-2 h-4 w-4" />
              Snooze Lead
            </Button>
            <Button variant="outline" className="w-full justify-start bg-transparent" size="sm">
              <Edit3 className="mr-2 h-4 w-4" />
              Manual Follow-up
            </Button>
          </div>
        </div>
      </div>
    </aside>
  )
}
