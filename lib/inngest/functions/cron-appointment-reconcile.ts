import "server-only";

import {
  buildAppointmentReconcileOptions,
  runAppointmentReconcileCron,
} from "@/lib/cron/appointment-reconcile";
import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_CRON_APPOINTMENT_RECONCILE_REQUESTED } from "@/lib/inngest/events";
import { writeInngestJobStatus } from "@/lib/inngest/job-status";

function buildSearchParamsFromEventParams(params: unknown): URLSearchParams {
  const searchParams = new URLSearchParams();

  if (!params || typeof params !== "object") return searchParams;

  for (const [key, rawValue] of Object.entries(params)) {
    if (typeof rawValue !== "string") continue;
    const value = rawValue.trim();
    if (!value) continue;
    searchParams.set(key, value);
  }

  return searchParams;
}

export const cronAppointmentReconcileFunction = inngest.createFunction(
  {
    id: "cron-appointment-reconcile",
    retries: 3,
    concurrency: { limit: 1 },
    idempotency: "event.data.dispatchKey",
  },
  { event: INNGEST_EVENT_CRON_APPOINTMENT_RECONCILE_REQUESTED },
  async ({ event, step, attempt, runId }) => {
    const source = typeof event.data?.source === "string" ? event.data.source : "unknown";
    const requestedAt = typeof event.data?.requestedAt === "string" ? event.data.requestedAt : null;
    const dispatchKey = typeof event.data?.dispatchKey === "string" ? event.data.dispatchKey : null;
    const correlationId = typeof event.data?.correlationId === "string" ? event.data.correlationId : null;
    const startedAt = new Date();

    await writeInngestJobStatus({
      jobName: "cron-appointment-reconcile",
      status: "running",
      attempt,
      startedAt: startedAt.toISOString(),
      source,
      runId,
      dispatchKey,
      correlationId,
      requestedAt,
    });

    try {
      const searchParams = buildSearchParamsFromEventParams(event.data?.params);
      const options = buildAppointmentReconcileOptions(searchParams);
      const result = await step.run("cron-appointment-reconcile", async () => runAppointmentReconcileCron(options));
      const finishedAt = new Date();

      await writeInngestJobStatus({
        jobName: "cron-appointment-reconcile",
        status: "succeeded",
        attempt,
        source,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        runId,
        dispatchKey,
        correlationId,
        requestedAt,
      });

      return {
        source,
        requestedAt,
        dispatchKey,
        correlationId,
        processedAt: finishedAt.toISOString(),
        options,
        ...result,
      };
    } catch (error) {
      const finishedAt = new Date();
      await writeInngestJobStatus({
        jobName: "cron-appointment-reconcile",
        status: "failed",
        attempt,
        source,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        lastError: error instanceof Error ? error.message : "Unknown error",
        runId,
        dispatchKey,
        correlationId,
        requestedAt,
      });
      throw error;
    }
  }
);
