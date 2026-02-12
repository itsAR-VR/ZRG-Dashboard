import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autoStartPostBookingSequenceIfEligible } from "@/lib/followup-automation";
import { pauseFollowUpsOnBooking } from "@/lib/followup-engine";
import { verifyCalendlyWebhookSignature } from "@/lib/calendly-webhook";
import { upsertAppointmentWithRollup } from "@/lib/appointment-upsert";
import { AppointmentStatus, AppointmentSource } from "@prisma/client";
import { createCancellationTask } from "@/lib/appointment-cancellation-task";
import {
  markLeadBookingQualificationPending,
  storeBookingFormAnswersOnLead,
} from "@/lib/booking-qualification";
import {
  buildBookingQualificationDedupeKey,
  enqueueBookingQualificationJob,
} from "@/lib/booking-qualification-jobs/enqueue";

type CalendlyWebhookEnvelope = {
  event?: string;
  payload?: unknown;
};

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function getObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getNested(obj: Record<string, unknown> | null, key: string): unknown {
  if (!obj) return null;
  return obj[key];
}

function parseInviteePayload(payload: unknown): {
  inviteeUri: string | null;
  inviteeEmail: string | null;
  inviteeName: string | null;
  scheduledEventUri: string | null;
  eventTypeUri: string | null;
  startTime: string | null;
  endTime: string | null;
  questionsAndAnswers: Array<{ question: string; answer: string; position: number }>;
} {
  const root = getObject(payload);
  const invitee = getObject(getNested(root, "invitee"));
  const scheduledEvent = getObject(getNested(root, "scheduled_event")) ?? getObject(getNested(root, "scheduledEvent"));

  const inviteeUri = getString(getNested(invitee, "uri"));
  const inviteeEmail = getString(getNested(invitee, "email"))?.toLowerCase() ?? null;
  const inviteeName = getString(getNested(invitee, "name"));

  const scheduledEventUri = getString(getNested(scheduledEvent, "uri"));
  const eventTypeUri =
    getString(getNested(scheduledEvent, "event_type")) ??
    getString(getNested(scheduledEvent, "eventType"));

  const startTime = getString(getNested(scheduledEvent, "start_time")) ?? getString(getNested(scheduledEvent, "startTime"));
  const endTime = getString(getNested(scheduledEvent, "end_time")) ?? getString(getNested(scheduledEvent, "endTime"));
  const questionsAndAnswersRaw = getNested(invitee, "questions_and_answers");
  const questionsAndAnswers = Array.isArray(questionsAndAnswersRaw)
    ? questionsAndAnswersRaw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          question: typeof item.question === "string" ? item.question.trim() : "",
          answer: typeof item.answer === "string" ? item.answer.trim() : "",
          position: typeof item.position === "number" && Number.isFinite(item.position) ? Math.trunc(item.position) : 0,
        }))
        .filter((item) => item.question && item.answer)
    : [];

  return {
    inviteeUri,
    inviteeEmail,
    inviteeName,
    scheduledEventUri,
    eventTypeUri,
    startTime,
    endTime,
    questionsAndAnswers,
  };
}

async function applyPostBookingSideEffects(leadId: string, opts?: { skipAutoStart?: boolean }) {
  if (!opts?.skipAutoStart) {
    await autoStartPostBookingSequenceIfEligible({ leadId });
  }
  await pauseFollowUpsOnBooking(leadId, { mode: "complete" });
}

export async function POST(request: NextRequest, context: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await context.params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      calendlyWebhookSigningKey: true,
      calendlyWebhookSubscriptionUri: true,
    },
  });

  if (!client) {
    return NextResponse.json({ error: "Unknown workspace" }, { status: 404 });
  }

  const rawBody = await request.text();

  const vercelEnv = process.env.VERCEL_ENV;
  const isProduction = vercelEnv ? vercelEnv === "production" : process.env.NODE_ENV === "production";

  // Signature verification is required in production to prevent forged invitee events.
  const signingKey = client.calendlyWebhookSigningKey || process.env.CALENDLY_WEBHOOK_SIGNING_KEY || null;
  if (!signingKey) {
    if (isProduction) {
      console.error("[Calendly Webhook] Missing signing key in production for client", clientId);
      return NextResponse.json({ error: "Server misconfigured: missing Calendly webhook signing key" }, { status: 500 });
    }
    console.warn("[Calendly Webhook] No signing key configured for client", clientId, "- accepting webhook without signature verification (non-production)");
  } else {
    const verified = verifyCalendlyWebhookSignature({ signingKey, headers: request.headers, rawBody });
    if (!verified.ok) {
      console.warn("[Calendly Webhook] Invalid signature for client", clientId, "-", verified.reason);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let parsed: CalendlyWebhookEnvelope | null = null;
  try {
    parsed = JSON.parse(rawBody) as CalendlyWebhookEnvelope;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = getString(parsed?.event);
  if (!event) {
    return NextResponse.json({ ok: true, ignored: true, reason: "missing_event" }, { status: 200 });
  }

  const { inviteeUri, inviteeEmail, scheduledEventUri, eventTypeUri, startTime, endTime, questionsAndAnswers } =
    parseInviteePayload(parsed?.payload);

  // Try to map to a lead deterministically (IDs first, then email fallback).
  let lead =
    (inviteeUri
      ? await prisma.lead.findUnique({
          where: { calendlyInviteeUri: inviteeUri },
          select: { id: true, status: true },
        })
      : null) ||
    (scheduledEventUri
      ? await prisma.lead.findUnique({
          where: { calendlyScheduledEventUri: scheduledEventUri },
          select: { id: true, status: true },
        })
      : null) ||
    (inviteeEmail
      ? await prisma.lead.findFirst({
          where: { clientId, email: { equals: inviteeEmail, mode: "insensitive" } },
          orderBy: { updatedAt: "desc" },
          select: { id: true, status: true },
        })
      : null);

  const settings = lead
    ? await prisma.workspaceSettings.findUnique({
        where: { clientId },
        select: {
          calendlyEventTypeUri: true,
          calendlyDirectBookEventTypeUri: true,
          bookingQualificationCheckEnabled: true,
          bookingQualificationCriteria: true,
        },
      })
    : null;

  // Optional: filter by configured event types if present (avoids noise if org has many event types).
  const allowedEventTypeUris = [
    (settings?.calendlyEventTypeUri || "").trim(),
    (settings?.calendlyDirectBookEventTypeUri || "").trim(),
  ].filter(Boolean);
  if (eventTypeUri && allowedEventTypeUris.length > 0 && !allowedEventTypeUris.includes(eventTypeUri)) {
    return NextResponse.json({ ok: true, ignored: true, reason: "event_type_mismatch" }, { status: 200 });
  }

  if (!lead) {
    return NextResponse.json({ ok: true, ignored: true, reason: "lead_not_found" }, { status: 200 });
  }

  if (event === "invitee.created") {
    const appointmentStartAt = startTime ? new Date(startTime) : null;
    const appointmentEndAt = endTime ? new Date(endTime) : null;

    // Dual-write: create Appointment + update Lead rollups atomically (Phase 34d)
    if (inviteeUri) {
      await upsertAppointmentWithRollup({
        leadId: lead.id,
        provider: "CALENDLY",
        source: AppointmentSource.WEBHOOK,
        calendlyInviteeUri: inviteeUri,
        calendlyScheduledEventUri: scheduledEventUri,
        calendlyEventTypeUri: eventTypeUri,
        startAt: appointmentStartAt,
        endAt: appointmentEndAt,
        status: AppointmentStatus.CONFIRMED,
      });
    } else {
      // Fallback: update lead directly if no invitee URI (legacy support)
      const bookedSlot = startTime ? new Date(startTime).toISOString() : null;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          calendlyScheduledEventUri: scheduledEventUri,
          appointmentBookedAt: new Date(),
          appointmentStartAt,
          appointmentEndAt,
          appointmentStatus: "confirmed",
          appointmentProvider: "CALENDLY",
          appointmentSource: "webhook",
          bookedSlot: bookedSlot || startTime,
          status: "meeting-booked",
          offeredSlots: null,
        },
      });
    }

    const qualificationEventTypeUri = (settings?.calendlyEventTypeUri || "").trim();
    const shouldRunQualificationCheck =
      Boolean(settings?.bookingQualificationCheckEnabled) &&
      Boolean((settings?.bookingQualificationCriteria || "").trim()) &&
      Boolean(eventTypeUri && qualificationEventTypeUri && eventTypeUri === qualificationEventTypeUri) &&
      questionsAndAnswers.length > 0;

    if (shouldRunQualificationCheck) {
      await storeBookingFormAnswersOnLead({
        leadId: lead.id,
        clientId,
        questionsAndAnswers,
      });
      await markLeadBookingQualificationPending(lead.id);

      const anchorId =
        (inviteeUri || "").trim() || (scheduledEventUri || "").trim() || `${lead.id}:calendly:${eventTypeUri || "unknown"}`;
      await enqueueBookingQualificationJob({
        clientId,
        leadId: lead.id,
        provider: "CALENDLY",
        anchorId,
        dedupeKey: buildBookingQualificationDedupeKey({
          clientId,
          leadId: lead.id,
          provider: "CALENDLY",
          anchorId,
        }),
        payload: {
          inviteeUri: inviteeUri || null,
          scheduledEventUri: scheduledEventUri || null,
          eventTypeUri: eventTypeUri || null,
        },
      });
    }

    await applyPostBookingSideEffects(lead.id, { skipAutoStart: shouldRunQualificationCheck });

    return NextResponse.json(
      { ok: true, handled: true, event, leadId: lead.id, calendlyInviteeUri: inviteeUri, calendlyScheduledEventUri: scheduledEventUri },
      { status: 200 }
    );
  }

  if (event === "invitee.canceled") {
    // Look up existing appointment start time for cancellation task
    let appointmentStartTime: Date | null = null;
    const existingLead = await prisma.lead.findUnique({
      where: { id: lead.id },
      select: { appointmentStartAt: true, calendlyInviteeUri: true },
    });
    appointmentStartTime = existingLead?.appointmentStartAt ?? (startTime ? new Date(startTime) : null);

    // Dual-write: update Appointment + Lead rollups atomically (Phase 34d)
    const targetInviteeUri = inviteeUri || existingLead?.calendlyInviteeUri;
    if (targetInviteeUri) {
      await upsertAppointmentWithRollup({
        leadId: lead.id,
        provider: "CALENDLY",
        source: AppointmentSource.WEBHOOK,
        calendlyInviteeUri: targetInviteeUri,
        calendlyScheduledEventUri: scheduledEventUri,
        calendlyEventTypeUri: eventTypeUri,
        startAt: appointmentStartTime,
        endAt: endTime ? new Date(endTime) : null,
        status: AppointmentStatus.CANCELED,
        canceledAt: new Date(),
      });

      // Create cancellation task for follow-up
      if (appointmentStartTime) {
        await createCancellationTask({
          leadId: lead.id,
          taskType: "meeting-canceled",
          appointmentStartTime,
          provider: "CALENDLY",
        });
      }

      // No resume on cancellation when using completion semantics.
    } else {
      // Fallback: update lead directly if no invitee URI (legacy support)
      const nextStatus = lead.status === "meeting-booked" ? "qualified" : lead.status;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          appointmentStatus: "canceled",
          appointmentCanceledAt: new Date(),
          status: nextStatus,
          offeredSlots: null,
        },
      });
    }

    return NextResponse.json({ ok: true, handled: true, event, leadId: lead.id }, { status: 200 });
  }

  return NextResponse.json({ ok: true, ignored: true, event }, { status: 200 });
}

export async function GET(_: NextRequest, context: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await context.params;
  return NextResponse.json(
    {
      ok: true,
      message: "Calendly webhook endpoint",
      clientId,
    },
    { status: 200 }
  );
}
