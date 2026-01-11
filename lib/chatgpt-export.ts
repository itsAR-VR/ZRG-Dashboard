// ChatGPT export options are used by:
// - UI (Analytics download modal)
// - API route (zip generation)
//
// Keep this module client-safe (no server-only imports).

export type ChatgptExportTimePreset = "all_time" | "7d" | "30d" | "90d" | "custom";
export type ChatgptExportChannel = "sms" | "email" | "linkedin";
export type ChatgptExportDirection = "inbound" | "outbound";

export type ChatgptExportOptions = {
  version: 1;
  positiveOnly: boolean;
  timePreset: ChatgptExportTimePreset;
  fromIso: string | null;
  toIso: string | null;
  includeLeadsCsv: boolean;
  includeMessagesJsonl: boolean;
  channels: ChatgptExportChannel[]; // [] = all
  directions: ChatgptExportDirection[]; // [] = all
  messagesWithinRangeOnly: boolean;
};

export const DEFAULT_CHATGPT_EXPORT_OPTIONS: ChatgptExportOptions = {
  version: 1,
  positiveOnly: false,
  timePreset: "all_time",
  fromIso: null,
  toIso: null,
  includeLeadsCsv: true,
  includeMessagesJsonl: true,
  channels: [],
  directions: [],
  messagesWithinRangeOnly: true,
};

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTimePreset(value: unknown): ChatgptExportTimePreset | null {
  const s = asString(value);
  if (!s) return null;
  if (s === "all_time" || s === "7d" || s === "30d" || s === "90d" || s === "custom") return s;
  return null;
}

function asChannel(value: unknown): ChatgptExportChannel | null {
  const s = asString(value);
  if (!s) return null;
  if (s === "sms" || s === "email" || s === "linkedin") return s;
  return null;
}

function asDirection(value: unknown): ChatgptExportDirection | null {
  const s = asString(value);
  if (!s) return null;
  if (s === "inbound" || s === "outbound") return s;
  return null;
}

function safeIso(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function normalizeChatgptExportOptions(input: unknown): ChatgptExportOptions {
  const obj = asObject(input) || {};

  const positiveOnly = asBoolean(obj.positiveOnly) ?? DEFAULT_CHATGPT_EXPORT_OPTIONS.positiveOnly;
  const timePreset = asTimePreset(obj.timePreset) ?? DEFAULT_CHATGPT_EXPORT_OPTIONS.timePreset;

  const includeLeadsCsv = asBoolean(obj.includeLeadsCsv) ?? DEFAULT_CHATGPT_EXPORT_OPTIONS.includeLeadsCsv;
  const includeMessagesJsonl = asBoolean(obj.includeMessagesJsonl) ?? DEFAULT_CHATGPT_EXPORT_OPTIONS.includeMessagesJsonl;

  const channelsRaw = asArray(obj.channels);
  const channels = (channelsRaw ? channelsRaw.map(asChannel).filter(Boolean) : DEFAULT_CHATGPT_EXPORT_OPTIONS.channels) as ChatgptExportChannel[];
  const directionsRaw = asArray(obj.directions);
  const directions = (directionsRaw ? directionsRaw.map(asDirection).filter(Boolean) : DEFAULT_CHATGPT_EXPORT_OPTIONS.directions) as ChatgptExportDirection[];

  const messagesWithinRangeOnly =
    asBoolean(obj.messagesWithinRangeOnly) ?? DEFAULT_CHATGPT_EXPORT_OPTIONS.messagesWithinRangeOnly;

  let fromIso = safeIso(asString(obj.fromIso)) ?? null;
  let toIso = safeIso(asString(obj.toIso)) ?? null;
  if (fromIso && toIso) {
    const fromMs = new Date(fromIso).getTime();
    const toMs = new Date(toIso).getTime();
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs > toMs) {
      const tmp = fromIso;
      fromIso = toIso;
      toIso = tmp;
    }
  }

  // If both files are disabled, default to including both.
  const ensuredIncludeLeadsCsv = includeLeadsCsv || includeMessagesJsonl ? includeLeadsCsv : true;
  const ensuredIncludeMessagesJsonl = includeLeadsCsv || includeMessagesJsonl ? includeMessagesJsonl : true;

  // Custom range requires valid dates; otherwise fall back to all_time.
  const effectiveTimePreset =
    timePreset === "custom" && (!fromIso || !toIso) ? "all_time" : timePreset;

  const normalized: ChatgptExportOptions = {
    version: 1,
    positiveOnly,
    timePreset: effectiveTimePreset,
    fromIso: effectiveTimePreset === "custom" ? fromIso : null,
    toIso: effectiveTimePreset === "custom" ? toIso : null,
    includeLeadsCsv: ensuredIncludeLeadsCsv,
    includeMessagesJsonl: ensuredIncludeMessagesJsonl,
    channels,
    directions,
    messagesWithinRangeOnly,
  };

  return normalized;
}

export function serializeChatgptExportOptions(opts: ChatgptExportOptions): string {
  return JSON.stringify(opts);
}

export function parseChatgptExportOptionsJson(value: string | null | undefined): ChatgptExportOptions | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  try {
    return normalizeChatgptExportOptions(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function computeChatgptExportDateRange(
  opts: ChatgptExportOptions,
  now: Date = new Date()
): { from: Date | null; to: Date | null } {
  if (opts.timePreset === "all_time") return { from: null, to: null };

  const to = new Date(now);

  if (opts.timePreset === "custom") {
    const from = opts.fromIso ? new Date(opts.fromIso) : null;
    const toCustom = opts.toIso ? new Date(opts.toIso) : null;
    if (!from || !toCustom || Number.isNaN(from.getTime()) || Number.isNaN(toCustom.getTime())) {
      return { from: null, to: null };
    }
    return { from, to: toCustom };
  }

  const days =
    opts.timePreset === "7d" ? 7 :
    opts.timePreset === "30d" ? 30 :
    90;

  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from, to };
}

export function getChatgptExportOptionsSummary(opts: ChatgptExportOptions): string {
  const parts: string[] = [];
  parts.push(opts.positiveOnly ? "Positive only" : "All leads");

  const time =
    opts.timePreset === "all_time"
      ? "All time"
      : opts.timePreset === "custom"
        ? "Custom range"
        : `Last ${opts.timePreset}`;
  parts.push(time);

  if (opts.channels.length > 0) parts.push(`Channels: ${opts.channels.join("+")}`);
  if (opts.directions.length > 0) parts.push(`Directions: ${opts.directions.join("+")}`);

  const files: string[] = [];
  if (opts.includeLeadsCsv) files.push("leads.csv");
  if (opts.includeMessagesJsonl) files.push("messages.jsonl");
  parts.push(files.length ? `Files: ${files.join(" + ")}` : "Files: (none)");

  return parts.join(" · ");
}

export function buildChatgptExportUrl(opts: { clientId: string; options?: ChatgptExportOptions | null }): string {
  const params = new URLSearchParams({ clientId: opts.clientId });
  if (opts.options) {
    params.set("opts", serializeChatgptExportOptions(opts.options));
  }
  return `/api/export/chatgpt?${params.toString()}`;
}
