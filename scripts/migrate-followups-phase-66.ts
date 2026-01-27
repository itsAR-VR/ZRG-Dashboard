/**
 * Phase 66g — Migrate Follow-Ups: Remove Day 1 Auto-Email + Disable No Response
 *
 * 1) Remove Day 1 auto-email step from existing "Meeting Requested Day 1/2/5/7" sequences
 * 2) Migrate in-flight "No Response Day 2/5/7" instances to "Meeting Requested Day 1/2/5/7"
 * 3) Disable "No Response Day 2/5/7" sequences (isActive = false)
 *
 * Run:
 *   npx tsx scripts/migrate-followups-phase-66.ts                           # dry-run all
 *   npx tsx scripts/migrate-followups-phase-66.ts --apply                   # apply all
 *   npx tsx scripts/migrate-followups-phase-66.ts --apply --clientId <uuid> # canary
 *   npx tsx scripts/migrate-followups-phase-66.ts --rollback <file>         # rollback
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
import { computeStepOffsetMs } from "../lib/followup-schedule";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  isActive: boolean;
  steps: RollbackStepData[];
  deletedStepIds: string[];
};

type RollbackInstanceData = {
  instanceId: string;
  leadId: string;
  sequenceId: string;
  status: string;
  currentStep: number;
  nextStepDue: string | null;
  pausedReason: string | null;
  // For migrated instances, track the new instance we created so rollback can delete it
  migratedToInstanceId?: string;
};

type RollbackTaskData = {
  taskId: string;
  instanceId: string | null;
  stepOrder: number | null;
};

type RollbackArtifact = {
  phase: "66g";
  createdAt: string;
  sequences: RollbackSequenceData[];
  instances: RollbackInstanceData[];
  tasks: RollbackTaskData[];
};

const DEFAULT_SEQUENCE_NAMES = {
  noResponse: "No Response Day 2/5/7",
  meetingRequested: "Meeting Requested Day 1/2/5/7",
} as const;

// ---------------------------------------------------------------------------
// Prisma Client
// ---------------------------------------------------------------------------

function createPrismaClient(): PrismaClient {
  const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!directUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL environment variable required");
  }
  const adapter = new PrismaPg({ connectionString: directUrl });
  return new PrismaClient({ adapter });
}

// ---------------------------------------------------------------------------
// Main Logic
// ---------------------------------------------------------------------------

async function migrate(prisma: PrismaClient, apply: boolean, targetClientId?: string): Promise<RollbackArtifact> {
  const artifact: RollbackArtifact = {
    phase: "66g",
    createdAt: new Date().toISOString(),
    sequences: [],
    instances: [],
    tasks: [],
  };

  // Find all clients to process
  const clientFilter = targetClientId ? { id: targetClientId } : {};
  const clients = await prisma.client.findMany({
    where: clientFilter,
    select: { id: true, name: true },
  });

  console.log(`Processing ${clients.length} client(s)...\n`);

  for (const client of clients) {
    console.log(`\n=== Client: ${client.name} (${client.id}) ===`);

    // Load sequences
    const noResponseSeq = await prisma.followUpSequence.findFirst({
      where: { clientId: client.id, name: DEFAULT_SEQUENCE_NAMES.noResponse },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });

    const meetingRequestedSeq = await prisma.followUpSequence.findFirst({
      where: { clientId: client.id, name: DEFAULT_SEQUENCE_NAMES.meetingRequested },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });

    // Step 1: Remove Day 1 auto-email from Meeting Requested
    if (meetingRequestedSeq) {
      await removeDay1EmailFromMeetingRequested(prisma, meetingRequestedSeq, artifact, apply);
    } else {
      console.log("  No Meeting Requested sequence found - skipping Day 1 email removal");
    }

    // Step 2: Disable No Response and migrate instances
    if (noResponseSeq) {
      await disableNoResponseAndMigrateInstances(prisma, client.id, noResponseSeq, meetingRequestedSeq, artifact, apply);
    } else {
      console.log("  No 'No Response' sequence found - nothing to migrate");
    }
  }

  return artifact;
}

async function removeDay1EmailFromMeetingRequested(
  prisma: PrismaClient,
  seq: { id: string; clientId: string; steps: Array<{ id: string; stepOrder: number; channel: string; dayOffset: number; minuteOffset: number; messageTemplate: string | null; subject: string | null; condition: unknown; requiresApproval: boolean }> },
  artifact: RollbackArtifact,
  apply: boolean
): Promise<void> {
  // Find Day 1 email step(s): channel === 'email', dayOffset === 1, minuteOffset === 0
  const day1EmailSteps = seq.steps.filter(
    (s) => s.channel === "email" && s.dayOffset === 1 && s.minuteOffset === 0
  );

  if (day1EmailSteps.length === 0) {
    console.log("  Meeting Requested: No Day 1 auto-email step found (already removed or never existed)");
    return;
  }

  console.log(`  Meeting Requested: Found ${day1EmailSteps.length} Day 1 email step(s) to remove`);

  // Record rollback data
  const seqRollback: RollbackSequenceData = {
    sequenceId: seq.id,
    sequenceName: DEFAULT_SEQUENCE_NAMES.meetingRequested,
    clientId: seq.clientId,
    isActive: true, // Will record current state
    steps: seq.steps.map((s) => ({
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
    deletedStepIds: day1EmailSteps.map((s) => s.id),
  };
  artifact.sequences.push(seqRollback);

  if (!apply) {
    console.log("  [DRY-RUN] Would delete Day 1 email step(s) and renumber remaining steps");
    return;
  }

  // Delete Day 1 email steps
  const deletedIds = day1EmailSteps.map((s) => s.id);
  await prisma.followUpStep.deleteMany({
    where: { id: { in: deletedIds } },
  });
  console.log(`  Deleted ${deletedIds.length} Day 1 email step(s)`);

  // Renumber remaining steps to avoid gaps
  const remainingSteps = seq.steps.filter((s) => !deletedIds.includes(s.id));
  remainingSteps.sort((a, b) => {
    if (a.dayOffset !== b.dayOffset) return a.dayOffset - b.dayOffset;
    if (a.minuteOffset !== b.minuteOffset) return a.minuteOffset - b.minuteOffset;
    // Channel priority: email, sms, linkedin
    const channelOrder = { email: 0, sms: 1, linkedin: 2 };
    return (channelOrder[a.channel as keyof typeof channelOrder] ?? 99) - (channelOrder[b.channel as keyof typeof channelOrder] ?? 99);
  });

  // Build oldOrder -> newOrder map
  const stepOrderMap = new Map<number, number>();
  for (let i = 0; i < remainingSteps.length; i++) {
    stepOrderMap.set(remainingSteps[i].stepOrder, i + 1);
  }

  // Two-phase renumber to avoid unique constraint violations
  // Phase 1: Set to negative temporary values
  for (let i = 0; i < remainingSteps.length; i++) {
    await prisma.followUpStep.update({
      where: { id: remainingSteps[i].id },
      data: { stepOrder: -(i + 1) },
    });
  }

  // Phase 2: Set to final positive values
  for (let i = 0; i < remainingSteps.length; i++) {
    await prisma.followUpStep.update({
      where: { id: remainingSteps[i].id },
      data: { stepOrder: i + 1 },
    });
  }
  console.log(`  Renumbered ${remainingSteps.length} remaining steps`);

  // Remap in-flight instances' currentStep
  const instances = await prisma.followUpInstance.findMany({
    where: { sequenceId: seq.id, status: { in: ["active", "paused"] } },
    select: { id: true, leadId: true, currentStep: true, nextStepDue: true, startedAt: true, status: true, pausedReason: true },
  });

  for (const inst of instances) {
    const oldStep = inst.currentStep;
    let newStep = stepOrderMap.get(oldStep);

    // If currentStep pointed to a deleted step, snap to nearest prior retained step
    if (newStep === undefined) {
      // Find the highest retained stepOrder that was < oldStep
      const priorSteps = Array.from(stepOrderMap.entries())
        .filter(([old]) => old < oldStep)
        .sort((a, b) => b[0] - a[0]);

      if (priorSteps.length > 0) {
        newStep = priorSteps[0][1];
      } else {
        // No prior steps exist - snap to the first retained step (mark it as "completed")
        // This prevents the cron from re-executing what is now the first step
        const retainedStepOrders = Array.from(stepOrderMap.values());
        newStep = retainedStepOrders.length > 0 ? Math.min(...retainedStepOrders) : 0;
      }
    }

    if (newStep !== oldStep) {
      // Record for rollback
      artifact.instances.push({
        instanceId: inst.id,
        leadId: inst.leadId,
        sequenceId: seq.id,
        status: inst.status,
        currentStep: oldStep,
        nextStepDue: inst.nextStepDue?.toISOString() ?? null,
        pausedReason: inst.pausedReason,
      });

      await prisma.followUpInstance.update({
        where: { id: inst.id },
        data: { currentStep: newStep },
      });
      console.log(`    Instance ${inst.id}: currentStep ${oldStep} -> ${newStep}`);
    }
  }
}

async function disableNoResponseAndMigrateInstances(
  prisma: PrismaClient,
  clientId: string,
  noResponseSeq: { id: string; isActive: boolean; steps: Array<{ id: string; stepOrder: number; channel: string; dayOffset: number; minuteOffset: number }> },
  meetingRequestedSeq: { id: string; steps: Array<{ id: string; stepOrder: number; channel: string; dayOffset: number; minuteOffset: number }> } | null,
  artifact: RollbackArtifact,
  apply: boolean
): Promise<void> {
  // Disable No Response sequence
  if (noResponseSeq.isActive) {
    console.log("  Disabling 'No Response' sequence...");

    artifact.sequences.push({
      sequenceId: noResponseSeq.id,
      sequenceName: DEFAULT_SEQUENCE_NAMES.noResponse,
      clientId,
      isActive: true,
      steps: noResponseSeq.steps.map((s) => ({
        id: s.id,
        dayOffset: s.dayOffset,
        minuteOffset: s.minuteOffset,
        stepOrder: s.stepOrder,
        channel: s.channel,
        messageTemplate: null,
        subject: null,
        condition: null,
        requiresApproval: false,
      })),
      deletedStepIds: [],
    });

    if (apply) {
      await prisma.followUpSequence.update({
        where: { id: noResponseSeq.id },
        data: { isActive: false },
      });
      console.log("  Disabled 'No Response' sequence");
    } else {
      console.log("  [DRY-RUN] Would disable 'No Response' sequence");
    }
  } else {
    console.log("  'No Response' sequence already disabled");
  }

  // Find in-flight No Response instances
  const instances = await prisma.followUpInstance.findMany({
    where: {
      sequenceId: noResponseSeq.id,
      status: { in: ["active", "paused"] },
    },
    select: {
      id: true,
      leadId: true,
      status: true,
      currentStep: true,
      nextStepDue: true,
      startedAt: true,
      lastStepAt: true,
      pausedReason: true,
    },
  });

  if (instances.length === 0) {
    console.log("  No in-flight 'No Response' instances to migrate");
    return;
  }

  console.log(`  Found ${instances.length} in-flight 'No Response' instance(s) to migrate`);

  if (!meetingRequestedSeq) {
    console.log("  WARNING: No 'Meeting Requested' sequence exists - instances will be cancelled but not migrated");
    if (apply) {
      await prisma.followUpInstance.updateMany({
        where: { id: { in: instances.map((i) => i.id) } },
        data: {
          status: "cancelled",
          pausedReason: "no_migration_target",
          nextStepDue: null,
        },
      });
      console.log(`  Cancelled ${instances.length} instance(s)`);
    }
    return;
  }

  // Build step mapping: No Response step -> Meeting Requested step
  // Match by (dayOffset, minuteOffset, channel)
  const stepKeyMap = new Map<string, number>();
  for (const mrStep of meetingRequestedSeq.steps) {
    const key = `${mrStep.dayOffset}:${mrStep.minuteOffset}:${mrStep.channel}`;
    stepKeyMap.set(key, mrStep.stepOrder);
  }

  // Track old instance -> new instance mapping for task migration
  const instanceMigrationMap = new Map<string, string>();

  for (const inst of instances) {
    // Check if Meeting Requested instance already exists for this lead
    const existingMrInstance = await prisma.followUpInstance.findUnique({
      where: { leadId_sequenceId: { leadId: inst.leadId, sequenceId: meetingRequestedSeq.id } },
      select: { id: true },
    });

    if (existingMrInstance) {
      // Record for rollback (no new instance created)
      artifact.instances.push({
        instanceId: inst.id,
        leadId: inst.leadId,
        sequenceId: noResponseSeq.id,
        status: inst.status,
        currentStep: inst.currentStep,
        nextStepDue: inst.nextStepDue?.toISOString() ?? null,
        pausedReason: inst.pausedReason,
      });

      // Cancel No Response, tasks will be migrated to existing MR instance
      instanceMigrationMap.set(inst.id, existingMrInstance.id);

      if (apply) {
        await prisma.followUpInstance.update({
          where: { id: inst.id },
          data: {
            status: "cancelled",
            pausedReason: "migrated_to_meeting_requested",
            nextStepDue: null,
          },
        });
        console.log(`    Instance ${inst.id}: Cancelled (Meeting Requested already exists)`);
      } else {
        console.log(`    [DRY-RUN] Would cancel instance ${inst.id} (Meeting Requested already exists)`);
      }
      continue;
    }

    // Map currentStep
    let newCurrentStep = 0;
    if (inst.currentStep > 0) {
      const oldStep = noResponseSeq.steps.find((s) => s.stepOrder === inst.currentStep);
      if (oldStep) {
        const key = `${oldStep.dayOffset}:${oldStep.minuteOffset}:${oldStep.channel}`;
        newCurrentStep = stepKeyMap.get(key) ?? 0;
      }
    }

    // Special case: if currentStep === 0, set to "pre-Day-2 barrier"
    // so Day 1 SMS/LinkedIn are treated as completed (won't send for migrated leads)
    if (inst.currentStep === 0) {
      const day1Steps = meetingRequestedSeq.steps.filter((s) => s.dayOffset === 1);
      if (day1Steps.length > 0) {
        // Find highest Day 1 stepOrder
        newCurrentStep = Math.max(...day1Steps.map((s) => s.stepOrder));
      }
    }

    // Compute safe nextStepDue to prevent "instant send" regression
    // If nextStepDue is in the past or very soon, recompute based on startedAt + next step offset
    let safeNextStepDue = inst.nextStepDue;
    const now = new Date();
    const nextStep = meetingRequestedSeq.steps.find((s) => s.stepOrder === newCurrentStep + 1);
    if (nextStep && inst.startedAt) {
      const nextStepOffsetMs = computeStepOffsetMs({ dayOffset: nextStep.dayOffset, minuteOffset: nextStep.minuteOffset });
      const computedNextDue = new Date(inst.startedAt.getTime() + nextStepOffsetMs);

      // Safety: never pull nextStepDue earlier than existing value
      // Always use the LATER of (existing nextStepDue, computed nextStepDue)
      if (safeNextStepDue) {
        const maxTime = Math.max(computedNextDue.getTime(), safeNextStepDue.getTime());
        safeNextStepDue = new Date(maxTime);
      } else {
        safeNextStepDue = computedNextDue;
      }

      // Additional safety: if nextStepDue would be in the past, push to now + 5 minutes
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
      if (safeNextStepDue && safeNextStepDue < fiveMinutesFromNow) {
        safeNextStepDue = fiveMinutesFromNow;
      }
    }

    if (apply) {
      // Create new Meeting Requested instance preserving schedule
      const newInstance = await prisma.followUpInstance.create({
        data: {
          leadId: inst.leadId,
          sequenceId: meetingRequestedSeq.id,
          status: inst.status,
          currentStep: newCurrentStep,
          pausedReason: inst.pausedReason,
          startedAt: inst.startedAt,
          lastStepAt: inst.lastStepAt,
          nextStepDue: safeNextStepDue,
        },
      });

      // Track for task migration
      instanceMigrationMap.set(inst.id, newInstance.id);

      // Record for rollback (include new instance ID for deletion on rollback)
      artifact.instances.push({
        instanceId: inst.id,
        leadId: inst.leadId,
        sequenceId: noResponseSeq.id,
        status: inst.status,
        currentStep: inst.currentStep,
        nextStepDue: inst.nextStepDue?.toISOString() ?? null,
        pausedReason: inst.pausedReason,
        migratedToInstanceId: newInstance.id,
      });

      // Cancel old No Response instance
      await prisma.followUpInstance.update({
        where: { id: inst.id },
        data: {
          status: "cancelled",
          pausedReason: "migrated_to_meeting_requested",
          nextStepDue: null,
        },
      });

      const nextDueStr = safeNextStepDue ? safeNextStepDue.toISOString() : "null";
      console.log(`    Instance ${inst.id}: Migrated to Meeting Requested (currentStep: ${inst.currentStep} -> ${newCurrentStep}, nextStepDue: ${nextDueStr})`);
    } else {
      // Record for dry-run artifact preview
      artifact.instances.push({
        instanceId: inst.id,
        leadId: inst.leadId,
        sequenceId: noResponseSeq.id,
        status: inst.status,
        currentStep: inst.currentStep,
        nextStepDue: inst.nextStepDue?.toISOString() ?? null,
        pausedReason: inst.pausedReason,
      });
      console.log(`    [DRY-RUN] Would migrate instance ${inst.id} (currentStep: ${inst.currentStep} -> ${newCurrentStep})`);
    }
  }

  // Migrate pending tasks
  const tasks = await prisma.followUpTask.findMany({
    where: {
      instanceId: { in: instances.map((i) => i.id) },
      status: "pending",
    },
    select: { id: true, instanceId: true, stepOrder: true },
  });

  if (tasks.length === 0) {
    console.log("  No pending tasks to migrate");
    return;
  }

  console.log(`  Found ${tasks.length} pending task(s) to migrate`);

  // Build No Response step -> Meeting Requested step mapping by (dayOffset, minuteOffset, channel)
  const noResponseStepMap = new Map<number, { dayOffset: number; minuteOffset: number; channel: string }>();
  for (const step of noResponseSeq.steps) {
    noResponseStepMap.set(step.stepOrder, { dayOffset: step.dayOffset, minuteOffset: step.minuteOffset, channel: step.channel });
  }

  for (const task of tasks) {
    // Record original state for rollback
    artifact.tasks.push({
      taskId: task.id,
      instanceId: task.instanceId,
      stepOrder: task.stepOrder,
    });

    // Find the new instance this task should belong to
    const newInstanceId = task.instanceId ? instanceMigrationMap.get(task.instanceId) : null;
    if (!newInstanceId) {
      console.log(`    Task ${task.id}: No migration target found (instanceId: ${task.instanceId}) - skipping`);
      continue;
    }

    // Remap stepOrder using the step key map
    let newStepOrder: number | null = null;
    if (task.stepOrder !== null) {
      const oldStepInfo = noResponseStepMap.get(task.stepOrder);
      if (oldStepInfo) {
        const key = `${oldStepInfo.dayOffset}:${oldStepInfo.minuteOffset}:${oldStepInfo.channel}`;
        newStepOrder = stepKeyMap.get(key) ?? null;
      }
    }

    if (apply) {
      await prisma.followUpTask.update({
        where: { id: task.id },
        data: {
          instanceId: newInstanceId,
          stepOrder: newStepOrder,
        },
      });
      console.log(`    Task ${task.id}: Migrated (instanceId: ${task.instanceId} -> ${newInstanceId}, stepOrder: ${task.stepOrder} -> ${newStepOrder})`);
    } else {
      console.log(`    [DRY-RUN] Would migrate task ${task.id} (instanceId: ${task.instanceId} -> ${newInstanceId}, stepOrder: ${task.stepOrder} -> ${newStepOrder})`);
    }
  }
}

async function rollback(prisma: PrismaClient, artifactPath: string): Promise<void> {
  console.log(`Loading rollback artifact from: ${artifactPath}`);
  const content = await fs.readFile(artifactPath, "utf-8");
  const artifact: RollbackArtifact = JSON.parse(content);

  if (artifact.phase !== "66g") {
    throw new Error(`Invalid artifact phase: expected '66g', got '${artifact.phase}'`);
  }

  console.log(`Rolling back changes from ${artifact.createdAt}...`);
  console.log(`  Instances to restore: ${artifact.instances.length}`);
  console.log(`  Sequences to restore: ${artifact.sequences.length}`);
  console.log(`  Tasks to restore: ${artifact.tasks.length}`);
  console.log("");

  // Step 1: Restore tasks first (while new instances still exist)
  console.log("Step 1: Restoring tasks...");
  for (const task of artifact.tasks) {
    try {
      await prisma.followUpTask.update({
        where: { id: task.taskId },
        data: {
          instanceId: task.instanceId,
          stepOrder: task.stepOrder,
        },
      });
      console.log(`  Restored task ${task.taskId} (instanceId: ${task.instanceId}, stepOrder: ${task.stepOrder})`);
    } catch (err) {
      console.error(`  Failed to restore task ${task.taskId}:`, err);
    }
  }

  // Step 2: Delete migrated instances (the new Meeting Requested ones we created)
  console.log("\nStep 2: Deleting migrated instances...");
  const migratedInstanceIds = artifact.instances
    .filter((inst) => inst.migratedToInstanceId)
    .map((inst) => inst.migratedToInstanceId as string);

  if (migratedInstanceIds.length > 0) {
    // First delete any tasks that might reference these instances
    await prisma.followUpTask.deleteMany({
      where: { instanceId: { in: migratedInstanceIds } },
    });

    // Then delete the instances
    const deleteResult = await prisma.followUpInstance.deleteMany({
      where: { id: { in: migratedInstanceIds } },
    });
    console.log(`  Deleted ${deleteResult.count} migrated instance(s)`);
  } else {
    console.log("  No migrated instances to delete");
  }

  // Step 3: Restore original instances
  console.log("\nStep 3: Restoring original instances...");
  for (const inst of artifact.instances) {
    try {
      await prisma.followUpInstance.update({
        where: { id: inst.instanceId },
        data: {
          sequenceId: inst.sequenceId,
          status: inst.status as "active" | "paused" | "completed" | "cancelled",
          currentStep: inst.currentStep,
          nextStepDue: inst.nextStepDue ? new Date(inst.nextStepDue) : null,
          pausedReason: inst.pausedReason,
        },
      });
      console.log(`  Restored instance ${inst.instanceId}`);
    } catch (err) {
      console.error(`  Failed to restore instance ${inst.instanceId}:`, err);
    }
  }

  // Step 4: Restore sequences (isActive flag + deleted steps)
  console.log("\nStep 4: Restoring sequences...");
  for (const seq of artifact.sequences) {
    // Restore isActive flag
    await prisma.followUpSequence.update({
      where: { id: seq.sequenceId },
      data: { isActive: seq.isActive },
    });
    console.log(`  Restored sequence ${seq.sequenceName} (isActive: ${seq.isActive})`);

    // Recreate deleted steps
    if (seq.deletedStepIds.length > 0) {
      console.log(`  Recreating ${seq.deletedStepIds.length} deleted step(s)...`);

      // Find the step data for deleted steps
      const deletedSteps = seq.steps.filter((s) => seq.deletedStepIds.includes(s.id));

      // First, temporarily shift existing steps to negative values to make room
      const existingSteps = await prisma.followUpStep.findMany({
        where: { sequenceId: seq.sequenceId },
        select: { id: true, stepOrder: true },
      });

      // Shift to negative
      for (const step of existingSteps) {
        await prisma.followUpStep.update({
          where: { id: step.id },
          data: { stepOrder: -step.stepOrder - 1000 },
        });
      }

      // Recreate deleted steps with original stepOrder
      for (const step of deletedSteps) {
        try {
          await prisma.followUpStep.create({
            data: {
              id: step.id, // Preserve original ID
              sequenceId: seq.sequenceId,
              stepOrder: step.stepOrder,
              channel: step.channel,
              dayOffset: step.dayOffset,
              minuteOffset: step.minuteOffset,
              messageTemplate: step.messageTemplate,
              subject: step.subject,
              condition: step.condition ? JSON.stringify(step.condition) : null,
              requiresApproval: step.requiresApproval,
            },
          });
          console.log(`    Recreated step ${step.id} (order: ${step.stepOrder}, channel: ${step.channel})`);
        } catch (err) {
          console.error(`    Failed to recreate step ${step.id}:`, err);
        }
      }

      // Restore existing steps to their original stepOrder from artifact
      const originalStepOrders = new Map(seq.steps.map((s) => [s.id, s.stepOrder]));
      for (const step of existingSteps) {
        const originalOrder = originalStepOrders.get(step.id);
        if (originalOrder !== undefined) {
          await prisma.followUpStep.update({
            where: { id: step.id },
            data: { stepOrder: originalOrder },
          });
        } else {
          // Step wasn't in original artifact, keep its relative position
          await prisma.followUpStep.update({
            where: { id: step.id },
            data: { stepOrder: -step.stepOrder - 1000 }, // Undo the shift
          });
        }
      }

      console.log(`    Restored step ordering for ${seq.sequenceName}`);
    }
  }

  console.log("\nRollback complete");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const rollbackArg = args.find((a) => a === "--rollback");
  const rollbackIdx = args.indexOf("--rollback");
  const rollbackPath = rollbackIdx >= 0 ? args[rollbackIdx + 1] : null;
  const clientIdIdx = args.indexOf("--clientId");
  const targetClientId = clientIdIdx >= 0 ? args[clientIdIdx + 1] : undefined;

  const prisma = createPrismaClient();

  try {
    if (rollbackArg && rollbackPath) {
      await rollback(prisma, rollbackPath);
    } else {
      console.log(`Phase 66g Migration: ${apply ? "APPLYING" : "DRY-RUN"}`);
      if (targetClientId) {
        console.log(`Target client: ${targetClientId}`);
      }
      console.log("");

      const artifact = await migrate(prisma, apply, targetClientId);

      if (apply) {
        const artifactPath = `phase-66g-rollback-${Date.now()}.json`;
        await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2));
        console.log(`\nRollback artifact saved to: ${artifactPath}`);
      } else {
        console.log("\n[DRY-RUN] No changes applied. Run with --apply to apply changes.");
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
