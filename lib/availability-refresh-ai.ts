import "server-only";

import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";

export type AvailabilityReplacement = {
  startIndex: number;
  endIndex: number;
  oldText: string;
  newText: string;
};

type AvailabilityReplacementPair = {
  oldText: string;
  newText: string;
};

export type AvailabilityRefreshResult =
  | {
      success: true;
      updatedDraft: string;
      replacementsApplied: Array<{ oldText: string; newText: string }>;
      passesUsed: number;
      hasTimeOffers: boolean;
    }
  | {
      success: false;
      error: string;
      hasTimeOffers: boolean;
    };

type AvailabilityRefreshAiResponse = {
  replacements: AvailabilityReplacementPair[];
  hasTimeOffers: boolean;
  done: boolean;
};

const DEFAULT_MAX_PASSES = 10;
const DEFAULT_CHUNK_SIZE = 5;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_MAX_OUTPUT_TOKENS = 800;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function coerceTemperature(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEMPERATURE;
  return Math.max(0, Math.min(1, value));
}

export function applyValidatedReplacements(draft: string, replacements: AvailabilityReplacement[]): string {
  const sorted = [...replacements].sort((a, b) => b.startIndex - a.startIndex);
  let result = draft;
  for (const r of sorted) {
    result = result.slice(0, r.startIndex) + r.newText + result.slice(r.endIndex);
  }
  return result;
}

export function validateAvailabilityReplacements(opts: {
  draft: string;
  replacements: AvailabilityReplacementPair[];
  candidateLabels: Set<string>;
  usedNewTexts: Set<string>;
  chunkSize: number;
}): { ok: true; replacements: AvailabilityReplacement[] } | { ok: false; error: string } {
  const { draft, replacements, candidateLabels, usedNewTexts, chunkSize } = opts;

  if (!Array.isArray(replacements)) {
    return { ok: false, error: "replacements_not_array" };
  }

  if (replacements.length > chunkSize) {
    return { ok: false, error: "chunk_size_exceeded" };
  }

  const normalized: AvailabilityReplacement[] = [];
  const seenNewTexts = new Set<string>(usedNewTexts);
  for (const r of replacements) {
    if (!r || typeof r !== "object") {
      return { ok: false, error: "invalid_replacement" };
    }
    const oldText = typeof r.oldText === "string" ? r.oldText : "";
    const newText = typeof r.newText === "string" ? r.newText : "";
    if (!oldText) {
      return { ok: false, error: "invalid_old_text" };
    }
    if (!newText) {
      return { ok: false, error: "invalid_new_text" };
    }

    const startIndex = draft.indexOf(oldText);
    if (startIndex === -1) {
      return { ok: false, error: "old_text_not_found" };
    }
    const nextIndex = draft.indexOf(oldText, startIndex + Math.max(1, oldText.length));
    if (nextIndex !== -1) {
      return { ok: false, error: "old_text_not_unique" };
    }
    const endIndex = startIndex + oldText.length;

    if (!candidateLabels.has(newText)) {
      return { ok: false, error: "new_text_not_candidate" };
    }
    if (seenNewTexts.has(newText)) {
      return { ok: false, error: "duplicate_new_text" };
    }
    seenNewTexts.add(newText);
    normalized.push({ startIndex, endIndex, oldText, newText });
  }

  const sorted = [...normalized].sort((a, b) => a.startIndex - b.startIndex);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    if (curr.startIndex < prev.endIndex) {
      return { ok: false, error: "overlapping_ranges" };
    }
  }

  return { ok: true, replacements: normalized };
}

export async function refreshAvailabilityInDraftViaAi(opts: {
  clientId: string;
  leadId?: string | null;
  draft: string;
  candidates: Array<{ datetimeUtcIso: string; label: string }>;
  labelToDatetimeUtcIso: Record<string, string>;
  leadTimeZone: string;
  nowUtcIso: string;
  maxPasses?: number;
  chunkSize?: number;
  timeoutMs?: number;
  temperature?: number;
}): Promise<AvailabilityRefreshResult> {
  const maxPasses =
    Number.isFinite(opts.maxPasses) && (opts.maxPasses || 0) > 0
      ? Math.floor(opts.maxPasses!)
      : parsePositiveInt(process.env.OPENAI_AVAILABILITY_REFRESH_MAX_PASSES, DEFAULT_MAX_PASSES);
  const chunkSize =
    Number.isFinite(opts.chunkSize) && (opts.chunkSize || 0) > 0
      ? Math.floor(opts.chunkSize!)
      : parsePositiveInt(process.env.OPENAI_AVAILABILITY_REFRESH_CHUNK_SIZE, DEFAULT_CHUNK_SIZE);
  const timeoutMs =
    Number.isFinite(opts.timeoutMs) && (opts.timeoutMs || 0) > 0
      ? Math.floor(opts.timeoutMs!)
      : parsePositiveInt(process.env.OPENAI_AVAILABILITY_REFRESH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const temperature = coerceTemperature(
    typeof opts.temperature === "number"
      ? opts.temperature
      : parsePositiveFloat(process.env.OPENAI_AVAILABILITY_REFRESH_TEMPERATURE, DEFAULT_TEMPERATURE)
  );
  const maxOutputTokens = parsePositiveInt(
    process.env.OPENAI_AVAILABILITY_REFRESH_MAX_OUTPUT_TOKENS,
    DEFAULT_MAX_OUTPUT_TOKENS
  );

  const candidateLabels: string[] = [];
  const candidateLabelSet = new Set<string>();
  for (const c of opts.candidates) {
    if (!candidateLabelSet.has(c.label)) {
      candidateLabelSet.add(c.label);
      candidateLabels.push(c.label);
    }
  }
  for (const label of Object.keys(opts.labelToDatetimeUtcIso || {})) {
    if (!candidateLabelSet.has(label)) {
      candidateLabelSet.add(label);
      candidateLabels.push(label);
    }
  }

  const systemFallback = `You are a strict text editor. Your task is to identify and replace outdated or unavailable time offers in an email draft.

Rules:
1. Find time offers in the draft that are NOT in the AVAILABLE_SLOTS list OR that represent times on or before TODAY (based on LEAD_TIMEZONE).
2. For each time offer that needs replacement, select a replacement VERBATIM from AVAILABLE_SLOTS.
3. Do NOT change any text except the time offer strings themselves.
4. Return only up to CHUNK_SIZE replacements per response.
5. Each replacement MUST be an object with "oldText" and "newText" (no indices). "oldText" MUST match text that appears in DRAFT exactly.
6. If you find no time offers in the draft at all, set hasTimeOffers to false.
7. If all time offers are already valid (present in AVAILABLE_SLOTS and in the future), return empty replacements with done=true.

Match the timezone abbreviation style already used in the draft (e.g., if the draft uses "EST", use "EST" from the candidate labels).

Output ONLY valid JSON. No explanation.`;

  const schema = {
    type: "object",
    properties: {
      replacements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            oldText: { type: "string" },
            newText: { type: "string" },
          },
          required: ["oldText", "newText"],
          additionalProperties: false,
        },
      },
      hasTimeOffers: { type: "boolean" },
      done: { type: "boolean" },
    },
    required: ["replacements", "hasTimeOffers", "done"],
    additionalProperties: false,
  } as const;

  let current = opts.draft;
  const replacementsApplied: Array<{ oldText: string; newText: string }> = [];
  const usedNewTexts = new Set<string>();
  let hasTimeOffers = true;

  for (let pass = 0; pass < maxPasses; pass++) {
    const input = `DRAFT:\n${current}\n\nAVAILABLE_SLOTS:\n${candidateLabels.map((l) => `- ${l}`).join("\n")}\n\nLEAD_TIMEZONE: ${opts.leadTimeZone}\nNOW_UTC_ISO: ${opts.nowUtcIso}\nCHUNK_SIZE: ${chunkSize}`;

    const result = await runStructuredJsonPrompt<AvailabilityRefreshAiResponse>({
      pattern: "structured_json",
      clientId: opts.clientId,
      leadId: opts.leadId ?? null,
      featureId: "availability_refresh",
      promptKey: "availability.refresh.inline.v1",
      model: "gpt-5-nano",
      reasoningEffort: "minimal",
      temperature,
      systemFallback,
      input,
      schemaName: "availability_refresh_inline",
      schema,
      strict: true,
      timeoutMs,
      budget: {
        min: 200,
        max: maxOutputTokens,
        retryMax: Math.max(maxOutputTokens, 1200),
        overheadTokens: 128,
        outputScale: 0.3,
        preferApiCount: true,
      },
    });

    if (!result.success) {
      return { success: false, error: result.error.message || "ai_refresh_failed", hasTimeOffers };
    }

    const data = result.data;
    hasTimeOffers = data.hasTimeOffers;

    if (!hasTimeOffers && data.replacements.length === 0) {
      return { success: false, error: "no_time_offers", hasTimeOffers: false };
    }

    const validated = validateAvailabilityReplacements({
      draft: current,
      replacements: data.replacements || [],
      candidateLabels: candidateLabelSet,
      usedNewTexts,
      chunkSize,
    });

    if (!validated.ok) {
      return { success: false, error: `validation_failed:${validated.error}`, hasTimeOffers };
    }

    if (validated.replacements.length === 0) {
      return {
        success: true,
        updatedDraft: current,
        replacementsApplied,
        passesUsed: pass + 1,
        hasTimeOffers,
      };
    }

    for (const r of validated.replacements) {
      usedNewTexts.add(r.newText);
      replacementsApplied.push({ oldText: r.oldText, newText: r.newText });
    }

    current = applyValidatedReplacements(current, validated.replacements);

    if (data.done) {
      return {
        success: true,
        updatedDraft: current,
        replacementsApplied,
        passesUsed: pass + 1,
        hasTimeOffers,
      };
    }
  }

  return { success: false, error: "max_passes_exceeded", hasTimeOffers };
}
