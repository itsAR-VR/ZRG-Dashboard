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
import { getGHLAppointment } from "@/lib/ghl-api";
import { getCalendlyScheduledEvent } from "@/lib/calendly-api";

export interface UpsertAppointmentInput {
  leadId: string;
  provider: MeetingBookingProvider;
  source: AppointmentSource;

  // Provider identifiers (exactly one required per provider)
  ghlAppointmentId?: string | null;
  calendlyInviteeUri?: string | null;
  calendlyScheduledEventUri?: string | null;
  // Calendar attribution (Phase 126) - enables capacity utilization analytics
  ghlCalendarId?: string | null;
  calendlyEventTypeUri?: string | null;

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
    ghlCalendarId,
    calendlyEventTypeUri,
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
      ghlCalendarId: provider === "GHL" ? (ghlCalendarId ?? undefined) : undefined,
      calendlyEventTypeUri: provider === "CALENDLY" ? (calendlyEventTypeUri ?? undefined) : undefined,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backfill calendar attribution fields for historical appointments.
 *
 * This is an on-demand utility (not invoked automatically in reconcile hot paths) to avoid
 * adding extra DB reads to reconciliation early-return branches.
 */
export async function backfillAppointmentAttribution(
  clientId: string,
  opts?: { limit?: number; batchSize?: number; batchDelayMs?: number }
): Promise<{ ghlUpdated: number; calendlyUpdated: number; errors: string[] }> {
  const limit = Math.max(1, Math.min(5_000, Math.trunc(opts?.limit ?? 500)));
  const batchSize = Math.max(1, Math.min(50, Math.trunc(opts?.batchSize ?? 10)));
  const batchDelayMs = Math.max(0, Math.min(30_000, Math.trunc(opts?.batchDelayMs ?? 500)));

  const errors: string[] = [];
  let ghlUpdated = 0;
  let calendlyUpdated = 0;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      ghlLocationId: true,
      ghlPrivateKey: true,
      calendlyAccessToken: true,
    },
  });

  if (!client) {
    return { ghlUpdated: 0, calendlyUpdated: 0, errors: ["Client not found"] };
  }

  const ghlKey = client.ghlPrivateKey?.trim() || "";
  const ghlLocationId = client.ghlLocationId?.trim() || "";
  const calendlyAccessToken = client.calendlyAccessToken?.trim() || "";

  if (ghlKey && ghlLocationId) {
    const ghlTargets = await prisma.appointment.findMany({
      where: {
        provider: "GHL",
        ghlAppointmentId: { not: null },
        ghlCalendarId: null,
        lead: { clientId },
      },
      select: { id: true, ghlAppointmentId: true },
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    for (let i = 0; i < ghlTargets.length; i += batchSize) {
      const batch = ghlTargets.slice(i, i + batchSize);
      for (const appt of batch) {
        const eventId = (appt.ghlAppointmentId || "").trim();
        if (!eventId) continue;
        const res = await getGHLAppointment(eventId, ghlKey, { locationId: ghlLocationId });
        if (!res.success || !res.data?.calendarId) {
          errors.push(`GHL appointment lookup failed for appointmentId=${appt.id}`);
          continue;
        }

        await prisma.appointment
          .update({
            where: { id: appt.id },
            data: { ghlCalendarId: res.data.calendarId },
          })
          .then(() => {
            ghlUpdated += 1;
          })
          .catch((error) => {
            console.warn("[Appointment Backfill] Failed to update GHL calendarId:", appt.id, error);
            errors.push(`Failed to update GHL calendarId for appointmentId=${appt.id}`);
          });
      }

      if (batchDelayMs > 0 && i + batchSize < ghlTargets.length) {
        await sleep(batchDelayMs);
      }
    }
  } else {
    errors.push("GHL credentials not configured for this workspace");
  }

  if (calendlyAccessToken) {
    const calendlyTargets = await prisma.appointment.findMany({
      where: {
        provider: "CALENDLY",
        calendlyScheduledEventUri: { not: null },
        calendlyEventTypeUri: null,
        lead: { clientId },
      },
      select: { id: true, calendlyScheduledEventUri: true },
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    for (let i = 0; i < calendlyTargets.length; i += batchSize) {
      const batch = calendlyTargets.slice(i, i + batchSize);
      for (const appt of batch) {
        const uri = (appt.calendlyScheduledEventUri || "").trim();
        if (!uri) continue;
        const res = await getCalendlyScheduledEvent(calendlyAccessToken, uri);
        const eventTypeUri =
          res.success && res.data && typeof res.data.event_type === "string" && res.data.event_type.trim()
            ? res.data.event_type.trim()
            : "";
        if (!eventTypeUri) {
          errors.push(`Calendly event lookup missing event_type for appointmentId=${appt.id}`);
          continue;
        }

        await prisma.appointment
          .update({
            where: { id: appt.id },
            data: { calendlyEventTypeUri: eventTypeUri },
          })
          .then(() => {
            calendlyUpdated += 1;
          })
          .catch((error) => {
            console.warn("[Appointment Backfill] Failed to update Calendly eventTypeUri:", appt.id, error);
            errors.push(`Failed to update Calendly eventTypeUri for appointmentId=${appt.id}`);
          });
      }

      if (batchDelayMs > 0 && i + batchSize < calendlyTargets.length) {
        await sleep(batchDelayMs);
      }
    }
  } else {
    errors.push("Calendly access token not configured for this workspace");
  }

  return { ghlUpdated, calendlyUpdated, errors };
}
