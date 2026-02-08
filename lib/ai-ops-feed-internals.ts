export type AiOpsDecision = "approve" | "deny" | "needs_clarification" | "revise";

export function parseCursorDate(value: string | null | undefined): Date | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function readPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

function parseDecision(value: unknown): AiOpsDecision | null {
  const raw = (typeof value === "string" ? value : "").trim().toLowerCase();
  if (raw === "approve") return "approve";
  if (raw === "deny") return "deny";
  if (raw === "needs_clarification") return "needs_clarification";
  if (raw === "revise") return "revise";
  return null;
}

export function extractAiInteractionSummary(meta: unknown): {
  decision: AiOpsDecision | null;
  confidence: number | null;
  issuesCount: number | null;
} {
  const obj = readPlainObject(meta);
  if (!obj) return { decision: null, confidence: null, issuesCount: null };

  const autoSendRevision = readPlainObject(obj.autoSendRevision);
  if (autoSendRevision) {
    const stage = readString(autoSendRevision.stage);
    const stageConfidence = readNumber(autoSendRevision.selectorConfidence);
    const originalConfidence = readNumber(autoSendRevision.originalConfidence);
    const revisedConfidence = readNumber(autoSendRevision.revisedConfidence);

    // Provide a stable, non-PII summary: decision indicates whether it improved.
    if (stage === "revise" && typeof originalConfidence === "number" && typeof revisedConfidence === "number") {
      return {
        decision: revisedConfidence > originalConfidence ? "revise" : null,
        confidence: revisedConfidence,
        issuesCount: null,
      };
    }

    if (stage === "context_select") {
      return {
        decision: null,
        confidence: typeof stageConfidence === "number" ? stageConfidence : null,
        issuesCount: null,
      };
    }
  }

  const bookingGate = readPlainObject(obj.bookingGate);
  if (!bookingGate) return { decision: null, confidence: null, issuesCount: null };

  return {
    decision: parseDecision(bookingGate.decision),
    confidence: readNumber(bookingGate.confidence),
    issuesCount: readNumber(bookingGate.issuesCount),
  };
}

export function extractOverseerPayloadSummary(stage: string, payload: unknown): {
  status: string | null;
  decision: AiOpsDecision | null;
  issuesCount: number | null;
} {
  const obj = readPlainObject(payload);
  if (!obj) return { status: null, decision: null, issuesCount: null };

  if (stage === "extract") {
    // Keep a narrow allowlist; omit evidence and free-form rationale/quotes.
    const intent = readString(obj.intent);
    const isSchedulingRelated = readBoolean(obj.is_scheduling_related);
    if (intent) return { status: intent, decision: null, issuesCount: null };
    if (isSchedulingRelated !== null) {
      return {
        status: isSchedulingRelated ? "scheduling_related" : "not_scheduling_related",
        decision: null,
        issuesCount: null,
      };
    }
    return { status: null, decision: null, issuesCount: null };
  }

  // "gate" (meeting overseer) or "booking_gate" (followup booking gate)
  const decision = parseDecision(obj.decision);
  const issues = readStringArray(obj.issues);
  return {
    status: null,
    decision,
    issuesCount: issues ? issues.length : null,
  };
}

