import "server-only";

import { prisma } from "@/lib/prisma";
import {
  coerceConfidencePolicyConfig,
  getDefaultConfidencePolicyConfig,
  listSupportedConfidencePolicyKeys,
} from "@/lib/confidence-policy";

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function bucket01(value: number, step: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(0, Math.min(1, value));
  return Math.floor(clamped / step) * step;
}

function average(values: number[]): number | null {
  const finite = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!finite.length) return null;
  return finite.reduce((sum, v) => sum + v, 0) / finite.length;
}

async function computeAutoSendMetrics(clientId: string, windowFrom: Date, windowTo: Date) {
  const rows = await prisma.aIDraft.findMany({
    where: {
      autoSendEvaluatedAt: { gte: windowFrom, lt: windowTo },
      lead: { clientId },
      autoSendConfidence: { not: null },
    },
    select: {
      autoSendConfidence: true,
      autoSendAction: true,
      autoSendThreshold: true,
      responseDisposition: true,
      channel: true,
    },
    take: 5000,
    orderBy: { autoSendEvaluatedAt: "desc" },
  });

  const histogramStep = 0.05;
  const histogram: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  const byDisposition: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  const confidences: number[] = [];
  const thresholds: number[] = [];

  for (const row of rows) {
    const c = typeof row.autoSendConfidence === "number" ? row.autoSendConfidence : null;
    if (typeof c === "number" && Number.isFinite(c)) {
      confidences.push(c);
      const bucket = bucket01(c, histogramStep);
      const key = `${bucket.toFixed(2)}-${(bucket + histogramStep).toFixed(2)}`;
      histogram[key] = (histogram[key] ?? 0) + 1;
    }

    const actionKey = row.autoSendAction || "unknown";
    byAction[actionKey] = (byAction[actionKey] ?? 0) + 1;

    const dispKey = row.responseDisposition || "unknown";
    byDisposition[dispKey] = (byDisposition[dispKey] ?? 0) + 1;

    const channelKey = row.channel || "unknown";
    byChannel[channelKey] = (byChannel[channelKey] ?? 0) + 1;

    if (typeof row.autoSendThreshold === "number" && Number.isFinite(row.autoSendThreshold)) {
      thresholds.push(row.autoSendThreshold);
    }
  }

  return {
    samples: rows.length,
    byAction,
    byDisposition,
    byChannel,
    confidence: {
      avg: average(confidences),
      histogramStep,
      histogram,
    },
    threshold: {
      avg: average(thresholds),
    },
    notes: rows.length >= 5000 ? ["truncated_to_5000_latest"] : [],
  };
}

async function computeMeetingOverseerGateMetrics(clientId: string, windowFrom: Date, windowTo: Date) {
  const rows = await prisma.meetingOverseerDecision.findMany({
    where: {
      clientId,
      stage: "gate",
      createdAt: { gte: windowFrom, lt: windowTo },
    },
    select: {
      confidence: true,
      model: true,
      promptKey: true,
    },
    take: 5000,
    orderBy: { createdAt: "desc" },
  });

  const confidences: number[] = [];
  const byModel: Record<string, number> = {};
  const byPromptKey: Record<string, number> = {};

  for (const row of rows) {
    if (typeof row.confidence === "number" && Number.isFinite(row.confidence)) {
      confidences.push(row.confidence);
    }
    byModel[row.model] = (byModel[row.model] ?? 0) + 1;
    byPromptKey[row.promptKey] = (byPromptKey[row.promptKey] ?? 0) + 1;
  }

  return {
    samples: rows.length,
    byModel,
    byPromptKey,
    confidence: {
      avg: average(confidences),
    },
    notes: rows.length >= 5000 ? ["truncated_to_5000_latest"] : [],
  };
}

async function ensureBootstrapProposals(opts: {
  clientId: string;
  runId: string;
  computedByUserId?: string | null;
  computedByEmail?: string | null;
}): Promise<{ proposalsCreated: number; created: Array<{ proposalId: string; policyKey: string }> }> {
  const policyKeys = listSupportedConfidencePolicyKeys();
  const created: Array<{ proposalId: string; policyKey: string }> = [];

  for (const policyKey of policyKeys) {
    const existingPolicy = await prisma.confidencePolicy.findUnique({
      where: { clientId_policyKey: { clientId: opts.clientId, policyKey } },
      select: { id: true },
    });
    if (existingPolicy) continue;

    const existingPending = await prisma.confidencePolicyProposal.findFirst({
      where: {
        clientId: opts.clientId,
        policyKey,
        status: { in: ["PENDING", "APPROVED"] },
      },
      select: { id: true },
    });
    if (existingPending) continue;

    const defaults = getDefaultConfidencePolicyConfig(policyKey);
    if (!defaults) continue;

    const payload = coerceConfidencePolicyConfig(policyKey, defaults);

    const proposal = await prisma.confidencePolicyProposal.create({
      data: {
        clientId: opts.clientId,
        policyKey,
        status: "PENDING",
        title: `Initialize confidence policy: ${policyKey}`,
        summary: "Bootstrap default thresholds (no behavior change until applied).",
        payload,
        evidence: {
          kind: "bootstrap_default",
          policyKey,
        },
        sourceRunId: opts.runId,
        createdByUserId: opts.computedByUserId ?? null,
        createdByEmail: opts.computedByEmail ?? null,
      },
      select: { id: true },
    });

    created.push({ proposalId: proposal.id, policyKey });
  }

  return { proposalsCreated: created.length, created };
}

export async function runConfidenceCalibrationSystem(opts: {
  clientId: string;
  windowFrom: Date;
  windowTo: Date;
  computedByUserId?: string | null;
  computedByEmail?: string | null;
}): Promise<{ runId: string; proposalsCreated: number }> {
  const run = await prisma.confidenceCalibrationRun.create({
    data: {
      clientId: opts.clientId,
      windowFrom: opts.windowFrom,
      windowTo: opts.windowTo,
      status: "PENDING",
      // "model" is required by schema; for v1 this system is deterministic (no LLM calls).
      model: "deterministic.v1",
      reasoningEffort: null,
      computedByUserId: opts.computedByUserId ?? null,
      computedByEmail: opts.computedByEmail ?? null,
    },
    select: { id: true },
  });

  try {
    await prisma.confidenceCalibrationRun.update({
      where: { id: run.id },
      data: { status: "RUNNING" },
      select: { id: true },
    });

    const [autoSendMetrics, overseerGateMetrics] = await Promise.all([
      computeAutoSendMetrics(opts.clientId, opts.windowFrom, opts.windowTo),
      computeMeetingOverseerGateMetrics(opts.clientId, opts.windowFrom, opts.windowTo),
    ]);

    const bootstrap = await ensureBootstrapProposals({
      clientId: opts.clientId,
      runId: run.id,
      computedByUserId: opts.computedByUserId ?? null,
      computedByEmail: opts.computedByEmail ?? null,
    });

    const metricsSnapshot = {
      windowFrom: opts.windowFrom.toISOString(),
      windowTo: opts.windowTo.toISOString(),
      autoSend: autoSendMetrics,
      meetingOverseerGate: overseerGateMetrics,
    };

    const output = {
      supportedPolicyKeys: listSupportedConfidencePolicyKeys(),
      bootstrapProposalsCreated: bootstrap.created,
    };

    await prisma.confidenceCalibrationRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETE",
        metricsSnapshot,
        output,
        proposalsCreated: bootstrap.proposalsCreated,
        computedAt: new Date(),
      },
      select: { id: true },
    });

    return { runId: run.id, proposalsCreated: bootstrap.proposalsCreated };
  } catch (error) {
    const message = safeErrorMessage(error);
    await prisma.confidenceCalibrationRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: message,
        computedAt: new Date(),
      },
      select: { id: true },
    }).catch(() => {});
    throw error instanceof Error ? error : new Error(message);
  }
}

