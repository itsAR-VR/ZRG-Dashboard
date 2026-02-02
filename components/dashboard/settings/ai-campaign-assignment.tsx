"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Bot, ChevronDown, Clock, RefreshCw, Save, Timer, Undo2, User } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { getEmailCampaigns, updateEmailCampaignConfig, assignBookingProcessToCampaign, assignPersonaToCampaign } from "@/actions/email-campaign-actions"
import { listBookingProcesses, type BookingProcessSummary } from "@/actions/booking-process-actions"
import { listAiPersonas, type AiPersonaSummary } from "@/actions/ai-persona-actions"
import { EMAIL_CAMPAIGNS_SYNCED_EVENT, type EmailCampaignsSyncedDetail } from "@/lib/client-events"
import { cn } from "@/lib/utils"
import type { CampaignResponseMode } from "@prisma/client"

type CampaignRow = {
  id: string
  name: string
  bisonCampaignId: string
  leadCount: number
  responseMode: CampaignResponseMode
  autoSendConfidenceThreshold: number
  // Phase 47l: Auto-send delay window
  autoSendDelayMinSeconds: number
  autoSendDelayMaxSeconds: number
  autoSendScheduleMode: "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM" | null
  autoSendCustomSchedule: CampaignCustomSchedule
  bookingProcessId: string | null
  bookingProcessName: string | null
  aiPersonaId: string | null
  aiPersonaName: string | null
}

type CampaignHolidayState = {
  additionalBlackoutDates: string[]
  additionalBlackoutDateRanges: Array<{ start: string; end: string }>
}

type CampaignCustomSchedule = {
  days: number[]
  startTime: string
  endTime: string
  holidays: CampaignHolidayState
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_CUSTOM_SCHEDULE: CampaignCustomSchedule = {
  days: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "17:00",
  holidays: {
    additionalBlackoutDates: [],
    additionalBlackoutDateRanges: [],
  },
}
const DEFAULT_SCHEDULE_DRAFT = { blackoutDate: "", rangeStart: "", rangeEnd: "" }
const SCHEDULE_DAYS = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
]

const normalizeDateList = (input: unknown): string[] => {
  if (!Array.isArray(input)) return []
  const filtered = input.filter((value) => typeof value === "string" && DATE_PATTERN.test(value)) as string[]
  return Array.from(new Set(filtered)).sort()
}

const normalizeDateRanges = (input: unknown): Array<{ start: string; end: string }> => {
  if (!Array.isArray(input)) return []
  const ranges = new Map<string, { start: string; end: string }>()
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const start = typeof record.start === "string" && DATE_PATTERN.test(record.start) ? record.start : null
    const end = typeof record.end === "string" && DATE_PATTERN.test(record.end) ? record.end : null
    if (!start || !end) continue
    const normalizedStart = start <= end ? start : end
    const normalizedEnd = start <= end ? end : start
    ranges.set(`${normalizedStart}:${normalizedEnd}`, { start: normalizedStart, end: normalizedEnd })
  }
  return Array.from(ranges.values()).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
}

function coerceCustomSchedule(input: unknown): CampaignCustomSchedule | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const days = Array.isArray(record.days)
    ? record.days.filter((d) => typeof d === "number" && d >= 0 && d <= 6)
    : []
  const startTime = typeof record.startTime === "string" ? record.startTime : null
  const endTime = typeof record.endTime === "string" ? record.endTime : null
  if (!startTime || !endTime || days.length === 0) return null
  const holidayRecord =
    record.holidays && typeof record.holidays === "object" && !Array.isArray(record.holidays)
      ? (record.holidays as Record<string, unknown>)
      : null
  return {
    days,
    startTime,
    endTime,
    holidays: {
      additionalBlackoutDates: normalizeDateList(holidayRecord?.additionalBlackoutDates),
      additionalBlackoutDateRanges: normalizeDateRanges(holidayRecord?.additionalBlackoutDateRanges),
    },
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function areEqual(a: CampaignRow, b: CampaignRow): boolean {
  const scheduleModeEqual = a.autoSendScheduleMode === b.autoSendScheduleMode
  const scheduleDataEqual =
    a.autoSendScheduleMode === "CUSTOM"
      ? JSON.stringify(a.autoSendCustomSchedule) === JSON.stringify(b.autoSendCustomSchedule)
      : true
  return (
    a.responseMode === b.responseMode &&
    Math.abs((a.autoSendConfidenceThreshold ?? 0) - (b.autoSendConfidenceThreshold ?? 0)) < 0.00001 &&
    a.autoSendDelayMinSeconds === b.autoSendDelayMinSeconds &&
    a.autoSendDelayMaxSeconds === b.autoSendDelayMaxSeconds &&
    scheduleModeEqual &&
    scheduleDataEqual &&
    a.bookingProcessId === b.bookingProcessId &&
    a.aiPersonaId === b.aiPersonaId
  )
}

export function AiCampaignAssignmentPanel({ activeWorkspace }: { activeWorkspace?: string | null }) {
  const [rows, setRows] = useState<CampaignRow[]>([])
  const [baselineById, setBaselineById] = useState<Record<string, CampaignRow>>({})
  const [bookingProcesses, setBookingProcesses] = useState<BookingProcessSummary[]>([])
  const [personas, setPersonas] = useState<AiPersonaSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({})
  const [scheduleDraftsById, setScheduleDraftsById] = useState<Record<string, typeof DEFAULT_SCHEDULE_DRAFT>>({})
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    if (!activeWorkspace) {
      setRows([])
      setBaselineById({})
      setBookingProcesses([])
      setPersonas([])
      setScheduleDraftsById({})
      return
    }

    setLoading(true)

    // Load campaigns, booking processes, and personas in parallel
    const [campaignsRes, bookingRes, personasRes] = await Promise.all([
      getEmailCampaigns(activeWorkspace),
      listBookingProcesses(activeWorkspace),
      listAiPersonas(activeWorkspace),
    ])

    if (!campaignsRes.success || !campaignsRes.data) {
      toast.error(campaignsRes.error || "Failed to load email campaigns")
      setLoading(false)
      return
    }

    if (bookingRes.success && bookingRes.data) {
      setBookingProcesses(bookingRes.data)
    }

    if (personasRes.success && personasRes.data) {
      setPersonas(personasRes.data)
    }

    const nextRows: CampaignRow[] = campaignsRes.data.map((c) => ({
      id: c.id,
      name: c.name,
      bisonCampaignId: c.bisonCampaignId,
      leadCount: c.leadCount,
      responseMode: c.responseMode,
      autoSendConfidenceThreshold: c.autoSendConfidenceThreshold ?? 0.9,
      autoSendDelayMinSeconds: c.autoSendDelayMinSeconds ?? 180,
      autoSendDelayMaxSeconds: c.autoSendDelayMaxSeconds ?? 420,
      autoSendScheduleMode: c.autoSendScheduleMode ?? null,
      autoSendCustomSchedule: coerceCustomSchedule(c.autoSendCustomSchedule) ?? DEFAULT_CUSTOM_SCHEDULE,
      bookingProcessId: c.bookingProcessId,
      bookingProcessName: c.bookingProcessName,
      aiPersonaId: c.aiPersonaId,
      aiPersonaName: c.aiPersonaName,
    }))

    const nextBaseline: Record<string, CampaignRow> = {}
    for (const row of nextRows) nextBaseline[row.id] = row

    setRows(nextRows)
    setBaselineById(nextBaseline)
    setScheduleDraftsById({})
    setLoading(false)
  }, [activeWorkspace])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!activeWorkspace) return

    const handler = ((event: Event) => {
      const detail = (event as CustomEvent<EmailCampaignsSyncedDetail>).detail
      if (!detail?.clientId) return
      if (detail.clientId !== activeWorkspace) return
      load()
    }) as EventListener

    window.addEventListener(EMAIL_CAMPAIGNS_SYNCED_EVENT, handler)
    return () => window.removeEventListener(EMAIL_CAMPAIGNS_SYNCED_EVENT, handler)
  }, [activeWorkspace, load])

  const dirtyIds = useMemo(() => {
    const ids = new Set<string>()
    for (const row of rows) {
      const baseline = baselineById[row.id]
      if (!baseline) continue
      if (!areEqual(row, baseline)) ids.add(row.id)
    }
    return ids
  }, [rows, baselineById])

  const counts = useMemo(() => {
    let ai = 0
    let setter = 0
    for (const row of rows) {
      if (row.responseMode === "AI_AUTO_SEND") ai++
      else setter++
    }
    return { ai, setter, total: rows.length }
  }, [rows])

  const updateRow = (id: string, patch: Partial<CampaignRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const updateScheduleDraft = (id: string, patch: Partial<typeof DEFAULT_SCHEDULE_DRAFT>) => {
    setScheduleDraftsById((prev) => ({
      ...prev,
      [id]: {
        ...DEFAULT_SCHEDULE_DRAFT,
        ...(prev[id] ?? {}),
        ...patch,
      },
    }))
  }

  const resetRow = (id: string) => {
    const baseline = baselineById[id]
    if (!baseline) return
    setRows((prev) => prev.map((row) => (row.id === id ? baseline : row)))
  }

  const saveRow = async (id: string) => {
    const row = rows.find((r) => r.id === id)
    const baseline = baselineById[id]
    if (!row || !baseline) return

    setSavingIds((prev) => ({ ...prev, [id]: true }))

    // Check what changed
    const scheduleChanged =
      row.autoSendScheduleMode !== baseline.autoSendScheduleMode ||
      (row.autoSendScheduleMode === "CUSTOM" &&
        JSON.stringify(row.autoSendCustomSchedule) !== JSON.stringify(baseline.autoSendCustomSchedule))
    const responseModeChanged =
      row.responseMode !== baseline.responseMode ||
      Math.abs((row.autoSendConfidenceThreshold ?? 0) - (baseline.autoSendConfidenceThreshold ?? 0)) >= 0.00001 ||
      row.autoSendDelayMinSeconds !== baseline.autoSendDelayMinSeconds ||
      row.autoSendDelayMaxSeconds !== baseline.autoSendDelayMaxSeconds ||
      scheduleChanged
    const bookingProcessChanged = row.bookingProcessId !== baseline.bookingProcessId
    const personaChanged = row.aiPersonaId !== baseline.aiPersonaId

    let nextRow = { ...row }

    // Save response mode if changed
    if (responseModeChanged) {
      const res = await updateEmailCampaignConfig(row.id, {
        responseMode: row.responseMode,
        autoSendConfidenceThreshold: clamp01(row.autoSendConfidenceThreshold),
        autoSendDelayMinSeconds: row.autoSendDelayMinSeconds,
        autoSendDelayMaxSeconds: row.autoSendDelayMaxSeconds,
        autoSendScheduleMode: row.autoSendScheduleMode,
        autoSendCustomSchedule: row.autoSendScheduleMode === "CUSTOM" ? row.autoSendCustomSchedule : null,
      })

      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to save campaign settings")
        setSavingIds((prev) => ({ ...prev, [id]: false }))
        return
      }

      nextRow.responseMode = res.data.responseMode
      nextRow.autoSendConfidenceThreshold = res.data.autoSendConfidenceThreshold
      nextRow.autoSendDelayMinSeconds = res.data.autoSendDelayMinSeconds
      nextRow.autoSendDelayMaxSeconds = res.data.autoSendDelayMaxSeconds
      nextRow.autoSendScheduleMode = res.data.autoSendScheduleMode
      nextRow.autoSendCustomSchedule =
        coerceCustomSchedule(res.data.autoSendCustomSchedule) ?? nextRow.autoSendCustomSchedule
    }

    // Save booking process if changed
    if (bookingProcessChanged) {
      const res = await assignBookingProcessToCampaign(row.id, row.bookingProcessId)

      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to assign booking process")
        setSavingIds((prev) => ({ ...prev, [id]: false }))
        return
      }

      nextRow.bookingProcessId = res.data.bookingProcessId
      nextRow.bookingProcessName = res.data.bookingProcessName
    }

    // Save AI persona if changed
    if (personaChanged) {
      const res = await assignPersonaToCampaign(row.id, row.aiPersonaId)

      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to assign AI persona")
        setSavingIds((prev) => ({ ...prev, [id]: false }))
        return
      }

      nextRow.aiPersonaId = res.data.aiPersonaId
      nextRow.aiPersonaName = res.data.aiPersonaName
    }

    setRows((prev) => prev.map((r) => (r.id === id ? nextRow : r)))
    setBaselineById((prev) => ({ ...prev, [id]: nextRow }))
    setSavingIds((prev) => ({ ...prev, [id]: false }))
    toast.success("Campaign settings saved")
  }

  return (
    <Card className="border-muted/60">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Campaign Assignment (AI Auto‑Send vs Setter)
            </CardTitle>
            <CardDescription>
              Controls which EmailBison campaigns can auto‑send AI replies (only when confidence meets threshold).
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={counts.ai > 0 ? "default" : "secondary"} className="whitespace-nowrap">
              AI Auto‑Send: {counts.ai}/{counts.total}
            </Badge>
            <Button variant="outline" size="sm" onClick={load} disabled={!activeWorkspace || loading}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <div className="flex flex-col gap-1">
            <span>
              <span className="font-medium text-foreground">Setter‑managed</span>: drafts generate, humans send.
            </span>
            <span>
              <span className="font-medium text-foreground">AI auto‑send</span>: drafts generate and auto‑send when evaluator says{" "}
              <span className="font-mono">safe_to_send</span> and{" "}
              <span className="font-mono">confidence ≥ threshold</span>; otherwise Jon gets a Slack DM for review.
            </span>
            <span className="text-xs">
              Tip: For the 80/20 experiment, start with ~1 in 5 campaigns set to AI auto‑send.
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {!activeWorkspace ? (
          <div className="py-8 text-center text-muted-foreground">Select a workspace to configure campaigns.</div>
        ) : loading ? (
          <div className="py-8 text-center text-muted-foreground">Loading campaigns…</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            No EmailBison campaigns found for this workspace. Use “Sync Email” in Integrations to import campaigns.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const isDirty = dirtyIds.has(row.id)
              const saving = Boolean(savingIds[row.id])
              const modeLabel =
                row.responseMode === "AI_AUTO_SEND" ? "AI auto‑send" : "Setter‑managed"

              const thresholdDisabled = row.responseMode !== "AI_AUTO_SEND"
              const thresholdPct = Math.round((row.autoSendConfidenceThreshold || 0) * 100)
              const scheduleValue = row.autoSendScheduleMode ?? "INHERIT"
              const scheduleDraft = scheduleDraftsById[row.id] ?? DEFAULT_SCHEDULE_DRAFT
              const sliderValue = Math.min(100, Math.max(50, thresholdPct))
              const isOpen = expandedRows[row.id] ?? false

              return (
                <Collapsible
                  key={row.id}
                  open={isOpen}
                  onOpenChange={(open) => setExpandedRows((prev) => ({ ...prev, [row.id]: open }))}
                  className={cn(
                    "rounded-lg border",
                    isDirty ? "border-primary/30 bg-muted/30" : "border-border"
                  )}
                >
                  <div className="space-y-3 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{row.name}</span>
                          {isDirty ? (
                            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                              Unsaved
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.bisonCampaignId} · {row.leadCount} leads
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={row.responseMode === "AI_AUTO_SEND" ? "default" : "secondary"}
                          className="whitespace-nowrap"
                        >
                          {modeLabel}
                        </Badge>
                        <Badge variant="outline" className={thresholdDisabled ? "opacity-60" : undefined}>
                          {thresholdPct}%
                        </Badge>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Toggle campaign settings">
                            <ChevronDown
                              className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
                            />
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resetRow(row.id)}
                        disabled={!isDirty || saving}
                        title="Revert"
                      >
                        <Undo2 className="h-4 w-4 mr-1.5" />
                        Revert
                      </Button>
                      <Button
                        variant={row.responseMode === "AI_AUTO_SEND" ? "default" : "secondary"}
                        size="sm"
                        onClick={() => saveRow(row.id)}
                        disabled={!isDirty || saving}
                      >
                        <Save className="h-4 w-4 mr-1.5" />
                        Save
                      </Button>
                    </div>
                  </div>

                  <CollapsibleContent className="border-t px-4 pb-4 pt-3">
                    <div className="space-y-4">
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Response mode</Label>
                          <Select
                            value={row.responseMode}
                            onValueChange={(v) => updateRow(row.id, { responseMode: v as CampaignResponseMode })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="SETTER_MANAGED">Setter‑managed</SelectItem>
                              <SelectItem value="AI_AUTO_SEND">AI auto‑send</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            {row.responseMode === "AI_AUTO_SEND"
                              ? `Auto‑sends when confident (≥ ${thresholdPct}%).`
                              : "Drafts only (no auto‑send)."}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-medium">Draft confidence threshold</Label>
                            <Badge variant="outline" className={thresholdDisabled ? "opacity-60" : undefined}>
                              {thresholdPct}%
                            </Badge>
                          </div>
                          <Slider
                            value={[sliderValue]}
                            min={50}
                            max={100}
                            step={5}
                            disabled={thresholdDisabled}
                            onValueChange={([v]) => {
                              const nextValue = clamp01(v / 100)
                              updateRow(row.id, { autoSendConfidenceThreshold: nextValue })
                            }}
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>More aggressive (50%)</span>
                            <span>More conservative (100%)</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {thresholdDisabled ? "Enable AI auto‑send to edit." : "Higher = fewer auto‑sends, more reviews."}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="flex items-center gap-2 text-sm font-medium">
                            <Timer className="h-4 w-4 text-muted-foreground" />
                            Auto-send delay
                          </Label>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={60}
                              step={1}
                              className="w-16"
                              value={Math.round(row.autoSendDelayMinSeconds / 60)}
                              disabled={thresholdDisabled}
                              onChange={(e) => {
                                const minutes = Math.max(0, Math.min(60, Number(e.target.value) || 0))
                                const seconds = minutes * 60
                                updateRow(row.id, {
                                  autoSendDelayMinSeconds: seconds,
                                  autoSendDelayMaxSeconds: Math.max(seconds, row.autoSendDelayMaxSeconds),
                                })
                              }}
                            />
                            <span className="text-muted-foreground">–</span>
                            <Input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={60}
                              step={1}
                              className="w-16"
                              value={Math.round(row.autoSendDelayMaxSeconds / 60)}
                              disabled={thresholdDisabled}
                              onChange={(e) => {
                                const minutes = Math.max(0, Math.min(60, Number(e.target.value) || 0))
                                const seconds = minutes * 60
                                updateRow(row.id, {
                                  autoSendDelayMaxSeconds: seconds,
                                  autoSendDelayMinSeconds: Math.min(seconds, row.autoSendDelayMinSeconds),
                                })
                              }}
                            />
                            <span className="text-xs text-muted-foreground">min</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {thresholdDisabled
                              ? "Enable AI auto‑send to edit."
                              : row.autoSendDelayMinSeconds === 0 && row.autoSendDelayMaxSeconds === 0
                                ? "Sends immediately (0 delay)."
                                : `Waits ${Math.round(row.autoSendDelayMinSeconds / 60)}–${Math.round(
                                    row.autoSendDelayMaxSeconds / 60
                                  )} min before send.`}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Booking process</Label>
                          <Select
                            value={row.bookingProcessId ?? "none"}
                            onValueChange={(v) => {
                              const processId = v === "none" ? null : v
                              const process = bookingProcesses.find((p) => p.id === processId)
                              updateRow(row.id, {
                                bookingProcessId: processId,
                                bookingProcessName: process?.name ?? null,
                              })
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="None">
                                {row.bookingProcessName ?? "None"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None (Manual)</SelectItem>
                              {bookingProcesses.map((bp) => (
                                <SelectItem key={bp.id} value={bp.id}>
                                  {bp.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            {row.bookingProcessId ? "Controls how AI offers booking." : "AI drafts without booking guidance."}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="flex items-center gap-2 text-sm font-medium">
                            <User className="h-4 w-4 text-muted-foreground" />
                            AI persona
                          </Label>
                          <Select
                            value={row.aiPersonaId ?? "default"}
                            onValueChange={(v) => {
                              const personaId = v === "default" ? null : v
                              const persona = personas.find((p) => p.id === personaId)
                              updateRow(row.id, {
                                aiPersonaId: personaId,
                                aiPersonaName: persona?.name ?? null,
                              })
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Default">
                                {row.aiPersonaName ?? "Default"}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Default (Workspace)</SelectItem>
                              {personas.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                  {p.isDefault && " ★"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            {row.aiPersonaId ? "Custom persona for this campaign." : "Uses workspace default persona."}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="flex items-center gap-2 text-sm font-medium">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          Auto-send schedule
                        </Label>
                        <div className="space-y-2">
                          <Select
                            value={scheduleValue}
                            onValueChange={(v) => {
                              const nextMode =
                                v === "INHERIT" ? null : (v as "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM")
                              updateRow(row.id, {
                                autoSendScheduleMode: nextMode,
                                autoSendCustomSchedule:
                                  nextMode === "CUSTOM"
                                    ? row.autoSendCustomSchedule ?? DEFAULT_CUSTOM_SCHEDULE
                                    : row.autoSendCustomSchedule,
                              })
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="INHERIT">Inherit workspace</SelectItem>
                              <SelectItem value="ALWAYS">Always (24/7)</SelectItem>
                              <SelectItem value="BUSINESS_HOURS">Business hours</SelectItem>
                              <SelectItem value="CUSTOM">Custom</SelectItem>
                            </SelectContent>
                          </Select>

                          {row.autoSendScheduleMode === "CUSTOM" ? (
                            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                {SCHEDULE_DAYS.map((day) => (
                                  <label key={day.value} className="flex items-center gap-2 text-xs">
                                    <Checkbox
                                      checked={row.autoSendCustomSchedule.days.includes(day.value)}
                                      onCheckedChange={(v) => {
                                        const checked = v === true
                                        const nextDays = checked
                                          ? row.autoSendCustomSchedule.days.includes(day.value)
                                            ? row.autoSendCustomSchedule.days
                                            : [...row.autoSendCustomSchedule.days, day.value]
                                          : row.autoSendCustomSchedule.days.filter((d) => d !== day.value)
                                        updateRow(row.id, {
                                          autoSendCustomSchedule: {
                                            ...row.autoSendCustomSchedule,
                                            days: nextDays,
                                          },
                                        })
                                      }}
                                    />
                                    {day.label}
                                  </label>
                                ))}
                              </div>
                              <div className="flex items-center gap-2">
                                <Input
                                  type="time"
                                  className="w-24"
                                  value={row.autoSendCustomSchedule.startTime}
                                  onChange={(e) =>
                                    updateRow(row.id, {
                                      autoSendCustomSchedule: {
                                        ...row.autoSendCustomSchedule,
                                        startTime: e.target.value,
                                      },
                                    })
                                  }
                                />
                                <span className="text-xs text-muted-foreground">–</span>
                                <Input
                                  type="time"
                                  className="w-24"
                                  value={row.autoSendCustomSchedule.endTime}
                                  onChange={(e) =>
                                    updateRow(row.id, {
                                      autoSendCustomSchedule: {
                                        ...row.autoSendCustomSchedule,
                                        endTime: e.target.value,
                                      },
                                    })
                                  }
                                />
                              </div>

                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                  Additional blackout dates (campaign-only)
                                </Label>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Input
                                    type="date"
                                    className="w-[140px]"
                                    value={scheduleDraft.blackoutDate}
                                    onChange={(e) => updateScheduleDraft(row.id, { blackoutDate: e.target.value })}
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!scheduleDraft.blackoutDate}
                                    onClick={() => {
                                      if (!scheduleDraft.blackoutDate) return
                                      updateRow(row.id, {
                                        autoSendCustomSchedule: {
                                          ...row.autoSendCustomSchedule,
                                          holidays: {
                                            ...row.autoSendCustomSchedule.holidays,
                                            additionalBlackoutDates: normalizeDateList([
                                              ...row.autoSendCustomSchedule.holidays.additionalBlackoutDates,
                                              scheduleDraft.blackoutDate,
                                            ]),
                                          },
                                        },
                                      })
                                      updateScheduleDraft(row.id, { blackoutDate: "" })
                                    }}
                                  >
                                    Add
                                  </Button>
                                </div>
                                {row.autoSendCustomSchedule.holidays.additionalBlackoutDates.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {row.autoSendCustomSchedule.holidays.additionalBlackoutDates.map((date) => (
                                      <Badge key={date} variant="outline" className="text-[10px]">
                                        {date}
                                        <button
                                          type="button"
                                          className="ml-1 text-muted-foreground hover:text-destructive"
                                          onClick={() => {
                                            updateRow(row.id, {
                                              autoSendCustomSchedule: {
                                                ...row.autoSendCustomSchedule,
                                                holidays: {
                                                  ...row.autoSendCustomSchedule.holidays,
                                                  additionalBlackoutDates: row.autoSendCustomSchedule.holidays.additionalBlackoutDates.filter(
                                                    (d) => d !== date
                                                  ),
                                                },
                                              },
                                            })
                                          }}
                                          aria-label="Remove blackout date"
                                        >
                                          ×
                                        </button>
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                              </div>

                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Additional blackout ranges</Label>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Input
                                    type="date"
                                    className="w-[140px]"
                                    value={scheduleDraft.rangeStart}
                                    onChange={(e) => updateScheduleDraft(row.id, { rangeStart: e.target.value })}
                                  />
                                  <Input
                                    type="date"
                                    className="w-[140px]"
                                    value={scheduleDraft.rangeEnd}
                                    onChange={(e) => updateScheduleDraft(row.id, { rangeEnd: e.target.value })}
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!scheduleDraft.rangeStart || !scheduleDraft.rangeEnd}
                                    onClick={() => {
                                      if (!scheduleDraft.rangeStart || !scheduleDraft.rangeEnd) return
                                      updateRow(row.id, {
                                        autoSendCustomSchedule: {
                                          ...row.autoSendCustomSchedule,
                                          holidays: {
                                            ...row.autoSendCustomSchedule.holidays,
                                            additionalBlackoutDateRanges: normalizeDateRanges([
                                              ...row.autoSendCustomSchedule.holidays.additionalBlackoutDateRanges,
                                              { start: scheduleDraft.rangeStart, end: scheduleDraft.rangeEnd },
                                            ]),
                                          },
                                        },
                                      })
                                      updateScheduleDraft(row.id, { rangeStart: "", rangeEnd: "" })
                                    }}
                                  >
                                    Add
                                  </Button>
                                </div>
                                {row.autoSendCustomSchedule.holidays.additionalBlackoutDateRanges.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {row.autoSendCustomSchedule.holidays.additionalBlackoutDateRanges.map((range) => (
                                      <Badge key={`${range.start}:${range.end}`} variant="outline" className="text-[10px]">
                                        {range.start} → {range.end}
                                        <button
                                          type="button"
                                          className="ml-1 text-muted-foreground hover:text-destructive"
                                          onClick={() => {
                                            updateRow(row.id, {
                                              autoSendCustomSchedule: {
                                                ...row.autoSendCustomSchedule,
                                                holidays: {
                                                  ...row.autoSendCustomSchedule.holidays,
                                                  additionalBlackoutDateRanges: row.autoSendCustomSchedule.holidays.additionalBlackoutDateRanges.filter(
                                                    (r) => !(r.start === range.start && r.end === range.end)
                                                  ),
                                                },
                                              },
                                            })
                                          }}
                                          aria-label="Remove blackout range"
                                        >
                                          ×
                                        </button>
                                      </Badge>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {scheduleValue === "INHERIT" ? "Uses workspace schedule." : "Applies to this campaign only."}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
