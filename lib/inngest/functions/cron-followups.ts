import "server-only";

import { runFollowupsCron } from "@/lib/cron/followups";
import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_CRON_FOLLOWUPS_REQUESTED } from "@/lib/inngest/events";
import { writeInngestJobStatus } from "@/lib/inngest/job-status";

export const cronFollowupsFunction = inngest.createFunction(
  {
    id: "cron-followups",
    retries: 3,
    concurrency: { limit: 1 },
    idempotency: "event.data.dispatchKey",
  },
  { event: INNGEST_EVENT_CRON_FOLLOWUPS_REQUESTED },
  async ({ event, step, attempt, runId }) => {
    const source = typeof event.data?.source === "string" ? event.data.source : "unknown";
    const requestedAt = typeof event.data?.requestedAt === "string" ? event.data.requestedAt : null;
    const dispatchKey = typeof event.data?.dispatchKey === "string" ? event.data.dispatchKey : null;
    const correlationId = typeof event.data?.correlationId === "string" ? event.data.correlationId : null;
    const startedAt = new Date();

    await writeInngestJobStatus({
      jobName: "cron-followups",
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
      const runResult = await step.run("cron-followups", async () => {
        const response = await runFollowupsCron("/api/cron/followups");
        let payload: unknown = null;

        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        return {
          ok: response.ok,
          status: response.status,
          payload,
        };
      });

      if (!runResult.ok) {
        throw new Error(`Followups cron returned status ${runResult.status}`);
      }

      const finishedAt = new Date();
      await writeInngestJobStatus({
        jobName: "cron-followups",
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
        payload: runResult.payload,
      };
    } catch (error) {
      const finishedAt = new Date();
      await writeInngestJobStatus({
        jobName: "cron-followups",
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
