"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useDebounce } from "use-debounce"

import {
  getCrmAssigneeOptions,
  getCrmSheetRows,
  getCrmWindowSummary,
  updateCrmSheetCell,
  type CrmWindowSummary,
  type CrmSheetFilters,
  type CrmSheetRow,
} from "@/actions/analytics-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { toDisplayPhone } from "@/lib/phone-utils"
import { cn } from "@/lib/utils"

const LEAD_STATUSES = [
  { value: "all", label: "All Statuses" },
  { value: "new", label: "New" },
  { value: "qualified", label: "Qualified" },
  { value: "unqualified", label: "Unqualified" },
  { value: "meeting-booked", label: "Meeting Booked" },
  { value: "not-interested", label: "Not Interested" },
  { value: "blacklisted", label: "Blacklisted" },
]

const RESPONSE_MODES = [
  { value: "all", label: "All Responses" },
  { value: "AI", label: "AI" },
  { value: "HUMAN", label: "Human" },
  { value: "UNKNOWN", label: "Unknown" },
]

const CRM_TABLE_ROW_ESTIMATE_PX = 56
const CRM_TABLE_COLUMN_COUNT = 34

const formatDate = (value: Date | null) => {
  if (!value) return "—"
  return new Date(value).toLocaleDateString()
}

const renderValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return "—"
  return value
}

const responseModeLabel = (value: CrmSheetRow["responseMode"]) => {
  if (!value) return "—"
  if (value === "AI") return "AI"
  if (value === "HUMAN") return "Human"
  return "Unknown"
}

const formatPercent01 = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0%"
  return `${Math.round(value * 100)}%`
}

type CrmRowsResult = Awaited<ReturnType<typeof getCrmSheetRows>>
type CrmSummaryResult = Awaited<ReturnType<typeof getCrmWindowSummary>>
type CrmAssigneesResult = Awaited<ReturnType<typeof getCrmAssigneeOptions>>

function isReadApiDisabledPayload(payload: unknown): payload is { error: "READ_API_DISABLED" } {
  if (!payload || typeof payload !== "object") return false
  return (payload as { error?: unknown }).error === "READ_API_DISABLED"
}

function appendCrmFilters(
  params: URLSearchParams,
  filters: CrmSheetFilters | undefined,
  window?: { from: string; to: string }
) {
  if (!filters) {
    if (window?.from) params.set("dateFrom", window.from)
    if (window?.to) params.set("dateTo", window.to)
    return
  }

  if (filters.campaign) params.set("campaign", filters.campaign)
  if (filters.leadCategory) params.set("leadCategory", filters.leadCategory)
  if (filters.leadStatus) params.set("leadStatus", filters.leadStatus)
  if (filters.responseMode) params.set("responseMode", filters.responseMode)
  if (window?.from || filters.dateFrom) params.set("dateFrom", window?.from ?? String(filters.dateFrom))
  if (window?.to || filters.dateTo) params.set("dateTo", window?.to ?? String(filters.dateTo))
}

async function getCrmRowsRead(input: {
  clientId: string
  cursor?: string | null
  limit?: number
  filters?: CrmSheetFilters
  window?: { from: string; to: string }
}): Promise<CrmRowsResult> {
  const params = new URLSearchParams()
  params.set("mode", "rows")
  params.set("clientId", input.clientId)
  params.set("limit", String(input.limit ?? 150))
  if (input.cursor) params.set("cursor", input.cursor)
  appendCrmFilters(params, input.filters, input.window)

  try {
    const response = await fetch(`/api/analytics/crm/rows?${params.toString()}`, { method: "GET" })
    const json = (await response.json()) as CrmRowsResult
    if (!response.ok && isReadApiDisabledPayload(json)) {
      return getCrmSheetRows(input)
    }
    return json
  } catch {
    return getCrmSheetRows(input)
  }
}

async function getCrmSummaryRead(input: {
  clientId: string
  filters?: CrmSheetFilters
  window?: { from: string; to: string }
}): Promise<CrmSummaryResult> {
  const params = new URLSearchParams()
  params.set("mode", "summary")
  params.set("clientId", input.clientId)
  appendCrmFilters(params, input.filters, input.window)

  try {
    const response = await fetch(`/api/analytics/crm/rows?${params.toString()}`, { method: "GET" })
    const json = (await response.json()) as CrmSummaryResult
    if (!response.ok && isReadApiDisabledPayload(json)) {
      return getCrmWindowSummary({
        clientId: input.clientId,
        filters: {
          ...(input.filters || {}),
          ...(input.window?.from ? { dateFrom: input.window.from } : {}),
          ...(input.window?.to ? { dateTo: input.window.to } : {}),
        },
      })
    }
    return json
  } catch {
    return getCrmWindowSummary({
      clientId: input.clientId,
      filters: {
        ...(input.filters || {}),
        ...(input.window?.from ? { dateFrom: input.window.from } : {}),
        ...(input.window?.to ? { dateTo: input.window.to } : {}),
      },
    })
  }
}

async function getCrmAssigneesRead(clientId: string): Promise<CrmAssigneesResult> {
  const params = new URLSearchParams()
  params.set("mode", "assignees")
  params.set("clientId", clientId)

  try {
    const response = await fetch(`/api/analytics/crm/rows?${params.toString()}`, { method: "GET" })
    const json = (await response.json()) as CrmAssigneesResult
    if (!response.ok && isReadApiDisabledPayload(json)) {
      return getCrmAssigneeOptions({ clientId })
    }
    return json
  } catch {
    return getCrmAssigneeOptions({ clientId })
  }
}

const responseTypeLabel = (value: CrmSheetRow["responseType"]) => {
  switch (value) {
    case "MEETING_REQUEST":
      return "Meeting request"
    case "INFORMATION_REQUEST":
      return "Info request"
    case "FOLLOW_UP_FUTURE":
      return "Follow-up future"
    case "OBJECTION":
      return "Objection"
    default:
      return "Other"
  }
}

type CrmAssigneeOption = { userId: string; email: string | null }

type EditableField =
  | "jobTitle"
  | "leadCategory"
  | "leadStatus"
  | "leadType"
  | "applicationStatus"
  | "notes"
  | "campaign"
  | "email"
  | "phone"
  | "linkedinUrl"
  | "assignedToUserId"

type SaveCellArgs = {
  rowId: string
  leadId: string
  field: EditableField
  value: string | null
  updateAutomation?: boolean
}

type SaveCellResult = { success: boolean; error?: string; newValue?: string | null }

type SaveCellFn = (args: SaveCellArgs) => Promise<SaveCellResult>

interface EditableTextCellProps {
  rowId: string
  leadId: string
  field: EditableField
  value: string | null
  displayValue?: string | null
  multiline?: boolean
  showAutomationToggle?: boolean
  onSave: SaveCellFn
}

function EditableTextCell({
  rowId,
  leadId,
  field,
  value,
  displayValue,
  multiline,
  showAutomationToggle,
  onSave,
}: EditableTextCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(value ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)
  const [updateAutomation, setUpdateAutomation] = useState(false)

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(value ?? "")
    }
  }, [value, isEditing])

  const startEdit = () => {
    setIsEditing(true)
    setError(null)
    setUpdateAutomation(false)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setError(null)
    setDraftValue(value ?? "")
  }

  const handleSave = async () => {
    if (isSaving) return
    const trimmed = multiline ? draftValue : draftValue.trim()
    const nextValue = trimmed.length > 0 ? trimmed : null
    setIsSaving(true)
    const result = await onSave({
      rowId,
      leadId,
      field,
      value: nextValue,
      updateAutomation: showAutomationToggle ? updateAutomation : undefined,
    })
    setIsSaving(false)
    if (!result.success) {
      setError(result.error || "Failed to save")
      return
    }
    setError(null)
    setIsEditing(false)
    setFlash(true)
    window.setTimeout(() => setFlash(false), 800)
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    if (isEditing) void handleSave()
  }

  if (!isEditing) {
    const currentDisplay = displayValue ?? value
    const hasValue = currentDisplay !== null && currentDisplay !== undefined && currentDisplay !== ""
    return (
      <button
        type="button"
        onClick={startEdit}
        className={cn(
          "w-full text-left hover:text-foreground focus-visible:outline-none",
          flash ? "rounded bg-emerald-50/70" : "",
          hasValue ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {renderValue(currentDisplay)}
      </button>
    )
  }

  return (
    <div className="space-y-1" onBlur={handleBlur}>
      {multiline ? (
        <Textarea
          autoFocus
          rows={3}
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              cancelEdit()
            }
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault()
              void handleSave()
            }
          }}
        />
      ) : (
        <Input
          autoFocus
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              cancelEdit()
            }
            if (event.key === "Enter") {
              event.preventDefault()
              void handleSave()
            }
          }}
        />
      )}
      {showAutomationToggle ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={updateAutomation}
            onCheckedChange={(checked) => setUpdateAutomation(Boolean(checked))}
          />
          Also update automation
        </label>
      ) : null}
      {isSaving ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving...
        </div>
      ) : null}
      {error ? <div className="text-xs text-red-500">{error}</div> : null}
    </div>
  )
}

interface EditableSelectCellProps {
  rowId: string
  leadId: string
  value: string | null
  options: CrmAssigneeOption[]
  isLoading: boolean
  onSave: SaveCellFn
}

function EditableSelectCell({
  rowId,
  leadId,
  value,
  options,
  isLoading,
  onSave,
}: EditableSelectCellProps) {
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  const resolvedId = useMemo(() => {
    if (!value) return ""
    if (!value.includes("@")) return value
    const match = options.find((option) => option.email === value)
    return match?.userId ?? ""
  }, [value, options])

  const selectValue = resolvedId || undefined
  const isDisabled = isSaving || options.length === 0

  const handleChange = async (nextValue: string) => {
    const selectedId = nextValue === "unassigned" ? null : nextValue
    setIsSaving(true)
    setError(null)
    const result = await onSave({
      rowId,
      leadId,
      field: "assignedToUserId",
      value: selectedId,
    })
    setIsSaving(false)
    if (!result.success) {
      setError(result.error || "Failed to save")
      return
    }
    setFlash(true)
    window.setTimeout(() => setFlash(false), 800)
  }

  if (isLoading && options.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading...
      </div>
    )
  }

  return (
    <div className={cn("space-y-1", flash && "rounded bg-emerald-50/70")}>
      <Select value={selectValue} onValueChange={handleChange} disabled={isDisabled}>
        <SelectTrigger className="h-8">
          <SelectValue placeholder={value ? renderValue(value) : "Unassigned"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.userId} value={option.userId}>
              {option.email ?? option.userId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isSaving ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Saving...
        </div>
      ) : null}
      {error ? <div className="text-xs text-red-500">{error}</div> : null}
    </div>
  )
}

interface AnalyticsCrmTableProps {
  activeWorkspace?: string | null
  window?: { from: string; to: string }
  windowLabel?: string
}

export function AnalyticsCrmTable({ activeWorkspace, window, windowLabel }: AnalyticsCrmTableProps) {
  const [rows, setRows] = useState<CrmSheetRow[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<CrmWindowSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [filters, setFilters] = useState<CrmSheetFilters>({})
  const [assigneeOptions, setAssigneeOptions] = useState<CrmAssigneeOption[]>([])
  const [assigneeLoading, setAssigneeLoading] = useState(false)
  const tableViewportRef = useRef<HTMLDivElement>(null)

  const canLoadMore = Boolean(nextCursor)
  const windowFrom = window?.from ?? null
  const windowTo = window?.to ?? null
  const normalizedWindow = useMemo(() => {
    if (!windowFrom || !windowTo) return undefined
    return { from: windowFrom, to: windowTo }
  }, [windowFrom, windowTo])
  const [debouncedCampaign] = useDebounce(filters.campaign?.trim() ?? "", 350)
  const [debouncedLeadCategory] = useDebounce(filters.leadCategory?.trim() ?? "", 350)

  const normalizedFilters = useMemo(() => {
    return {
      campaign: debouncedCampaign || null,
      leadCategory: debouncedLeadCategory || null,
      leadStatus: filters.leadStatus?.trim() || null,
      responseMode: filters.responseMode ?? null,
      dateFrom: windowFrom,
      dateTo: windowTo,
    }
  }, [debouncedCampaign, debouncedLeadCategory, filters.leadStatus, filters.responseMode, windowFrom, windowTo])

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableViewportRef.current,
    estimateSize: () => CRM_TABLE_ROW_ESTIMATE_PX,
    overscan: 8,
  })

  const virtualRows = rowVirtualizer.getVirtualItems()
  const virtualPaddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0
  const virtualPaddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0

  useEffect(() => {
    tableViewportRef.current?.scrollTo({ top: 0 })
  }, [
    activeWorkspace,
    normalizedFilters.campaign,
    normalizedFilters.leadCategory,
    normalizedFilters.leadStatus,
    normalizedFilters.responseMode,
    normalizedWindow?.from,
    normalizedWindow?.to,
  ])

  useEffect(() => {
    if (!activeWorkspace) {
      setRows([])
      setNextCursor(null)
      setError(null)
      return
    }

    let cancelled = false

    const fetchRows = async () => {
      setIsLoading(true)
      setError(null)

      const result = await getCrmRowsRead({
        clientId: activeWorkspace,
        limit: 150,
        filters: normalizedFilters,
        window: normalizedWindow,
      })

      if (cancelled) return

      if (result.success && result.data) {
        setRows(result.data.rows)
        setNextCursor(result.data.nextCursor)
      } else {
        setRows([])
        setNextCursor(null)
        setError(result.error || "Failed to load CRM rows")
      }

      setIsLoading(false)
    }

    fetchRows()

    return () => {
      cancelled = true
    }
  }, [activeWorkspace, normalizedFilters, normalizedWindow])

  useEffect(() => {
    if (!activeWorkspace) {
      setSummary(null)
      setSummaryError(null)
      return
    }

    let cancelled = false

    const fetchSummary = async () => {
      setSummaryLoading(true)
      setSummaryError(null)

      const result = await getCrmSummaryRead({
        clientId: activeWorkspace,
        filters: normalizedFilters,
        window: normalizedWindow,
      })

      if (cancelled) return

      if (result.success && result.data) {
        setSummary(result.data)
      } else {
        setSummary(null)
        setSummaryError(result.error || "Failed to load CRM summary")
      }

      setSummaryLoading(false)
    }

    fetchSummary()

    return () => {
      cancelled = true
    }
  }, [activeWorkspace, normalizedFilters, normalizedWindow])

  useEffect(() => {
    if (!activeWorkspace) {
      setAssigneeOptions([])
      return
    }

    let cancelled = false

    const fetchAssignees = async () => {
      setAssigneeLoading(true)
      const result = await getCrmAssigneesRead(activeWorkspace)
      if (cancelled) return
      if (result.success && result.data) {
        setAssigneeOptions(result.data)
      } else {
        setAssigneeOptions([])
      }
      setAssigneeLoading(false)
    }

    fetchAssignees()

    return () => {
      cancelled = true
    }
  }, [activeWorkspace])

  const handleRefresh = async () => {
    if (!activeWorkspace) return
    setIsLoading(true)
    setError(null)

    const result = await getCrmRowsRead({
      clientId: activeWorkspace,
      limit: 150,
      filters: normalizedFilters,
      window: normalizedWindow,
    })

    if (result.success && result.data) {
      setRows(result.data.rows)
      setNextCursor(result.data.nextCursor)
    } else {
      setError(result.error || "Failed to refresh CRM rows")
    }

    setIsLoading(false)
  }

  const handleLoadMore = async () => {
    if (!activeWorkspace || !nextCursor) return
    setIsLoadingMore(true)

    const result = await getCrmRowsRead({
      clientId: activeWorkspace,
      cursor: nextCursor,
      limit: 150,
      filters: normalizedFilters,
      window: normalizedWindow,
    })

    const data = result.data

    if (!result.success || !data) {
      setIsLoadingMore(false)
      return
    }

    setRows((prev) => [...prev, ...data.rows])
    setNextCursor(data.nextCursor)

    setIsLoadingMore(false)
  }

  const applyRowUpdate = useCallback(
    (row: CrmSheetRow, field: EditableField, value: string | null): CrmSheetRow => {
      switch (field) {
        case "jobTitle":
          return { ...row, jobTitle: value }
        case "leadCategory":
          return { ...row, leadCategory: value }
        case "leadStatus":
          return { ...row, leadStatus: value }
        case "leadType":
          return { ...row, leadType: value }
        case "applicationStatus":
          return { ...row, applicationStatus: value }
        case "notes":
          return { ...row, notes: value }
        case "campaign":
          return { ...row, campaign: value }
        case "email":
          return { ...row, leadEmail: value }
        case "phone":
          return { ...row, phoneNumber: value }
        case "linkedinUrl":
          return { ...row, leadLinkedIn: value }
        case "assignedToUserId": {
          const assigneeEmail = value
            ? assigneeOptions.find((option) => option.userId === value)?.email ?? value
            : null
          return { ...row, appointmentSetter: assigneeEmail, setters: assigneeEmail }
        }
        default:
          return row
      }
    },
    [assigneeOptions]
  )

  const handleSaveCell = useCallback<SaveCellFn>(
    async ({ rowId, leadId, field, value, updateAutomation }) => {
      let previousRow: CrmSheetRow | null = null

      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== rowId) return row
          previousRow = row
          return applyRowUpdate(row, field, value)
        })
      )

      const result = await updateCrmSheetCell({
        leadId,
        field,
        value,
        updateAutomation,
      })

      if (!result.success) {
        if (previousRow) {
          setRows((prev) => prev.map((row) => (row.id === rowId ? previousRow! : row)))
        }
        return { success: false, error: result.error || "Failed to save" }
      }

      const finalValue = result.newValue ?? value ?? null
      if (result.newValue !== undefined) {
        setRows((prev) =>
          prev.map((row) => (row.id === rowId ? applyRowUpdate(row, field, finalValue) : row))
        )
      }

      return { success: true, newValue: finalValue }
    },
    [applyRowUpdate]
  )

  if (!activeWorkspace) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Select a workspace to view CRM analytics.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="w-[220px]"
            placeholder="Filter by campaign"
            value={filters.campaign || ""}
            onChange={(event) => setFilters((prev) => ({ ...prev, campaign: event.target.value }))}
          />
          <Input
            className="w-[200px]"
            placeholder="Filter by lead category"
            value={filters.leadCategory || ""}
            onChange={(event) => setFilters((prev) => ({ ...prev, leadCategory: event.target.value }))}
          />
          <Select
            value={filters.leadStatus ?? "all"}
            onValueChange={(value) =>
              setFilters((prev) => ({ ...prev, leadStatus: value === "all" ? null : value }))
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Lead status" />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUSES.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.responseMode ?? "all"}
            onValueChange={(value) =>
              setFilters((prev) => ({
                ...prev,
                responseMode: value === "all" ? null : (value as CrmSheetFilters["responseMode"]),
              }))
            }
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Response mode" />
            </SelectTrigger>
            <SelectContent>
              {RESPONSE_MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{rows.length.toLocaleString()} rows</Badge>
          {windowLabel ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Window: {windowLabel}
            </Badge>
          ) : null}
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {summaryLoading ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          <Loader2 className="inline h-4 w-4 animate-spin" /> Loading summary...
        </div>
      ) : summaryError ? (
        <div className="rounded-lg border p-4 text-sm text-destructive">{summaryError}</div>
      ) : summary ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Cohort leads</div>
                <div className="text-2xl font-semibold tabular-nums">{summary.totals.cohortLeads.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Booked ever</div>
                <div className="text-2xl font-semibold tabular-nums">{summary.totals.bookedEverKept.toLocaleString()}</div>
                <div className="mt-1 text-xs text-muted-foreground">Any: {summary.totals.bookedEverAny.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Cohort conversion</div>
                <div className="text-2xl font-semibold tabular-nums">{formatPercent01(summary.totals.cohortConversionRateKept)}</div>
                <div className="mt-1 text-xs text-muted-foreground">Any: {formatPercent01(summary.totals.cohortConversionRateAny)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Booked in window</div>
                <div className="text-2xl font-semibold tabular-nums">{summary.totals.bookedInWindowKept.toLocaleString()}</div>
                <div className="mt-1 text-xs text-muted-foreground">Any: {summary.totals.bookedInWindowAny.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">In-window rate</div>
                <div className="text-2xl font-semibold tabular-nums">{formatPercent01(summary.totals.inWindowBookingRateKept)}</div>
                <div className="mt-1 text-xs text-muted-foreground">Any: {formatPercent01(summary.totals.inWindowBookingRateAny)}</div>
              </CardContent>
            </Card>
          </div>

          <div className="text-xs text-muted-foreground">
            Kept excludes canceled appointments. Any includes booking evidence even if later canceled.
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Response Type</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Booked</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.byResponseType.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{responseTypeLabel(row.key)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.cohortLeads.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.bookedEverKept.toLocaleString()}
                          <div className="text-xs text-muted-foreground">Any: {row.bookedEverAny.toLocaleString()}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPercent01(row.cohortConversionRateKept)}
                          <div className="text-xs text-muted-foreground">Any: {formatPercent01(row.cohortConversionRateAny)}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">AI vs Human</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mode</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Booked</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.byResponseMode.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{responseModeLabel(row.key)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.cohortLeads.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.bookedEverKept.toLocaleString()}
                          <div className="text-xs text-muted-foreground">Any: {row.bookedEverAny.toLocaleString()}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPercent01(row.cohortConversionRateKept)}
                          <div className="text-xs text-muted-foreground">Any: {formatPercent01(row.cohortConversionRateAny)}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Setters</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Setter</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Booked</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.bySetter.slice(0, 10).map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.cohortLeads.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.bookedEverKept.toLocaleString()}
                          <div className="text-xs text-muted-foreground">Any: {row.bookedEverAny.toLocaleString()}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPercent01(row.cohortConversionRateKept)}
                          <div className="text-xs text-muted-foreground">Any: {formatPercent01(row.cohortConversionRateAny)}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border">
        <div ref={tableViewportRef} className="max-h-[70vh] overflow-auto">
          <Table className="min-w-[1800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Interest date</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Company Name</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>First Name</TableHead>
                <TableHead>Last Name</TableHead>
                <TableHead>Job Title</TableHead>
                <TableHead>Lead&apos;s Email</TableHead>
                <TableHead>Lead LinkedIn</TableHead>
                <TableHead>Phone Number</TableHead>
                <TableHead>Email/LinkedIn Step Responded</TableHead>
                <TableHead>Lead Category</TableHead>
                <TableHead>Response Type</TableHead>
                <TableHead>Lead Status</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Lead Type</TableHead>
                <TableHead>Application Status</TableHead>
                <TableHead>Appointment Setter</TableHead>
                <TableHead>Setter Assignment</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Initial response date</TableHead>
                <TableHead>Follow-up 1</TableHead>
                <TableHead>Follow-up 2</TableHead>
                <TableHead>Follow-up 3</TableHead>
                <TableHead>Follow-up 4</TableHead>
                <TableHead>Follow-up 5</TableHead>
                <TableHead>Response step complete</TableHead>
                <TableHead>Date of Booking</TableHead>
                <TableHead>Date of Meeting</TableHead>
                <TableHead>Qualified</TableHead>
                <TableHead>Follow-up Date Requested</TableHead>
                <TableHead>Setters</TableHead>
                <TableHead>AI vs Human Response</TableHead>
                <TableHead>Lead Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={CRM_TABLE_COLUMN_COUNT} className="h-28 text-center text-muted-foreground">
                    <Loader2 className="inline h-4 w-4 animate-spin" /> Loading CRM rows...
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={CRM_TABLE_COLUMN_COUNT} className="h-28 text-center text-muted-foreground">
                    {error || "No CRM rows yet"}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {virtualPaddingTop > 0 ? (
                    <TableRow aria-hidden="true">
                      <TableCell
                        colSpan={CRM_TABLE_COLUMN_COUNT}
                        className="h-0 border-0 p-0"
                        style={{ height: `${virtualPaddingTop}px` }}
                      />
                    </TableRow>
                  ) : null}
                  {virtualRows.map((virtualRow) => {
                    const row = rows[virtualRow.index]
                    if (!row) return null

                    return (
                  <TableRow key={row.id}>
                    <TableCell>{formatDate(row.date)}</TableCell>
                    <TableCell>
                      <EditableTextCell
                        rowId={row.id}
                        leadId={row.leadId}
                        field="campaign"
                        value={row.campaign}
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>{renderValue(row.companyName)}</TableCell>
                    <TableCell>{renderValue(row.website)}</TableCell>
                    <TableCell>{renderValue(row.firstName)}</TableCell>
                    <TableCell>{renderValue(row.lastName)}</TableCell>
                    <TableCell>
                      <EditableTextCell
                        rowId={row.id}
                        leadId={row.leadId}
                        field="jobTitle"
                        value={row.jobTitle}
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableTextCell
                        rowId={row.id}
                        leadId={row.leadId}
                        field="email"
                        value={row.leadEmail}
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableTextCell
                        rowId={row.id}
                        leadId={row.leadId}
                        field="linkedinUrl"
                        value={row.leadLinkedIn}
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableTextCell
                        rowId={row.id}
                        leadId={row.leadId}
                        field="phone"
                        value={row.phoneNumber}
                        displayValue={toDisplayPhone(row.phoneNumber || "") || row.phoneNumber}
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>{renderValue(row.stepResponded)}</TableCell>
                    <TableCell>
                      <EditableTextCell
                        rowId={row.id}
                        leadId={row.leadId}
                        field="leadCategory"
                        value={row.leadCategory}
                        showAutomationToggle
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {responseTypeLabel(row.responseType)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <EditableTextCell
                        rowId={row.id}
                        leadId={row.leadId}
                        field="leadStatus"
                        value={row.leadStatus}
                        showAutomationToggle
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>{renderValue(row.channel)}</TableCell>
                    <TableCell>
                      <EditableTextCell
                        rowId={row.id}
                        leadId={row.leadId}
                        field="leadType"
                        value={row.leadType}
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableTextCell
                        rowId={row.id}
                        leadId={row.leadId}
                        field="applicationStatus"
                        value={row.applicationStatus}
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>
                      <EditableSelectCell
                        rowId={row.id}
                        leadId={row.leadId}
                        value={row.appointmentSetter}
                        options={assigneeOptions}
                        isLoading={assigneeLoading}
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>{renderValue(row.setterAssignment)}</TableCell>
                    <TableCell>
                      <EditableTextCell
                        rowId={row.id}
                        leadId={row.leadId}
                        field="notes"
                        value={row.notes}
                        multiline
                        onSave={handleSaveCell}
                      />
                    </TableCell>
                    <TableCell>{formatDate(row.initialResponseDate)}</TableCell>
                    <TableCell>{formatDate(row.followUp1)}</TableCell>
                    <TableCell>{formatDate(row.followUp2)}</TableCell>
                    <TableCell>{formatDate(row.followUp3)}</TableCell>
                    <TableCell>{formatDate(row.followUp4)}</TableCell>
                    <TableCell>{formatDate(row.followUp5)}</TableCell>
                    <TableCell>{row.responseStepComplete == null ? "—" : row.responseStepComplete ? "Yes" : "No"}</TableCell>
                    <TableCell>{formatDate(row.dateOfBooking)}</TableCell>
                    <TableCell>{formatDate(row.dateOfMeeting)}</TableCell>
                    <TableCell>{row.qualified == null ? "—" : row.qualified ? "Yes" : "No"}</TableCell>
                    <TableCell>{formatDate(row.followUpDateRequested)}</TableCell>
                    <TableCell>{renderValue(row.setters)}</TableCell>
                    <TableCell>{responseModeLabel(row.responseMode)}</TableCell>
                    <TableCell>{row.leadScore == null ? "—" : row.leadScore}</TableCell>
                  </TableRow>
                    )
                  })}
                  {virtualPaddingBottom > 0 ? (
                    <TableRow aria-hidden="true">
                      <TableCell
                        colSpan={CRM_TABLE_COLUMN_COUNT}
                        className="h-0 border-0 p-0"
                        style={{ height: `${virtualPaddingBottom}px` }}
                      />
                    </TableRow>
                  ) : null}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {canLoadMore ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
            {isLoadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Load more rows
          </Button>
        </div>
      ) : null}
    </div>
  )
}
