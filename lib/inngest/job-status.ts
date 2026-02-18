import "server-only";

import { redisSetJson } from "@/lib/redis";
import { prisma } from "@/lib/prisma";

type JobStatus = "running" | "succeeded" | "failed";

type WriteInngestJobStatusInput = {
  jobName: string;
  status: JobStatus;
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  lastError?: string;
  clientId?: string | null;
  source?: string;
  runId?: string;
  dispatchKey?: string | null;
  correlationId?: string | null;
  requestedAt?: string | null;
};

const DEFAULT_JOB_STATUS_TTL_SECONDS = 60 * 60 * 24; // 24h
const RUN_STATUS_BY_JOB_STATUS = {
  running: "RUNNING",
  succeeded: "SUCCEEDED",
  failed: "FAILED",
} as const;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getJobStatusTtlSeconds(): number {
  return Math.max(60, parsePositiveInt(process.env.INNGEST_JOB_STATUS_TTL_SECONDS, DEFAULT_JOB_STATUS_TTL_SECONDS));
}

function normalizeJobKeyScope(clientId: string | null | undefined): string {
  const trimmed = clientId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "global";
}

function parseIsoDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function computeRunKey(input: WriteInngestJobStatusInput): string {
  const runId = normalizeNullableString(input.runId);
  if (runId) {
    return `${input.jobName}:${runId}:${Math.max(0, Math.trunc(input.attempt))}`;
  }
  return `${input.jobName}:${Math.max(0, Math.trunc(input.attempt))}:${input.startedAt}`;
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function writeRedisJobStatus(input: WriteInngestJobStatusInput): Promise<void> {
  const key = `job:v1:${normalizeJobKeyScope(input.clientId)}:${input.jobName}`;
  await redisSetJson(
    key,
    {
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt ?? null,
      durationMs: typeof input.durationMs === "number" ? Math.max(0, Math.trunc(input.durationMs)) : null,
      attempt: Math.max(0, Math.trunc(input.attempt)),
      lastError: input.lastError ?? null,
      source: input.source ?? null,
      runId: normalizeNullableString(input.runId),
      dispatchKey: normalizeNullableString(input.dispatchKey),
      correlationId: normalizeNullableString(input.correlationId),
      requestedAt: input.requestedAt ?? null,
      updatedAt: new Date().toISOString(),
    },
    { exSeconds: getJobStatusTtlSeconds() }
  );
}

async function writeDurableRunStatus(input: WriteInngestJobStatusInput): Promise<void> {
  const startedAt = parseIsoDate(input.startedAt);
  if (!startedAt) {
    throw new Error(`Invalid startedAt timestamp: ${input.startedAt}`);
  }

  const finishedAt = parseIsoDate(input.finishedAt);
  const requestedAt = parseIsoDate(input.requestedAt);
  const runKey = computeRunKey(input);
  const normalizedRunId = normalizeNullableString(input.runId);
  const normalizedSource = normalizeNullableString(input.source);
  const normalizedClientId = normalizeNullableString(input.clientId);
  const normalizedDispatchKey = normalizeNullableString(input.dispatchKey);
  const normalizedCorrelationId = normalizeNullableString(input.correlationId);
  const normalizedError = normalizeNullableString(input.lastError);

  await prisma.backgroundFunctionRun.upsert({
    where: { runKey },
    create: {
      runKey,
      functionName: input.jobName,
      status: RUN_STATUS_BY_JOB_STATUS[input.status],
      attempt: Math.max(0, Math.trunc(input.attempt)),
      runId: normalizedRunId,
      source: normalizedSource,
      clientId: normalizedClientId,
      dispatchKey: normalizedDispatchKey,
      correlationId: normalizedCorrelationId,
      requestedAt,
      startedAt,
      finishedAt,
      durationMs: typeof input.durationMs === "number" ? Math.max(0, Math.trunc(input.durationMs)) : null,
      lastError: normalizedError,
    },
    update: {
      status: RUN_STATUS_BY_JOB_STATUS[input.status],
      attempt: Math.max(0, Math.trunc(input.attempt)),
      runId: normalizedRunId,
      source: normalizedSource,
      clientId: normalizedClientId,
      dispatchKey: normalizedDispatchKey,
      correlationId: normalizedCorrelationId,
      requestedAt,
      startedAt,
      finishedAt,
      durationMs: typeof input.durationMs === "number" ? Math.max(0, Math.trunc(input.durationMs)) : null,
      lastError: normalizedError,
    },
  });
}

export async function writeInngestJobStatus(input: WriteInngestJobStatusInput): Promise<void> {
  const writes = await Promise.allSettled([writeRedisJobStatus(input), writeDurableRunStatus(input)]);
  for (const [index, result] of writes.entries()) {
    if (result.status === "fulfilled") continue;
    const target = index === 0 ? "redis" : "durable-run-ledger";
    console.warn("[Inngest Job Status] Write failed", {
      target,
      jobName: input.jobName,
      runId: input.runId ?? null,
      error: serializeError(result.reason),
    });
  }
}
