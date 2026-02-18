import "server-only";

import { BackgroundDispatchStatus } from "@prisma/client";
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
