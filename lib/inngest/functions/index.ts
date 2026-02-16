import "server-only";

import { processBackgroundJobsFunction } from "@/lib/inngest/functions/process-background-jobs";

export const inngestFunctions = [processBackgroundJobsFunction];
