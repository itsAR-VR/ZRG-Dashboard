import "server-only";

import { BookingQualificationProvider, Prisma } from "@prisma/client";
import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";

export interface EnqueueBookingQualificationJobParams {
  clientId: string;
  leadId: string;
  provider: BookingQualificationProvider;
  anchorId: string;
  payload?: Record<string, unknown> | null;
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

export function buildBookingQualificationDedupeKey(params: {
  clientId: string;
  leadId: string;
  provider: BookingQualificationProvider;
  anchorId: string;
}): string {
  return `${params.clientId}:${params.leadId}:${params.provider}:${params.anchorId}`;
}

export async function enqueueBookingQualificationJob(
  params: EnqueueBookingQualificationJobParams
): Promise<boolean> {
  const anchorId = (params.anchorId || "").trim();
  if (!anchorId) return false;

  const dedupeKey =
    params.dedupeKey?.trim() ||
    buildBookingQualificationDedupeKey({
      clientId: params.clientId,
      leadId: params.leadId,
      provider: params.provider,
      anchorId,
    });

  try {
    await prisma.bookingQualificationJob.create({
      data: {
        clientId: params.clientId,
        leadId: params.leadId,
        provider: params.provider,
        anchorId,
        dedupeKey,
        payload: (params.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        status: "PENDING",
        runAt: params.runAt ?? new Date(),
        maxAttempts: params.maxAttempts ?? 3,
      },
    });
    return true;
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) return false;
    throw error;
  }
}
