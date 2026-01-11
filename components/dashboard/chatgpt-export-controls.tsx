"use client"

import { useEffect, useMemo, useState } from "react"
import { Download, RefreshCw, Save, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  DEFAULT_CHATGPT_EXPORT_OPTIONS,
  buildChatgptExportUrl,
  getChatgptExportOptionsSummary,
  normalizeChatgptExportOptions,
  type ChatgptExportChannel,
  type ChatgptExportDirection,
  type ChatgptExportOptions,
  type ChatgptExportTimePreset,
} from "@/lib/chatgpt-export"
import { getChatgptExportDefaults, setChatgptExportDefaults } from "@/actions/chatgpt-export-actions"

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromDatetimeLocalValue(value: string): string | null {
  const trimmed = (value || "").trim()
  if (!trimmed) return null
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

const CHANNELS: Array<{ id: ChatgptExportChannel; label: string }> = [
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
  { id: "linkedin", label: "LinkedIn" },
]

const DIRECTIONS: Array<{ id: ChatgptExportDirection; label: string }> = [
  { id: "inbound", label: "Inbound" },
  { id: "outbound", label: "Outbound" },
]

export function ChatgptExportControls({ activeWorkspace }: { activeWorkspace?: string | null }) {
  const [open, setOpen] = useState(false)
  const [loadingDefaults, setLoadingDefaults] = useState(false)
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [saved, setSaved] = useState<{ options: ChatgptExportOptions; isSaved: boolean } | null>(null)
  const [working, setWorking] = useState<ChatgptExportOptions>(DEFAULT_CHATGPT_EXPORT_OPTIONS)

  const summary = useMemo(() => getChatgptExportOptionsSummary(working), [working])

  const refreshDefaults = async () => {
    if (!activeWorkspace) return
    setLoadingDefaults(true)
    const res = await getChatgptExportDefaults(activeWorkspace)
    if (!res.success || !res.data) {
      toast.error(res.error || "Failed to load export defaults")
      setLoadingDefaults(false)
      return
    }

    setSaved(res.data)
    setWorking(res.data.options)
    setLoadingDefaults(false)
  }

  useEffect(() => {
    if (!open) return
    // Lazy-load defaults when the dialog is opened.
    refreshDefaults()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onSaveDefaults = async () => {
    if (!activeWorkspace) return
    setSavingDefaults(true)
    const normalized = normalizeChatgptExportOptions(working)
    const res = await setChatgptExportDefaults(activeWorkspace, normalized)
    if (!res.success || !res.data) {
      toast.error(res.error || "Failed to save defaults")
      setSavingDefaults(false)
      return
    }

    setSaved({ options: res.data.options, isSaved: true })
    setWorking(res.data.options)
    setSavingDefaults(false)
    toast.success("Saved ChatGPT export defaults")
  }

  const onDownloadDefault = () => {
    if (!activeWorkspace) return
    // Keep the main button a one-click download; backend falls back to saved defaults.
    window.location.href = buildChatgptExportUrl({ clientId: activeWorkspace, options: null })
  }

  const onDownloadNow = () => {
    if (!activeWorkspace) return
    const normalized = normalizeChatgptExportOptions(working)
    window.location.href = buildChatgptExportUrl({ clientId: activeWorkspace, options: normalized })
    setOpen(false)
  }

  const setTimePreset = (preset: ChatgptExportTimePreset) => {
    setWorking((prev) => {
      const next = { ...prev, timePreset: preset }
      if (preset !== "custom") {
        next.fromIso = null
        next.toIso = null
      } else {
        // Sensible defaults: last 7 days.
        const to = new Date()
        const from = new Date(to)
        from.setDate(from.getDate() - 7)
        next.fromIso = from.toISOString()
        next.toIso = to.toISOString()
      }
      return normalizeChatgptExportOptions(next)
    })
  }

  const setChannels = (channels: string[]) => {
    setWorking((prev) => normalizeChatgptExportOptions({ ...prev, channels }))
  }

  const setDirections = (directions: string[]) => {
    setWorking((prev) => normalizeChatgptExportOptions({ ...prev, directions }))
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" disabled={!activeWorkspace} onClick={onDownloadDefault}>
        <Download className="h-4 w-4 mr-2" />
        Download dataset for ChatGPT
      </Button>

      <Button
        variant="outline"
        size="icon"
        disabled={!activeWorkspace}
        onClick={() => setOpen(true)}
        title="ChatGPT export settings"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>ChatGPT Export Settings</span>
              {saved?.isSaved ? (
                <Badge variant="secondary">Defaults saved</Badge>
              ) : (
                <Badge variant="outline">Using fallback defaults</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Build a smaller dataset you can query quickly in ChatGPT. Save defaults so the main download button uses them automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Current selection</span>
                <span className="font-medium">{summary}</span>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3 rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Lead selection</p>
                  <p className="text-xs text-muted-foreground">
                    “Positive only” includes leads tagged Interested / Information Requested / Meeting Requested / Call Requested.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm">Positive replies only</Label>
                  <Switch
                    checked={working.positiveOnly}
                    onCheckedChange={(v) => setWorking((prev) => normalizeChatgptExportOptions({ ...prev, positiveOnly: v }))}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Time window</p>
                  <p className="text-xs text-muted-foreground">
                    Filters leads by message activity (and optionally truncates messages).
                  </p>
                </div>

                <div className="space-y-2">
                  <Select value={working.timePreset} onValueChange={(v) => setTimePreset(v as ChatgptExportTimePreset)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_time">All time</SelectItem>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                      <SelectItem value="90d">Last 90 days</SelectItem>
                      <SelectItem value="custom">Custom…</SelectItem>
                    </SelectContent>
                  </Select>

                  {working.timePreset === "custom" ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">From</Label>
                        <Input
                          type="datetime-local"
                          value={toDatetimeLocalValue(working.fromIso)}
                          onChange={(e) =>
                            setWorking((prev) =>
                              normalizeChatgptExportOptions({ ...prev, fromIso: fromDatetimeLocalValue(e.target.value) })
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">To</Label>
                        <Input
                          type="datetime-local"
                          value={toDatetimeLocalValue(working.toIso)}
                          onChange={(e) =>
                            setWorking((prev) =>
                              normalizeChatgptExportOptions({ ...prev, toIso: fromDatetimeLocalValue(e.target.value) })
                            )
                          }
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-sm">Messages within range only</Label>
                    <Switch
                      disabled={working.timePreset === "all_time"}
                      checked={working.messagesWithinRangeOnly}
                      onCheckedChange={(v) =>
                        setWorking((prev) => normalizeChatgptExportOptions({ ...prev, messagesWithinRangeOnly: v }))
                      }
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3 rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Files</p>
                  <p className="text-xs text-muted-foreground">
                    Choose what to include in the zip.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm">Include leads.csv</Label>
                  <Switch
                    checked={working.includeLeadsCsv}
                    onCheckedChange={(v) => setWorking((prev) => normalizeChatgptExportOptions({ ...prev, includeLeadsCsv: v }))}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-sm">Include messages.jsonl</Label>
                  <Switch
                    checked={working.includeMessagesJsonl}
                    onCheckedChange={(v) =>
                      setWorking((prev) => normalizeChatgptExportOptions({ ...prev, includeMessagesJsonl: v }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Message filters</p>
                  <p className="text-xs text-muted-foreground">
                    Leave empty to include all channels/directions.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Channels</Label>
                  <ToggleGroup
                    type="multiple"
                    value={working.channels}
                    onValueChange={(v) => setChannels(v)}
                    className="flex flex-wrap justify-start"
                  >
                    {CHANNELS.map((c) => (
                      <ToggleGroupItem key={c.id} value={c.id} className="text-xs">
                        {c.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Directions</Label>
                  <ToggleGroup
                    type="multiple"
                    value={working.directions}
                    onValueChange={(v) => setDirections(v)}
                    className="flex flex-wrap justify-start"
                  >
                    {DIRECTIONS.map((d) => (
                      <ToggleGroupItem key={d.id} value={d.id} className="text-xs">
                        {d.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={refreshDefaults} disabled={loadingDefaults || !activeWorkspace}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reload defaults
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (saved?.options) setWorking(saved.options)
                    else setWorking(DEFAULT_CHATGPT_EXPORT_OPTIONS)
                  }}
                  disabled={loadingDefaults}
                >
                  Reset changes
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={onSaveDefaults} disabled={savingDefaults || loadingDefaults || !activeWorkspace}>
                  <Save className="h-4 w-4 mr-2" />
                  Save defaults
                </Button>
                <Button onClick={onDownloadNow} disabled={!activeWorkspace || loadingDefaults}>
                  <Download className="h-4 w-4 mr-2" />
                  Download now
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

