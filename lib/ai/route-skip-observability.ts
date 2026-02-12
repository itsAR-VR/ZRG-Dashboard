import "server-only";

import { prisma } from "@/lib/prisma";
import { getAiTelemetrySource } from "@/lib/ai/telemetry-context";

export const AI_ROUTE_SKIP_FEATURE_ID = "ai.route_skipped";

export type AiRouteSkipKey =
  | "draft_generation"
  | "draft_generation_step2"
  | "draft_verification_step3"
  | "meeting_overseer_draft"
  | "meeting_overseer_followup";

function promptKeyForRoute(route: AiRouteSkipKey): string {
  return `ai.route_skip.${route}.v1`;
}

export async function recordAiRouteSkip(opts: {
  clientId: string;
  leadId?: string | null;
  route: AiRouteSkipKey;
  channel?: string | null;
  reason?: string | null;
  triggerMessageId?: string | null;
  source?: string | null;
}): Promise<void> {
  try {
    await prisma.aIInteraction.create({
      data: {
        clientId: opts.clientId,
        leadId: opts.leadId ?? null,
        source: opts.source ?? getAiTelemetrySource(),
        featureId: AI_ROUTE_SKIP_FEATURE_ID,
        promptKey: promptKeyForRoute(opts.route),
        model: "system",
        apiType: "responses",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        status: "success",
        metadata: {
          routeSkip: {
            route: opts.route,
            reason: (opts.reason || "disabled_by_workspace_settings").slice(0, 120),
            channel: opts.channel ?? null,
            triggerMessageId: opts.triggerMessageId ?? null,
          },
        },
      },
    });
  } catch (error) {
    console.warn("[AI Route Skip] Failed to record skip interaction", {
      route: opts.route,
      clientId: opts.clientId,
      leadId: opts.leadId ?? null,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
