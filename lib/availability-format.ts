export type AvailabilityLabelMode = "your_time" | "explicit_tz";

function getShortTimeZoneName(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value || timeZone;
  } catch {
    return timeZone;
  }
}

export function formatAvailabilitySlotLabel(opts: {
  datetimeUtcIso: string;
  timeZone: string;
  mode: AvailabilityLabelMode;
}): { datetime: string; label: string } {
  const date = new Date(opts.datetimeUtcIso);

  const dayPart = new Intl.DateTimeFormat("en-US", {
    timeZone: opts.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);

  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: opts.timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);

  if (opts.mode === "your_time") {
    return {
      datetime: date.toISOString(),
      label: `${timePart} (your time) on ${dayPart}`,
    };
  }

  const tzName = getShortTimeZoneName(date, opts.timeZone);
  return {
    datetime: date.toISOString(),
    label: `${timePart} ${tzName} on ${dayPart}`,
  };
}

export function formatAvailabilitySlots(opts: {
  slotsUtcIso: string[];
  timeZone: string;
  mode: AvailabilityLabelMode;
  limit: number;
}): Array<{ datetime: string; label: string }> {
  const result: Array<{ datetime: string; label: string }> = [];

  for (const iso of opts.slotsUtcIso.slice(0, Math.max(0, opts.limit))) {
    try {
      result.push(
        formatAvailabilitySlotLabel({
          datetimeUtcIso: iso,
          timeZone: opts.timeZone,
          mode: opts.mode,
        })
      );
    } catch {
      // Skip malformed slots
    }
  }

  return result;
}

