import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autoStartPostBookingSequenceIfEligible } from "@/lib/followup-automation";
import { pauseFollowUpsOnBooking } from "@/lib/followup-engine";
import { verifyCalendlyWebhookSignature } from "@/lib/calendly-webhook";
import { upsertAppointmentWithRollup } from "@/lib/appointment-upsert";
import { AppointmentStatus, AppointmentSource } from "@prisma/client";
import { createCancellationTask } from "@/lib/appointment-cancellation-task";

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

  return { inviteeUri, inviteeEmail, inviteeName, scheduledEventUri, eventTypeUri, startTime, endTime };
}

async function applyPostBookingSideEffects(leadId: string) {
  await autoStartPostBookingSequenceIfEligible({ leadId });
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

  // Signature verification: Calendly only provides signing keys for OAuth apps, not Personal Access Tokens.
  // When no signing key is available, we accept the webhook but log a warning.
  const signingKey = client.calendlyWebhookSigningKey || process.env.CALENDLY_WEBHOOK_SIGNING_KEY || null;
  if (signingKey) {
    const verified = verifyCalendlyWebhookSignature({ signingKey, headers: request.headers, rawBody });
    if (!verified.ok) {
      return NextResponse.json({ error: "Unauthorized", reason: verified.reason }, { status: 401 });
    }
  } else {
    // No signing key available - accept webhook but log warning
    // This is expected for clients using Personal Access Tokens instead of OAuth
    console.warn("[Calendly Webhook] No signing key configured for client", clientId, "- accepting webhook without signature verification");
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

  const { inviteeUri, inviteeEmail, scheduledEventUri, eventTypeUri, startTime, endTime } = parseInviteePayload(parsed?.payload);

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

  // Optional: filter by configured event type if present (avoids noise if org has many event types).
  if (lead && eventTypeUri) {
    const settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: { calendlyEventTypeUri: true },
    });
    if (settings?.calendlyEventTypeUri && settings.calendlyEventTypeUri !== eventTypeUri) {
      return NextResponse.json({ ok: true, ignored: true, reason: "event_type_mismatch" }, { status: 200 });
    }
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

    await applyPostBookingSideEffects(lead.id);

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
