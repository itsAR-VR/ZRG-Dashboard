/**
 * Meeting Lifecycle Module (Phase 28)
 *
 * Defines the provider-backed meeting lifecycle states and reconciliation semantics.
 *
 * ## Meeting Lifecycle States
 *
 * - **Booked**: Provider evidence exists (GHL appointment ID or Calendly URIs) AND
 *   appointmentStatus is not "canceled". This is the primary "has a meeting" state.
 *
 * - **Canceled**: Provider evidence indicates cancellation (appointmentStatus = "canceled").
 *   Provider IDs are preserved for audit trail; appointmentCanceledAt is set.
 *
 * - **Completed** (deferred): No reliable attendance tracking yet. Until provider attendance
 *   signals are implemented (GHL appointment status webhooks, Calendly invitee no_show),
 *   treat verified booking as "completed" for automation purposes.
 *
 * ## Authority Rules
 *
 * 1. Provider evidence takes priority over AI sentiment.
 * 2. If sentiment = "Meeting Booked" but no provider evidence → downgrade to "Meeting Requested".
 * 3. If provider evidence exists but lead isn't marked booked → update status to "meeting-booked".
 *
 * ## Appointment Status Values
 *
 * Normalized values stored in Lead.appointmentStatus:
 * - "confirmed" - Appointment exists and is scheduled
 * - "canceled" - Appointment was canceled (by provider or lead)
 * - "rescheduled" - Appointment was rescheduled (treat as a new booking)
 * - "showed" - Lead attended the meeting (future: from provider signals)
 * - "no_show" - Lead did not attend (future: from provider signals)
 *
 * ## Appointment Source Values
 *
 * Lead.appointmentSource indicates how we learned about the appointment:
 * - "webhook" - Received via Calendly webhook (invitee.created)
 * - "reconcile_cron" - Discovered via cron reconciliation
 * - "backfill" - Discovered via backfill script
 * - "auto_book" - Created via ZRG auto-booking
 * - "manual" - Manually created/linked
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import type { Lead, MeetingBookingProvider } from "@prisma/client";

// Appointment status constants
export const APPOINTMENT_STATUS = {
  CONFIRMED: "confirmed",
  CANCELED: "canceled",
  RESCHEDULED: "rescheduled",
  SHOWED: "showed",
  NO_SHOW: "no_show",
} as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[keyof typeof APPOINTMENT_STATUS];

// Appointment source constants
export const APPOINTMENT_SOURCE = {
  WEBHOOK: "webhook",
  RECONCILE_CRON: "reconcile_cron",
  BACKFILL: "backfill",
  AUTO_BOOK: "auto_book",
  MANUAL: "manual",
} as const;

export type AppointmentSource = (typeof APPOINTMENT_SOURCE)[keyof typeof APPOINTMENT_SOURCE];

// Lead fields relevant to meeting state
export type LeadMeetingFields = Pick<
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
  | "status"
  | "sentimentTag"
>;

/**
 * Check if a lead has provider-backed booking evidence.
 * Returns true if any provider ID is present, regardless of status.
 */
export function hasProviderEvidence(
  lead: Pick<Lead, "ghlAppointmentId" | "calendlyInviteeUri" | "calendlyScheduledEventUri">
): boolean {
  return Boolean(lead.ghlAppointmentId || lead.calendlyInviteeUri || lead.calendlyScheduledEventUri);
}

/**
 * Check if a lead is considered "meeting booked" based on provider evidence.
 * A lead is booked if provider evidence exists AND the appointment is not canceled.
 */
export function isMeetingVerifiedBooked(
  lead: Pick<Lead, "ghlAppointmentId" | "calendlyInviteeUri" | "calendlyScheduledEventUri" | "appointmentStatus">
): boolean {
  if (!hasProviderEvidence(lead)) return false;
  if (lead.appointmentStatus === APPOINTMENT_STATUS.CANCELED) return false;
  return true;
}

/**
 * Check if a lead has a canceled appointment.
 */
export function isMeetingCanceled(
  lead: Pick<Lead, "appointmentStatus" | "appointmentCanceledAt">
): boolean {
  return lead.appointmentStatus === APPOINTMENT_STATUS.CANCELED || Boolean(lead.appointmentCanceledAt);
}

/**
 * Determine if there's a sentiment/provider mismatch.
 * Returns a mismatch type if detected, null otherwise.
 */
export function detectSentimentProviderMismatch(
  lead: Pick<
    Lead,
    | "ghlAppointmentId"
    | "calendlyInviteeUri"
    | "calendlyScheduledEventUri"
    | "appointmentStatus"
    | "sentimentTag"
    | "status"
  >
): "sentiment_booked_no_evidence" | "evidence_exists_not_booked" | null {
  const hasEvidence = hasProviderEvidence(lead);
  const isVerifiedBooked = isMeetingVerifiedBooked(lead);
  const sentimentSaysBooked = lead.sentimentTag === "Meeting Booked";
  const statusIsBooked = lead.status === "meeting-booked";

  // Sentiment says booked but no provider evidence
  if (sentimentSaysBooked && !hasEvidence) {
    return "sentiment_booked_no_evidence";
  }

  // Provider evidence exists (and not canceled) but lead isn't marked booked
  if (isVerifiedBooked && !statusIsBooked) {
    return "evidence_exists_not_booked";
  }

  return null;
}

/**
 * Get the appropriate sentiment tag downgrade for a lead with "Meeting Booked"
 * sentiment but no provider evidence.
 */
export function getDowngradedSentiment(
  currentSentiment: string | null
): string | null {
  if (currentSentiment === "Meeting Booked") {
    return "Meeting Requested";
  }
  return currentSentiment;
}

/**
 * Build the data object for marking a lead as booked during reconciliation.
 * Preserves existing fields and only updates what's needed.
 */
export function buildReconciliationBookedData(opts: {
  provider: MeetingBookingProvider;
  source: AppointmentSource;
  appointmentId?: string;
  calendlyInviteeUri?: string;
  calendlyScheduledEventUri?: string;
  startTime?: Date;
  endTime?: Date;
}): Partial<Lead> {
  const now = new Date();
  const data: Partial<Lead> = {
    appointmentStatus: APPOINTMENT_STATUS.CONFIRMED,
    appointmentProvider: opts.provider,
    appointmentSource: opts.source,
    appointmentLastCheckedAt: now,
    appointmentBookedAt: now,
    status: "meeting-booked",
  };

  if (opts.provider === "GHL" && opts.appointmentId) {
    data.ghlAppointmentId = opts.appointmentId;
  }

  if (opts.provider === "CALENDLY") {
    if (opts.calendlyInviteeUri) data.calendlyInviteeUri = opts.calendlyInviteeUri;
    if (opts.calendlyScheduledEventUri) data.calendlyScheduledEventUri = opts.calendlyScheduledEventUri;
  }

  if (opts.startTime) {
    data.appointmentStartAt = opts.startTime;
    data.bookedSlot = opts.startTime.toISOString();
  }
  if (opts.endTime) {
    data.appointmentEndAt = opts.endTime;
  }

  return data;
}

/**
 * Build the data object for marking a lead's appointment as canceled.
 * Preserves provider IDs for audit trail.
 */
export function buildReconciliationCanceledData(): Partial<Lead> {
  const now = new Date();
  return {
    appointmentStatus: APPOINTMENT_STATUS.CANCELED,
    appointmentCanceledAt: now,
    appointmentLastCheckedAt: now,
    // Note: status is NOT changed here. Caller should decide based on context
    // (e.g., revert to "qualified" or keep as-is for manual review).
  };
}

/**
 * Determine which provider to use for reconciliation lookup.
 * Checks both workspace setting and existing lead evidence.
 */
export function determineReconciliationProvider(
  lead: Pick<Lead, "ghlAppointmentId" | "calendlyInviteeUri" | "calendlyScheduledEventUri">,
  workspaceProvider: MeetingBookingProvider | null
): MeetingBookingProvider | null {
  // If lead already has Calendly evidence, prefer Calendly
  if (lead.calendlyInviteeUri || lead.calendlyScheduledEventUri) {
    return "CALENDLY";
  }
  // If lead already has GHL evidence, prefer GHL
  if (lead.ghlAppointmentId) {
    return "GHL";
  }
  // Fall back to workspace default
  return workspaceProvider;
}

export async function coerceMeetingBookedSentimentToEvidence(opts: {
  leadId: string;
  sentimentTag: string | null;
}): Promise<{ sentimentTag: string | null; downgraded: boolean; reason: string | null }> {
  const sentiment = (opts.sentimentTag || "").trim();
  if (sentiment !== "Meeting Booked") {
    return { sentimentTag: opts.sentimentTag, downgraded: false, reason: null };
  }

  const lead = await prisma.lead
    .findUnique({
      where: { id: opts.leadId },
      select: {
        id: true,
        ghlAppointmentId: true,
        calendlyInviteeUri: true,
        calendlyScheduledEventUri: true,
      },
    })
    .catch(() => null);

  if (!lead) {
    return { sentimentTag: opts.sentimentTag, downgraded: false, reason: null };
  }

  const hasProviderIds = Boolean(lead.ghlAppointmentId || lead.calendlyInviteeUri || lead.calendlyScheduledEventUri);
  if (hasProviderIds) {
    return { sentimentTag: "Meeting Booked", downgraded: false, reason: null };
  }

  const hasActiveAppointment = await prisma.appointment
    .findFirst({
      where: {
        leadId: lead.id,
        status: { not: "CANCELED" },
      },
      select: { id: true },
    })
    .then((row) => Boolean(row?.id))
    .catch(() => false);

  if (hasActiveAppointment) {
    return { sentimentTag: "Meeting Booked", downgraded: false, reason: null };
  }

  return {
    sentimentTag: "Meeting Requested",
    downgraded: true,
    reason: "meeting_booked_without_provider_evidence",
  };
}
