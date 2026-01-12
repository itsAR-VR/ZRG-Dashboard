/**
 * Backfill default FollowUpSequences to include LinkedIn steps for any workspace
 * that has `Client.unipileAccountId` set.
 *
 * Run (dry-run):
 *   npx tsx scripts/backfill-linkedin-sequence-steps.ts
 *
 * Apply changes:
 *   npx tsx scripts/backfill-linkedin-sequence-steps.ts --apply
 *
 * Limit to a single workspace:
 *   npx tsx scripts/backfill-linkedin-sequence-steps.ts --clientId <uuid> --apply
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DEFAULT_SEQUENCE_NAMES = {
  noResponse: "No Response Day 2/5/7",
  meetingRequested: "Meeting Requested Day 1/2/5/7",
} as const;

type StepCondition = { type: "phone_provided" | "linkedin_connected" | "no_response" | "email_opened" | "always"; value?: string };

type NewStep = {
  dayOffset: number;
  channel: "linkedin";
  messageTemplate: string;
  subject: null;
  condition: StepCondition;
  requiresApproval: boolean;
  fallbackStepId: null;
};

function getFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function sortStepsForScheduling<T extends { dayOffset: number; channel: string }>(steps: T[]): T[] {
  const priority: Record<string, number> = {
    email: 1,
    sms: 2,
    linkedin: 3,
    ai_voice: 4,
  };
  return [...steps].sort((a, b) => {
    const dayDiff = a.dayOffset - b.dayOffset;
    if (dayDiff !== 0) return dayDiff;
    return (priority[a.channel] ?? 999) - (priority[b.channel] ?? 999);
  });
}

function defaultNoResponseLinkedInSteps(): NewStep[] {
  return [
    {
      dayOffset: 2,
      channel: "linkedin",
      messageTemplate: `Hi {firstName} — quick follow-up about {result}. Happy to share details if you're still exploring.`,
      subject: null,
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    {
      dayOffset: 5,
      channel: "linkedin",
      messageTemplate: `Hey {firstName} — circling back. If helpful, I have {availability}. Or grab a time here: {calendarLink}`,
      subject: null,
      condition: { type: "linkedin_connected" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    {
      dayOffset: 7,
      channel: "linkedin",
      messageTemplate: `Last touch, {firstName} — should I close the loop on this, or do you still want to chat about {result}?`,
      subject: null,
      condition: { type: "linkedin_connected" },
      requiresApproval: false,
      fallbackStepId: null,
    },
  ];
}

function defaultMeetingRequestedLinkedInSteps(): NewStep[] {
  return [
    {
      dayOffset: 1,
      channel: "linkedin",
      messageTemplate: `Hi {firstName} — thanks for reaching out. Happy to connect and share details about {result}.`,
      subject: null,
      condition: { type: "always" },
      requiresApproval: false,
      fallbackStepId: null,
    },
    {
      dayOffset: 2,
      channel: "linkedin",
      messageTemplate: `Thanks for connecting, {firstName}. If you’d like, here’s my calendar to grab a quick call: {calendarLink}`,
      subject: null,
      condition: { type: "linkedin_connected" },
      requiresApproval: false,
      fallbackStepId: null,
    },
  ];
}

async function main() {
  const apply = getFlag("--apply");
  const clientId = getArg("--clientId");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing (set it in .env/.env.local)");
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const clients = await prisma.client.findMany({
    where: {
      ...(clientId ? { id: clientId } : {}),
      unipileAccountId: { not: null },
    },
    select: { id: true, unipileAccountId: true },
    orderBy: { createdAt: "asc" },
  });

  const eligible = clients.filter((c) => (c.unipileAccountId || "").trim() !== "");
  console.log(
    `[backfill-linkedin-sequence-steps] Mode: ${apply ? "APPLY" : "DRY-RUN"} | Workspaces: ${eligible.length}${clientId ? " (filtered)" : ""}`
  );

  let sequencesScanned = 0;
  let sequencesUpdated = 0;
  let stepsInserted = 0;

  for (const client of eligible) {
    const sequences = await prisma.followUpSequence.findMany({
      where: {
        clientId: client.id,
        name: { in: [DEFAULT_SEQUENCE_NAMES.noResponse, DEFAULT_SEQUENCE_NAMES.meetingRequested] },
      },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });

    for (const sequence of sequences) {
      sequencesScanned++;

      const hasLinkedIn = sequence.steps.some((s) => s.channel === "linkedin");
      if (hasLinkedIn) continue;

      const toCreate =
        sequence.name === DEFAULT_SEQUENCE_NAMES.noResponse
          ? defaultNoResponseLinkedInSteps()
          : sequence.name === DEFAULT_SEQUENCE_NAMES.meetingRequested
            ? defaultMeetingRequestedLinkedInSteps()
            : [];

      if (toCreate.length === 0) continue;

      console.log(
        `[backfill-linkedin-sequence-steps] clientId=${client.id} sequenceId=${sequence.id} name="${sequence.name}" addLinkedInSteps=${toCreate.length}`
      );

      if (!apply) continue;

      await prisma.$transaction(
        async (tx) => {
        const desired = sortStepsForScheduling([
          ...sequence.steps.map((s) => ({
            kind: "existing" as const,
            id: s.id,
            oldStepOrder: s.stepOrder,
            dayOffset: s.dayOffset,
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

      sequencesUpdated++;
      stepsInserted += toCreate.length;
    }
  }

  console.log(
    `[backfill-linkedin-sequence-steps] scanned=${sequencesScanned} updated=${sequencesUpdated} insertedSteps=${stepsInserted}`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfill-linkedin-sequence-steps] failed:", err);
  process.exit(1);
});
