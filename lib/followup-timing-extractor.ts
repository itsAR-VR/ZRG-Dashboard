import "server-only";

import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!DATE_RE.test(trimmed)) return null;
  return trimmed;
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!TIME_RE.test(trimmed)) return null;
  const [h, m] = trimmed.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return trimmed;
}

function normalizeTimezone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type RawFollowUpTimingExtraction = {
  hasConcreteDate: boolean;
  localDate: string | null;
  localTime: string | null;
  timezone: string | null;
  hasFutureWindow: boolean;
  futureWindowStartDate: string | null;
  futureWindowEndDate: string | null;
  futureWindowLabel: string | null;
  rationale: string | null;
  normalizedText: string | null;
};

export type FollowUpTimingExtraction = {
  hasConcreteDate: boolean;
  localDate: string | null;
  localTime: string | null;
  timezone: string | null;
  hasFutureWindow: boolean;
  futureWindowStartDate: string | null;
  futureWindowEndDate: string | null;
  futureWindowLabel: string | null;
  rationale: string | null;
  normalizedText: string | null;
};

export type FollowUpTimingExtractionResult = {
  success: boolean;
  data: FollowUpTimingExtraction;
  rawOutput?: string;
  error?: {
    category: string;
    message: string;
  };
};

export async function extractFollowUpTimingFromMessage(opts: {
  clientId: string;
  leadId: string;
  messageText: string;
  leadTimezone?: string | null;
  workspaceTimezone?: string | null;
  now?: Date;
}): Promise<FollowUpTimingExtractionResult> {
  const nowIso = (opts.now ?? new Date()).toISOString();
  const fallbackData: FollowUpTimingExtraction = {
    hasConcreteDate: false,
    localDate: null,
    localTime: null,
    timezone: null,
    hasFutureWindow: false,
    futureWindowStartDate: null,
    futureWindowEndDate: null,
    futureWindowLabel: null,
    rationale: null,
    normalizedText: null,
  };

  if (!process.env.OPENAI_API_KEY) {
    return {
      success: false,
      data: fallbackData,
      error: {
        category: "api_error",
        message: "OPENAI_API_KEY is not configured",
      },
    };
  }

  const input = JSON.stringify(
    {
      nowIso,
      leadTimezone: opts.leadTimezone || null,
      workspaceTimezone: opts.workspaceTimezone || null,
      messageText: opts.messageText || "",
    },
    null,
    2
  );

  const result = await runStructuredJsonPrompt<RawFollowUpTimingExtraction>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "followup.extract_timing",
    promptKey: "followup.extract_timing.v1",
    model: "gpt-5-mini",
    reasoningEffort: "low",
    systemFallback: `Extract follow-up timing from the inbound message.

Return ONLY JSON.

Rules:
- Determine whether the sender gives a concrete follow-up date/time.
- When they describe a broad future window (for example: "mid-March", "second week of March", "next quarter"), set hasFutureWindow=true.
- For hasFutureWindow=true:
  - futureWindowStartDate must be YYYY-MM-DD when parseable.
  - futureWindowEndDate should be YYYY-MM-DD when parseable, otherwise null.
  - futureWindowLabel should preserve a concise, human-readable label from the message (for example "mid-March").
- If they imply "later" but no parseable window start can be derived, set hasFutureWindow=false and all futureWindow* fields to null.
- Accept relative and quarter/fiscal language only when you can normalize it into concrete local dates.
- If no concrete date can be derived, set hasConcreteDate=false and date/time null.
- localDate must be YYYY-MM-DD when hasConcreteDate=true.
- localTime may be null if not provided.
- timezone should be an IANA timezone string when explicitly inferable from message context, otherwise null.
- normalizedText should be a concise paraphrase of the scheduling request.
- rationale should briefly explain the extraction decision.`,
    input,
    schemaName: "followup_timing_extraction",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        hasConcreteDate: { type: "boolean" },
        localDate: { type: ["string", "null"] },
        localTime: { type: ["string", "null"] },
        timezone: { type: ["string", "null"] },
        hasFutureWindow: { type: "boolean" },
        futureWindowStartDate: { type: ["string", "null"] },
        futureWindowEndDate: { type: ["string", "null"] },
        futureWindowLabel: { type: ["string", "null"] },
        rationale: { type: ["string", "null"] },
        normalizedText: { type: ["string", "null"] },
      },
      required: [
        "hasConcreteDate",
        "localDate",
        "localTime",
        "timezone",
        "hasFutureWindow",
        "futureWindowStartDate",
        "futureWindowEndDate",
        "futureWindowLabel",
        "rationale",
        "normalizedText",
      ],
    },
    budget: {
      min: 1800,
      max: 8100,
      retryMax: 16200,
      overheadTokens: 128,
      outputScale: 0.2,
      preferApiCount: true,
    },
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") {
        return { success: false, error: "not_an_object" };
      }
      if (typeof anyValue.hasConcreteDate !== "boolean") {
        return { success: false, error: "hasConcreteDate_must_be_boolean" };
      }
      if (!(typeof anyValue.localDate === "string" || anyValue.localDate === null)) {
        return { success: false, error: "localDate_must_be_string_or_null" };
      }
      if (!(typeof anyValue.localTime === "string" || anyValue.localTime === null)) {
        return { success: false, error: "localTime_must_be_string_or_null" };
      }
      if (!(typeof anyValue.timezone === "string" || anyValue.timezone === null)) {
        return { success: false, error: "timezone_must_be_string_or_null" };
      }
      if (typeof anyValue.hasFutureWindow !== "boolean") {
        return { success: false, error: "hasFutureWindow_must_be_boolean" };
      }
      if (!(typeof anyValue.futureWindowStartDate === "string" || anyValue.futureWindowStartDate === null)) {
        return { success: false, error: "futureWindowStartDate_must_be_string_or_null" };
      }
      if (!(typeof anyValue.futureWindowEndDate === "string" || anyValue.futureWindowEndDate === null)) {
        return { success: false, error: "futureWindowEndDate_must_be_string_or_null" };
      }
      if (!(typeof anyValue.futureWindowLabel === "string" || anyValue.futureWindowLabel === null)) {
        return { success: false, error: "futureWindowLabel_must_be_string_or_null" };
      }
      if (!(typeof anyValue.rationale === "string" || anyValue.rationale === null)) {
        return { success: false, error: "rationale_must_be_string_or_null" };
      }
      if (!(typeof anyValue.normalizedText === "string" || anyValue.normalizedText === null)) {
        return { success: false, error: "normalizedText_must_be_string_or_null" };
      }
      return {
        success: true,
        data: {
          hasConcreteDate: Boolean(anyValue.hasConcreteDate),
          localDate: normalizeDate(anyValue.localDate),
          localTime: normalizeTime(anyValue.localTime),
          timezone: normalizeTimezone(anyValue.timezone),
          hasFutureWindow: Boolean(anyValue.hasFutureWindow),
          futureWindowStartDate: normalizeDate(anyValue.futureWindowStartDate),
          futureWindowEndDate: normalizeDate(anyValue.futureWindowEndDate),
          futureWindowLabel:
            typeof anyValue.futureWindowLabel === "string" ? anyValue.futureWindowLabel.trim() || null : null,
          rationale: typeof anyValue.rationale === "string" ? anyValue.rationale.trim() || null : null,
          normalizedText:
            typeof anyValue.normalizedText === "string" ? anyValue.normalizedText.trim() || null : null,
        },
      };
    },
  });

  if (!result.success) {
    return {
      success: false,
      data: fallbackData,
      rawOutput: result.rawOutput,
      error: {
        category: result.error.category,
        message: result.error.message,
      },
    };
  }

  const extracted = result.data;
  const hasConcreteDate = extracted.hasConcreteDate && Boolean(extracted.localDate);
  const hasFutureWindow = extracted.hasFutureWindow && Boolean(extracted.futureWindowStartDate);

  return {
    success: true,
    data: {
      hasConcreteDate,
      localDate: hasConcreteDate ? extracted.localDate : null,
      localTime: hasConcreteDate ? extracted.localTime : null,
      timezone: hasConcreteDate ? extracted.timezone : null,
      hasFutureWindow,
      futureWindowStartDate: hasFutureWindow ? extracted.futureWindowStartDate : null,
      futureWindowEndDate: hasFutureWindow ? extracted.futureWindowEndDate : null,
      futureWindowLabel: hasFutureWindow ? extracted.futureWindowLabel : null,
      rationale: extracted.rationale,
      normalizedText: extracted.normalizedText,
    },
    rawOutput: result.rawOutput,
  };
}
