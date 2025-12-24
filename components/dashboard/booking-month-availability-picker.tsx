'use client'

import * as React from 'react'
import { Clock, Info } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Calendar } from '@/components/ui/calendar'

type BookingAvailabilitySlot = {
  datetime: string
  label: string
  offeredCount: number
}

const monthMap: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
}

function getTimePartFromLabel(label: string): string {
  const [timePart] = label.split(' on ')
  return timePart || label
}

function splitTimeLabel(timePart: string): { time: string; meta: string | null } {
  const match = timePart.match(/^(.*?)(\s*\((your time)\))$/i)
  if (!match) return { time: timePart, meta: null }
  return { time: (match[1] ?? timePart).trim(), meta: match[2]?.trim() ?? null }
}

function parseDayFromLabel(label: string): { monthIndex: number; day: number } | null {
  const idx = label.lastIndexOf(' on ')
  if (idx < 0) return null
  const dayPart = label.slice(idx + 4).trim() // "Wed, Jan 3"
  const match = dayPart.match(/^[A-Za-z]{3},\s([A-Za-z]{3})\s(\d{1,2})$/)
  if (!match) return null
  const monthIndex = monthMap[match[1] ?? '']
  const day = Number(match[2])
  if (!Number.isInteger(monthIndex) || !Number.isFinite(day)) return null
  return { monthIndex, day }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function dateKeyFromParts(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`
}

function dateKeyFromDate(date: Date): string {
  return dateKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate())
}

function deriveSlotDay(slot: BookingAvailabilitySlot): { key: string; date: Date } | null {
  const parsed = parseDayFromLabel(slot.label)
  if (!parsed) return null

  const utc = new Date(slot.datetime)
  if (!Number.isFinite(utc.getTime())) return null

  const utcYear = utc.getUTCFullYear()
  const utcMonth = utc.getUTCMonth()
  const diff = parsed.monthIndex - utcMonth
  const year = utcYear + (diff > 6 ? -1 : diff < -6 ? 1 : 0)

  const date = new Date(year, parsed.monthIndex, parsed.day)
  if (!Number.isFinite(date.getTime())) return null

  return { key: dateKeyFromDate(date), date }
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1)
}

function getShortDayLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function BookingMonthAvailabilityPicker({
  slots,
  selectedSlot,
  onSelectSlot,
}: {
  slots: BookingAvailabilitySlot[]
  selectedSlot: string | null
  onSelectSlot: (slotDatetime: string | null) => void
}) {
  const index = React.useMemo(() => {
    const byDay = new Map<
      string,
      {
        date: Date
        slots: BookingAvailabilitySlot[]
      }
    >()

    for (const slot of slots) {
      const derived = deriveSlotDay(slot)
      if (!derived) continue

      const existing = byDay.get(derived.key)
      if (existing) {
        existing.slots.push(slot)
      } else {
        byDay.set(derived.key, { date: derived.date, slots: [slot] })
      }
    }

    const days = [...byDay.entries()].sort((a, b) => a[1].date.getTime() - b[1].date.getTime())
    for (const [, group] of days) {
      group.slots.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
    }

    const firstDay = days[0]?.[1].date ?? null
    const lastDay = days[days.length - 1]?.[1].date ?? null

    return {
      byDay,
      days,
      availableDates: days.map(([, group]) => group.date),
      startMonth: firstDay ? getMonthStart(firstDay) : undefined,
      endMonth: lastDay ? getMonthEnd(lastDay) : undefined,
      initialMonth: firstDay ? getMonthStart(firstDay) : undefined,
    }
  }, [slots])

  const selectedDay = React.useMemo(() => {
    if (!selectedSlot) return null
    const slot = slots.find((s) => s.datetime === selectedSlot)
    if (!slot) return null
    return deriveSlotDay(slot)?.date ?? null
  }, [selectedSlot, slots])

  const [activeDay, setActiveDay] = React.useState<Date | undefined>(undefined)

  React.useEffect(() => {
    if (index.days.length === 0) {
      setActiveDay(undefined)
      return
    }

    if (selectedDay) {
      setActiveDay(selectedDay)
      return
    }

    setActiveDay(index.days[0]?.[1].date)
  }, [index.days, selectedDay])

  const activeDayKey = activeDay ? dateKeyFromDate(activeDay) : null
  const activeGroup = activeDayKey ? index.byDay.get(activeDayKey) : undefined
  const activeSlots = activeGroup?.slots ?? []

  return (
    <div className="grid gap-4 md:grid-cols-[420px_minmax(0,1fr)] xl:grid-cols-[460px_minmax(0,1fr)]">
      <div className="rounded-lg border bg-background">
        <div className="border-b px-4 py-3">
          <div className="text-sm font-medium">Choose a day</div>
          <div className="text-xs text-muted-foreground">
            Days with availability are highlighted.
          </div>
        </div>
        <Calendar
          mode="single"
          selected={activeDay}
          onSelect={(d) => {
            if (!d) return
            const key = dateKeyFromDate(d)
            if (!index.byDay.has(key)) return
            setActiveDay(d)
            onSelectSlot(null)
          }}
          defaultMonth={index.initialMonth}
          startMonth={index.startMonth}
          endMonth={index.endMonth}
          disabled={(d) => !index.byDay.has(dateKeyFromDate(d))}
          modifiers={{ available: index.availableDates }}
          modifiersClassNames={{
            available:
              'bg-primary/10 text-foreground hover:bg-primary/15 border border-primary/20',
          }}
          classNames={{
            cell: 'relative p-0 text-center text-sm focus-within:relative focus-within:z-20',
            day: cn(
              'h-9 w-9 p-0 font-normal aria-selected:opacity-100',
              'hover:bg-muted'
            ),
          }}
        />
      </div>

      <div className="min-w-0 rounded-lg border bg-background">
        <div className="flex items-start justify-between gap-6 border-b px-4 py-3">
          <div>
            <div className="text-sm font-medium">Choose a time</div>
            <div className="text-xs text-muted-foreground">
              {activeDay ? getShortDayLabel(activeDay) : 'Select a day to see times'}
            </div>
          </div>
          <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-4 w-4" />
            <span>Times match the slot labels shown below</span>
          </div>
        </div>

        {activeDay && activeSlots.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No slots for this day.</div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto p-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {activeSlots.map((slot) => {
                const { time, meta } = splitTimeLabel(getTimePartFromLabel(slot.label))
                return (
                  <button
                    key={slot.datetime}
                    onClick={() => onSelectSlot(slot.datetime)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-all',
                      selectedSlot === slot.datetime
                        ? 'border-primary bg-primary/10 ring-1 ring-primary'
                        : 'border-border hover:border-primary/50 hover:bg-muted/50'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <div className="font-medium leading-tight tabular-nums">
                            {time}
                          </div>
                          {meta ? (
                            <div className="rounded-full border px-2 py-0.5 text-[11px] leading-none text-muted-foreground">
                              {meta}
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Offered: {slot.offeredCount}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
