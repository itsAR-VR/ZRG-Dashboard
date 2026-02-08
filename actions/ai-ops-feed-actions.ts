"use server";

import { prisma } from "@/lib/prisma";
import {
  extractAiInteractionSummary,
  extractOverseerPayloadSummary,
  parseCursorDate,
  type AiOpsDecision,
} from "@/lib/ai-ops-feed-internals";
import { requireClientAdminAccess } from "@/lib/workspace-access";

type AiOpsEventSource = "ai_interaction" | "overseer_decision";

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
  "auto_send.context_select",
  "auto_send.revise",
] as const;

const AI_OPS_OVERSEER_STAGES = ["extract", "gate", "booking_gate"] as const;

function clampLimit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(200, Math.trunc(value)));
}

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
