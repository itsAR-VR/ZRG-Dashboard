import "server-only";

import { backgroundMaintenanceFunction } from "@/lib/inngest/functions/background-maintenance";
import { cronAppointmentReconcileFunction } from "@/lib/inngest/functions/cron-appointment-reconcile";
import { cronAvailabilityFunction } from "@/lib/inngest/functions/cron-availability";
import { cronEmailBisonAvailabilitySlotFunction } from "@/lib/inngest/functions/cron-emailbison-availability-slot";
import { cronFollowupsFunction } from "@/lib/inngest/functions/cron-followups";
import { cronResponseTimingFunction } from "@/lib/inngest/functions/cron-response-timing";
import { processBackgroundJobsFunction } from "@/lib/inngest/functions/process-background-jobs";

export const inngestFunctions = [
  processBackgroundJobsFunction,
  backgroundMaintenanceFunction,
  cronResponseTimingFunction,
  cronAppointmentReconcileFunction,
  cronFollowupsFunction,
  cronAvailabilityFunction,
  cronEmailBisonAvailabilitySlotFunction,
];
