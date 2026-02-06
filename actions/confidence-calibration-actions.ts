"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAdminAccess } from "@/lib/workspace-access";
import { runConfidenceCalibrationSystem } from "@/lib/confidence-calibration";

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

export async function runConfidenceCalibrationRun(
  clientId: string | null | undefined,
  params?: { windowFrom?: string | Date; windowTo?: string | Date }
): Promise<{ success: boolean; runId?: string; proposalsCreated?: number; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAdminAccess(clientId);

    const windowDays = parsePositiveIntEnv("CONFIDENCE_CALIBRATION_WINDOW_DAYS", 30);
    const windowTo = params?.windowTo ? new Date(params.windowTo) : new Date();
    const windowFrom = params?.windowFrom
      ? new Date(params.windowFrom)
      : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const res = await runConfidenceCalibrationSystem({
      clientId,
      windowFrom,
      windowTo,
      computedByUserId: userId,
      computedByEmail: userEmail,
    });

    return { success: true, runId: res.runId, proposalsCreated: res.proposalsCreated };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to run calibration" };
  }
}

export type ConfidenceCalibrationRunRow = {
  id: string;
  windowFrom: string;
  windowTo: string;
  status: string;
  model: string;
  proposalsCreated: number;
  computedAt: string | null;
  error: string | null;
  createdAt: string;
};

export async function listConfidenceCalibrationRuns(
  clientId: string | null | undefined
): Promise<{ success: boolean; data?: { runs: ConfidenceCalibrationRunRow[] }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAdminAccess(clientId);

    const runs = await prisma.confidenceCalibrationRun.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        windowFrom: true,
        windowTo: true,
        status: true,
        model: true,
        proposalsCreated: true,
        computedAt: true,
        error: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      data: {
        runs: runs.map((r) => ({
          id: r.id,
          windowFrom: r.windowFrom.toISOString(),
          windowTo: r.windowTo.toISOString(),
          status: r.status,
          model: r.model,
          proposalsCreated: r.proposalsCreated,
          computedAt: r.computedAt ? r.computedAt.toISOString() : null,
          error: r.error ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load calibration runs" };
  }
}

export async function getConfidenceCalibrationRun(
  clientId: string | null | undefined,
  runId: string
): Promise<{ success: boolean; data?: { run: any }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAdminAccess(clientId);

    const run = await prisma.confidenceCalibrationRun.findFirst({
      where: { id: runId, clientId },
      select: {
        id: true,
        windowFrom: true,
        windowTo: true,
        status: true,
        model: true,
        reasoningEffort: true,
        metricsSnapshot: true,
        output: true,
        error: true,
        proposalsCreated: true,
        computedAt: true,
        computedByEmail: true,
        createdAt: true,
      },
    });
    if (!run) return { success: false, error: "Calibration run not found" };

    return {
      success: true,
      data: {
        run: {
          id: run.id,
          windowFrom: run.windowFrom.toISOString(),
          windowTo: run.windowTo.toISOString(),
          status: run.status,
          model: run.model,
          reasoningEffort: run.reasoningEffort,
          metricsSnapshot: run.metricsSnapshot,
          output: run.output,
          error: run.error ?? null,
          proposalsCreated: run.proposalsCreated,
          computedAt: run.computedAt ? run.computedAt.toISOString() : null,
          computedByEmail: run.computedByEmail ?? null,
          createdAt: run.createdAt.toISOString(),
        },
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load calibration run" };
  }
}

