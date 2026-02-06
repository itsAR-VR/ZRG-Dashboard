"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAdminAccess } from "@/lib/workspace-access";

type AiOpsEventSource = "ai_interaction" | "overseer_decision";
type AiOpsDecision = "approve" | "deny" | "needs_clarification" | "revise";

export type AiOpsEvent = {
  id: string;
  source: AiOpsEventSource;
  createdAt: string;
  clientId: string;
  leadId: string | null;

  // Common display fields
  eventType: string; // AIInteraction.featureId OR MeetingOverseerDecision.stage
  status: string | null; // AIInteraction.status OR derived (e.g. overseer extract intent)
  decision: AiOpsDecision | null;
  confidence: number | null;
  model: string | null;
  promptKey: string | null;
  latencyMs: number | null;
  totalTokens: number | null;
  issuesCount: number | null;
};

const AI_OPS_FEATURE_IDS = [
  "followup.booking.gate",
  "meeting.overseer.extract",
  "meeting.overseer.gate",
  "followup.parse_proposed_times",
  "auto_send.evaluate",
] as const;

const AI_OPS_OVERSEER_STAGES = ["extract", "gate", "booking_gate"] as const;

function clampLimit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(200, Math.trunc(value)));
}

function parseCursorDate(value: string | null | undefined): Date | null {
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

function extractAiInteractionSummary(meta: unknown): {
  decision: AiOpsDecision | null;
  confidence: number | null;
  issuesCount: number | null;
} {
  const obj = readPlainObject(meta);
  if (!obj) return { decision: null, confidence: null, issuesCount: null };

  const bookingGate = readPlainObject(obj.bookingGate);
  if (!bookingGate) return { decision: null, confidence: null, issuesCount: null };

  return {
    decision: parseDecision(bookingGate.decision),
    confidence: readNumber(bookingGate.confidence),
    issuesCount: readNumber(bookingGate.issuesCount),
  };
}

function extractOverseerPayloadSummary(stage: string, payload: unknown): {
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
    if (isSchedulingRelated !== null) return { status: isSchedulingRelated ? "scheduling_related" : "not_scheduling_related", decision: null, issuesCount: null };
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

// Test-only exports (pure helpers). Keep small and avoid leaking payload contents.
export const __aiOpsFeedInternals = {
  parseCursorDate,
  extractAiInteractionSummary,
  extractOverseerPayloadSummary,
};

export async function listAiOpsEvents(
  clientId: string | null | undefined,
  filters?: {
    leadId?: string;
    featureId?: string;
    stage?: string;
    decision?: AiOpsDecision;
    status?: "success" | "error";
    limit?: number;
    cursor?: string | null;
  }
): Promise<{ success: boolean; data?: { events: AiOpsEvent[]; nextCursor: string | null }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAdminAccess(clientId);

    const limit = clampLimit(filters?.limit, 50);
    const cursorDate = parseCursorDate(filters?.cursor ?? null);

    const rangeEnd = new Date();
    const rangeStart = new Date(rangeEnd.getTime() - 72 * 60 * 60 * 1000);

    const internalTake = Math.min(500, Math.max(limit * 4, 100));

    const [aiInteractionsRaw, overseerRaw] = await Promise.all([
      prisma.aIInteraction.findMany({
        where: {
          clientId,
          createdAt: {
            gte: rangeStart,
            ...(cursorDate ? { lt: cursorDate } : {}),
          },
          featureId: {
            in: AI_OPS_FEATURE_IDS as unknown as string[],
          },
          ...(filters?.featureId ? { featureId: filters.featureId } : {}),
          ...(filters?.status ? { status: filters.status } : {}),
          ...(filters?.leadId ? { leadId: filters.leadId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: internalTake,
        select: {
          id: true,
          createdAt: true,
          clientId: true,
          leadId: true,
          source: true,
          featureId: true,
          promptKey: true,
          model: true,
          status: true,
          latencyMs: true,
          totalTokens: true,
          metadata: true,
        },
      }),
      prisma.meetingOverseerDecision.findMany({
        where: {
          clientId,
          createdAt: {
            gte: rangeStart,
            ...(cursorDate ? { lt: cursorDate } : {}),
          },
          stage: {
            in: AI_OPS_OVERSEER_STAGES as unknown as string[],
          },
          ...(filters?.stage ? { stage: filters.stage } : {}),
          ...(filters?.leadId ? { leadId: filters.leadId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: internalTake,
        select: {
          id: true,
          createdAt: true,
          clientId: true,
          leadId: true,
          stage: true,
          promptKey: true,
          model: true,
          confidence: true,
          payload: true,
        },
      }),
    ]);

    const aiEvents: AiOpsEvent[] = aiInteractionsRaw.map((row) => {
      const bookingGate = row.featureId === "followup.booking.gate" ? extractAiInteractionSummary(row.metadata) : null;
      return {
        id: `ai:${row.id}`,
        source: "ai_interaction",
        createdAt: row.createdAt.toISOString(),
        clientId: row.clientId,
        leadId: row.leadId ?? null,
        eventType: row.featureId,
        status: row.status,
        decision: bookingGate?.decision ?? null,
        confidence: bookingGate?.confidence ?? null,
        model: row.model,
        promptKey: row.promptKey ?? null,
        latencyMs: row.latencyMs ?? null,
        totalTokens: row.totalTokens ?? null,
        issuesCount: bookingGate?.issuesCount ?? null,
      };
    });

    const overseerEvents: AiOpsEvent[] = overseerRaw.map((row) => {
      const summary = extractOverseerPayloadSummary(row.stage, row.payload);
      return {
        id: `overseer:${row.id}`,
        source: "overseer_decision",
        createdAt: row.createdAt.toISOString(),
        clientId: row.clientId,
        leadId: row.leadId ?? null,
        eventType: row.stage,
        status: summary.status,
        decision: summary.decision,
        confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : null,
        model: row.model,
        promptKey: row.promptKey,
        latencyMs: null,
        totalTokens: null,
        issuesCount: summary.issuesCount,
      };
    });

    let merged = aiEvents.concat(overseerEvents);

    if (filters?.decision) {
      merged = merged.filter((evt) => evt.decision === filters.decision);
    }

    merged.sort((a, b) => {
      const aMs = new Date(a.createdAt).getTime();
      const bMs = new Date(b.createdAt).getTime();
      if (aMs !== bMs) return bMs - aMs;
      // Stable-ish tie-breakers for deterministic UI ordering.
      if (a.source !== b.source) return a.source < b.source ? 1 : -1;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

    const page = merged.slice(0, limit);
    const nextCursor = page.length === limit ? page[page.length - 1]!.createdAt : null;

    return {
      success: true,
      data: {
        events: page,
        nextCursor,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to list AI ops events" };
  }
}
