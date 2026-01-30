import type { PrismaClient } from "@prisma/client";
import {
  MEETING_REQUESTED_SEQUENCE_NAMES,
  NO_RESPONSE_SEQUENCE_NAME,
  isMeetingRequestedSequenceName,
} from "@/lib/followup-sequence-names";

type StepCondition = { type: "phone_provided" | "linkedin_connected" | "no_response" | "email_opened" | "always"; value?: string };

type NewLinkedInStep = {
  dayOffset: number;
  minuteOffset?: number;
  channel: "linkedin";
  messageTemplate: string;
  subject: null;
  condition: StepCondition;
  requiresApproval: boolean;
  fallbackStepId: null;
};

function sortStepsForScheduling<T extends { dayOffset: number; minuteOffset?: number; channel: string }>(steps: T[]): T[] {
  const priority: Record<string, number> = {
    email: 1,
    sms: 2,
    linkedin: 3,
    ai_voice: 4,
  };
  return [...steps].sort((a, b) => {
    const dayDiff = a.dayOffset - b.dayOffset;
    if (dayDiff !== 0) return dayDiff;
    const minDiff = (a.minuteOffset ?? 0) - (b.minuteOffset ?? 0);
    if (minDiff !== 0) return minDiff;
    return (priority[a.channel] ?? 999) - (priority[b.channel] ?? 999);
  });
}

function defaultNoResponseLinkedInSteps(): NewLinkedInStep[] {
  return [
    // DAY 2 - LinkedIn follow-up (only if connected)
    // Per canonical doc: "Check to see whether they have connected on LinkedIn yet - follow up on there if so"
    {
      dayOffset: 2,
      minuteOffset: 0,
      channel: "linkedin",
      messageTemplate: `Hi {FIRST_NAME} could I get the best number to reach you on so we can give you a call?`,
      subject: null,
      condition: { type: "linkedin_connected" },
      requiresApproval: false,
      fallbackStepId: null,
    },
  ];
}

function defaultMeetingRequestedLinkedInSteps(): NewLinkedInStep[] {
  return [
    // DAY 1 - LinkedIn connection request (1 hour after email)
    // Per canonical doc: "Automated trigger a linkedin connection (on Unipile, 1 hour delay)"
    {
      dayOffset: 1,
      minuteOffset: 60, // 1 hour after the day 0 email
      channel: "linkedin",
      messageTemplate: `Hi {FIRST_NAME}, just wanted to connect on here too as well as over email`,
      subject: null,
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    // DAY 2 - Follow up on LinkedIn if connected
    {
      dayOffset: 2,
      minuteOffset: 0,
      channel: "linkedin",
      messageTemplate: `Hi {FIRST_NAME} could I get the best number to reach you on so we can give you a call?`,
      subject: null,
      condition: { type: "linkedin_connected" },
      requiresApproval: false,
      fallbackStepId: null,
    },
  ];
}

export async function ensureDefaultSequencesIncludeLinkedInStepsForClient(opts: {
  prisma: PrismaClient;
  clientId: string;
  }): Promise<{ updatedSequences: number; insertedSteps: number }> {
  const sequences = await opts.prisma.followUpSequence.findMany({
    where: {
      clientId: opts.clientId,
      name: { in: [NO_RESPONSE_SEQUENCE_NAME, ...MEETING_REQUESTED_SEQUENCE_NAMES] },
    },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  });

  let updatedSequences = 0;
  let insertedSteps = 0;

  for (const sequence of sequences) {
    const hasLinkedInSteps = sequence.steps.some((s) => s.channel === "linkedin");
    if (hasLinkedInSteps) continue;

    const toCreate =
      sequence.name === NO_RESPONSE_SEQUENCE_NAME
        ? defaultNoResponseLinkedInSteps()
        : isMeetingRequestedSequenceName(sequence.name)
          ? defaultMeetingRequestedLinkedInSteps()
          : [];
    if (toCreate.length === 0) continue;

    await opts.prisma.$transaction(
      async (tx) => {
      const desired = sortStepsForScheduling([
        ...sequence.steps.map((s) => ({
          kind: "existing" as const,
          id: s.id,
          oldStepOrder: s.stepOrder,
          dayOffset: s.dayOffset,
          minuteOffset: s.minuteOffset ?? 0,
          channel: s.channel,
          messageTemplate: s.messageTemplate,
          subject: s.subject,
          condition: s.condition,
          requiresApproval: s.requiresApproval,
          fallbackStepId: s.fallbackStepId,
        })),
        ...toCreate.map((s) => ({
          kind: "new" as const,
          dayOffset: s.dayOffset,
          minuteOffset: s.minuteOffset ?? 0,
          channel: s.channel,
          messageTemplate: s.messageTemplate,
          subject: s.subject,
          condition: JSON.stringify(s.condition),
          requiresApproval: s.requiresApproval,
          fallbackStepId: s.fallbackStepId,
        })),
      ]);

      const existingInDesired = desired.filter((d) => d.kind === "existing") as Array<
        Extract<(typeof desired)[number], { kind: "existing" }>
      >;
      const createdInDesired = desired.filter((d) => d.kind === "new") as Array<
        Extract<(typeof desired)[number], { kind: "new" }>
      >;

      const orderMap = new Map<number, number>();
      for (let i = 0; i < desired.length; i++) {
        const d = desired[i]!;
        if (d.kind === "existing") orderMap.set(d.oldStepOrder!, i + 1);
      }

      for (let i = 0; i < existingInDesired.length; i++) {
        await tx.followUpStep.update({
          where: { id: existingInDesired[i]!.id },
          data: { stepOrder: 1000 + i },
        });
      }

      const createdIds: string[] = [];
      for (let i = 0; i < createdInDesired.length; i++) {
        const created = await tx.followUpStep.create({
          data: {
            sequenceId: sequence.id,
            stepOrder: 2000 + i,
            dayOffset: createdInDesired[i]!.dayOffset,
            minuteOffset: createdInDesired[i]!.minuteOffset ?? 0,
            channel: createdInDesired[i]!.channel,
            messageTemplate: createdInDesired[i]!.messageTemplate,
            subject: createdInDesired[i]!.subject,
            condition: createdInDesired[i]!.condition,
            requiresApproval: createdInDesired[i]!.requiresApproval,
            fallbackStepId: createdInDesired[i]!.fallbackStepId,
          },
          select: { id: true },
        });
        createdIds.push(created.id);
      }

      const resolvedIds: string[] = [];
      let createdIdx = 0;
      for (const d of desired) {
        if (d.kind === "existing") resolvedIds.push(d.id);
        else resolvedIds.push(createdIds[createdIdx++]!);
      }

      for (let i = 0; i < resolvedIds.length; i++) {
        await tx.followUpStep.update({
          where: { id: resolvedIds[i]! },
          data: { stepOrder: 3000 + i },
        });
      }
      for (let i = 0; i < resolvedIds.length; i++) {
        await tx.followUpStep.update({
          where: { id: resolvedIds[i]! },
          data: { stepOrder: i + 1 },
        });
      }

      // Remap in-flight instances in bulk (avoid per-row updates).
      for (const d of existingInDesired) {
        const oldStepOrder = d.oldStepOrder!;
        const newStepOrder = orderMap.get(oldStepOrder);
        if (!newStepOrder || newStepOrder === oldStepOrder) continue;
        await tx.followUpInstance.updateMany({
          where: { sequenceId: sequence.id, currentStep: oldStepOrder },
          data: { currentStep: newStepOrder },
        });
      }
    },
      { timeout: 20_000 }
    );

    updatedSequences++;
    insertedSteps += toCreate.length;
  }

  return { updatedSequences, insertedSteps };
}
