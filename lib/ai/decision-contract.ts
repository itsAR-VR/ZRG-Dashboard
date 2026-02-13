import "server-only";

export type DecisionYesNo = "yes" | "no";

export type DecisionResponseMode = "booking_only" | "info_then_booking" | "clarify_only";

export type DecisionProposedWindow = {
  type: "day_only" | "time_of_day" | "relative";
  value: string;
  detail: string | null;
};

export type AIDecisionContractV1 = {
  contractVersion: "v1";
  isQualified: DecisionYesNo;
  hasBookingIntent: DecisionYesNo;
  shouldBookNow: DecisionYesNo;
  leadTimezone: string | null;
  leadProposedWindows: DecisionProposedWindow[];
  needsPricingAnswer: DecisionYesNo;
  needsCommunityDetails: DecisionYesNo;
  responseMode: DecisionResponseMode;
  evidence: string[];
};

type ExtractionForDecisionContract = {
  is_scheduling_related: boolean;
  intent_to_book: boolean;
  qualification_status: "qualified" | "unqualified" | "unknown";
  preferred_day_of_week: string | null;
  preferred_time_of_day: string | null;
  relative_preference: string | null;
  relative_preference_detail: string | null;
  needs_clarification: boolean;
  detected_timezone: string | null;
  needs_pricing_answer?: unknown;
  needs_community_details?: unknown;
  evidence: string[];
  qualification_evidence: string[];
};

function normalizeYesNo(value: unknown, fallback: DecisionYesNo = "no"): DecisionYesNo {
  if (value === "yes" || value === "no") return value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    if (raw === "yes" || raw === "true") return "yes";
    if (raw === "no" || raw === "false") return "no";
  }
  return fallback;
}

function normalizeResponseMode(value: unknown): DecisionResponseMode {
  if (value === "booking_only" || value === "info_then_booking" || value === "clarify_only") {
    return value;
  }
  return "clarify_only";
}

function buildProposedWindows(extraction: ExtractionForDecisionContract): DecisionProposedWindow[] {
  const windows: DecisionProposedWindow[] = [];
  if (extraction.preferred_day_of_week) {
    windows.push({
      type: "day_only",
      value: extraction.preferred_day_of_week,
      detail: null,
    });
  }
  if (extraction.preferred_time_of_day) {
    windows.push({
      type: "time_of_day",
      value: extraction.preferred_time_of_day,
      detail: null,
    });
  }
  if (extraction.relative_preference) {
    windows.push({
      type: "relative",
      value: extraction.relative_preference,
      detail: extraction.relative_preference_detail || null,
    });
  }
  return windows;
}

export function deriveAIDecisionContractV1FromExtraction(opts: {
  extraction: ExtractionForDecisionContract;
}): AIDecisionContractV1 {
  const isQualified: DecisionYesNo = opts.extraction.qualification_status === "qualified" ? "yes" : "no";
  const hasBookingIntent: DecisionYesNo =
    opts.extraction.is_scheduling_related && opts.extraction.intent_to_book ? "yes" : "no";
  const shouldBookNow: DecisionYesNo =
    hasBookingIntent === "yes" && isQualified === "yes" && !opts.extraction.needs_clarification ? "yes" : "no";
  const needsPricingAnswer = normalizeYesNo(opts.extraction.needs_pricing_answer, "no");
  const needsCommunityDetails = normalizeYesNo(opts.extraction.needs_community_details, "no");
  const responseMode: DecisionResponseMode = opts.extraction.needs_clarification
    ? "clarify_only"
    : shouldBookNow === "yes"
      ? "booking_only"
      : hasBookingIntent === "yes" || needsPricingAnswer === "yes" || needsCommunityDetails === "yes"
        ? "info_then_booking"
        : "clarify_only";

  const evidence = Array.from(new Set([...(opts.extraction.evidence || []), ...(opts.extraction.qualification_evidence || [])])).filter(
    (item) => typeof item === "string" && item.trim().length > 0
  );

  return {
    contractVersion: "v1",
    isQualified,
    hasBookingIntent,
    shouldBookNow,
    leadTimezone: opts.extraction.detected_timezone || null,
    leadProposedWindows: buildProposedWindows(opts.extraction),
    needsPricingAnswer,
    needsCommunityDetails,
    responseMode,
    evidence,
  };
}

export function validateAIDecisionContractV1(value: unknown): { success: true; data: AIDecisionContractV1 } | { success: false; error: string } {
  if (!value || typeof value !== "object") return { success: false, error: "contract_not_object" };
  const record = value as Record<string, unknown>;

  if (record.contractVersion !== "v1") return { success: false, error: "invalid_contract_version" };
  if (normalizeYesNo(record.isQualified) !== record.isQualified) return { success: false, error: "invalid_isQualified" };
  if (normalizeYesNo(record.hasBookingIntent) !== record.hasBookingIntent) return { success: false, error: "invalid_hasBookingIntent" };
  if (normalizeYesNo(record.shouldBookNow) !== record.shouldBookNow) return { success: false, error: "invalid_shouldBookNow" };
  if (normalizeYesNo(record.needsPricingAnswer) !== record.needsPricingAnswer) return { success: false, error: "invalid_needsPricingAnswer" };
  if (normalizeYesNo(record.needsCommunityDetails) !== record.needsCommunityDetails) {
    return { success: false, error: "invalid_needsCommunityDetails" };
  }
  if (normalizeResponseMode(record.responseMode) !== record.responseMode) return { success: false, error: "invalid_responseMode" };
  if (!(record.leadTimezone === null || typeof record.leadTimezone === "string")) return { success: false, error: "invalid_leadTimezone" };
  if (!Array.isArray(record.leadProposedWindows)) return { success: false, error: "invalid_leadProposedWindows" };
  if (!Array.isArray(record.evidence) || !record.evidence.every((item) => typeof item === "string")) {
    return { success: false, error: "invalid_evidence" };
  }

  return { success: true, data: record as AIDecisionContractV1 };
}

export function repairAIDecisionContractV1(value: unknown): AIDecisionContractV1 | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const leadTimezone = record.leadTimezone;
  const leadProposedWindows = Array.isArray(record.leadProposedWindows) ? record.leadProposedWindows : [];
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.filter((item): item is string => typeof item === "string")
    : [];

  return {
    contractVersion: "v1",
    isQualified: normalizeYesNo(record.isQualified),
    hasBookingIntent: normalizeYesNo(record.hasBookingIntent),
    shouldBookNow: normalizeYesNo(record.shouldBookNow),
    leadTimezone: typeof leadTimezone === "string" ? leadTimezone : null,
    leadProposedWindows: leadProposedWindows
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const window = item as Record<string, unknown>;
        const type = window.type;
        const value = window.value;
        const detail = window.detail;
        if (type !== "day_only" && type !== "time_of_day" && type !== "relative") return null;
        if (typeof value !== "string" || !value.trim()) return null;
        return {
          type,
          value: value.trim(),
          detail: typeof detail === "string" && detail.trim() ? detail.trim() : null,
        } as DecisionProposedWindow;
      })
      .filter((item): item is DecisionProposedWindow => item !== null),
    needsPricingAnswer: normalizeYesNo(record.needsPricingAnswer),
    needsCommunityDetails: normalizeYesNo(record.needsCommunityDetails),
    responseMode: normalizeResponseMode(record.responseMode),
    evidence,
  };
}
