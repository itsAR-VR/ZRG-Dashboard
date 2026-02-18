import "server-only";

import { runResponseTimingCron } from "@/lib/cron/response-timing";
import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_CRON_RESPONSE_TIMING_REQUESTED } from "@/lib/inngest/events";
import { writeInngestJobStatus } from "@/lib/inngest/job-status";

export const cronResponseTimingFunction = inngest.createFunction(
  {
    id: "cron-response-timing",
    retries: 3,
    concurrency: { limit: 1 },
    idempotency: "event.data.dispatchKey",
  },
  { event: INNGEST_EVENT_CRON_RESPONSE_TIMING_REQUESTED },
  async ({ event, step, attempt, runId }) => {
    const source = typeof event.data?.source === "string" ? event.data.source : "unknown";
    const requestedAt = typeof event.data?.requestedAt === "string" ? event.data.requestedAt : null;
    const dispatchKey = typeof event.data?.dispatchKey === "string" ? event.data.dispatchKey : null;
    const correlationId = typeof event.data?.correlationId === "string" ? event.data.correlationId : null;
    const startedAt = new Date();

    await writeInngestJobStatus({
      jobName: "cron-response-timing",
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
      const result = await step.run("cron-response-timing", async () => runResponseTimingCron());
      const finishedAt = new Date();

      await writeInngestJobStatus({
        jobName: "cron-response-timing",
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
        ...result,
      };
    } catch (error) {
      const finishedAt = new Date();
      await writeInngestJobStatus({
        jobName: "cron-response-timing",
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
