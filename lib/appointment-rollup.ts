/**
 * Appointment Rollup Logic (Phase 34)
 *
 * Defines the deterministic rule for selecting the "primary" appointment from a lead's
 * appointment history. This rule is shared across:
 * - Reconciliation modules (GHL, Calendly)
 * - Webhook handlers
 * - UI display defaults
 * - API responses
 *
 * ## Primary Appointment Selection Rule
 *
 * Priority order (highest to lowest):
 * 1. Next upcoming CONFIRMED appointment (soonest startAt in the future)
 * 2. Most recent CONFIRMED appointment (latest startAt, even if in the past)
 * 3. Most recent CANCELED appointment (latest canceledAt or createdAt)
 *
 * This rule matches Phase 28 reconciliation behavior and ensures consistent lead rollups.
 */

import type { Appointment, AppointmentStatus, Lead, MeetingBookingProvider } from "@prisma/client";

/**
 * Subset of Appointment fields needed for rollup selection
 */
export type AppointmentForRollup = Pick<
  Appointment,
  | "id"
  | "leadId"
  | "provider"
  | "ghlAppointmentId"
  | "calendlyInviteeUri"
  | "calendlyScheduledEventUri"
  | "startAt"
  | "endAt"
  | "timezone"
  | "status"
  | "statusChangedAt"
  | "canceledAt"
  | "source"
  | "createdAt"
>;

/**
 * Select the primary appointment from a list of appointments for a lead.
 * Returns null if no appointments exist.
 *
 * Selection priority:
 * 1. Next upcoming CONFIRMED (soonest future startAt)
 * 2. Most recent CONFIRMED (latest startAt, even if past)
 * 3. Most recent CANCELED (latest canceledAt or createdAt)
 */
export function selectPrimaryAppointment(
  appointments: AppointmentForRollup[],
  referenceDate: Date = new Date()
): AppointmentForRollup | null {
  if (appointments.length === 0) return null;

  const confirmed = appointments.filter((a) => a.status === "CONFIRMED");
  const canceled = appointments.filter((a) => a.status === "CANCELED");

  // 1. Next upcoming confirmed (soonest future startAt)
  const upcomingConfirmed = confirmed
    .filter((a) => a.startAt && a.startAt > referenceDate)
    .sort((a, b) => (a.startAt!.getTime() - b.startAt!.getTime()));
  if (upcomingConfirmed.length > 0) {
    return upcomingConfirmed[0];
  }

  // 2. Most recent confirmed (latest startAt, even if past)
  const pastConfirmed = confirmed
    .filter((a) => a.startAt)
    .sort((a, b) => (b.startAt!.getTime() - a.startAt!.getTime()));
  if (pastConfirmed.length > 0) {
    return pastConfirmed[0];
  }

  // Also consider confirmed without startAt (unlikely but handle gracefully)
  const confirmedNoTime = confirmed.filter((a) => !a.startAt);
  if (confirmedNoTime.length > 0) {
    // Sort by createdAt desc
    confirmedNoTime.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return confirmedNoTime[0];
  }

  // 3. Most recent canceled (latest canceledAt or createdAt)
  if (canceled.length > 0) {
    canceled.sort((a, b) => {
      const aTime = a.canceledAt?.getTime() ?? a.createdAt.getTime();
      const bTime = b.canceledAt?.getTime() ?? b.createdAt.getTime();
      return bTime - aTime;
    });
    return canceled[0];
  }

  // Fallback: any remaining appointments (e.g., RESCHEDULED, SHOWED, NO_SHOW)
  const remaining = appointments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return remaining[0] ?? null;
}

/**
 * Build lead rollup data from the primary appointment.
 * Returns the fields that should be written to Lead for backward compatibility.
 */
export function buildLeadRollupFromAppointment(
  appointment: AppointmentForRollup | null
): Partial<Pick<
  Lead,
  | "ghlAppointmentId"
  | "calendlyInviteeUri"
  | "calendlyScheduledEventUri"
  | "appointmentBookedAt"
  | "appointmentStartAt"
  | "appointmentEndAt"
  | "appointmentStatus"
  | "appointmentCanceledAt"
  | "appointmentProvider"
  | "appointmentSource"
  | "bookedSlot"
>> {
  if (!appointment) {
    // No appointments: clear rollups
    return {
      ghlAppointmentId: null,
      calendlyInviteeUri: null,
      calendlyScheduledEventUri: null,
      appointmentBookedAt: null,
      appointmentStartAt: null,
      appointmentEndAt: null,
      appointmentStatus: null,
      appointmentCanceledAt: null,
      appointmentProvider: null,
      appointmentSource: null,
      bookedSlot: null,
    };
  }

  // Map Prisma enum status to string for Lead rollup (backward compat)
  const statusMap: Record<AppointmentStatus, string> = {
    CONFIRMED: "confirmed",
    CANCELED: "canceled",
    RESCHEDULED: "rescheduled",
    SHOWED: "showed",
    NO_SHOW: "no_show",
  };

  // Map Prisma enum source to string for Lead rollup
  const sourceMap: Record<string, string> = {
    WEBHOOK: "webhook",
    RECONCILE_CRON: "reconcile_cron",
    BACKFILL: "backfill",
    AUTO_BOOK: "auto_book",
    MANUAL: "manual",
    MIGRATION: "migration",
  };

  return {
    ghlAppointmentId: appointment.ghlAppointmentId,
    calendlyInviteeUri: appointment.calendlyInviteeUri,
    calendlyScheduledEventUri: appointment.calendlyScheduledEventUri,
    appointmentBookedAt: appointment.createdAt,
    appointmentStartAt: appointment.startAt,
    appointmentEndAt: appointment.endAt,
    appointmentStatus: statusMap[appointment.status] ?? appointment.status,
    appointmentCanceledAt: appointment.canceledAt,
    appointmentProvider: appointment.provider,
    appointmentSource: sourceMap[appointment.source] ?? appointment.source,
    bookedSlot: appointment.startAt?.toISOString() ?? null,
  };
}

/**
 * Determine if a new appointment should become the primary based on the selection rule.
 * Used to decide whether to update lead rollups after an appointment change.
 */
export function shouldUpdateRollup(
  currentPrimary: AppointmentForRollup | null,
  newAppointment: AppointmentForRollup,
  allAppointments: AppointmentForRollup[]
): boolean {
  const newPrimary = selectPrimaryAppointment(allAppointments);
  if (!newPrimary) return false;

  // Update if the primary changed
  if (!currentPrimary) return true;
  return newPrimary.id !== currentPrimary.id;
}

/**
 * Find an existing appointment by provider idempotency key.
 * Used for upsert operations during reconciliation and webhooks.
 */
export function findByProviderKey(
  appointments: AppointmentForRollup[],
  provider: MeetingBookingProvider,
  key: { ghlAppointmentId?: string; calendlyInviteeUri?: string }
): AppointmentForRollup | null {
  if (provider === "GHL" && key.ghlAppointmentId) {
    return appointments.find((a) => a.ghlAppointmentId === key.ghlAppointmentId) ?? null;
  }
  if (provider === "CALENDLY" && key.calendlyInviteeUri) {
    return appointments.find((a) => a.calendlyInviteeUri === key.calendlyInviteeUri) ?? null;
  }
  return null;
}
