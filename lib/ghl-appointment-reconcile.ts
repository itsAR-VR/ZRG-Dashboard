/**
 * GHL Appointment Reconciliation (Phase 28b)
 *
 * Detects and records GHL appointments for leads by looking up appointments via
 * the lead's ghlContactId. Used by both cron reconciliation and backfill scripts.
 *
 * Key behaviors:
 * - Read-only with GHL (no creating/updating appointments via this module)
 * - Idempotent: safe to run multiple times on the same lead
 * - Respects rate limits via lib/ghl-api.ts throttling
 * - Logs only IDs, never PII
 */

import { prisma } from "@/lib/prisma";
import { getGHLContactAppointments, getGHLAppointment, type GHLAppointment } from "@/lib/ghl-api";
import {
  APPOINTMENT_STATUS,
  APPOINTMENT_SOURCE,
  type AppointmentSource,
} from "@/lib/meeting-lifecycle";
import { autoStartPostBookingSequenceIfEligible } from "@/lib/followup-automation";
import { createCancellationTask } from "@/lib/appointment-cancellation-task";
import { upsertAppointmentWithRollup, mapStringToAppointmentStatus } from "@/lib/appointment-upsert";
import { AppointmentSource as PrismaAppointmentSource, AppointmentStatus } from "@prisma/client";

export interface GHLReconcileResult {
  leadId: string;
  status: "booked" | "canceled" | "no_change" | "no_appointments" | "error" | "skipped";
  appointmentId?: string;
  appointmentStatus?: string;
  startTime?: string;
  endTime?: string;
  error?: string;
  wasTransition?: boolean; // true if this reconciliation changed the lead's booking state
}

export interface GHLReconcileOptions {
  source?: AppointmentSource;
  dryRun?: boolean;
  skipSideEffects?: boolean; // Skip follow-up automation side effects
}

/**
 * Select the "primary" appointment from a list.
 * Prefers:
 * 1. Next upcoming non-canceled appointment (start time > now)
 * 2. Most recently scheduled non-canceled appointment
 * 3. If all canceled, the most recently canceled one (for audit)
 */
export function selectPrimaryAppointment(appointments: GHLAppointment[]): GHLAppointment | null {
  if (!appointments?.length) return null;

  const now = new Date();

  // Separate canceled from active
  const active = appointments.filter(
    (a) => a.appointmentStatus?.toLowerCase() !== "cancelled" && a.appointmentStatus?.toLowerCase() !== "canceled"
  );
  const canceled = appointments.filter(
    (a) => a.appointmentStatus?.toLowerCase() === "cancelled" || a.appointmentStatus?.toLowerCase() === "canceled"
  );

  if (active.length > 0) {
    // Sort by start time ascending
    const sorted = [...active].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    // Find next upcoming
    const upcoming = sorted.find((a) => new Date(a.startTime) > now);
    if (upcoming) return upcoming;

    // Otherwise return most recent (last in sorted = latest start time)
    return sorted[sorted.length - 1];
  }

  if (canceled.length > 0) {
    // Return most recently scheduled canceled appointment
    const sorted = [...canceled].sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
    return sorted[0];
  }

  return null;
}

/**
 * Normalize GHL appointment status to our schema values.
 */
export function normalizeGHLAppointmentStatus(ghlStatus: string | undefined): string {
  const lower = (ghlStatus || "").toLowerCase();
  if (lower === "cancelled" || lower === "canceled") return APPOINTMENT_STATUS.CANCELED;
  if (lower === "confirmed" || lower === "booked") return APPOINTMENT_STATUS.CONFIRMED;
  if (lower === "showed" || lower === "completed") return APPOINTMENT_STATUS.SHOWED;
  if (lower === "no_show" || lower === "noshow" || lower === "no-show") return APPOINTMENT_STATUS.NO_SHOW;
  // Default to confirmed for unknown statuses (e.g., "new", "pending")
  return APPOINTMENT_STATUS.CONFIRMED;
}

/**
 * Map AppointmentSource string to Prisma enum
 */
function mapSourceToPrismaEnum(source: AppointmentSource): PrismaAppointmentSource {
  switch (source) {
    case APPOINTMENT_SOURCE.WEBHOOK:
      return PrismaAppointmentSource.WEBHOOK;
    case APPOINTMENT_SOURCE.RECONCILE_CRON:
      return PrismaAppointmentSource.RECONCILE_CRON;
    case APPOINTMENT_SOURCE.BACKFILL:
      return PrismaAppointmentSource.BACKFILL;
    case APPOINTMENT_SOURCE.AUTO_BOOK:
      return PrismaAppointmentSource.AUTO_BOOK;
    case APPOINTMENT_SOURCE.MANUAL:
      return PrismaAppointmentSource.MANUAL;
    default:
      return PrismaAppointmentSource.RECONCILE_CRON;
  }
}

/**
 * Reconcile a single lead's GHL appointment status.
 *
 * Looks up appointments for the lead's ghlContactId, selects the primary one,
 * and updates the lead's appointment tracking fields if needed.
 */
export async function reconcileGHLAppointmentForLead(
  leadId: string,
  opts: GHLReconcileOptions = {}
): Promise<GHLReconcileResult> {
  const source = opts.source || APPOINTMENT_SOURCE.RECONCILE_CRON;

  try {
    // Load lead with required fields
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        ghlContactId: true,
        ghlAppointmentId: true,
        appointmentStatus: true,
        appointmentBookedAt: true,
        status: true,
        clientId: true,
        client: {
          select: {
            ghlLocationId: true,
            ghlPrivateKey: true,
          },
        },
      },
    });

    if (!lead) {
      return { leadId, status: "error", error: "Lead not found" };
    }

    // Skip if no GHL credentials
    if (!lead.client.ghlPrivateKey || !lead.client.ghlLocationId) {
      return { leadId, status: "skipped", error: "No GHL credentials configured" };
    }

    // Skip if no ghlContactId
    if (!lead.ghlContactId) {
      return { leadId, status: "skipped", error: "No ghlContactId" };
    }

    // Fetch appointments from GHL
    const appointmentsResult = await getGHLContactAppointments(
      lead.ghlContactId,
      lead.client.ghlPrivateKey,
      { locationId: lead.client.ghlLocationId }
    );

    if (!appointmentsResult.success) {
      console.error(`[GHL Reconcile] Failed to fetch appointments for lead ${leadId}:`, appointmentsResult.error);
      return { leadId, status: "error", error: appointmentsResult.error };
    }

    const appointments = appointmentsResult.data?.events || [];

    if (appointments.length === 0) {
      // No appointments found - update watermark only
      if (!opts.dryRun) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { appointmentLastCheckedAt: new Date() },
        });
      }
      return { leadId, status: "no_appointments" };
    }

    // Select primary appointment
    const primary = selectPrimaryAppointment(appointments);
    if (!primary) {
      if (!opts.dryRun) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { appointmentLastCheckedAt: new Date() },
        });
      }
      return { leadId, status: "no_appointments" };
    }

    const normalizedStatus = normalizeGHLAppointmentStatus(primary.appointmentStatus);
    const isCanceled = normalizedStatus === APPOINTMENT_STATUS.CANCELED;

    // Check if this is a state transition
    const wasBooked = lead.appointmentStatus === APPOINTMENT_STATUS.CONFIRMED || Boolean(lead.ghlAppointmentId && lead.appointmentStatus !== APPOINTMENT_STATUS.CANCELED);
    const wasCanceled = lead.appointmentStatus === APPOINTMENT_STATUS.CANCELED;
    const isNewBooking = !wasBooked && !isCanceled;
    const isNewCancellation = wasBooked && isCanceled;
    const appointmentIdChanged = lead.ghlAppointmentId !== primary.id;

    // Determine if we need to update
    const needsUpdate =
      appointmentIdChanged ||
      lead.appointmentStatus !== normalizedStatus ||
      !lead.appointmentBookedAt;

    if (!needsUpdate) {
      // Just update the watermark
      if (!opts.dryRun) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { appointmentLastCheckedAt: new Date() },
        });
      }
      return {
        leadId,
        status: "no_change",
        appointmentId: primary.id,
        appointmentStatus: normalizedStatus,
      };
    }

    // Build update data
    const startTime = new Date(primary.startTime);
    const endTime = new Date(primary.endTime);

    // Dual-write: upsert Appointment + update Lead rollups atomically (Phase 34c)
    if (!opts.dryRun) {
      await upsertAppointmentWithRollup({
        leadId,
        provider: "GHL",
        source: mapSourceToPrismaEnum(source),
        ghlAppointmentId: primary.id,
        startAt: startTime,
        endAt: endTime,
        status: mapStringToAppointmentStatus(normalizedStatus),
        canceledAt: isCanceled ? new Date() : null,
      });

      // Apply side effects for new bookings (not for cancellations, not for updates to existing bookings)
      if (isNewBooking && !opts.skipSideEffects) {
        // Start post-booking sequence
        await autoStartPostBookingSequenceIfEligible({ leadId });

        // Complete/stop non-booking follow-up instances
        const activeInstances = await prisma.followUpInstance.findMany({
          where: {
            leadId,
            status: { in: ["active", "paused"] },
            sequence: { triggerOn: { not: "meeting_selected" } },
          },
          select: { id: true },
        });

        if (activeInstances.length > 0) {
          await prisma.followUpInstance.updateMany({
            where: { id: { in: activeInstances.map((i) => i.id) } },
            data: {
              status: "completed",
              completedAt: new Date(),
              nextStepDue: null,
            },
          });
        }
      }

      // Create cancellation task for new cancellations (surface in Follow-ups UI)
      if (isNewCancellation && !opts.skipSideEffects) {
        await createCancellationTask({
          leadId,
          taskType: "meeting-canceled",
          appointmentStartTime: startTime,
          provider: "GHL",
        });
      }
    }

    return {
      leadId,
      status: isCanceled ? "canceled" : "booked",
      appointmentId: primary.id,
      appointmentStatus: normalizedStatus,
      startTime: primary.startTime,
      endTime: primary.endTime,
      wasTransition: isNewBooking || isNewCancellation,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[GHL Reconcile] Error reconciling lead ${leadId}:`, message);
    return { leadId, status: "error", error: message };
  }
}

/**
 * Reconcile an existing GHL appointment by ID.
 * Used when we already have ghlAppointmentId and want to refresh its status.
 */
export async function reconcileGHLAppointmentById(
  leadId: string,
  appointmentId: string,
  opts: GHLReconcileOptions = {}
): Promise<GHLReconcileResult> {
  const source = opts.source || APPOINTMENT_SOURCE.RECONCILE_CRON;

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        ghlAppointmentId: true,
        appointmentStatus: true,
        appointmentBookedAt: true,
        status: true,
        clientId: true,
        client: {
          select: {
            ghlLocationId: true,
            ghlPrivateKey: true,
          },
        },
      },
    });

    if (!lead) {
      return { leadId, status: "error", error: "Lead not found" };
    }

    if (!lead.client.ghlPrivateKey) {
      return { leadId, status: "skipped", error: "No GHL credentials configured" };
    }

    const appointmentResult = await getGHLAppointment(
      appointmentId,
      lead.client.ghlPrivateKey,
      { locationId: lead.client.ghlLocationId || undefined }
    );

    if (!appointmentResult.success) {
      // Appointment not found or error - might be deleted
      console.warn(`[GHL Reconcile] Appointment ${appointmentId} not found for lead ${leadId}`);
      return { leadId, status: "error", error: appointmentResult.error };
    }

    const appointment = appointmentResult.data;
    if (!appointment) {
      return { leadId, status: "no_appointments" };
    }

    const normalizedStatus = normalizeGHLAppointmentStatus(appointment.appointmentStatus);
    const isCanceled = normalizedStatus === APPOINTMENT_STATUS.CANCELED;

    const startTime = new Date(appointment.startTime);
    const endTime = new Date(appointment.endTime);

    // Dual-write: upsert Appointment + update Lead rollups atomically (Phase 34c)
    if (!opts.dryRun) {
      await upsertAppointmentWithRollup({
        leadId,
        provider: "GHL",
        source: mapSourceToPrismaEnum(source),
        ghlAppointmentId: appointment.id,
        startAt: startTime,
        endAt: endTime,
        status: mapStringToAppointmentStatus(normalizedStatus),
        canceledAt: isCanceled ? new Date() : null,
      });
    }

    return {
      leadId,
      status: isCanceled ? "canceled" : "booked",
      appointmentId: appointment.id,
      appointmentStatus: normalizedStatus,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[GHL Reconcile] Error reconciling appointment ${appointmentId} for lead ${leadId}:`, message);
    return { leadId, status: "error", error: message };
  }
}
