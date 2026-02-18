import "server-only";

export const INNGEST_EVENT_BACKGROUND_PROCESS_REQUESTED = "background/process.requested";
export const INNGEST_EVENT_BACKGROUND_MAINTENANCE_REQUESTED = "background/maintenance.requested";
export const INNGEST_EVENT_CRON_RESPONSE_TIMING_REQUESTED = "cron/response-timing.requested";
export const INNGEST_EVENT_CRON_APPOINTMENT_RECONCILE_REQUESTED = "cron/appointment-reconcile.requested";
export const INNGEST_EVENT_CRON_FOLLOWUPS_REQUESTED = "cron/followups.requested";
export const INNGEST_EVENT_CRON_AVAILABILITY_REQUESTED = "cron/availability.requested";
export const INNGEST_EVENT_CRON_EMAILBISON_AVAILABILITY_SLOT_REQUESTED =
  "cron/emailbison-availability-slot.requested";

export type BackgroundDispatchEventData = {
  source: string;
  requestedAt: string;
  dispatchKey: string;
  correlationId: string;
  dispatchWindowStart: string;
  dispatchWindowSeconds: number;
};

export type CronDispatchEventData = BackgroundDispatchEventData & {
  params?: Record<string, string>;
};
