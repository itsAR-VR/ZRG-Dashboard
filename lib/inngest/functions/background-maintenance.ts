import "server-only";

import { runBackgroundMaintenance } from "@/lib/background-jobs/maintenance";
import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_BACKGROUND_MAINTENANCE_REQUESTED } from "@/lib/inngest/events";
import { writeInngestJobStatus } from "@/lib/inngest/job-status";

export const backgroundMaintenanceFunction = inngest.createFunction(
  {
    id: "background-maintenance",
    retries: 3,
    concurrency: { limit: 1 },
  },
  { event: INNGEST_EVENT_BACKGROUND_MAINTENANCE_REQUESTED },
  async ({ event, step, attempt }) => {
    const source = typeof event.data?.source === "string" ? event.data.source : "unknown";
    const requestedAt = typeof event.data?.requestedAt === "string" ? event.data.requestedAt : null;
    const startedAt = new Date();

    await writeInngestJobStatus({
      jobName: "background-maintenance",
      status: "running",
      attempt,
      startedAt: startedAt.toISOString(),
      source,
    });

    try {
      const maintenance = await step.run("background-maintenance", async () => runBackgroundMaintenance());
      const finishedAt = new Date();
      await writeInngestJobStatus({
        jobName: "background-maintenance",
        status: "succeeded",
        attempt,
        source,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      });

      return {
        source,
        requestedAt,
        processedAt: finishedAt.toISOString(),
        ...maintenance,
      };
    } catch (error) {
      const finishedAt = new Date();
      await writeInngestJobStatus({
        jobName: "background-maintenance",
        status: "failed",
        attempt,
        source,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        lastError: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }
);
