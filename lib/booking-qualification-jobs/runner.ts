import "server-only";

import crypto from "crypto";
import { BookingQualificationJobStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  evaluateBookingQualification,
  executeBookingDisqualification,
  markLeadBookingQualified,
  toStoredQualificationAnswers,
} from "@/lib/booking-qualification";
import { getWorkspaceQualificationQuestions } from "@/lib/qualification-answer-extraction";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getBookingQualificationJobLimit(): number {
  return Math.min(200, parsePositiveInt(process.env.BOOKING_QUALIFICATION_JOB_CRON_LIMIT, 25));
}

function getBookingQualificationStaleLockMs(): number {
  return Math.max(
    60_000,
    parsePositiveInt(process.env.BOOKING_QUALIFICATION_JOB_STALE_LOCK_MS, 10 * 60_000)
  );
}

function getBookingQualificationTimeBudgetMs(): number {
  return Math.max(
    10_000,
    parsePositiveInt(process.env.BOOKING_QUALIFICATION_JOB_CRON_TIME_BUDGET_MS, 240_000)
  );
}

function getConfidenceThreshold(): number {
  const raw = Number.parseFloat(process.env.BOOKING_QUALIFICATION_MIN_CONFIDENCE || "");
  if (!Number.isFinite(raw)) return 0.7;
  return Math.max(0, Math.min(1, raw));
}

function computeRetryBackoffMs(attempt: number): number {
  const cappedAttempt = Math.max(1, Math.min(10, Math.floor(attempt)));
  const jitter = Math.floor(Math.random() * 1000);
  const base = Math.pow(2, cappedAttempt) * 1000;
  return Math.min(15 * 60_000, base + jitter);
}

function getStringField(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function runBookingQualificationJob(job: {
  id: string;
  clientId: string;
  leadId: string;
  provider: "CALENDLY" | "GHL";
  payload: unknown;
}): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: job.leadId },
    select: {
      id: true,
      clientId: true,
      qualificationAnswers: true,
      bookingQualificationStatus: true,
      bookingQualificationCheckedAt: true,
      client: {
        select: {
          settings: {
            select: {
              bookingQualificationCheckEnabled: true,
              bookingQualificationCriteria: true,
              idealCustomerProfile: true,
              serviceDescription: true,
            },
          },
        },
      },
    },
  });

  if (!lead) return;

  const currentStatus = (lead.bookingQualificationStatus || "").trim().toLowerCase();
  if (
    (currentStatus === "qualified" || currentStatus === "disqualified") &&
    lead.bookingQualificationCheckedAt
  ) {
    return;
  }

  const settings = lead.client.settings;
  const criteria = (settings?.bookingQualificationCriteria || "").trim();
  if (!settings?.bookingQualificationCheckEnabled || !criteria) {
    await markLeadBookingQualified({ leadId: lead.id, reason: "qualification_check_disabled_or_missing_criteria" });
    return;
  }

  const storedAnswers = toStoredQualificationAnswers(lead.qualificationAnswers);
  if (Object.keys(storedAnswers).length === 0) {
    await markLeadBookingQualified({ leadId: lead.id, reason: "no_qualification_answers" });
    return;
  }

  const workspaceQuestions = await getWorkspaceQualificationQuestions(lead.clientId);
  const questionById = new Map(workspaceQuestions.map((question) => [question.id, question.question] as const));
  const formAnswers: Record<string, { question: string; answer: string }> = {};
  for (const [questionId, value] of Object.entries(storedAnswers)) {
    const answer = (value?.answer || "").trim();
    if (!answer) continue;
    formAnswers[questionId] = {
      question: questionById.get(questionId) || questionId,
      answer,
    };
  }

  if (Object.keys(formAnswers).length === 0) {
    await markLeadBookingQualified({ leadId: lead.id, reason: "no_usable_qualification_answers" });
    return;
  }

  const evaluation = await evaluateBookingQualification({
    clientId: lead.clientId,
    leadId: lead.id,
    formAnswers,
    qualificationCriteria: criteria,
    idealCustomerProfile: settings.idealCustomerProfile,
    serviceDescription: settings.serviceDescription,
  });

  if (!evaluation) {
    await markLeadBookingQualified({ leadId: lead.id, reason: "evaluation_unavailable" });
    return;
  }

  if (evaluation.qualified) {
    await markLeadBookingQualified({
      leadId: lead.id,
      reason: evaluation.reasoning || "qualified",
    });
    return;
  }

  if (evaluation.confidence < getConfidenceThreshold()) {
    await markLeadBookingQualified({
      leadId: lead.id,
      reason: `fail_open_low_confidence:${evaluation.confidence.toFixed(2)}`,
    });
    return;
  }

  const payload = job.payload && typeof job.payload === "object" ? (job.payload as Record<string, unknown>) : {};
  const disqualified = await executeBookingDisqualification({
    clientId: lead.clientId,
    leadId: lead.id,
    provider: job.provider,
    scheduledEventUri: getStringField(payload, "scheduledEventUri"),
    ghlAppointmentId: getStringField(payload, "ghlAppointmentId"),
    reasoning: evaluation.reasoning,
    disqualificationReasons: evaluation.disqualificationReasons,
  });

  if (!disqualified.success) {
    throw new Error(disqualified.error || "booking_disqualification_failed");
  }
}

export async function processBookingQualificationJobs(opts?: {
  invocationId?: string;
  deadlineMs?: number;
}): Promise<{
  releasedStale: number;
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  skipped: number;
  remaining: number;
}> {
  const startedAtMs = Date.now();
  const deadlineMs = opts?.deadlineMs ?? startedAtMs + getBookingQualificationTimeBudgetMs();
  const invocationId = opts?.invocationId ?? crypto.randomUUID();

  const staleCutoff = new Date(Date.now() - getBookingQualificationStaleLockMs());
  const released = await prisma.bookingQualificationJob.updateMany({
    where: { status: BookingQualificationJobStatus.RUNNING, lockedAt: { lt: staleCutoff } },
    data: {
      status: BookingQualificationJobStatus.PENDING,
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      runAt: new Date(),
      lastError: "Released stale RUNNING lock",
    },
  });

  const due = await prisma.bookingQualificationJob.findMany({
    where: { status: BookingQualificationJobStatus.PENDING, runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: getBookingQualificationJobLimit(),
    select: { id: true },
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;

  for (const row of due) {
    if (Date.now() > deadlineMs - 7_500) break;

    const lockAt = new Date();
    const locked = await prisma.bookingQualificationJob.updateMany({
      where: { id: row.id, status: BookingQualificationJobStatus.PENDING },
      data: {
        status: BookingQualificationJobStatus.RUNNING,
        lockedAt: lockAt,
        lockedBy: invocationId,
        startedAt: lockAt,
        attempts: { increment: 1 },
      },
    });
    if (locked.count === 0) continue;

    const job = await prisma.bookingQualificationJob.findUnique({
      where: { id: row.id },
      select: {
        id: true,
        clientId: true,
        leadId: true,
        provider: true,
        payload: true,
        attempts: true,
        maxAttempts: true,
      },
    });
    if (!job) continue;

    processed++;

    try {
      await runBookingQualificationJob({
        id: job.id,
        clientId: job.clientId,
        leadId: job.leadId,
        provider: job.provider,
        payload: job.payload,
      });

      await prisma.bookingQualificationJob.update({
        where: { id: job.id },
        data: {
          status: BookingQualificationJobStatus.SUCCEEDED,
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      succeeded++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 10_000);
      const shouldRetry = job.attempts < job.maxAttempts;

      await prisma.bookingQualificationJob.update({
        where: { id: job.id },
        data: {
          status: shouldRetry ? BookingQualificationJobStatus.PENDING : BookingQualificationJobStatus.FAILED,
          runAt: shouldRetry ? new Date(Date.now() + computeRetryBackoffMs(job.attempts)) : new Date(),
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: message,
        },
      });

      if (shouldRetry) retried++;
      else failed++;
    }
  }

  const remaining = await prisma.bookingQualificationJob.count({
    where: { status: BookingQualificationJobStatus.PENDING, runAt: { lte: new Date() } },
  });

  return {
    releasedStale: released.count,
    processed,
    succeeded,
    failed,
    retried,
    skipped,
    remaining,
  };
}
