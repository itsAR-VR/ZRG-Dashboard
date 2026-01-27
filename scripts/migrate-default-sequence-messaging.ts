/**
 * Phase 59f — Migrate Default Sequence Messaging
 *
 * Overwrites existing default follow-up sequences with canonical copy + timing,
 * updates in-flight instances and pending tasks, and generates rollback artifacts.
 *
 * Run:
 *   npx tsx scripts/migrate-default-sequence-messaging.ts              # dry-run all
 *   npx tsx scripts/migrate-default-sequence-messaging.ts --apply      # apply all
 *   npx tsx scripts/migrate-default-sequence-messaging.ts --apply --clientId <uuid>  # canary
 *   npx tsx scripts/migrate-default-sequence-messaging.ts --rollback <file>  # rollback from artifact
 *
 * Env:
 *   DIRECT_URL (preferred) or DATABASE_URL - required
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import * as fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { computeStepDeltaMs, computeStepOffsetMs } from "../lib/followup-schedule";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StepCondition = { type: "phone_provided" | "linkedin_connected" | "no_response" | "email_opened" | "always"; value?: string };

type CanonicalStep = {
  dayOffset: number;
  minuteOffset: number;
  channel: "email" | "sms" | "linkedin";
  messageTemplate: string;
  subject: string | null;
  condition: StepCondition;
  requiresApproval: boolean;
};

type RollbackStepData = {
  id: string;
  dayOffset: number;
  minuteOffset: number;
  stepOrder: number;
  channel: string;
  messageTemplate: string | null;
  subject: string | null;
  condition: unknown;
  requiresApproval: boolean;
};

type RollbackSequenceData = {
  sequenceId: string;
  sequenceName: string;
  clientId: string;
  steps: RollbackStepData[];
  deletedStepIds: string[];
  createdStepIds: string[];
};

type RollbackInstanceData = {
  instanceId: string;
  sequenceId: string;
  currentStep: number;
  nextStepDue: string | null;
};

type RollbackTaskData = {
  taskId: string;
  instanceId: string;
  stepOrder: number | null;
  suggestedMessage: string | null;
  subject: string | null;
};

type RollbackArtifact = {
  createdAt: string;
  sequences: RollbackSequenceData[];
  instances: RollbackInstanceData[];
  tasks: RollbackTaskData[];
};

const DEFAULT_SEQUENCE_NAMES = {
  noResponse: "No Response Day 2/5/7",
  meetingRequested: "Meeting Requested Day 1/2/5/7",
  postBooking: "Post-Booking Qualification",
} as const;

// ---------------------------------------------------------------------------
// Canonical sequences (source of truth: Follow-Up Sequencing.md)
// ---------------------------------------------------------------------------

function canonicalNoResponseSteps(): CanonicalStep[] {
  return [
    // DAY 2 - Email
    {
      dayOffset: 2,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hi {FIRST_NAME} could I get the best number to reach you on so we can give you a call?`,
      subject: null, // Keep existing subjects in DB
      condition: { type: "always" },
      requiresApproval: false,
    },
    // DAY 2 - SMS (phone only)
    {
      dayOffset: 2,
      minuteOffset: 0,
      channel: "sms",
      messageTemplate: `Hey {FIRST_NAME}, when is a good time to give you a call?`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
    },
    // DAY 2 - LinkedIn (connected only)
    {
      dayOffset: 2,
      minuteOffset: 0,
      channel: "linkedin",
      messageTemplate: `Hi {FIRST_NAME} could I get the best number to reach you on so we can give you a call?`,
      subject: null,
      condition: { type: "linkedin_connected" },
      requiresApproval: false,
    },
    // DAY 5 - Email
    {
      dayOffset: 5,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hi {FIRST_NAME}, just had time to get back to you.

I’m currently reviewing the slots I have left for new clients and just wanted to give you a fair shot in case you were still interested in {achieving result}. 

No problem if not but just let me know. I have {x day x time} and {y day y time} and if it’s easier here’s my calendar link for you to choose a time that works for you: {link}`,
      subject: null,
      condition: { type: "always" },
      requiresApproval: false,
    },
    // DAY 5 - SMS (phone only)
    {
      dayOffset: 5,
      minuteOffset: 0,
      channel: "sms",
      messageTemplate: `Hey {FIRST_NAME} - {name} from {company} again

Just sent over an email about getting {result} 

I have {x day x time} and {y day y time} for you

Here’s the link to choose a time to talk if those don’t work  {link}`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
    },
    // DAY 7 - Email
    {
      dayOffset: 7,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hey {{contact.first_name}}, tried to reach you a few times but didn’t hear back….

Where should we go from here?`,
      subject: null,
      condition: { type: "always" },
      requiresApproval: false,
    },
    // DAY 7 - SMS (phone only)
    {
      dayOffset: 7,
      minuteOffset: 0,
      channel: "sms",
      messageTemplate: `Hey {{contact.first_name}}, tried to reach you a few times but didn’t hear back….

Where should we go from here?`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
    },
  ];
}

function canonicalMeetingRequestedSteps(): CanonicalStep[] {
  return [
    // DAY 1 - Email (CTA; reply-in-thread)
    {
      dayOffset: 1,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Sounds good, does {time 1 day 1} or {time 2 day 2} work for you?`,
      subject: null, // Keep existing subjects in DB
      condition: { type: "always" },
      requiresApproval: false,
    },
    // DAY 1 - SMS (+2 minutes, phone only)
    {
      dayOffset: 1,
      minuteOffset: 2,
      channel: "sms",
      messageTemplate: `Hi {FIRST_NAME}, it’s {name} from {company}, I just sent over an email but wanted to drop a text too incase it went to spam - here’s the link {link}`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
    },
    // DAY 1 - LinkedIn (+60 minutes)
    {
      dayOffset: 1,
      minuteOffset: 60,
      channel: "linkedin",
      messageTemplate: `Hi {FIRST_NAME}, just wanted to connect on here too as well as over email`,
      subject: null,
      condition: { type: "always" },
      requiresApproval: false,
    },
    // DAY 2 - Email
    {
      dayOffset: 2,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hi {FIRST_NAME} could I get the best number to reach you on so we can give you a call?`,
      subject: null,
      condition: { type: "always" },
      requiresApproval: false,
    },
    // DAY 2 - SMS (phone only)
    {
      dayOffset: 2,
      minuteOffset: 0,
      channel: "sms",
      messageTemplate: `Hey {FIRST_NAME}, when is a good time to give you a call?`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
    },
    // DAY 2 - LinkedIn (connected only)
    {
      dayOffset: 2,
      minuteOffset: 0,
      channel: "linkedin",
      messageTemplate: `Hi {FIRST_NAME} could I get the best number to reach you on so we can give you a call?`,
      subject: null,
      condition: { type: "linkedin_connected" },
      requiresApproval: false,
    },
    // DAY 5 - Email
    {
      dayOffset: 5,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hi {FIRST_NAME}, just had time to get back to you.

I’m currently reviewing the slots I have left for new clients and just wanted to give you a fair shot in case you were still interested in {achieving result}. 

No problem if not but just let me know. I have {x day x time} and {y day y time} and if it’s easier here’s my calendar link for you to choose a time that works for you: {link}`,
      subject: null,
      condition: { type: "always" },
      requiresApproval: false,
    },
    // DAY 5 - SMS (phone only)
    {
      dayOffset: 5,
      minuteOffset: 0,
      channel: "sms",
      messageTemplate: `Hey {FIRST_NAME} - {name} from {company} again

Just sent over an email about getting {result} 

I have {x day x time} and {y day y time} for you

Here’s the link to choose a time to talk if those don’t work  {link}`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
    },
    // DAY 7 - Email
    {
      dayOffset: 7,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Hey {{contact.first_name}}, tried to reach you a few times but didn’t hear back….

Where should we go from here?`,
      subject: null,
      condition: { type: "always" },
      requiresApproval: false,
    },
    // DAY 7 - SMS (phone only)
    {
      dayOffset: 7,
      minuteOffset: 0,
      channel: "sms",
      messageTemplate: `Hey {{contact.first_name}}, tried to reach you a few times but didn’t hear back….

Where should we go from here?`,
      subject: null,
      condition: { type: "phone_provided" },
      requiresApproval: false,
    },
  ];
}

function canonicalPostBookingSteps(): CanonicalStep[] {
  return [
    {
      dayOffset: 0,
      minuteOffset: 0,
      channel: "email",
      messageTemplate: `Great I’ve booked you in and you should get a reminder to your email.

Before the call would you be able to let me know {qualification question 1} and {qualification question 2} just so I’m able to prepare properly for the call.`,
      subject: null, // Keep existing subjects in DB
      condition: { type: "always" },
      requiresApproval: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

type StepKeyable = { channel: string; dayOffset: number; minuteOffset?: number | null };

function stepKey(step: StepKeyable): string {
  return `${step.channel}:${step.dayOffset}:${step.minuteOffset ?? 0}`;
}

function buildStepOrderMap(opts: {
  oldSteps: Array<{ stepOrder: number } & StepKeyable>;
  newSteps: Array<{ stepOrder: number } & StepKeyable>;
}): Map<number, number> {
  const newByKey = new Map<string, number>();
  for (const step of opts.newSteps) {
    const key = stepKey(step);
    if (!newByKey.has(key)) newByKey.set(key, step.stepOrder);
  }

  const map = new Map<number, number>();
  for (const oldStep of opts.oldSteps) {
    const mapped = newByKey.get(stepKey(oldStep));
    if (mapped) map.set(oldStep.stepOrder, mapped);
  }
  return map;
}

function inferSubjectForCanonicalStep(step: CanonicalStep, existingSteps: Array<{ channel: string; dayOffset: number; subject: string | null }>): string | null {
  if (step.channel !== "email") return null;

  const exact = existingSteps.find((s) => s.channel === "email" && s.dayOffset === step.dayOffset && s.subject);
  if (exact?.subject) return exact.subject;

  const subjects = existingSteps
    .filter((s) => s.channel === "email" && typeof s.subject === "string" && s.subject.trim().length > 0)
    .map((s) => s.subject!.trim());
  if (subjects.length === 0) return null;

  if (step.dayOffset <= 1) return subjects[0]!;
  const reSubject = subjects.find((s) => s.toLowerCase().startsWith("re:"));
  return reSubject ?? subjects[subjects.length - 1] ?? null;
}

function sortStepsForScheduling<T extends { dayOffset: number; minuteOffset?: number | null; channel: string }>(steps: T[]): T[] {
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

// ---------------------------------------------------------------------------
// Migration logic
// ---------------------------------------------------------------------------

async function migrateSequence(
  prisma: PrismaClient,
  sequence: {
    id: string;
    name: string;
    clientId: string;
    steps: Array<{
      id: string;
      stepOrder: number;
      dayOffset: number;
      minuteOffset: number;
      channel: string;
      messageTemplate: string | null;
      subject: string | null;
      condition: unknown;
      requiresApproval: boolean;
    }>;
  },
  canonicalSteps: CanonicalStep[],
  dryRun: boolean
): Promise<RollbackSequenceData> {
  const rollback: RollbackSequenceData = {
    sequenceId: sequence.id,
    sequenceName: sequence.name,
    clientId: sequence.clientId,
    steps: sequence.steps.map((s) => ({
      id: s.id,
      dayOffset: s.dayOffset,
      minuteOffset: s.minuteOffset,
      stepOrder: s.stepOrder,
      channel: s.channel,
      messageTemplate: s.messageTemplate,
      subject: s.subject,
      condition: s.condition,
      requiresApproval: s.requiresApproval,
    })),
    deletedStepIds: [],
    createdStepIds: [],
  };

  if (dryRun) {
    console.log(`  [dry-run] Would overwrite ${sequence.steps.length} steps with ${canonicalSteps.length} canonical steps`);
    return rollback;
  }

  // Strategy: delete all existing steps, create new ones with correct ordering
  // This is simpler and safer than trying to match/merge steps
  await prisma.$transaction(
    async (tx) => {
      // Record existing step IDs for rollback
      rollback.deletedStepIds = sequence.steps.map((s) => s.id);

      // Delete existing steps
      await tx.followUpStep.deleteMany({
        where: { sequenceId: sequence.id },
      });

      // Create new steps sorted properly
      const sortedCanonical = sortStepsForScheduling(
        canonicalSteps.map((s, i) => ({ ...s, _idx: i }))
      );

      for (let i = 0; i < sortedCanonical.length; i++) {
        const step = sortedCanonical[i]!;
        // Keep existing subjects unchanged (only infer for newly introduced email steps).
        const subject = step.subject ?? inferSubjectForCanonicalStep(step, sequence.steps) ?? null;

        const created = await tx.followUpStep.create({
          data: {
            sequenceId: sequence.id,
            stepOrder: i + 1,
            dayOffset: step.dayOffset,
            minuteOffset: step.minuteOffset,
            channel: step.channel,
            messageTemplate: step.messageTemplate,
            subject,
            condition: JSON.stringify(step.condition),
            requiresApproval: step.requiresApproval,
            fallbackStepId: null,
          },
          select: { id: true },
        });
        rollback.createdStepIds.push(created.id);
      }
    },
    { timeout: 30_000 }
  );

  console.log(`  Overwrote ${sequence.steps.length} → ${canonicalSteps.length} steps`);
  return rollback;
}

async function updateInstances(
  prisma: PrismaClient,
  sequenceId: string,
  oldSteps: Array<{ stepOrder: number; dayOffset: number; minuteOffset: number; channel: string }>,
  newSteps: Array<{ stepOrder: number; dayOffset: number; minuteOffset: number; channel: string }>,
  stepOrderMap: Map<number, number>,
  dryRun: boolean
): Promise<RollbackInstanceData[]> {
  const instances = await prisma.followUpInstance.findMany({
    where: {
      sequenceId,
      status: { in: ["active", "paused"] },
    },
    select: {
      id: true,
      currentStep: true,
      nextStepDue: true,
      startedAt: true,
      lastStepAt: true,
      status: true,
    },
  });

  const rollback: RollbackInstanceData[] = [];
  const now = new Date();
  const oldByOrder = new Map(oldSteps.map((s) => [s.stepOrder, s]));
  const newByOrder = new Map(newSteps.map((s) => [s.stepOrder, s]));

  for (const instance of instances) {
    rollback.push({
      instanceId: instance.id,
      sequenceId,
      currentStep: instance.currentStep,
      nextStepDue: instance.nextStepDue?.toISOString() ?? null,
    });

    if (dryRun) continue;

    let newCurrentStep = instance.currentStep;
    if (instance.currentStep > 0) {
      const mapped = stepOrderMap.get(instance.currentStep);
      if (mapped) {
        newCurrentStep = mapped;
      } else {
        const oldStep = oldByOrder.get(instance.currentStep);
        if (!oldStep) {
          newCurrentStep = 0;
        } else {
          const oldOffset = computeStepOffsetMs(oldStep);
          let best: number = 0;
          for (const step of newSteps) {
            if (computeStepOffsetMs(step) <= oldOffset) best = step.stepOrder;
          }
          newCurrentStep = best;
        }
      }
    }

    const nextStepData = newSteps.find((s) => s.stepOrder > newCurrentStep) ?? null;

    if (!nextStepData) {
      // No next step - instance might be at end, leave it
      await prisma.followUpInstance.update({
        where: { id: instance.id },
        data: { currentStep: newCurrentStep, nextStepDue: null },
      });
      continue;
    }

    const currentStepData = newCurrentStep > 0 ? newByOrder.get(newCurrentStep) : null;
    const anchor = currentStepData ? instance.lastStepAt ?? instance.startedAt ?? now : instance.startedAt ?? now;

    const candidateDue = currentStepData
      ? new Date(anchor.getTime() + computeStepDeltaMs(currentStepData, nextStepData))
      : new Date(anchor.getTime() + computeStepOffsetMs(nextStepData));

    const finalDue = candidateDue.getTime() < now.getTime() ? now : candidateDue;

    await prisma.followUpInstance.update({
      where: { id: instance.id },
      data: { currentStep: newCurrentStep, nextStepDue: finalDue },
    });
  }

  if (dryRun) {
    console.log(`  [dry-run] Would update ${instances.length} instances`);
  } else {
    console.log(`  Updated ${instances.length} instances`);
  }

  return rollback;
}

async function updateTasks(
  prisma: PrismaClient,
  sequenceId: string,
  newSteps: Array<{
    stepOrder: number;
    channel: string;
    messageTemplate: string | null;
    subject: string | null;
  }>,
  stepOrderMap: Map<number, number>,
  dryRun: boolean
): Promise<RollbackTaskData[]> {
  // First find instance IDs for this sequence
  const instances = await prisma.followUpInstance.findMany({
    where: { sequenceId },
    select: { id: true },
  });
  const instanceIds = instances.map((i) => i.id);

  if (instanceIds.length === 0) {
    if (dryRun) {
      console.log(`  [dry-run] No instances found, 0 tasks to update`);
    }
    return [];
  }

  // Find pending tasks for those instances
  const tasks = await prisma.followUpTask.findMany({
    where: {
      status: "pending",
      instanceId: { in: instanceIds },
    },
    select: {
      id: true,
      instanceId: true,
      stepOrder: true,
      suggestedMessage: true,
      subject: true,
      leadId: true,
    },
  });

  // Fetch lead data for each task
  const leadIds = [...new Set(tasks.map((t) => t.leadId))];
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      clientId: true,
    },
  });
  const leadMap = new Map(leads.map((l) => [l.id, l]));

  // Fetch client data via workspaceSettings
  const clientIds = [...new Set(leads.map((l) => l.clientId))];
  const workspaceSettings = await prisma.workspaceSettings.findMany({
    where: { clientId: { in: clientIds } },
    select: {
      clientId: true,
      aiPersonaName: true, // Used for {senderName}
      companyName: true,
      qualificationQuestions: true,
      targetResult: true, // Used for {result}
    },
  });
  const settingsMap = new Map(workspaceSettings.map((s) => [s.clientId, s]));

  const rollback: RollbackTaskData[] = [];

  for (const task of tasks) {
    if (!task.instanceId) continue;

    rollback.push({
      taskId: task.id,
      instanceId: task.instanceId,
      stepOrder: task.stepOrder,
      suggestedMessage: task.suggestedMessage,
      subject: task.subject,
    });

    if (dryRun) continue;

    if (!task.stepOrder) continue;
    const mappedStepOrder = stepOrderMap.get(task.stepOrder) ?? task.stepOrder;

    // Find the matching step template
    const stepTemplate = newSteps.find((s) => s.stepOrder === mappedStepOrder);
    if (!stepTemplate) continue;

    // Re-render template with lead data
    const lead = leadMap.get(task.leadId);
    if (!lead) continue;

    const settings = settingsMap.get(lead.clientId);

    const qualificationQuestionsRaw = settings?.qualificationQuestions;
    let question1 = "[qualification question 1]";
    let question2 = "[qualification question 2]";
    if (qualificationQuestionsRaw) {
      try {
        const questions = JSON.parse(qualificationQuestionsRaw as string) as Array<{ question?: string }>;
        if (questions[0]?.question) question1 = questions[0].question;
        if (questions[1]?.question) question2 = questions[1].question;
      } catch {
        // ignore parse errors
      }
    }

    const ctx = {
      firstName: lead.firstName || "",
      lastName: lead.lastName || "",
      senderName: settings?.aiPersonaName || "",
      companyName: settings?.companyName || "",
      result: settings?.targetResult || "achieving your goals",
      question1,
      question2,
    };

    const render = (input: string | null): string | null => {
      if (!input) return null;
      return input
        .replaceAll("{firstName}", ctx.firstName)
        .replaceAll("{FIRST_NAME}", ctx.firstName)
        .replaceAll("{lastName}", ctx.lastName)
        .replaceAll("{senderName}", ctx.senderName)
        .replaceAll("{name}", ctx.senderName)
        .replaceAll("{companyName}", ctx.companyName)
        .replaceAll("{company}", ctx.companyName)
        .replaceAll("{result}", ctx.result)
        .replaceAll("{achieving result}", ctx.result)
        .replaceAll("{qualificationQuestion1}", ctx.question1)
        .replaceAll("{qualificationQuestion2}", ctx.question2)
        .replaceAll("{qualification question 1}", ctx.question1)
        .replaceAll("{qualification question 2}", ctx.question2)
        .replaceAll("{{contact.first_name}}", ctx.firstName)
        .replaceAll("{{contact.first\\_name}}", ctx.firstName)
        // Booking link + availability are resolved at send time by server code.
        .replaceAll("{calendarLink}", "[calendar link]")
        .replaceAll("{link}", "[calendar link]")
        .replaceAll("{availability}", "[availability]")
        .replaceAll("{time 1 day 1}", "[time option 1]")
        .replaceAll("{time 2 day 2}", "[time option 2]")
        .replaceAll("{x day x time}", "[time option 1]")
        .replaceAll("{y day y time}", "[time option 2]");
    };

    const message = render(stepTemplate.messageTemplate) ?? "";
    const subject = task.subject ?? render(stepTemplate.subject);

    await prisma.followUpTask.update({
      where: { id: task.id },
      data: {
        stepOrder: mappedStepOrder,
        suggestedMessage: message,
        subject,
      },
    });
  }

  if (dryRun) {
    console.log(`  [dry-run] Would update ${tasks.length} pending tasks`);
  } else {
    console.log(`  Updated ${tasks.length} pending tasks`);
  }

  return rollback;
}

async function runRollback(prisma: PrismaClient, artifact: RollbackArtifact): Promise<void> {
  console.log(`Rolling back from artifact created at ${artifact.createdAt}...`);

  // Rollback sequences (delete created steps, restore original steps)
  for (const seq of artifact.sequences) {
    console.log(`  Rolling back sequence ${seq.sequenceName} (${seq.sequenceId})...`);

    await prisma.$transaction(
      async (tx) => {
        // Delete the new steps we created
        if (seq.createdStepIds.length > 0) {
          await tx.followUpStep.deleteMany({
            where: { id: { in: seq.createdStepIds } },
          });
        }

        // Restore original steps
        for (const step of seq.steps) {
          await tx.followUpStep.create({
            data: {
              id: step.id,
              sequenceId: seq.sequenceId,
              stepOrder: step.stepOrder,
              dayOffset: step.dayOffset,
              minuteOffset: step.minuteOffset,
              channel: step.channel,
              messageTemplate: step.messageTemplate,
              subject: step.subject,
              condition: typeof step.condition === "string" ? step.condition : JSON.stringify(step.condition),
              requiresApproval: step.requiresApproval,
              fallbackStepId: null,
            },
          });
        }
      },
      { timeout: 30_000 }
    );
  }

  // Rollback instances
  for (const inst of artifact.instances) {
    await prisma.followUpInstance.update({
      where: { id: inst.instanceId },
      data: {
        currentStep: inst.currentStep,
        nextStepDue: inst.nextStepDue ? new Date(inst.nextStepDue) : null,
      },
    });
  }
  console.log(`  Rolled back ${artifact.instances.length} instances`);

  // Rollback tasks
  for (const task of artifact.tasks) {
    await prisma.followUpTask.update({
      where: { id: task.taskId },
      data: {
        stepOrder: task.stepOrder,
        suggestedMessage: task.suggestedMessage,
        subject: task.subject,
      },
    });
  }
  console.log(`  Rolled back ${artifact.tasks.length} tasks`);

  console.log("Rollback complete.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const dryRun = !getFlag("--apply");
  const clientId = getArg("--clientId");
  const rollbackFile = getArg("--rollback");

  const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL required");
  }

  const adapter = new PrismaPg({ connectionString: dbUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    // Rollback mode
    if (rollbackFile) {
      const raw = await fs.readFile(rollbackFile, "utf8");
      const artifact = JSON.parse(raw) as RollbackArtifact;
      await runRollback(prisma, artifact);
      return;
    }

    console.log(`[migrate-default-sequence-messaging] Mode: ${dryRun ? "DRY-RUN" : "APPLY"}${clientId ? ` | clientId: ${clientId}` : ""}`);

    const clients = await prisma.client.findMany({
      where: clientId ? { id: clientId } : {},
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    console.log(`Found ${clients.length} workspace(s) to process\n`);

    const fullRollback: RollbackArtifact = {
      createdAt: new Date().toISOString(),
      sequences: [],
      instances: [],
      tasks: [],
    };

    let sequencesProcessed = 0;
    let stepsOverwritten = 0;
    let instancesUpdated = 0;
    let tasksUpdated = 0;

    for (const client of clients) {
      const sequences = await prisma.followUpSequence.findMany({
        where: {
          clientId: client.id,
          name: {
            in: [
              DEFAULT_SEQUENCE_NAMES.noResponse,
              DEFAULT_SEQUENCE_NAMES.meetingRequested,
              DEFAULT_SEQUENCE_NAMES.postBooking,
            ],
          },
        },
        include: {
          steps: { orderBy: { stepOrder: "asc" } },
        },
      });

      for (const sequence of sequences) {
        console.log(`Processing: ${sequence.name} (client: ${client.id})`);

        const canonicalSteps =
          sequence.name === DEFAULT_SEQUENCE_NAMES.noResponse
            ? canonicalNoResponseSteps()
            : sequence.name === DEFAULT_SEQUENCE_NAMES.meetingRequested
              ? canonicalMeetingRequestedSteps()
              : sequence.name === DEFAULT_SEQUENCE_NAMES.postBooking
                ? canonicalPostBookingSteps()
                : [];

        if (canonicalSteps.length === 0) {
          console.log("  Skipping - no canonical steps defined");
          continue;
        }

        // Migrate the sequence steps
        const seqRollback = await migrateSequence(prisma, sequence, canonicalSteps, dryRun);
        fullRollback.sequences.push(seqRollback);
        sequencesProcessed++;
        stepsOverwritten += sequence.steps.length;

        // Refresh the steps after migration to get new step data
        const newSteps = dryRun
          ? sortStepsForScheduling(canonicalSteps).map((s, idx) => ({
              stepOrder: idx + 1,
              dayOffset: s.dayOffset,
              minuteOffset: s.minuteOffset,
              channel: s.channel,
              messageTemplate: s.messageTemplate,
              subject: s.subject,
            }))
          : await prisma.followUpStep.findMany({
              where: { sequenceId: sequence.id },
              orderBy: { stepOrder: "asc" },
              select: {
                stepOrder: true,
                dayOffset: true,
                minuteOffset: true,
                channel: true,
                messageTemplate: true,
                subject: true,
              },
            });

        const stepOrderMap = buildStepOrderMap({
          oldSteps: sequence.steps.map((s) => ({
            stepOrder: s.stepOrder,
            dayOffset: s.dayOffset,
            minuteOffset: s.minuteOffset,
            channel: s.channel,
          })),
          newSteps: newSteps.map((s) => ({
            stepOrder: s.stepOrder,
            dayOffset: s.dayOffset,
            minuteOffset: s.minuteOffset,
            channel: s.channel,
          })),
        });

        // Update instances
        const instRollback = await updateInstances(
          prisma,
          sequence.id,
          sequence.steps.map((s) => ({
            stepOrder: s.stepOrder,
            dayOffset: s.dayOffset,
            minuteOffset: s.minuteOffset,
            channel: s.channel,
          })),
          newSteps.map((s) => ({
            stepOrder: s.stepOrder,
            dayOffset: s.dayOffset,
            minuteOffset: s.minuteOffset,
            channel: s.channel,
          })),
          stepOrderMap,
          dryRun
        );
        fullRollback.instances.push(...instRollback);
        instancesUpdated += instRollback.length;

        // Update tasks
        const taskRollback = await updateTasks(prisma, sequence.id, newSteps, stepOrderMap, dryRun);
        fullRollback.tasks.push(...taskRollback);
        tasksUpdated += taskRollback.length;

        console.log("");
      }
    }

    // Write rollback artifact
    if (!dryRun && fullRollback.sequences.length > 0) {
      const rollbackPath = `rollback-sequence-messaging-${Date.now()}.json`;
      await fs.writeFile(rollbackPath, JSON.stringify(fullRollback, null, 2));
      console.log(`Rollback artifact saved: ${rollbackPath}`);
    }

    console.log("\n=== Summary ===");
    console.log(`Sequences processed: ${sequencesProcessed}`);
    console.log(`Steps overwritten: ${stepsOverwritten}`);
    console.log(`Instances updated: ${instancesUpdated}`);
    console.log(`Tasks updated: ${tasksUpdated}`);
    console.log(`Mode: ${dryRun ? "DRY-RUN (no changes made)" : "APPLIED"}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[migrate-default-sequence-messaging] failed:", err);
  process.exit(1);
});
