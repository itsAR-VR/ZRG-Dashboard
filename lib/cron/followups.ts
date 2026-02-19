import "server-only";

import { NextResponse } from "next/server";

import { backfillNoResponseFollowUpsDueOnCron } from "@/lib/followup-backfill";
import {
  completeFollowUpsForMeetingBookedLeads,
  processFollowUpsDue,
  resumeAwaitingEnrichmentFollowUps,
  resumeGhostedFollowUps,
  resumeSnoozedFollowUps,
} from "@/lib/followup-engine";
import { processScheduledTimingFollowUpTasksDue } from "@/lib/followup-timing";
import { processDailyNotificationDigestsDue } from "@/lib/notification-center";
import { retrySmsDndHeldLeads } from "@/lib/booking-sms-dnd-retry";
import { getDbSchemaMissingColumnsForModels, isPrismaMissingTableOrColumnError } from "@/lib/db-schema-compat";

const CORE_MODELS_FOR_FOLLOWUPS_CRON = [
  "Client",
  "WorkspaceSettings",
  "Lead",
  "Message",
  "FollowUpSequence",
  "FollowUpStep",
  "FollowUpInstance",
  "NotificationEvent",
  "NotificationSendLog",
] as const;

function schemaOutOfDateResponse(opts: {
  path: string;
  missing?: unknown;
  details?: string;
}) {
  console.error("[SchemaCompat] DB schema out of date:", {
    path: opts.path,
    missing: opts.missing,
    details: opts.details,
  });

  return NextResponse.json(
    {
      error: "DB schema out of date",
      path: opts.path,
      missing: opts.missing,
      details: opts.details,
    },
    {
      status: 503,
      headers: { "Retry-After": "60" },
    }
  );
}

export async function runFollowupsCron(path: string = "/api/cron/followups") {
  const missing = await getDbSchemaMissingColumnsForModels({
    models: [...CORE_MODELS_FOR_FOLLOWUPS_CRON],
  }).catch((error) => {
    const details = error instanceof Error ? error.message : String(error);
    return schemaOutOfDateResponse({ path, details });
  });

  if (missing instanceof NextResponse) return missing;
  if (missing.length > 0) return schemaOutOfDateResponse({ path, missing });

  const errors: string[] = [];

  let backstop: unknown = null;
  let snoozed: unknown = null;
  let resumed: unknown = null;
  let enrichmentResumed: unknown = null;
  let smsDndRetry: unknown = null;
  let backfill: unknown = null;
  let results: unknown = null;
  let scheduledTiming: unknown = null;
  let notificationDigests: unknown = null;

  console.log("[Cron] Running booking backstop...");
  try {
    backstop = await completeFollowUpsForMeetingBookedLeads();
    console.log("[Cron] Booking backstop complete:", backstop);
  } catch (error) {
    if (isPrismaMissingTableOrColumnError(error)) {
      return schemaOutOfDateResponse({ path, details: error instanceof Error ? error.message : String(error) });
    }
    errors.push(`completeFollowUpsForMeetingBookedLeads: ${error instanceof Error ? error.message : String(error)}`);
    console.error("[Cron] Failed to run booking backstop:", error);
  }

  console.log("[Cron] Resuming snoozed follow-ups...");
  try {
    snoozed = await resumeSnoozedFollowUps({ limit: 200 });
    console.log("[Cron] Snoozed follow-up resume complete:", snoozed);
  } catch (error) {
    if (isPrismaMissingTableOrColumnError(error)) {
      return schemaOutOfDateResponse({ path, details: error instanceof Error ? error.message : String(error) });
    }
    errors.push(`resumeSnoozedFollowUps: ${error instanceof Error ? error.message : String(error)}`);
    console.error("[Cron] Failed to resume snoozed follow-ups:", error);
  }

  console.log("[Cron] Resuming ghosted follow-ups...");
  try {
    resumed = await resumeGhostedFollowUps({ days: 7, limit: 100 });
    console.log("[Cron] Ghosted follow-up resume complete:", resumed);
  } catch (error) {
    if (isPrismaMissingTableOrColumnError(error)) {
      return schemaOutOfDateResponse({ path, details: error instanceof Error ? error.message : String(error) });
    }
    errors.push(`resumeGhostedFollowUps: ${error instanceof Error ? error.message : String(error)}`);
    console.error("[Cron] Failed to resume ghosted follow-ups:", error);
  }

  console.log("[Cron] Resuming enrichment-paused follow-ups...");
  try {
    enrichmentResumed = await resumeAwaitingEnrichmentFollowUps({ limit: 200 });
    console.log("[Cron] Enrichment-paused follow-up resume complete:", enrichmentResumed);
  } catch (error) {
    if (isPrismaMissingTableOrColumnError(error)) {
      return schemaOutOfDateResponse({ path, details: error instanceof Error ? error.message : String(error) });
    }
    errors.push(`resumeAwaitingEnrichmentFollowUps: ${error instanceof Error ? error.message : String(error)}`);
    console.error("[Cron] Failed to resume enrichment-paused follow-ups:", error);
  }

  console.log("[Cron] Retrying SMS DND held leads...");
  try {
    smsDndRetry = await retrySmsDndHeldLeads({ limit: 50 });
    console.log("[Cron] SMS DND retry complete:", smsDndRetry);
  } catch (error) {
    if (isPrismaMissingTableOrColumnError(error)) {
      return schemaOutOfDateResponse({ path, details: error instanceof Error ? error.message : String(error) });
    }
    errors.push(`retrySmsDndHeldLeads: ${error instanceof Error ? error.message : String(error)}`);
    console.error("[Cron] Failed to retry SMS DND held leads:", error);
  }

  console.log("[Cron] Backfilling awaiting-reply follow-ups...");
  try {
    backfill = await backfillNoResponseFollowUpsDueOnCron();
    console.log("[Cron] Follow-up backfill complete:", backfill);
  } catch (error) {
    if (isPrismaMissingTableOrColumnError(error)) {
      return schemaOutOfDateResponse({ path, details: error instanceof Error ? error.message : String(error) });
    }
    errors.push(`backfillNoResponseFollowUpsDueOnCron: ${error instanceof Error ? error.message : String(error)}`);
    console.error("[Cron] Failed to backfill awaiting-reply follow-ups:", error);
  }

  console.log("[Cron] Processing follow-ups...");
  try {
    results = await processFollowUpsDue();
    console.log("[Cron] Follow-up processing complete:", results);
  } catch (error) {
    if (isPrismaMissingTableOrColumnError(error)) {
      return schemaOutOfDateResponse({ path, details: error instanceof Error ? error.message : String(error) });
    }
    errors.push(`processFollowUpsDue: ${error instanceof Error ? error.message : String(error)}`);
    console.error("[Cron] Failed to process follow-ups:", error);
  }

  console.log("[Cron] Processing scheduled timing follow-up tasks...");
  try {
    scheduledTiming = await processScheduledTimingFollowUpTasksDue();
    console.log("[Cron] Scheduled timing follow-up processing complete:", scheduledTiming);
  } catch (error) {
    if (isPrismaMissingTableOrColumnError(error)) {
      return schemaOutOfDateResponse({ path, details: error instanceof Error ? error.message : String(error) });
    }
    errors.push(`processScheduledTimingFollowUpTasksDue: ${error instanceof Error ? error.message : String(error)}`);
    console.error("[Cron] Failed to process scheduled timing follow-up tasks:", error);
  }

  console.log("[Cron] Processing notification digests...");
  try {
    notificationDigests = await processDailyNotificationDigestsDue({ limit: 50 });
    console.log("[Cron] Notification digests complete:", notificationDigests);
  } catch (error) {
    if (isPrismaMissingTableOrColumnError(error)) {
      return schemaOutOfDateResponse({ path, details: error instanceof Error ? error.message : String(error) });
    }
    errors.push(`processDailyNotificationDigestsDue: ${error instanceof Error ? error.message : String(error)}`);
    console.error("[Cron] Failed to process notification digests:", error);
  }

  const success = errors.length === 0;

  return NextResponse.json(
    {
      success,
      errors,
      backstop,
      snoozed,
      resumed,
      enrichmentResumed,
      smsDndRetry,
      backfill,
      results,
      scheduledTiming,
      notificationDigests,
      timestamp: new Date().toISOString(),
    },
    { status: success ? 200 : 500 }
  );
}
