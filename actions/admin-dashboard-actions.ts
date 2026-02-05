"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAdminAccess } from "@/lib/workspace-access";
import { BackgroundJobStatus, BackgroundJobType, WebhookEventStatus } from "@prisma/client";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getStaleQueueAlertMinutes(): number {
  // Keep behavior aligned with /api/cron/background-jobs
  return Math.max(5, parsePositiveInt(process.env.BACKGROUND_JOB_STALE_QUEUE_ALERT_MINUTES, 30));
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function truncate(text: string | null | undefined, maxChars: number): string | null {
  if (!text) return null;
  const s = String(text);
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 3))}...`;
}

export type AdminDashboardSnapshot = {
  generatedAt: string;
  vercelEnv: string | null;

  client: {
    id: string;
    name: string;
    emailProvider: string | null;
    ghlLocationId: string | null;
    emailBisonWorkspaceId: string | null;
    unipileAccountId: string | null;
    unipileConnectionStatus: string | null;
    unipileDisconnectedAt: string | null;
    unipileLastErrorAt: string | null;
    unipileLastErrorMessage: string | null;
    calendlyConnected: boolean;
    slackBotConnected: boolean;
    resendConnected: boolean;
  };

  env: {
    cronSecretConfigured: boolean;
    openAiKeyConfigured: boolean;
    autoSendDisabled: boolean;
  };

  workspaceSettings: {
    timezone: string | null;
    workStartTime: string | null;
    workEndTime: string | null;
    followUpsPausedUntil: string | null;
    airtableMode: boolean;
    slackAlertsEnabled: boolean;
    notificationSlackChannelsCount: number;
    autoSendScheduleMode: string | null;
    autoSendCustomScheduleConfigured: boolean;
    slackAutoSendApproversConfigured: boolean;
  } | null;

  queues: {
    backgroundJobs: {
      dueNowTotal: number;
      staleQueueAlertMinutes: number;
      oldestDueRunAt: string | null;
      oldestDueAgeMinutes: number | null;
      stale: boolean;
      dueNowByType: Array<{ type: string; count: number }>;
      byStatus: Array<{ status: string; count: number }>;
      recentFailures: Array<{
        id: string;
        type: string;
        attempts: number;
        lastError: string | null;
        finishedAt: string | null;
      }>;
    };

    webhookEvents: {
      enabled: boolean;
      workspaceId: string | null;
      dueNowTotal: number | null;
      oldestDueRunAt: string | null;
      oldestDueAgeMinutes: number | null;
      dueNowByProviderEventType: Array<{ provider: string; eventType: string; count: number }>;
      byStatus: Array<{ status: string; count: number }>;
      recentFailures: Array<{
        id: string;
        provider: string;
        eventType: string;
        attempts: number;
        lastError: string | null;
        finishedAt: string | null;
      }>;
    };
  };

  drafts: {
    pendingTotal: number;
    pendingByChannel: Array<{ channel: string; count: number }>;
    pendingByAutoSendAction: Array<{ action: string | null; count: number }>;
    needsReview: {
      total: number;
      slackSent: number;
      slackMissing: number;
    };
    sendDelayed: {
      total: number;
      oldestPendingAt: string | null;
      oldestPendingAgeMinutes: number | null;
      missingDelayedJobCount: number;
      sampledDraftsForMissingJobCheck: number;
    };
    sendingStaleCount: number;
  };

  enrichment: {
    pending: number;
    failed: number;
    enriched: number;
  };

  followUps: {
    dueNow: number;
    oldestDueAt: string | null;
    oldestDueAgeMinutes: number | null;
  };

  messages: {
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    lastInboundByChannel: Array<{ channel: string; at: string | null }>;
    lastOutboundByChannel: Array<{ channel: string; at: string | null }>;
  };
};

export async function getAdminDashboardSnapshot(
  clientId: string
): Promise<{ success: boolean; data?: AdminDashboardSnapshot; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "Missing workspace id" };
    await requireClientAdminAccess(clientId);

    const now = new Date();
    const staleQueueAlertMinutes = getStaleQueueAlertMinutes();

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        name: true,
        emailProvider: true,
        ghlLocationId: true,
        emailBisonWorkspaceId: true,
        slackBotToken: true,
        resendApiKey: true,
        calendlyAccessToken: true,
        unipileAccountId: true,
        unipileConnectionStatus: true,
        unipileDisconnectedAt: true,
        unipileLastErrorAt: true,
        unipileLastErrorMessage: true,
      },
    });

    if (!client) {
      return { success: false, error: "Workspace not found" };
    }

    const [settings, bgDueNowTotal, bgOldestDue, bgDueNowByType, bgByStatus, bgRecentFailures] =
      await Promise.all([
        prisma.workspaceSettings.findUnique({
          where: { clientId },
          select: {
            timezone: true,
            workStartTime: true,
            workEndTime: true,
            followUpsPausedUntil: true,
            airtableMode: true,
            slackAlerts: true,
            notificationSlackChannelIds: true,
            autoSendScheduleMode: true,
            autoSendCustomSchedule: true,
            slackAutoSendApprovalRecipients: true,
          },
        }),

        prisma.backgroundJob.count({
          where: { clientId, status: BackgroundJobStatus.PENDING, runAt: { lte: now } },
        }),

        prisma.backgroundJob.findFirst({
          where: { clientId, status: BackgroundJobStatus.PENDING, runAt: { lte: now } },
          orderBy: { runAt: "asc" },
          select: { runAt: true },
        }),

        prisma.backgroundJob.groupBy({
          by: ["type"],
          where: { clientId, status: BackgroundJobStatus.PENDING, runAt: { lte: now } },
          _count: { _all: true },
        }),

        prisma.backgroundJob.groupBy({
          by: ["status"],
          where: { clientId },
          _count: { _all: true },
        }),

        prisma.backgroundJob.findMany({
          where: {
            clientId,
            status: BackgroundJobStatus.FAILED,
            finishedAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
          },
          orderBy: { finishedAt: "desc" },
          take: 15,
          select: {
            id: true,
            type: true,
            attempts: true,
            lastError: true,
            finishedAt: true,
          },
        }),
      ]);

    const bgOldestDueAgeMinutes = bgOldestDue
      ? Math.max(0, Math.floor((now.getTime() - bgOldestDue.runAt.getTime()) / 60_000))
      : null;

    const bgQueueStale = bgOldestDueAgeMinutes !== null && bgOldestDueAgeMinutes >= staleQueueAlertMinutes;

    // Webhook event queue: tie to EmailBison workspace id (Inboxxia uses this field).
    const webhookWorkspaceId = client.emailBisonWorkspaceId || null;
    const webhookEnabled = Boolean(webhookWorkspaceId);

    const webhookStats = webhookEnabled
      ? await (async () => {
          const [dueNowTotal, oldestDue, dueNowByProviderEventType, byStatus, recentFailures] = await Promise.all([
            prisma.webhookEvent.count({
              where: {
                workspaceId: webhookWorkspaceId,
                status: WebhookEventStatus.PENDING,
                runAt: { lte: now },
              },
            }),

            prisma.webhookEvent.findFirst({
              where: {
                workspaceId: webhookWorkspaceId,
                status: WebhookEventStatus.PENDING,
                runAt: { lte: now },
              },
              orderBy: { runAt: "asc" },
              select: { runAt: true },
            }),

            prisma.webhookEvent.groupBy({
              by: ["provider", "eventType"],
              where: {
                workspaceId: webhookWorkspaceId,
                status: WebhookEventStatus.PENDING,
                runAt: { lte: now },
              },
              _count: { _all: true },
            }),

            prisma.webhookEvent.groupBy({
              by: ["status"],
              where: { workspaceId: webhookWorkspaceId },
              _count: { _all: true },
            }),

            prisma.webhookEvent.findMany({
              where: {
                workspaceId: webhookWorkspaceId,
                status: WebhookEventStatus.FAILED,
                finishedAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
              },
              orderBy: { finishedAt: "desc" },
              take: 15,
              select: {
                id: true,
                provider: true,
                eventType: true,
                attempts: true,
                lastError: true,
                finishedAt: true,
              },
            }),
          ]);

          const oldestDueAgeMinutes = oldestDue
            ? Math.max(0, Math.floor((now.getTime() - oldestDue.runAt.getTime()) / 60_000))
            : null;

          return {
            dueNowTotal,
            oldestDueRunAt: toIso(oldestDue?.runAt ?? null),
            oldestDueAgeMinutes,
            dueNowByProviderEventType: dueNowByProviderEventType.map((row) => ({
              provider: String(row.provider),
              eventType: row.eventType,
              count: row._count._all,
            })),
            byStatus: byStatus.map((row) => ({ status: String(row.status), count: row._count._all })),
            recentFailures: recentFailures.map((row) => ({
              id: row.id,
              provider: String(row.provider),
              eventType: row.eventType,
              attempts: row.attempts,
              lastError: truncate(row.lastError, 240),
              finishedAt: toIso(row.finishedAt),
            })),
          };
        })()
      : null;

    // Draft stats (per workspace)
    const [
      pendingDraftTotal,
      pendingByChannel,
      pendingByAutoSendAction,
      needsReviewTotal,
      needsReviewSlackSent,
      needsReviewSlackMissing,
      sendDelayedTotal,
      sendDelayedOldest,
      staleSendingDrafts,
    ] = await Promise.all([
      prisma.aIDraft.count({ where: { status: "pending", lead: { clientId } } }),

      prisma.aIDraft.groupBy({
        by: ["channel"],
        where: { status: "pending", lead: { clientId } },
        _count: { _all: true },
      }),

      prisma.aIDraft.groupBy({
        by: ["autoSendAction"],
        where: { status: "pending", lead: { clientId } },
        _count: { _all: true },
      }),

      prisma.aIDraft.count({
        where: { status: "pending", autoSendAction: "needs_review", lead: { clientId } },
      }),

      prisma.aIDraft.count({
        where: {
          status: "pending",
          autoSendAction: "needs_review",
          autoSendSlackNotified: true,
          lead: { clientId },
        },
      }),

      prisma.aIDraft.count({
        where: {
          status: "pending",
          autoSendAction: "needs_review",
          autoSendSlackNotified: false,
          lead: { clientId },
        },
      }),

      prisma.aIDraft.count({
        where: { status: "pending", autoSendAction: "send_delayed", lead: { clientId } },
      }),

      prisma.aIDraft.findFirst({
        where: { status: "pending", autoSendAction: "send_delayed", lead: { clientId } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),

      prisma.aIDraft.count({
        where: {
          status: "sending",
          updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) },
          lead: { clientId },
        },
      }),
    ]);

    // Detect send_delayed drafts missing a delayed-send background job (best-effort, bounded).
    const sendDelayedDraftsSample = await prisma.aIDraft.findMany({
      where: {
        status: "pending",
        autoSendAction: "send_delayed",
        createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60_000) },
        lead: { clientId },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true },
    });
    const sampledDraftIds = sendDelayedDraftsSample.map((d) => d.id);

    const delayedJobCounts = sampledDraftIds.length
      ? await prisma.backgroundJob.groupBy({
          by: ["draftId"],
          where: {
            draftId: { in: sampledDraftIds },
            type: BackgroundJobType.AI_AUTO_SEND_DELAYED,
          },
          _count: { _all: true },
        })
      : [];

    const draftIdsWithDelayedJob = new Set<string>();
    for (const row of delayedJobCounts) {
      if (row.draftId) draftIdsWithDelayedJob.add(row.draftId);
    }
    const missingDelayedJobCount = sampledDraftIds.filter((id) => !draftIdsWithDelayedJob.has(id)).length;

    const sendDelayedOldestAgeMinutes = sendDelayedOldest
      ? Math.max(0, Math.floor((now.getTime() - sendDelayedOldest.createdAt.getTime()) / 60_000))
      : null;

    const [enrichmentPending, enrichmentFailed, enrichmentEnriched, followUpsDueNow, followUpsOldestDue] =
      await Promise.all([
        prisma.lead.count({ where: { clientId, enrichmentStatus: "pending" } }),
        prisma.lead.count({ where: { clientId, enrichmentStatus: "failed" } }),
        prisma.lead.count({ where: { clientId, enrichmentStatus: "enriched" } }),

        prisma.followUpTask.count({
          where: { status: "pending", dueDate: { lte: now }, lead: { clientId } },
        }),

        prisma.followUpTask.findFirst({
          where: { status: "pending", dueDate: { lte: now }, lead: { clientId } },
          orderBy: { dueDate: "asc" },
          select: { dueDate: true },
        }),
      ]);

    const followUpsOldestAgeMinutes = followUpsOldestDue
      ? Math.max(0, Math.floor((now.getTime() - followUpsOldestDue.dueDate.getTime()) / 60_000))
      : null;

    const channels: Array<"email" | "sms" | "linkedin"> = ["email", "sms", "linkedin"];
    const [lastInbound, lastOutbound, ...perChannel] = await Promise.all([
      prisma.message.findFirst({
        where: { direction: "inbound", lead: { clientId } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      }),
      prisma.message.findFirst({
        where: { direction: "outbound", lead: { clientId } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      }),
      ...channels.flatMap((channel) => [
        prisma.message.findFirst({
          where: { direction: "inbound", channel, lead: { clientId } },
          orderBy: { sentAt: "desc" },
          select: { sentAt: true },
        }),
        prisma.message.findFirst({
          where: { direction: "outbound", channel, lead: { clientId } },
          orderBy: { sentAt: "desc" },
          select: { sentAt: true },
        }),
      ]),
    ]);

    const lastInboundByChannel: Array<{ channel: string; at: string | null }> = [];
    const lastOutboundByChannel: Array<{ channel: string; at: string | null }> = [];
    for (let i = 0; i < channels.length; i += 1) {
      const inbound = perChannel[i * 2] as { sentAt: Date } | null;
      const outbound = perChannel[i * 2 + 1] as { sentAt: Date } | null;
      lastInboundByChannel.push({ channel: channels[i], at: toIso(inbound?.sentAt ?? null) });
      lastOutboundByChannel.push({ channel: channels[i], at: toIso(outbound?.sentAt ?? null) });
    }

    const snapshot: AdminDashboardSnapshot = {
      generatedAt: now.toISOString(),
      vercelEnv: process.env.VERCEL_ENV ?? null,
      client: {
        id: client.id,
        name: client.name,
        emailProvider: client.emailProvider ? String(client.emailProvider) : null,
        ghlLocationId: client.ghlLocationId ?? null,
        emailBisonWorkspaceId: client.emailBisonWorkspaceId ?? null,
        unipileAccountId: client.unipileAccountId ?? null,
        unipileConnectionStatus: client.unipileConnectionStatus ?? null,
        unipileDisconnectedAt: toIso(client.unipileDisconnectedAt),
        unipileLastErrorAt: toIso(client.unipileLastErrorAt),
        unipileLastErrorMessage: truncate(client.unipileLastErrorMessage, 240),
        calendlyConnected: Boolean(client.calendlyAccessToken),
        slackBotConnected: Boolean(client.slackBotToken),
        resendConnected: Boolean(client.resendApiKey),
      },
      env: {
        cronSecretConfigured: Boolean(process.env.CRON_SECRET),
        openAiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
        autoSendDisabled: process.env.AUTO_SEND_DISABLED === "1",
      },
      workspaceSettings: settings
        ? {
            timezone: settings.timezone ?? null,
            workStartTime: settings.workStartTime ?? null,
            workEndTime: settings.workEndTime ?? null,
            followUpsPausedUntil: toIso(settings.followUpsPausedUntil),
            airtableMode: Boolean(settings.airtableMode),
            slackAlertsEnabled: Boolean(settings.slackAlerts),
            notificationSlackChannelsCount: settings.notificationSlackChannelIds?.length ?? 0,
            autoSendScheduleMode: settings.autoSendScheduleMode ? String(settings.autoSendScheduleMode) : null,
            autoSendCustomScheduleConfigured: Boolean(settings.autoSendCustomSchedule),
            slackAutoSendApproversConfigured: Boolean(settings.slackAutoSendApprovalRecipients),
          }
        : null,
      queues: {
        backgroundJobs: {
          dueNowTotal: bgDueNowTotal,
          staleQueueAlertMinutes,
          oldestDueRunAt: toIso(bgOldestDue?.runAt ?? null),
          oldestDueAgeMinutes: bgOldestDueAgeMinutes,
          stale: bgQueueStale,
          dueNowByType: bgDueNowByType.map((row) => ({ type: String(row.type), count: row._count._all })),
          byStatus: bgByStatus.map((row) => ({ status: String(row.status), count: row._count._all })),
          recentFailures: bgRecentFailures.map((row) => ({
            id: row.id,
            type: String(row.type),
            attempts: row.attempts,
            lastError: truncate(row.lastError, 240),
            finishedAt: toIso(row.finishedAt),
          })),
        },
        webhookEvents: {
          enabled: webhookEnabled,
          workspaceId: webhookWorkspaceId,
          dueNowTotal: webhookStats?.dueNowTotal ?? null,
          oldestDueRunAt: webhookStats?.oldestDueRunAt ?? null,
          oldestDueAgeMinutes: webhookStats?.oldestDueAgeMinutes ?? null,
          dueNowByProviderEventType: webhookStats?.dueNowByProviderEventType ?? [],
          byStatus: webhookStats?.byStatus ?? [],
          recentFailures: webhookStats?.recentFailures ?? [],
        },
      },
      drafts: {
        pendingTotal: pendingDraftTotal,
        pendingByChannel: pendingByChannel.map((row) => ({ channel: row.channel, count: row._count._all })),
        pendingByAutoSendAction: pendingByAutoSendAction.map((row) => ({
          action: row.autoSendAction ? String(row.autoSendAction) : null,
          count: row._count._all,
        })),
        needsReview: {
          total: needsReviewTotal,
          slackSent: needsReviewSlackSent,
          slackMissing: needsReviewSlackMissing,
        },
        sendDelayed: {
          total: sendDelayedTotal,
          oldestPendingAt: toIso(sendDelayedOldest?.createdAt ?? null),
          oldestPendingAgeMinutes: sendDelayedOldestAgeMinutes,
          missingDelayedJobCount,
          sampledDraftsForMissingJobCheck: sampledDraftIds.length,
        },
        sendingStaleCount: staleSendingDrafts,
      },
      enrichment: {
        pending: enrichmentPending,
        failed: enrichmentFailed,
        enriched: enrichmentEnriched,
      },
      followUps: {
        dueNow: followUpsDueNow,
        oldestDueAt: toIso(followUpsOldestDue?.dueDate ?? null),
        oldestDueAgeMinutes: followUpsOldestAgeMinutes,
      },
      messages: {
        lastInboundAt: toIso(lastInbound?.sentAt ?? null),
        lastOutboundAt: toIso(lastOutbound?.sentAt ?? null),
        lastInboundByChannel,
        lastOutboundByChannel,
      },
    };

    return { success: true, data: snapshot };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load admin dashboard snapshot",
    };
  }
}

