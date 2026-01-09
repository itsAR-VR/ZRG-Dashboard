import { prisma } from "@/lib/prisma";
import { autoStartNoResponseSequenceOnOutbound } from "@/lib/followup-automation";

const POSITIVE_SENTIMENT_TAGS: string[] = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Interested",
  "Positive", // legacy
];

function parsePositiveInt(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseBool(raw: string | undefined | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return fallback;
}

export async function backfillNoResponseFollowUpsDueOnCron(opts?: {
  lookbackDays?: number;
  workspaceLimit?: number;
  leadsPerWorkspaceLimit?: number;
}): Promise<{
  enabled: boolean;
  workspacesChecked: number;
  leadsChecked: number;
  leadsEnrolled: number;
  instancesStarted: number;
  reasons: Record<string, number>;
  errors: string[];
}> {
  const enabled = parseBool(process.env.FOLLOWUPS_BACKFILL_CRON_ENABLED, true);
  if (!enabled) {
    return {
      enabled: false,
      workspacesChecked: 0,
      leadsChecked: 0,
      leadsEnrolled: 0,
      instancesStarted: 0,
      reasons: { cron_disabled: 1 },
      errors: [],
    };
  }

  const lookbackDays =
    opts?.lookbackDays ??
    parsePositiveInt(process.env.FOLLOWUPS_BACKFILL_LOOKBACK_DAYS) ??
    30;
  const workspaceLimit =
    opts?.workspaceLimit ??
    parsePositiveInt(process.env.FOLLOWUPS_BACKFILL_WORKSPACE_LIMIT) ??
    10;
  const leadsPerWorkspaceLimit =
    opts?.leadsPerWorkspaceLimit ??
    parsePositiveInt(process.env.FOLLOWUPS_BACKFILL_LEADS_PER_WORKSPACE_LIMIT) ??
    50;

  const now = new Date();
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const results = {
    enabled: true,
    workspacesChecked: 0,
    leadsChecked: 0,
    leadsEnrolled: 0,
    instancesStarted: 0,
    reasons: {} as Record<string, number>,
    errors: [] as string[],
  };

  const workspaces = await prisma.workspaceSettings.findMany({
    where: {
      autoFollowUpsOnReply: true,
      OR: [{ followUpsPausedUntil: null }, { followUpsPausedUntil: { lte: now } }],
    },
    select: { clientId: true },
    take: workspaceLimit,
    orderBy: { updatedAt: "desc" },
  });

  for (const ws of workspaces) {
    results.workspacesChecked++;

    try {
      const leads = await prisma.lead.findMany({
        where: {
          clientId: ws.clientId,
          status: { notIn: ["blacklisted", "unqualified"] },
          sentimentTag: { in: POSITIVE_SENTIMENT_TAGS },
          lastInboundAt: { not: null },
          lastMessageDirection: "outbound",
          lastOutboundAt: { gte: cutoff },
          OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
        },
        select: {
          id: true,
          autoFollowUpEnabled: true,
          lastOutboundAt: true,
        },
        orderBy: { lastOutboundAt: "desc" },
        take: leadsPerWorkspaceLimit,
      });

      results.leadsChecked += leads.length;

      const toEnable = leads.filter((l) => !l.autoFollowUpEnabled).map((l) => l.id);
      if (toEnable.length > 0) {
        const update = await prisma.lead.updateMany({
          where: { id: { in: toEnable }, autoFollowUpEnabled: false },
          data: { autoFollowUpEnabled: true },
        });
        results.leadsEnrolled += update.count;
      }

      for (const lead of leads) {
        if (!lead.lastOutboundAt) {
          results.reasons.missing_last_outbound_at = (results.reasons.missing_last_outbound_at ?? 0) + 1;
          continue;
        }

        const res = await autoStartNoResponseSequenceOnOutbound({
          leadId: lead.id,
          outboundAt: lead.lastOutboundAt,
        });

        if (res.started) results.instancesStarted++;
        const key = res.reason || (res.started ? "started" : "unknown");
        results.reasons[key] = (results.reasons[key] ?? 0) + 1;
      }
    } catch (error) {
      results.errors.push(
        `${ws.clientId}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return results;
}
