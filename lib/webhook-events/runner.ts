import "server-only";

import crypto from "crypto";
import { WebhookEventStatus, WebhookProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { processInboxxiaEmailSentWebhookEvent } from "@/lib/webhook-events/inboxxia-email-sent";
import { processCrmOutboundWebhookEvent } from "@/lib/webhook-events/crm-outbound";
import { isWebhookEventTerminalError } from "@/lib/webhook-events/errors";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getWebhookEventLimit(): number {
  return Math.min(200, parsePositiveInt(process.env.WEBHOOK_EVENT_CRON_LIMIT, 25));
}

function getWebhookEventStaleLockMs(): number {
  return Math.max(60_000, parsePositiveInt(process.env.WEBHOOK_EVENT_STALE_LOCK_MS, 10 * 60_000));
}

function getWebhookEventTimeBudgetMs(): number {
  return Math.max(5_000, parsePositiveInt(process.env.WEBHOOK_EVENT_CRON_TIME_BUDGET_MS, 45_000));
}

function computeRetryBackoffMs(attempt: number): number {
  const cappedAttempt = Math.max(1, Math.min(10, Math.floor(attempt)));
  const jitter = Math.floor(Math.random() * 1000);
  const base = Math.pow(2, cappedAttempt) * 1000; // 2s, 4s, 8s, ...
  return Math.min(15 * 60_000, base + jitter);
}

function isPrismaMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyError = error as { code?: unknown; message?: unknown };
  if (anyError.code === "P2021" || anyError.code === "P2022") return true;
  return typeof anyError.message === "string" && anyError.message.toLowerCase().includes("does not exist");
}

export async function processWebhookEvents(opts?: {
  invocationId?: string;
  deadlineMs?: number;
}): Promise<{
  releasedStale: number;
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  skipped: number;
  remaining: number;
}> {
  // Best-effort: tolerate deployments where the queue table hasn't been migrated yet.
  // This keeps the background job cron from failing hard during staged rollouts.
  try {
  const startedAtMs = Date.now();
  const deadlineMs = opts?.deadlineMs ?? startedAtMs + getWebhookEventTimeBudgetMs();
  const invocationId = opts?.invocationId ?? crypto.randomUUID();

  const staleCutoff = new Date(Date.now() - getWebhookEventStaleLockMs());
  const released = await prisma.webhookEvent.updateMany({
    where: { status: WebhookEventStatus.RUNNING, lockedAt: { lt: staleCutoff } },
    data: {
      status: WebhookEventStatus.PENDING,
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      runAt: new Date(),
      lastError: "Released stale RUNNING lock",
    },
  });

  const limit = getWebhookEventLimit();
  const due = await prisma.webhookEvent.findMany({
    where: { status: WebhookEventStatus.PENDING, runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;

  for (const row of due) {
    // Keep a safety buffer so the cron can respond cleanly.
    if (Date.now() > deadlineMs - 2_500) break;

    const lockAt = new Date();
    const locked = await prisma.webhookEvent.updateMany({
      where: { id: row.id, status: WebhookEventStatus.PENDING },
      data: {
        status: WebhookEventStatus.RUNNING,
        lockedAt: lockAt,
        lockedBy: invocationId,
        startedAt: lockAt,
        attempts: { increment: 1 },
      },
    });
    if (locked.count === 0) continue;

    const evt = await prisma.webhookEvent.findUnique({
      where: { id: row.id },
      select: {
        id: true,
        provider: true,
        eventType: true,
        attempts: true,
        maxAttempts: true,
        workspaceId: true,
        campaignId: true,
        campaignName: true,
        emailBisonLeadId: true,
        leadEmail: true,
        leadFirstName: true,
        leadLastName: true,
        senderEmailId: true,
        senderEmail: true,
        senderName: true,
        scheduledEmailId: true,
        emailSubject: true,
        emailBodyHtml: true,
        emailSentAt: true,
        raw: true,
      },
    });
    if (!evt) continue;

    processed++;

    try {
      if (evt.provider === WebhookProvider.INBOXXIA && evt.eventType === "EMAIL_SENT") {
        await processInboxxiaEmailSentWebhookEvent({
          id: evt.id,
          workspaceId: evt.workspaceId,
          campaignId: evt.campaignId,
          campaignName: evt.campaignName,
          emailBisonLeadId: evt.emailBisonLeadId,
          leadEmail: evt.leadEmail,
          leadFirstName: evt.leadFirstName,
          leadLastName: evt.leadLastName,
          senderEmailId: evt.senderEmailId,
          senderEmail: evt.senderEmail,
          senderName: evt.senderName,
          scheduledEmailId: evt.scheduledEmailId,
          emailSubject: evt.emailSubject,
          emailBodyHtml: evt.emailBodyHtml,
          emailSentAt: evt.emailSentAt,
        });
      } else if (evt.provider === WebhookProvider.CRM) {
        await processCrmOutboundWebhookEvent({
          id: evt.id,
          workspaceId: evt.workspaceId,
          eventType: evt.eventType,
          raw: evt.raw,
        });
      } else {
        console.warn(`[WebhookEvents] Unsupported event: ${String(evt.provider)} ${evt.eventType}`);
        skipped++;
      }

      await prisma.webhookEvent.update({
        where: { id: evt.id },
        data: {
          status: WebhookEventStatus.SUCCEEDED,
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      succeeded++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 10_000);
      const attempts = evt.attempts;
      const shouldRetry = attempts < evt.maxAttempts && !isWebhookEventTerminalError(error);

      await prisma.webhookEvent.update({
        where: { id: evt.id },
        data: {
          status: shouldRetry ? WebhookEventStatus.PENDING : WebhookEventStatus.FAILED,
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

  const remaining = await prisma.webhookEvent.count({
    where: { status: WebhookEventStatus.PENDING, runAt: { lte: new Date() } },
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
  } catch (error) {
    if (isPrismaMissingRelationError(error)) {
      return {
        releasedStale: 0,
        processed: 0,
        succeeded: 0,
        failed: 0,
        retried: 0,
        skipped: 0,
        remaining: 0,
      };
    }

    throw error;
  }
}
