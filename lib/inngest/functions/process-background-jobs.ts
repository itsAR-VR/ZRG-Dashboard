import "server-only";

import { inngest } from "@/lib/inngest/client";
import { INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED } from "@/lib/inngest/events";
import { processBackgroundJobs } from "@/lib/background-jobs/runner";

export const processBackgroundJobsFunction = inngest.createFunction(
  {
    id: "process-background-jobs",
    retries: 5,
    concurrency: { limit: 1 },
  },
  { event: INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED },
  async ({ event, step }) => {
    const source = typeof event.data?.source === "string" ? event.data.source : "unknown";
    const requestedAt = typeof event.data?.requestedAt === "string" ? event.data.requestedAt : null;

    const results = await step.run("process-background-jobs", async () => processBackgroundJobs());

    return {
      source,
      requestedAt,
      processedAt: new Date().toISOString(),
      ...results,
    };
  }
);
