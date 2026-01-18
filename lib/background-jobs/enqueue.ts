import "server-only";

import { BackgroundJobType } from "@prisma/client";
import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";

export interface EnqueueJobParams {
  type: BackgroundJobType;
  clientId: string;
  leadId: string;
  messageId: string;
  dedupeKey: string;
  runAt?: Date;
  maxAttempts?: number;
}

/**
 * Enqueues a background job for async processing.
 * Uses dedupeKey to prevent duplicate jobs.
 * Returns true if job was enqueued, false if duplicate skipped.
 */
export async function enqueueBackgroundJob(params: EnqueueJobParams): Promise<boolean> {
  try {
    await prisma.backgroundJob.create({
      data: {
        type: params.type,
        clientId: params.clientId,
        leadId: params.leadId,
        messageId: params.messageId,
        dedupeKey: params.dedupeKey,
        status: "PENDING",
        runAt: params.runAt ?? new Date(),
        maxAttempts: params.maxAttempts ?? 5,
        attempts: 0,
      },
    });

    console.log(`[Background Jobs] Enqueued ${params.type} for message ${params.messageId}`);
    return true;
  } catch (error) {
    // Unique constraint violation on dedupeKey means job already enqueued
    if (isPrismaUniqueConstraintError(error)) {
      console.log(`[Background Jobs] Job already enqueued (dedupe): ${params.dedupeKey}`);
      return false;
    }

    throw error;
  }
}

/**
 * Generates a deterministic dedupe key for a job.
 * Format: {clientId}:{messageId}:{jobType}
 */
export function buildJobDedupeKey(
  clientId: string,
  messageId: string,
  jobType: BackgroundJobType
): string {
  return `${clientId}:${messageId}:${jobType}`;
}
