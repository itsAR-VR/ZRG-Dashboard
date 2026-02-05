"use server";

import { requireClientAdminAccess } from "@/lib/workspace-access";
import { runMessagePerformanceEvaluationSystem } from "@/lib/message-performance-eval";

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

export async function runMessagePerformanceEval(
  clientId: string | null | undefined,
  params?: { windowFrom?: string | Date; windowTo?: string | Date }
): Promise<{ success: boolean; runId?: string; proposalsCreated?: number; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAdminAccess(clientId);

    const windowDays = parsePositiveIntEnv("MESSAGE_PERFORMANCE_WINDOW_DAYS", 30);
    const windowTo = params?.windowTo ? new Date(params.windowTo) : new Date();
    const windowFrom = params?.windowFrom ? new Date(params.windowFrom) : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const res = await runMessagePerformanceEvaluationSystem({
      clientId,
      windowFrom,
      windowTo,
      computedByUserId: userId,
      computedByEmail: userEmail,
    });

    return { success: true, runId: res.runId, proposalsCreated: res.proposalsCreated };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to run evaluation" };
  }
}
