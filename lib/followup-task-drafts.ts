import "server-only";

import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";

const MESSAGEABLE_TASK_TYPES = ["email", "sms", "linkedin"] as const;
type MessageableTaskType = (typeof MESSAGEABLE_TASK_TYPES)[number];
const FOLLOWUP_TASK_TIMING_CLARIFY_PREFIX = "Follow-up timing clarification";
const FOLLOWUP_TASK_SCHEDULED_AUTO = "Scheduled follow-up (auto)";

function normalizePositiveInt(value: number | undefined, fallback: number, opts?: { min?: number; max?: number }): number {
  const min = Math.max(1, Math.trunc(opts?.min ?? 1));
  const max = Math.max(min, Math.trunc(opts?.max ?? 250));
  const resolved = typeof value === "number" ? Math.trunc(value) : fallback;
  if (!Number.isFinite(resolved)) return fallback;
  return Math.max(min, Math.min(max, resolved));
}

function resolveLookbackDays(value: number | undefined, fallback: number): number {
  const resolved = typeof value === "number" ? Math.trunc(value) : fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) return fallback;
  return Math.max(1, Math.min(365, resolved));
}

export type FollowUpTaskDraftBackfillResult = {
  candidates: number;
  draftsCreated: number;
  errors: string[];
};

type FollowUpTaskEligibilityInput = {
  campaignName?: string | null;
  instanceId?: string | null;
  stepOrder?: number | null;
};

export function isEligibleFollowUpTaskDraftSource(task: FollowUpTaskEligibilityInput): boolean {
  const campaignName = (task.campaignName || "").trim();
  const hasSequenceIdentity = Boolean((task.instanceId || "").trim()) && Number.isInteger(task.stepOrder);
  if (hasSequenceIdentity) return true;
  if (campaignName.startsWith(FOLLOWUP_TASK_TIMING_CLARIFY_PREFIX)) return true;
  return campaignName === FOLLOWUP_TASK_SCHEDULED_AUTO;
}

function buildEligibleFollowUpTaskWhereClause() {
  return {
    OR: [
      {
        instanceId: { not: null },
        stepOrder: { not: null },
      },
      {
        campaignName: { startsWith: FOLLOWUP_TASK_TIMING_CLARIFY_PREFIX },
      },
      {
        campaignName: FOLLOWUP_TASK_SCHEDULED_AUTO,
      },
    ],
  };
}

export async function hasPendingEligibleFollowUpTaskDraft(opts: {
  leadId: string;
  limit?: number;
  lookbackDays?: number;
}): Promise<boolean> {
  const limit = normalizePositiveInt(opts.limit, 50, { min: 1, max: 250 });
  const lookbackDays = resolveLookbackDays(opts.lookbackDays, 120);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);

  const eligibleTasks = await prisma.followUpTask.findMany({
    where: {
      leadId: opts.leadId,
      status: "pending",
      type: { in: [...MESSAGEABLE_TASK_TYPES] },
      dueDate: { gte: cutoff },
      ...buildEligibleFollowUpTaskWhereClause(),
    },
    orderBy: { dueDate: "desc" },
    take: limit,
    select: { id: true },
  });

  if (eligibleTasks.length === 0) return false;

  const triggerMessageIds = eligibleTasks.map((task) => `followup_task:${task.id}`);
  const pendingDraft = await prisma.aIDraft.findFirst({
    where: {
      leadId: opts.leadId,
      status: "pending",
      triggerMessageId: { in: triggerMessageIds },
      channel: { in: [...MESSAGEABLE_TASK_TYPES] },
    },
    select: { id: true },
  });

  return Boolean(pendingDraft?.id);
}

export async function backfillMissingFollowUpTaskDrafts(opts?: {
  leadId?: string;
  limit?: number;
  lookbackDays?: number;
}): Promise<FollowUpTaskDraftBackfillResult> {
  const limit = normalizePositiveInt(opts?.limit, 25, { min: 1, max: 250 });
  const lookbackDays = resolveLookbackDays(opts?.lookbackDays, 90);

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);

  const tasks = await prisma.followUpTask.findMany({
    where: {
      leadId: opts?.leadId ?? undefined,
      status: "pending",
      type: { in: [...MESSAGEABLE_TASK_TYPES] },
      dueDate: { gte: cutoff },
      suggestedMessage: { not: null },
      ...buildEligibleFollowUpTaskWhereClause(),
    },
    orderBy: { dueDate: "desc" },
    take: limit,
    select: { id: true, leadId: true, type: true, suggestedMessage: true, campaignName: true, instanceId: true, stepOrder: true },
  });

  if (tasks.length === 0) {
    return { candidates: 0, draftsCreated: 0, errors: [] };
  }

  const triggerIds = tasks.map((task) => `followup_task:${task.id}`);
  const existingDrafts = await prisma.aIDraft.findMany({
    where: {
      triggerMessageId: { in: triggerIds },
      channel: { in: [...MESSAGEABLE_TASK_TYPES] },
    },
    select: { triggerMessageId: true, channel: true },
  });

  const existing = new Set(existingDrafts.map((row) => `${row.triggerMessageId}::${row.channel}`));
  const errors: string[] = [];
  let created = 0;

  for (const task of tasks) {
    if (!isEligibleFollowUpTaskDraftSource(task)) continue;

    const triggerMessageId = `followup_task:${task.id}`;
    const channel = task.type as MessageableTaskType;
    const key = `${triggerMessageId}::${channel}`;
    if (existing.has(key)) continue;

    const content = (task.suggestedMessage || "").trim();
    if (!content) continue;

    try {
      await prisma.aIDraft.create({
        data: {
          leadId: task.leadId,
          triggerMessageId,
          content,
          channel,
          status: "pending",
        },
        select: { id: true },
      });
      created += 1;
      existing.add(key);
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        existing.add(key);
        continue;
      }
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { candidates: tasks.length, draftsCreated: created, errors: errors.slice(0, 5) };
}
