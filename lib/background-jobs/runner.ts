import "server-only";

import crypto from "crypto";
import { BackgroundJobStatus, BackgroundJobType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAiTelemetrySource } from "@/lib/ai/telemetry-context";
import { runEmailInboundPostProcessJob } from "@/lib/background-jobs/email-inbound-post-process";
import { runLeadScoringPostProcessJob } from "@/lib/background-jobs/lead-scoring-post-process";
import { runSmsInboundPostProcessJob } from "@/lib/background-jobs/sms-inbound-post-process";
import { runLinkedInInboundPostProcessJob } from "@/lib/background-jobs/linkedin-inbound-post-process";
import { runSmartLeadInboundPostProcessJob } from "@/lib/background-jobs/smartlead-inbound-post-process";
import { runInstantlyInboundPostProcessJob } from "@/lib/background-jobs/instantly-inbound-post-process";
import { runConversationSyncJob } from "@/lib/background-jobs/conversation-sync";
import { runAiAutoSendDelayedJob } from "@/lib/background-jobs/ai-auto-send-delayed";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getCronJobLimit(): number {
  return Math.min(200, parsePositiveInt(process.env.BACKGROUND_JOB_CRON_LIMIT, 10));
}

function getStaleLockMs(): number {
  return Math.max(60_000, parsePositiveInt(process.env.BACKGROUND_JOB_STALE_LOCK_MS, 10 * 60_000));
}

function getCronTimeBudgetMs(): number {
  return Math.max(10_000, parsePositiveInt(process.env.BACKGROUND_JOB_CRON_TIME_BUDGET_MS, 240_000));
}

function computeRetryBackoffMs(attempt: number): number {
  const cappedAttempt = Math.max(1, Math.min(10, Math.floor(attempt)));
  const jitter = Math.floor(Math.random() * 1000);
  const base = Math.pow(2, cappedAttempt) * 1000; // 2s, 4s, 8s, ...
  return Math.min(15 * 60_000, base + jitter);
}

export async function processBackgroundJobs(): Promise<{
  releasedStale: number;
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  skipped: number;
  remaining: number;
}> {
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + getCronTimeBudgetMs();
  const invocationId = crypto.randomUUID();

  const staleCutoff = new Date(Date.now() - getStaleLockMs());
  const released = await prisma.backgroundJob.updateMany({
    where: {
      status: BackgroundJobStatus.RUNNING,
      lockedAt: { lt: staleCutoff },
    },
    data: {
      status: BackgroundJobStatus.PENDING,
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      // keep attempts as-is
      runAt: new Date(),
      lastError: "Released stale RUNNING lock",
    },
  });

  const limit = getCronJobLimit();
  const now = new Date();
  const due = await prisma.backgroundJob.findMany({
    where: {
      status: BackgroundJobStatus.PENDING,
      runAt: { lte: now },
    },
    orderBy: { runAt: "asc" },
    take: limit,
    select: {
      id: true,
      type: true,
    },
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;

  for (const job of due) {
    // Keep a safety buffer so the cron can respond cleanly.
    if (Date.now() > deadlineMs - 7_500) break;

    const lockAt = new Date();
    const locked = await prisma.backgroundJob.updateMany({
      where: { id: job.id, status: BackgroundJobStatus.PENDING },
      data: {
        status: BackgroundJobStatus.RUNNING,
        lockedAt: lockAt,
        lockedBy: invocationId,
        startedAt: lockAt,
        attempts: { increment: 1 },
      },
    });
    if (locked.count === 0) continue;

    const lockedJob = await prisma.backgroundJob.findUnique({
      where: { id: job.id },
      select: {
        id: true,
        type: true,
        clientId: true,
        leadId: true,
        messageId: true,
        draftId: true, // Phase 47l: For delayed auto-send jobs
        attempts: true,
        maxAttempts: true,
      },
    });
    if (!lockedJob) continue;

    processed++;

    try {
      // Wrap each job execution with telemetry source for AI attribution
      const telemetrySource = `background-job/${lockedJob.type.toLowerCase().replace(/_/g, "-")}`;

      switch (lockedJob.type) {
        case BackgroundJobType.EMAIL_INBOUND_POST_PROCESS: {
          await withAiTelemetrySource(telemetrySource, () =>
            runEmailInboundPostProcessJob({
              clientId: lockedJob.clientId,
              leadId: lockedJob.leadId,
              messageId: lockedJob.messageId,
            })
          );
          break;
        }
        case BackgroundJobType.SMS_INBOUND_POST_PROCESS: {
          await withAiTelemetrySource(telemetrySource, () =>
            runSmsInboundPostProcessJob({
              clientId: lockedJob.clientId,
              leadId: lockedJob.leadId,
              messageId: lockedJob.messageId,
            })
          );
          break;
        }
        case BackgroundJobType.LINKEDIN_INBOUND_POST_PROCESS: {
          await withAiTelemetrySource(telemetrySource, () =>
            runLinkedInInboundPostProcessJob({
              clientId: lockedJob.clientId,
              leadId: lockedJob.leadId,
              messageId: lockedJob.messageId,
            })
          );
          break;
        }
        case BackgroundJobType.SMARTLEAD_INBOUND_POST_PROCESS: {
          await withAiTelemetrySource(telemetrySource, () =>
            runSmartLeadInboundPostProcessJob({
              clientId: lockedJob.clientId,
              leadId: lockedJob.leadId,
              messageId: lockedJob.messageId,
            })
          );
          break;
        }
        case BackgroundJobType.INSTANTLY_INBOUND_POST_PROCESS: {
          await withAiTelemetrySource(telemetrySource, () =>
            runInstantlyInboundPostProcessJob({
              clientId: lockedJob.clientId,
              leadId: lockedJob.leadId,
              messageId: lockedJob.messageId,
            })
          );
          break;
        }
        case BackgroundJobType.LEAD_SCORING_POST_PROCESS: {
          await withAiTelemetrySource(telemetrySource, () =>
            runLeadScoringPostProcessJob({
              clientId: lockedJob.clientId,
              leadId: lockedJob.leadId,
              messageId: lockedJob.messageId,
            })
          );
          break;
        }
        case BackgroundJobType.CONVERSATION_SYNC: {
          await withAiTelemetrySource(telemetrySource, () =>
            runConversationSyncJob({
              clientId: lockedJob.clientId,
              leadId: lockedJob.leadId,
              messageId: lockedJob.messageId,
            })
          );
          break;
        }
        case BackgroundJobType.AI_AUTO_SEND_DELAYED: {
          // Phase 47l: Delayed auto-send execution
          await withAiTelemetrySource(telemetrySource, () =>
            runAiAutoSendDelayedJob({
              clientId: lockedJob.clientId,
              leadId: lockedJob.leadId,
              messageId: lockedJob.messageId,
              draftId: lockedJob.draftId,
            })
          );
          break;
        }
        default: {
          console.warn(`[Background Jobs] Unsupported type: ${String(lockedJob.type)}`);
          skipped++;
          break;
        }
      }

      await prisma.backgroundJob.update({
        where: { id: lockedJob.id },
        data: {
          status: BackgroundJobStatus.SUCCEEDED,
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      succeeded++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 10_000);
      const attempts = lockedJob.attempts;
      const shouldRetry = attempts < lockedJob.maxAttempts;

      await prisma.backgroundJob.update({
        where: { id: lockedJob.id },
        data: {
          status: shouldRetry ? BackgroundJobStatus.PENDING : BackgroundJobStatus.FAILED,
          runAt: shouldRetry ? new Date(Date.now() + computeRetryBackoffMs(attempts)) : new Date(),
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: message,
        },
      });

      if (shouldRetry) retried++;
      else failed++;
    }
  }

  const remaining = await prisma.backgroundJob.count({
    where: { status: BackgroundJobStatus.PENDING, runAt: { lte: new Date() } },
  });

  return {
    releasedStale: released.count,
    processed,
    succeeded,
    failed,
    retried,
    skipped,
    remaining,
  };
}
