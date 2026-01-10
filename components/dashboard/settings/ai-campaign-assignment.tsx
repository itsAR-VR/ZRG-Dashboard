"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Bot, RefreshCw, Save, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getEmailCampaigns, updateEmailCampaignConfig } from "@/actions/email-campaign-actions"
import type { CampaignResponseMode } from "@prisma/client"

type CampaignRow = {
  id: string
  name: string
  bisonCampaignId: string
  leadCount: number
  responseMode: CampaignResponseMode
  autoSendConfidenceThreshold: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function areEqual(a: CampaignRow, b: CampaignRow): boolean {
  return (
    a.responseMode === b.responseMode &&
    Math.abs((a.autoSendConfidenceThreshold ?? 0) - (b.autoSendConfidenceThreshold ?? 0)) < 0.00001
  )
}

export function AiCampaignAssignmentPanel({ activeWorkspace }: { activeWorkspace?: string | null }) {
  const [rows, setRows] = useState<CampaignRow[]>([])
  const [baselineById, setBaselineById] = useState<Record<string, CampaignRow>>({})
  const [loading, setLoading] = useState(false)
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    if (!activeWorkspace) {
      setRows([])
      setBaselineById({})
      return
    }

    setLoading(true)
    const res = await getEmailCampaigns(activeWorkspace)
    if (!res.success || !res.data) {
      toast.error(res.error || "Failed to load email campaigns")
      setLoading(false)
      return
    }

    const nextRows: CampaignRow[] = res.data.map((c) => ({
      id: c.id,
      name: c.name,
      bisonCampaignId: c.bisonCampaignId,
      leadCount: c.leadCount,
      responseMode: c.responseMode,
      autoSendConfidenceThreshold: c.autoSendConfidenceThreshold ?? 0.9,
    }))

    const nextBaseline: Record<string, CampaignRow> = {}
    for (const row of nextRows) nextBaseline[row.id] = row

    setRows(nextRows)
    setBaselineById(nextBaseline)
    setLoading(false)
  }, [activeWorkspace])

  useEffect(() => {
    load()
  }, [load])

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

  const resetRow = (id: string) => {
    const baseline = baselineById[id]
    if (!baseline) return
    setRows((prev) => prev.map((row) => (row.id === id ? baseline : row)))
  }

  const saveRow = async (id: string) => {
    const row = rows.find((r) => r.id === id)
    if (!row) return

    setSavingIds((prev) => ({ ...prev, [id]: true }))
    const res = await updateEmailCampaignConfig(row.id, {
      responseMode: row.responseMode,
      autoSendConfidenceThreshold: clamp01(row.autoSendConfidenceThreshold),
    })

    if (!res.success || !res.data) {
      toast.error(res.error || "Failed to save campaign settings")
      setSavingIds((prev) => ({ ...prev, [id]: false }))
      return
    }

    const nextRow: CampaignRow = {
      ...row,
      responseMode: res.data.responseMode,
      autoSendConfidenceThreshold: res.data.autoSendConfidenceThreshold,
    }

    setRows((prev) => prev.map((r) => (r.id === id ? nextRow : r)))
    setBaselineById((prev) => ({ ...prev, [id]: nextRow }))
    setSavingIds((prev) => ({ ...prev, [id]: false }))
    toast.success("Campaign assignment saved")
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>
                  <div className="flex items-center justify-between">
                    <span>Threshold</span>
                    <span className="text-xs text-muted-foreground">0–1</span>
                  </div>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isDirty = dirtyIds.has(row.id)
                const saving = Boolean(savingIds[row.id])
                const modeLabel =
                  row.responseMode === "AI_AUTO_SEND" ? "AI auto‑send" : "Setter‑managed"

                const thresholdDisabled = row.responseMode !== "AI_AUTO_SEND"
                const thresholdPct = Math.round((row.autoSendConfidenceThreshold || 0) * 100)

                return (
                  <TableRow key={row.id} className={isDirty ? "bg-muted/30" : undefined}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span className="truncate">{row.name}</span>
                        <span className="text-xs text-muted-foreground">{row.bisonCampaignId}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{row.leadCount}</TableCell>
                    <TableCell className="min-w-[220px]">
                      <div className="flex flex-col gap-1.5">
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
                        <div className="text-xs text-muted-foreground">
                          {modeLabel === "AI auto‑send" ? (
                            <span>
                              Auto‑sends when confident (≥ {thresholdPct}%).
                            </span>
                          ) : (
                            <span>Drafts only (no auto‑send).</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[220px]">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={1}
                            step={0.01}
                            value={Number.isFinite(row.autoSendConfidenceThreshold) ? row.autoSendConfidenceThreshold : 0.9}
                            disabled={thresholdDisabled}
                            onChange={(e) => {
                              const n = clamp01(Number(e.target.value))
                              updateRow(row.id, { autoSendConfidenceThreshold: n })
                            }}
                          />
                          <Badge variant="outline" className={thresholdDisabled ? "opacity-60" : undefined}>
                            {thresholdPct}%
                          </Badge>
                        </div>
                        <Label className="text-xs text-muted-foreground">
                          {thresholdDisabled ? "Enable AI auto‑send to edit." : "Higher = fewer auto‑sends, more reviews."}
                        </Label>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
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
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

