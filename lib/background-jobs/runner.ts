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
import { RescheduleBackgroundJobError } from "@/lib/background-jobs/errors";
import {
  applyBackgroundAutoscaleDecision,
  evaluateBackgroundAutoscaleDecision,
  getBackgroundAutoscaleConfig,
  getBackgroundAutoscaleGuardrailState,
  type BackgroundAutoscaleDecision,
  type BackgroundAutoscaleState,
} from "@/lib/background-jobs/autoscale-control";
import {
  buildFairWorkspaceQueue,
  claimNextQuotaEligibleJob,
  getBackgroundWorkspaceQuotaConfig,
  isBackgroundWorkspaceHighQuotaEligible,
  selectPartitionedWorkspaceJobs,
  resolveBackgroundWorkspaceQuota,
} from "@/lib/background-jobs/fair-scheduler";
import {
  applyBackgroundPromotionGateDecision,
  computeQueueAgeP95Seconds,
  evaluateBackgroundPromotionGate,
  getBackgroundObservedDuplicateSendCount,
  getBackgroundPromotionGateConfig,
  type BackgroundPromotionGateDecision,
  type BackgroundPromotionGateState,
} from "@/lib/background-jobs/promotion-gate";
import { processWebhookEvents } from "@/lib/webhook-events/runner";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getCronJobLimit(): number {
  return Math.min(200, parsePositiveInt(process.env.BACKGROUND_JOB_CRON_LIMIT, 20));
}

function getCronSelectionPoolLimit(limit: number): number {
  return Math.min(200, Math.max(limit, limit * 4));
}

function getPartitionPerWorkspaceCap(limit: number): number {
  return Math.max(
    1,
    Math.min(200, parsePositiveInt(process.env.BACKGROUND_JOB_PARTITION_PER_WORKSPACE_CAP, Math.max(1, limit)))
  );
}

function getCronWorkerConcurrency(): number {
  return Math.max(1, Math.min(8, parsePositiveInt(process.env.BACKGROUND_JOB_WORKER_CONCURRENCY, 4)));
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

async function getObservedDuplicateSendCount(windowMs: number, now: Date): Promise<number> {
  const fallback = getBackgroundObservedDuplicateSendCount();
  const cutoff = new Date(now.getTime() - Math.max(60_000, windowMs));

  try {
    const dbCount = await prisma.backgroundFunctionRun.count({
      where: {
        functionName: "process-background-jobs",
        createdAt: { gte: cutoff },
        OR: [
          { lastError: { contains: "duplicate send", mode: "insensitive" } },
          { lastError: { contains: "duplicate-send", mode: "insensitive" } },
          { lastError: { contains: "duplicate", mode: "insensitive" } },
        ],
      },
    });
    return Math.max(dbCount, fallback);
  } catch (error) {
    console.warn("[Background Promotion Gate] Duplicate-send signal query failed:", error);
    return fallback;
  }
}

const backgroundAutoscaleState: BackgroundAutoscaleState = {
  currentCapacity: 1024,
  lastScaleAtMs: null,
};

const backgroundPromotionGateState: BackgroundPromotionGateState = {
  healthyWindows: 0,
  lastPromotionEvaluatedAtMs: null,
  promoted: false,
  demotionBreachWindows: 0,
  lastDemotionEvaluatedAtMs: null,
  lastObservedFailureRatePercent: 0,
};

export async function processBackgroundJobs(): Promise<{
  webhookEvents?: {
    releasedStale: number;
    processed: number;
    succeeded: number;
    failed: number;
    retried: number;
    skipped: number;
    remaining: number;
  };
  releasedStale: number;
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  skipped: number;
  remaining: number;
  autoscaleDecision: BackgroundAutoscaleDecision;
  promotionDecision: BackgroundPromotionGateDecision;
  backpressure: {
    deferredJobs: number;
    blockedCycles: number;
    reasonCode: "none" | "quota_or_capacity_exhausted";
  };
}> {
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + getCronTimeBudgetMs();
  const invocationId = crypto.randomUUID();

  // Phase 53: drain bursty webhook events first (bounded), then process background jobs.
  const webhookEvents = await processWebhookEvents({ invocationId }).catch((error) => {
    console.error("[Cron] Webhook event processing failed:", error);
    return undefined;
  });

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
  const selectionPoolLimit = getCronSelectionPoolLimit(limit);
  const partitionPerWorkspaceCap = getPartitionPerWorkspaceCap(limit);
  const now = new Date();
  const duePool = await prisma.backgroundJob.findMany({
    where: {
      status: BackgroundJobStatus.PENDING,
      runAt: { lte: now },
    },
    orderBy: { runAt: "asc" },
    take: selectionPoolLimit,
    select: {
      id: true,
      type: true,
      clientId: true,
      runAt: true,
    },
  });
  const due = selectPartitionedWorkspaceJobs(duePool, limit, partitionPerWorkspaceCap);

  const fairDueQueue = buildFairWorkspaceQueue(due);
  const workspaceQuotaConfig = getBackgroundWorkspaceQuotaConfig();
  const dueClientIds = Array.from(new Set(fairDueQueue.map((job) => job.clientId)));
  const workspaceTierRows =
    dueClientIds.length > 0
      ? await prisma.workspaceSettings.findMany({
          where: { clientId: { in: dueClientIds } },
          select: {
            clientId: true,
            highQuotaEnabled: true,
          },
        })
      : [];
  const highQuotaEnabledByClient = new Map(
    workspaceTierRows.map((row) => [row.clientId, row.highQuotaEnabled ?? false])
  );
  const autoscaleConfig = getBackgroundAutoscaleConfig();
  const autoscaleGuardrailState = getBackgroundAutoscaleGuardrailState();
  if (backgroundAutoscaleState.currentCapacity < autoscaleConfig.globalFloor) {
    backgroundAutoscaleState.currentCapacity = autoscaleConfig.globalFloor;
  }
  const autoscaleDecision = evaluateBackgroundAutoscaleDecision({
    config: autoscaleConfig,
    guardrailState: autoscaleGuardrailState,
    activeWorkspaceCount: dueClientIds.length,
    state: backgroundAutoscaleState,
    now: new Date(),
    correlationId: invocationId,
  });
  applyBackgroundAutoscaleDecision(backgroundAutoscaleState, autoscaleDecision, new Date());
  console.info("[Background Autoscale]", autoscaleDecision);
  const promotionConfig = getBackgroundPromotionGateConfig();
  const promotionDecision = evaluateBackgroundPromotionGate({
    config: promotionConfig,
    state: backgroundPromotionGateState,
    signals: {
      queueAgeP95Seconds: computeQueueAgeP95Seconds(due.map((job) => job.runAt), now),
      failureRatePercent: backgroundPromotionGateState.lastObservedFailureRatePercent,
      contentionBreached:
        autoscaleGuardrailState.contentionBreached || autoscaleGuardrailState.failureRateBreached,
      duplicateSendCount: await getObservedDuplicateSendCount(
        Math.max(promotionConfig.windowMs, promotionConfig.demotionWindowMs),
        now
      ),
    },
    now,
  });
  applyBackgroundPromotionGateDecision(backgroundPromotionGateState, promotionDecision, now);
  console.info("[Background Promotion Gate]", promotionDecision);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;

  const processDueJob = async (job: (typeof due)[number]): Promise<void> => {
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
    if (locked.count === 0) return;

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
    if (!lockedJob) return;

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
      if (error instanceof RescheduleBackgroundJobError) {
        await prisma.backgroundJob.update({
          where: { id: lockedJob.id },
          data: {
            status: BackgroundJobStatus.PENDING,
            runAt: error.runAt,
            finishedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: error.message,
          },
        });
        retried++;
        return;
      }

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
  };

  const configuredWorkerConcurrency = getCronWorkerConcurrency();
  const autoscaleBoundedConcurrency = Math.max(
    1,
    Math.min(configuredWorkerConcurrency, autoscaleDecision.toCapacity)
  );
  const workerConcurrency = Math.min(Math.max(1, fairDueQueue.length), autoscaleBoundedConcurrency);
  const activeByClient = new Map<string, number>();
  let blockedCycles = 0;
  const getWorkspaceQuota = (clientId: string) => {
    const dbHighQuotaEnabled = highQuotaEnabledByClient.get(clientId) ?? false;
    const highQuotaEligible = isBackgroundWorkspaceHighQuotaEligible(
      clientId,
      dbHighQuotaEnabled,
      workspaceQuotaConfig
    );

    const quotaPromotionGranted = promotionDecision.promotionGranted;
    return resolveBackgroundWorkspaceQuota(highQuotaEligible && quotaPromotionGranted, workspaceQuotaConfig);
  };
  const workerLoops = Array.from({ length: workerConcurrency }, async () => {
    while (true) {
      // Keep a safety buffer so the cron can respond cleanly.
      if (Date.now() > deadlineMs - 7_500) return;

      const job = claimNextQuotaEligibleJob(fairDueQueue, activeByClient, getWorkspaceQuota);
      if (!job) {
        if (fairDueQueue.length === 0) return;
        blockedCycles++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        continue;
      }

      try {
        await processDueJob(job);
      } finally {
        const currentActive = activeByClient.get(job.clientId) ?? 1;
        if (currentActive <= 1) {
          activeByClient.delete(job.clientId);
        } else {
          activeByClient.set(job.clientId, currentActive - 1);
        }
      }
    }
  });

  await Promise.all(workerLoops);

  const remaining = await prisma.backgroundJob.count({
    where: { status: BackgroundJobStatus.PENDING, runAt: { lte: new Date() } },
  });
  const deferredJobs = fairDueQueue.length;
  const backpressureReasonCode = deferredJobs > 0 ? "quota_or_capacity_exhausted" : "none";
  if (deferredJobs > 0) {
    console.warn("[Background Backpressure]", {
      deferredJobs,
      blockedCycles,
      reasonCode: backpressureReasonCode,
      correlationId: invocationId,
    });
  }
  if (processed > 0) {
    backgroundPromotionGateState.lastObservedFailureRatePercent = (failed / processed) * 100;
  }

  return {
    webhookEvents,
    releasedStale: released.count,
    processed,
    succeeded,
    failed,
    retried,
    skipped,
    remaining,
    autoscaleDecision,
    promotionDecision,
    backpressure: {
      deferredJobs,
      blockedCycles,
      reasonCode: backpressureReasonCode,
    },
  };
}
