import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  processFollowUpsDue,
  completeFollowUpsForMeetingBookedLeads,
  resumeAwaitingEnrichmentFollowUps,
  resumeGhostedFollowUps,
  resumeSnoozedFollowUps,
} from "@/lib/followup-engine";
import { backfillNoResponseFollowUpsDueOnCron } from "@/lib/followup-backfill";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { retrySmsDndHeldLeads } from "@/lib/booking-sms-dnd-retry";
import { processDailyNotificationDigestsDue } from "@/lib/notification-center";
import { getDbSchemaMissingColumnsForModels, isPrismaMissingTableOrColumnError } from "@/lib/db-schema-compat";

// Vercel Serverless Functions (Pro) require maxDuration in [1, 800].
export const maxDuration = 800;

const LOCK_KEY = BigInt("64064064064");

async function tryAcquireLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
  return Boolean(rows?.[0]?.locked);
}

async function releaseLock(): Promise<void> {
  await prisma.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
}

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

async function runFollowupsCron(request: NextRequest) {
  const path = request.nextUrl.pathname;

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
      notificationDigests,
      timestamp: new Date().toISOString(),
    },
    { status: success ? 200 : 500 }
  );
}

/**
 * GET /api/cron/followups
 * 
 * Processes all due follow-up instances.
 * Called automatically by Vercel Cron (configured in vercel.json)
 * 
 * Security: Requires Authorization: Bearer <CRON_SECRET> header
 * Vercel automatically adds this header when invoking cron jobs
 */
export async function GET(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    try {
      // Verify cron secret using Vercel's Bearer token pattern
      const authHeader = request.headers.get("Authorization");
      const expectedSecret = process.env.CRON_SECRET;

      if (!expectedSecret) {
        console.warn("[Cron] CRON_SECRET not configured - endpoint disabled");
        return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
      }

      if (authHeader !== `Bearer ${expectedSecret}`) {
        console.warn("[Cron] Invalid authorization attempt");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const acquired = await tryAcquireLock();
      if (!acquired) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: "locked",
          timestamp: new Date().toISOString(),
        });
      }

      try {
        return await runFollowupsCron(request);
      } finally {
        await releaseLock();
      }
    } catch (error) {
      console.error("[Cron] Follow-up processing error:", error);
        if (isPrismaMissingTableOrColumnError(error)) {
          return schemaOutOfDateResponse({
            path: request.nextUrl.pathname,
            details: error instanceof Error ? error.message : String(error),
          });
        }
      return NextResponse.json(
        {
          error: "Failed to process follow-ups",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/cron/followups
 * 
 * Alternative endpoint for manual triggering or external cron services
 * Uses x-cron-secret header for backwards compatibility
 */
export async function POST(request: NextRequest) {
  return withAiTelemetrySource(request.nextUrl.pathname, async () => {
    try {
      // Check both Authorization header (Vercel pattern) and x-cron-secret (legacy)
      const authHeader = request.headers.get("Authorization");
      const legacySecret = request.headers.get("x-cron-secret");
      const expectedSecret = process.env.CRON_SECRET;

      if (!expectedSecret) {
        console.warn("[Cron] CRON_SECRET not configured - endpoint disabled");
        return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
      }

      const isAuthorized = authHeader === `Bearer ${expectedSecret}` || legacySecret === expectedSecret;

      if (!isAuthorized) {
        console.warn("[Cron] Invalid authorization attempt");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const acquired = await tryAcquireLock();
      if (!acquired) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: "locked",
          timestamp: new Date().toISOString(),
        });
      }

      try {
        return await runFollowupsCron(request);
      } finally {
        await releaseLock();
      }
    } catch (error) {
      console.error("[Cron] Follow-up processing error:", error);
        if (isPrismaMissingTableOrColumnError(error)) {
          return schemaOutOfDateResponse({
            path: request.nextUrl.pathname,
            details: error instanceof Error ? error.message : String(error),
          });
        }
      return NextResponse.json(
        {
          error: "Failed to process follow-ups",
          message: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      );
    }
  });
}
