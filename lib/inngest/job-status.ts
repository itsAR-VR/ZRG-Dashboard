import "server-only";

import { redisSetJson } from "@/lib/redis";

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
};

const DEFAULT_JOB_STATUS_TTL_SECONDS = 60 * 60 * 24; // 24h

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

export async function writeInngestJobStatus(input: WriteInngestJobStatusInput): Promise<void> {
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
      updatedAt: new Date().toISOString(),
    },
    { exSeconds: getJobStatusTtlSeconds() }
  );
}
