import "server-only";

import { backgroundMaintenanceFunction } from "@/lib/inngest/functions/background-maintenance";
import { processBackgroundJobsFunction } from "@/lib/inngest/functions/process-background-jobs";

export const inngestFunctions = [processBackgroundJobsFunction, backgroundMaintenanceFunction];
