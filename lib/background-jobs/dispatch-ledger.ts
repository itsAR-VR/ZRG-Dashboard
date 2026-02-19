import "server-only";

import { BackgroundDispatchStatus, BackgroundFunctionRunStatus } from "@prisma/client";
import { isPrismaUniqueConstraintError, prisma } from "@/lib/prisma";

function parseIsoDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getStaleFunctionRunMinutes(): number {
  return Math.max(5, parsePositiveInt(process.env.BACKGROUND_FUNCTION_RUN_STALE_MINUTES, 15));
}

function getStaleFunctionRunRecoveryLimit(): number {
  return Math.max(1, Math.min(200, parsePositiveInt(process.env.BACKGROUND_FUNCTION_RUN_STALE_RECOVERY_LIMIT, 25)));
}

type RegisterDispatchWindowInput = {
  dispatchKey: string;
  source: string;
  requestedAt: string;
  windowStart: string;
  windowSeconds: number;
  correlationId: string;
};

type ExistingDispatchWindowSummary = {
  status: BackgroundDispatchStatus;
  processDispatchId: string | null;
  maintenanceDispatchId: string | null;
  processEventId: string | null;
  maintenanceEventId: string | null;
  updatedAt: string;
};

export type RegisterBackgroundDispatchWindowResult = {
  trackingEnabled: boolean;
  duplicateSuppressed: boolean;
  existing?: ExistingDispatchWindowSummary;
};

async function readExistingDispatchWindow(
  dispatchKey: string
): Promise<ExistingDispatchWindowSummary | undefined> {
  const existing = await prisma.backgroundDispatchWindow.findUnique({
    where: { dispatchKey },
    select: {
      status: true,
      processDispatchId: true,
      maintenanceDispatchId: true,
      processEventId: true,
      maintenanceEventId: true,
      updatedAt: true,
    },
  });

  if (!existing) return undefined;
  return {
    ...existing,
    updatedAt: existing.updatedAt.toISOString(),
  };
}

export async function registerBackgroundDispatchWindow(
  input: RegisterDispatchWindowInput
): Promise<RegisterBackgroundDispatchWindowResult> {
  try {
    await prisma.backgroundDispatchWindow.create({
      data: {
        dispatchKey: input.dispatchKey,
        source: input.source,
        requestedAt: parseIsoDate(input.requestedAt),
        windowStart: parseIsoDate(input.windowStart),
        windowSeconds: Math.max(1, Math.trunc(input.windowSeconds)),
        correlationId: input.correlationId,
        status: BackgroundDispatchStatus.DISPATCHING,
      },
    });

    return { trackingEnabled: true, duplicateSuppressed: false };
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      try {
        const existing = await readExistingDispatchWindow(input.dispatchKey);
        return {
          trackingEnabled: true,
          duplicateSuppressed: true,
          ...(existing ? { existing } : {}),
        };
      } catch (readError) {
        console.warn("[Background Dispatch] Failed reading duplicate dispatch window", {
          dispatchKey: input.dispatchKey,
          error: serializeError(readError),
        });
        return { trackingEnabled: true, duplicateSuppressed: true };
      }
    }

    console.warn("[Background Dispatch] Failed registering dispatch window", {
      dispatchKey: input.dispatchKey,
      error: serializeError(error),
    });
    return { trackingEnabled: false, duplicateSuppressed: false };
  }
}

async function updateDispatchWindow(
  dispatchKey: string,
  data: {
    status: BackgroundDispatchStatus;
    processDispatchId?: string;
    maintenanceDispatchId?: string;
    processEventId?: string;
    maintenanceEventId?: string;
    errorMessage?: string;
  }
): Promise<void> {
  try {
    await prisma.backgroundDispatchWindow.update({
      where: { dispatchKey },
      data: {
        status: data.status,
        processDispatchId: data.processDispatchId,
        maintenanceDispatchId: data.maintenanceDispatchId,
        processEventId: data.processEventId,
        maintenanceEventId: data.maintenanceEventId,
        errorMessage: data.errorMessage ?? null,
      },
    });
  } catch (error) {
    console.warn("[Background Dispatch] Failed updating dispatch window", {
      dispatchKey,
      status: data.status,
      error: serializeError(error),
    });
  }
}

export async function markBackgroundDispatchEnqueued(input: {
  dispatchKey: string;
  processDispatchId: string;
  maintenanceDispatchId: string;
  processEventId?: string;
  maintenanceEventId?: string;
}): Promise<void> {
  await updateDispatchWindow(input.dispatchKey, {
    status: BackgroundDispatchStatus.ENQUEUED,
    processDispatchId: input.processDispatchId,
    maintenanceDispatchId: input.maintenanceDispatchId,
    processEventId: input.processEventId,
    maintenanceEventId: input.maintenanceEventId,
  });
}

export async function markBackgroundDispatchFailed(input: {
  dispatchKey: string;
  processDispatchId: string;
  maintenanceDispatchId: string;
  errorMessage: string;
}): Promise<void> {
  await updateDispatchWindow(input.dispatchKey, {
    status: BackgroundDispatchStatus.ENQUEUE_FAILED,
    processDispatchId: input.processDispatchId,
    maintenanceDispatchId: input.maintenanceDispatchId,
    errorMessage: input.errorMessage,
  });
}

export async function markBackgroundDispatchInlineEmergency(input: {
  dispatchKey: string;
  processDispatchId: string;
  maintenanceDispatchId: string;
  errorMessage: string;
}): Promise<void> {
  await updateDispatchWindow(input.dispatchKey, {
    status: BackgroundDispatchStatus.INLINE_EMERGENCY,
    processDispatchId: input.processDispatchId,
    maintenanceDispatchId: input.maintenanceDispatchId,
    errorMessage: input.errorMessage,
  });
}

export type RecoverStaleBackgroundFunctionRunsResult = {
  functionName: string;
  staleMinutes: number;
  recovered: number;
  runKeys: string[];
  oldestStartedAt: string | null;
};

export async function recoverStaleBackgroundFunctionRuns(input?: {
  functionName?: string;
  staleMinutes?: number;
  limit?: number;
  reason?: string;
}): Promise<RecoverStaleBackgroundFunctionRunsResult> {
  const functionName = input?.functionName?.trim() || "process-background-jobs";
  const staleMinutes = Math.max(1, Math.trunc(input?.staleMinutes ?? getStaleFunctionRunMinutes()));
  const limit = Math.max(1, Math.min(200, Math.trunc(input?.limit ?? getStaleFunctionRunRecoveryLimit())));
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);

  const staleRuns = await prisma.backgroundFunctionRun.findMany({
    where: {
      functionName,
      status: BackgroundFunctionRunStatus.RUNNING,
      startedAt: { lt: cutoff },
    },
    orderBy: { startedAt: "asc" },
    take: limit,
    select: {
      id: true,
      runKey: true,
      startedAt: true,
    },
  });

  if (staleRuns.length === 0) {
    return {
      functionName,
      staleMinutes,
      recovered: 0,
      runKeys: [],
      oldestStartedAt: null,
    };
  }

  const finishedAt = new Date();
  const reason =
    input?.reason?.trim() || `Recovered stale RUNNING run via cron watchdog (>${staleMinutes}m).`;

  const result = await prisma.backgroundFunctionRun.updateMany({
    where: {
      id: { in: staleRuns.map((run) => run.id) },
      status: BackgroundFunctionRunStatus.RUNNING,
    },
    data: {
      status: BackgroundFunctionRunStatus.FAILED,
      finishedAt,
      lastError: reason,
    },
  });

  const runKeys = staleRuns.map((run) => run.runKey);
  console.error("[Background Dispatch] Recovered stale function runs", {
    functionName,
    staleMinutes,
    recovered: result.count,
    runKeys: runKeys.slice(0, 10),
  });

  return {
    functionName,
    staleMinutes,
    recovered: result.count,
    runKeys,
    oldestStartedAt: staleRuns[0]?.startedAt.toISOString() ?? null,
  };
}
