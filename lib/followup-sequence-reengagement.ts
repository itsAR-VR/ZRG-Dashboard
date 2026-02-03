import "server-only";

import type { PrismaClient } from "@prisma/client";

export const REENGAGEMENT_FOLLOWUP_SEQUENCE_NAME = "Re-engagement Follow-up" as const;

type StepCondition = { type: "phone_provided" | "linkedin_connected" | "no_response" | "email_opened" | "always"; value?: string };

type ReengagementStepTemplate = {
  dayOffset: number;
  minuteOffset: number;
  channel: "sms" | "linkedin" | "email";
  subject: string | null;
  messageTemplate: string;
  condition: StepCondition;
  requiresApproval: boolean;
  fallbackStepId: null;
};

const BASE_REENGAGEMENT_STEPS: ReengagementStepTemplate[] = [
  {
    dayOffset: 0,
    minuteOffset: 0,
    channel: "sms",
    subject: null,
    messageTemplate:
      "Hey {firstName}, it's {senderName} from {companyName} I sent over an email about {result}\n\nJust wanted to check in and see if you're still interested in exploring?",
    condition: { type: "always" },
    requiresApproval: false,
    fallbackStepId: null,
  },
  {
    dayOffset: 0,
    minuteOffset: 0,
    channel: "linkedin",
    subject: null,
    messageTemplate:
      "Hi {firstName},\n\nWanted to say hi and ask whether you're still interested in {result}?",
    condition: { type: "always" },
    requiresApproval: false,
    fallbackStepId: null,
  },
  {
    dayOffset: 2,
    minuteOffset: 0,
    channel: "email",
    subject: null,
    messageTemplate: "Just checking in on this one final time ^",
    condition: { type: "always" },
    requiresApproval: false,
    fallbackStepId: null,
  },
];

function buildReengagementSteps(opts: { hasLinkedIn: boolean; airtableMode: boolean }): ReengagementStepTemplate[] {
  return BASE_REENGAGEMENT_STEPS.filter((step) => {
    if (step.channel === "linkedin" && !opts.hasLinkedIn) return false;
    if (step.channel === "email" && opts.airtableMode) return false;
    return true;
  });
}

export async function ensureReengagementFollowUpSequenceForClient(opts: {
  prisma: PrismaClient;
  clientId: string;
  isActive?: boolean;
  overwriteExisting?: boolean;
}): Promise<
  | { ok: true; created: true; updated: false; skipped: false; sequenceId: string }
  | { ok: true; created: false; updated: true; skipped: false; sequenceId: string }
  | { ok: true; created: false; updated: false; skipped: true; sequenceId: string }
  | { ok: false; error: string }
> {
  const isActive = opts.isActive ?? false;
  const overwriteExisting = opts.overwriteExisting ?? false;

  try {
    const client = await opts.prisma.client.findUnique({
      where: { id: opts.clientId },
      select: {
        id: true,
        unipileAccountId: true,
        settings: { select: { airtableMode: true } },
      },
    });

    if (!client) return { ok: false, error: "Workspace not found" };

    const steps = buildReengagementSteps({
      hasLinkedIn: Boolean((client.unipileAccountId ?? "").trim()),
      airtableMode: Boolean(client.settings?.airtableMode),
    }).map((step, idx) => ({
      stepOrder: idx + 1,
      dayOffset: step.dayOffset,
      minuteOffset: step.minuteOffset,
      channel: step.channel,
      messageTemplate: step.messageTemplate,
      subject: step.subject,
      condition: JSON.stringify(step.condition),
      requiresApproval: step.requiresApproval,
      fallbackStepId: step.fallbackStepId,
    }));

    const existing = await opts.prisma.followUpSequence.findFirst({
      where: {
        clientId: opts.clientId,
        name: { equals: REENGAGEMENT_FOLLOWUP_SEQUENCE_NAME, mode: "insensitive" },
      },
      select: { id: true },
    });

    if (existing && !overwriteExisting) {
      return { ok: true, created: false, updated: false, skipped: true, sequenceId: existing.id };
    }

    const result = await opts.prisma.$transaction(async (tx) => {
      const stillExisting = await tx.followUpSequence.findFirst({
        where: {
          clientId: opts.clientId,
          name: { equals: REENGAGEMENT_FOLLOWUP_SEQUENCE_NAME, mode: "insensitive" },
        },
        select: { id: true },
      });

      if (stillExisting && !overwriteExisting) {
        return { created: false as const, updated: false as const, sequenceId: stillExisting.id };
      }

      if (stillExisting && overwriteExisting) {
        await tx.followUpStep.deleteMany({ where: { sequenceId: stillExisting.id } });
        const updated = await tx.followUpSequence.update({
          where: { id: stillExisting.id },
          data: {
            name: REENGAGEMENT_FOLLOWUP_SEQUENCE_NAME,
            triggerOn: "manual",
            isActive,
            steps: { create: steps },
          },
          select: { id: true },
        });
        return { created: false as const, updated: true as const, sequenceId: updated.id };
      }

      const created = await tx.followUpSequence.create({
        data: {
          clientId: opts.clientId,
          name: REENGAGEMENT_FOLLOWUP_SEQUENCE_NAME,
          description: "",
          triggerOn: "manual",
          isActive,
          steps: { create: steps },
        },
        select: { id: true },
      });

      return { created: true as const, updated: false as const, sequenceId: created.id };
    });

    if (result.created) {
      return { ok: true, created: true, updated: false, skipped: false, sequenceId: result.sequenceId };
    }
    if (result.updated) {
      return { ok: true, created: false, updated: true, skipped: false, sequenceId: result.sequenceId };
    }
    return { ok: true, created: false, updated: false, skipped: true, sequenceId: result.sequenceId };
  } catch (error) {
    console.error("[Reengagement Template] Failed to ensure sequence:", error);
    return { ok: false, error: "Failed to ensure re-engagement sequence" };
  }
}

