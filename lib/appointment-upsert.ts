/**
 * Appointment Upsert Helper (Phase 34c)
 *
 * Shared helper for upserting appointments and updating lead rollups atomically.
 * Used by reconciliation modules, webhooks, and auto-booking.
 *
 * Key behaviors:
 * - Idempotent upsert keyed by provider external identifier
 * - Uses transactions to prevent partial writes
 * - Updates lead rollups from the selected "primary appointment"
 * - Preserves existing side-effect logic (follow-up gating, cancellation tasks)
 */

import { prisma } from "@/lib/prisma";
import { AppointmentStatus, AppointmentSource, type MeetingBookingProvider } from "@prisma/client";
import { selectPrimaryAppointment, buildLeadRollupFromAppointment, type AppointmentForRollup } from "@/lib/appointment-rollup";

export interface UpsertAppointmentInput {
  leadId: string;
  provider: MeetingBookingProvider;
  source: AppointmentSource;

  // Provider identifiers (exactly one required per provider)
  ghlAppointmentId?: string | null;
  calendlyInviteeUri?: string | null;
  calendlyScheduledEventUri?: string | null;

  // Timing
  startAt?: Date | null;
  endAt?: Date | null;
  timezone?: string | null;

  // Status
  status: AppointmentStatus;
  statusChangedAt?: Date;

  // Cancellation
  canceledAt?: Date | null;
  cancelReason?: string | null;

  // Reschedule chain
  rescheduledFromId?: string | null;
}

export interface UpsertAppointmentResult {
  appointmentId: string;
  isNew: boolean;
  statusChanged: boolean;
  previousStatus?: AppointmentStatus;
  leadRollupUpdated: boolean;
  rescheduledFromId: string | null;
}

/**
 * Map string status to AppointmentStatus enum
 */
export function mapStringToAppointmentStatus(status: string | null | undefined): AppointmentStatus {
  if (!status) return AppointmentStatus.CONFIRMED;
  switch (status.toLowerCase()) {
    case "confirmed":
    case "booked":
      return AppointmentStatus.CONFIRMED;
    case "canceled":
    case "cancelled":
      return AppointmentStatus.CANCELED;
    case "rescheduled":
      return AppointmentStatus.RESCHEDULED;
    case "showed":
    case "completed":
      return AppointmentStatus.SHOWED;
    case "no_show":
    case "noshow":
    case "no-show":
      return AppointmentStatus.NO_SHOW;
    default:
      return AppointmentStatus.CONFIRMED;
  }
}

/**
 * Map AppointmentSource enum to string for lead rollups
 */
export function mapSourceToString(source: AppointmentSource): string {
  switch (source) {
    case AppointmentSource.WEBHOOK:
      return "webhook";
    case AppointmentSource.RECONCILE_CRON:
      return "reconcile_cron";
    case AppointmentSource.BACKFILL:
      return "backfill";
    case AppointmentSource.AUTO_BOOK:
      return "auto_book";
    case AppointmentSource.MANUAL:
      return "manual";
    case AppointmentSource.MIGRATION:
      return "migration";
    default:
      return source;
  }
}

/**
 * Map AppointmentStatus enum to string for lead rollups
 */
export function mapStatusToString(status: AppointmentStatus): string {
  switch (status) {
    case AppointmentStatus.CONFIRMED:
      return "confirmed";
    case AppointmentStatus.CANCELED:
      return "canceled";
    case AppointmentStatus.RESCHEDULED:
      return "rescheduled";
    case AppointmentStatus.SHOWED:
      return "showed";
    case AppointmentStatus.NO_SHOW:
      return "no_show";
    default:
      return status;
  }
}

/**
 * Upsert an appointment and update lead rollups atomically.
 *
 * Uses a transaction to:
 * 1. Upsert the Appointment record (keyed by provider ID)
 * 2. Select the primary appointment
 * 3. Update lead rollup fields from the primary
 *
 * Returns info about what changed for side-effect handling.
 */
export async function upsertAppointmentWithRollup(
  input: UpsertAppointmentInput
): Promise<UpsertAppointmentResult> {
  const {
    leadId,
    provider,
    source,
    ghlAppointmentId,
    calendlyInviteeUri,
    calendlyScheduledEventUri,
    startAt,
    endAt,
    timezone,
    status,
    statusChangedAt = new Date(),
    canceledAt,
    cancelReason,
    rescheduledFromId,
  } = input;

  return await prisma.$transaction(async (tx) => {
    // 1. Upsert key selection (race-safe idempotency)
    // Note: upserting without a provider-backed unique identifier is not supported.
    let uniqueWhere: { ghlAppointmentId: string } | { calendlyInviteeUri: string };
    if (provider === "GHL") {
      if (!ghlAppointmentId) {
        throw new Error("[Appointment Upsert] Missing ghlAppointmentId for GHL appointment upsert");
      }
      uniqueWhere = { ghlAppointmentId };
    } else {
      if (!calendlyInviteeUri) {
        throw new Error("[Appointment Upsert] Missing calendlyInviteeUri for CALENDLY appointment upsert");
      }
      uniqueWhere = { calendlyInviteeUri };
    }

    const existingAppointment = await tx.appointment.findUnique({
      where: uniqueWhere,
      select: { id: true, status: true, leadId: true },
    });

    if (existingAppointment && existingAppointment.leadId !== leadId) {
      console.warn(
        `[Appointment Upsert] Provider key already associated with a different lead; reassigning appointment ${existingAppointment.id} from lead ${existingAppointment.leadId} to ${leadId}`
      );
    }

    const isNew = !existingAppointment;
    const previousStatus = existingAppointment?.status;
    const statusChanged = existingAppointment ? existingAppointment.status !== status : false;

    const RESCHEDULE_LINK_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours (best-effort)

    let effectiveRescheduledFromId: string | null | undefined = rescheduledFromId;

    // Best-effort reschedule linking (Calendly):
    // If we receive a *new* confirmed appointment shortly after a cancellation for the same lead,
    // link the new appointment back to the canceled one via `rescheduledFromId`.
    if (
      effectiveRescheduledFromId === undefined &&
      isNew &&
      provider === "CALENDLY" &&
      status === AppointmentStatus.CONFIRMED
    ) {
      const windowStart = new Date(statusChangedAt.getTime() - RESCHEDULE_LINK_WINDOW_MS);
      const recentCanceled = await tx.appointment.findFirst({
        where: {
          leadId,
          provider: "CALENDLY",
          status: AppointmentStatus.CANCELED,
          canceledAt: { gte: windowStart },
        },
        orderBy: [{ canceledAt: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      });

      if (recentCanceled) {
        effectiveRescheduledFromId = recentCanceled.id;
      }
    }

    // 2. Upsert appointment
    const appointmentData = {
      leadId,
      provider,
      source,
      ghlAppointmentId: provider === "GHL" ? ghlAppointmentId : null,
      calendlyInviteeUri: provider === "CALENDLY" ? calendlyInviteeUri : null,
      calendlyScheduledEventUri: provider === "CALENDLY" ? calendlyScheduledEventUri : null,
      startAt,
      endAt,
      timezone,
      status,
      statusChangedAt,
      canceledAt: status === AppointmentStatus.CANCELED ? (canceledAt ?? new Date()) : null,
      cancelReason,
      rescheduledFromId: effectiveRescheduledFromId,
    };

    const appointment = await tx.appointment.upsert({
      where: uniqueWhere,
      create: appointmentData,
      update: appointmentData,
    });

    // Best-effort reschedule linking (Calendly) in the opposite webhook ordering:
    // If we receive a cancellation *after* a new booking was already created, link that booking back.
    if (provider === "CALENDLY" && status === AppointmentStatus.CANCELED) {
      const windowStart = new Date(statusChangedAt.getTime() - RESCHEDULE_LINK_WINDOW_MS);
      const recentConfirmed = await tx.appointment.findFirst({
        where: {
          leadId,
          provider: "CALENDLY",
          status: AppointmentStatus.CONFIRMED,
          createdAt: { gte: windowStart, lte: statusChangedAt },
          rescheduledFromId: null,
          id: { not: appointment.id },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (recentConfirmed) {
        await tx.appointment.update({
          where: { id: recentConfirmed.id },
          data: { rescheduledFromId: appointment.id },
        });
      }
    }

    // 3. Get all appointments for this lead to select primary
    const allAppointments = await tx.appointment.findMany({
      where: { leadId },
      select: {
        id: true,
        leadId: true,
        provider: true,
        ghlAppointmentId: true,
        calendlyInviteeUri: true,
        calendlyScheduledEventUri: true,
        startAt: true,
        endAt: true,
        timezone: true,
        status: true,
        statusChangedAt: true,
        canceledAt: true,
        source: true,
        createdAt: true,
      },
    });

    // 4. Select primary appointment
    const primary = selectPrimaryAppointment(allAppointments as AppointmentForRollup[]);

    // 5. Build and apply lead rollup update
    const rollup = buildLeadRollupFromAppointment(primary);
    const leadRollupUpdated = primary?.id === appointment.id || isNew;

    // Build lead update data
    const leadUpdateData: Record<string, unknown> = {
      appointmentLastCheckedAt: new Date(),
    };

    // Only update rollup fields if this appointment is the primary
    if (primary?.id === appointment.id) {
      Object.assign(leadUpdateData, {
        ghlAppointmentId: rollup.ghlAppointmentId,
        calendlyInviteeUri: rollup.calendlyInviteeUri,
        calendlyScheduledEventUri: rollup.calendlyScheduledEventUri,
        appointmentBookedAt: rollup.appointmentBookedAt,
        appointmentStartAt: rollup.appointmentStartAt,
        appointmentEndAt: rollup.appointmentEndAt,
        appointmentStatus: rollup.appointmentStatus,
        appointmentCanceledAt: rollup.appointmentCanceledAt,
        appointmentProvider: rollup.appointmentProvider,
        appointmentSource: rollup.appointmentSource,
        bookedSlot: rollup.bookedSlot,
      });

      // Update lead status based on appointment status
      if (status === AppointmentStatus.CANCELED) {
        // Check current lead status and revert if booked
        const lead = await tx.lead.findUnique({
          where: { id: leadId },
          select: { status: true },
        });
        if (lead?.status === "meeting-booked") {
          leadUpdateData.status = "qualified";
        }
      } else if (status === AppointmentStatus.CONFIRMED) {
        leadUpdateData.status = "meeting-booked";
      }
    }

    await tx.lead.update({
      where: { id: leadId },
      data: leadUpdateData,
    });

    return {
      appointmentId: appointment.id,
      isNew,
      statusChanged,
      previousStatus,
      leadRollupUpdated,
      rescheduledFromId: appointment.rescheduledFromId,
    };
  });
}

/**
 * Find existing appointment by provider key.
 * Returns null if not found.
 */
export async function findAppointmentByProviderKey(opts: {
  provider: MeetingBookingProvider;
  ghlAppointmentId?: string | null;
  calendlyInviteeUri?: string | null;
}): Promise<{ id: string; status: AppointmentStatus } | null> {
  const { provider, ghlAppointmentId, calendlyInviteeUri } = opts;

  if (provider === "GHL" && ghlAppointmentId) {
    return await prisma.appointment.findUnique({
      where: { ghlAppointmentId },
      select: { id: true, status: true },
    });
  }

  if (provider === "CALENDLY" && calendlyInviteeUri) {
    return await prisma.appointment.findUnique({
      where: { calendlyInviteeUri },
      select: { id: true, status: true },
    });
  }

  return null;
}
