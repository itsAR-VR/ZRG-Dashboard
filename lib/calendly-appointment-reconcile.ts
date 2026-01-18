/**
 * Calendly Booking Reconciliation (Phase 28c)
 *
 * Detects and records Calendly bookings for leads by looking up scheduled events
 * via the lead's email address. Used by both cron reconciliation and backfill scripts.
 *
 * Key behaviors:
 * - Read-only with Calendly (no creating/updating events via this module)
 * - Idempotent: safe to run multiple times on the same lead
 * - Uses invitee_email filter on GET /scheduled_events for efficient lookup
 * - Logs only IDs, never PII
 */

import { prisma } from "@/lib/prisma";
import {
  listCalendlyScheduledEvents,
  listCalendlyEventInvitees,
  getCalendlyScheduledEvent,
  type CalendlyScheduledEvent,
  type CalendlyInvitee,
} from "@/lib/calendly-api";
import {
  APPOINTMENT_STATUS,
  APPOINTMENT_SOURCE,
  type AppointmentSource,
} from "@/lib/meeting-lifecycle";
import { autoStartPostBookingSequenceIfEligible } from "@/lib/followup-automation";
import { createCancellationTask } from "@/lib/appointment-cancellation-task";
import { upsertAppointmentWithRollup, mapStringToAppointmentStatus } from "@/lib/appointment-upsert";
import { AppointmentSource as PrismaAppointmentSource } from "@prisma/client";

// Default time window for reconciliation lookups (days)
const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_LOOKAHEAD_DAYS = 90;

export interface CalendlyReconcileResult {
  leadId: string;
  status: "booked" | "canceled" | "no_change" | "no_events" | "error" | "skipped";
  scheduledEventUri?: string;
  inviteeUri?: string;
  appointmentStatus?: string;
  startTime?: string;
  endTime?: string;
  error?: string;
  wasTransition?: boolean; // true if this reconciliation changed the lead's booking state
}

export interface CalendlyReconcileOptions {
  source?: AppointmentSource;
  dryRun?: boolean;
  skipSideEffects?: boolean; // Skip follow-up automation side effects
  lookbackDays?: number; // Days to look back for events
  lookaheadDays?: number; // Days to look ahead for events
}

/**
 * Represents a matched Calendly event with its invitee data
 */
interface MatchedCalendlyEvent {
  event: CalendlyScheduledEvent;
  invitee: CalendlyInvitee | null;
}

/**
 * Select the "primary" event from a list of matched Calendly events.
 * Prefers:
 * 1. Next upcoming active event (start time > now)
 * 2. Most recently scheduled active event
 * 3. If all canceled, the most recently canceled one (for audit)
 */
export function selectPrimaryCalendlyEvent(events: MatchedCalendlyEvent[]): MatchedCalendlyEvent | null {
  if (!events?.length) return null;

  const now = new Date();

  // Separate canceled from active
  const active = events.filter((e) => e.event.status === "active");
  const canceled = events.filter((e) => e.event.status === "canceled");

  if (active.length > 0) {
    // Sort by start time ascending
    const sorted = [...active].sort(
      (a, b) => new Date(a.event.start_time).getTime() - new Date(b.event.start_time).getTime()
    );

    // Find next upcoming
    const upcoming = sorted.find((e) => new Date(e.event.start_time) > now);
    if (upcoming) return upcoming;

    // Otherwise return most recent (last in sorted = latest start time)
    return sorted[sorted.length - 1];
  }

  if (canceled.length > 0) {
    // Return most recently scheduled canceled event
    const sorted = [...canceled].sort(
      (a, b) => new Date(b.event.start_time).getTime() - new Date(a.event.start_time).getTime()
    );
    return sorted[0];
  }

  return null;
}

/**
 * Normalize Calendly event/invitee status to our schema values.
 */
export function normalizeCalendlyStatus(calendlyStatus: string | undefined): string {
  const lower = (calendlyStatus || "").toLowerCase();
  if (lower === "canceled" || lower === "cancelled") return APPOINTMENT_STATUS.CANCELED;
  if (lower === "active") return APPOINTMENT_STATUS.CONFIRMED;
  // Default to confirmed for unknown statuses
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
 * Reconcile a single lead's Calendly booking status.
 *
 * Looks up scheduled events filtered by the lead's email, selects the primary one,
 * and updates the lead's appointment tracking fields if needed.
 */
export async function reconcileCalendlyBookingForLead(
  leadId: string,
  opts: CalendlyReconcileOptions = {}
): Promise<CalendlyReconcileResult> {
  const source = opts.source || APPOINTMENT_SOURCE.RECONCILE_CRON;
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const lookaheadDays = opts.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS;

  try {
    // Load lead with required fields
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        email: true,
        calendlyInviteeUri: true,
        calendlyScheduledEventUri: true,
        appointmentStatus: true,
        appointmentBookedAt: true,
        status: true,
        clientId: true,
        client: {
          select: {
            calendlyAccessToken: true,
            calendlyOrganizationUri: true,
            calendlyUserUri: true,
            settings: {
              select: {
                calendlyEventTypeUri: true,
              },
            },
          },
        },
      },
    });

    if (!lead) {
      return { leadId, status: "error", error: "Lead not found" };
    }

    // Skip if no Calendly credentials
    if (!lead.client.calendlyAccessToken) {
      return { leadId, status: "skipped", error: "No Calendly access token configured" };
    }

    if (!lead.client.calendlyOrganizationUri) {
      return { leadId, status: "skipped", error: "No Calendly organization URI configured" };
    }

    // Skip if no email
    if (!lead.email?.trim()) {
      return { leadId, status: "skipped", error: "No email address" };
    }

    const email = lead.email.trim().toLowerCase();

    // Calculate time window
    const now = new Date();
    const minStartTime = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const maxStartTime = new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);

    // Fetch scheduled events filtered by invitee email
    const eventsResult = await listCalendlyScheduledEvents(lead.client.calendlyAccessToken, {
      organizationUri: lead.client.calendlyOrganizationUri,
      inviteeEmail: email,
      minStartTime: minStartTime.toISOString(),
      maxStartTime: maxStartTime.toISOString(),
    });

    if (!eventsResult.success) {
      console.error(`[Calendly Reconcile] Failed to fetch events for lead ${leadId}:`, eventsResult.error);
      return { leadId, status: "error", error: eventsResult.error };
    }

    const events = eventsResult.data?.collection || [];

    if (events.length === 0) {
      // No events found - update watermark only
      if (!opts.dryRun) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { appointmentLastCheckedAt: new Date() },
        });
      }
      return { leadId, status: "no_events" };
    }

    // Filter by event type if configured (to reduce noise from multiple event types)
    const configuredEventType = lead.client.settings?.calendlyEventTypeUri;
    const filteredEvents = configuredEventType
      ? events.filter((e) => e.event_type === configuredEventType)
      : events;

    // If filtering removed all events but we had some, fall back to unfiltered
    const eventsToProcess = filteredEvents.length > 0 ? filteredEvents : events;

    // Fetch invitee details for each event to get the invitee URI
    const matchedEvents: MatchedCalendlyEvent[] = [];
    for (const event of eventsToProcess) {
      // Get invitees for this event
      const inviteesResult = await listCalendlyEventInvitees(lead.client.calendlyAccessToken, event.uri);
      if (!inviteesResult.success) {
        console.warn(`[Calendly Reconcile] Failed to fetch invitees for event ${event.uri}`);
        matchedEvents.push({ event, invitee: null });
        continue;
      }

      // Find the invitee matching our lead's email
      const invitees = inviteesResult.data?.collection || [];
      const matchingInvitee = invitees.find((inv) => inv.email?.toLowerCase() === email);
      matchedEvents.push({ event, invitee: matchingInvitee || null });
    }

    if (matchedEvents.length === 0) {
      if (!opts.dryRun) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { appointmentLastCheckedAt: new Date() },
        });
      }
      return { leadId, status: "no_events" };
    }

    // Select primary event
    const primary = selectPrimaryCalendlyEvent(matchedEvents);
    if (!primary) {
      if (!opts.dryRun) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { appointmentLastCheckedAt: new Date() },
        });
      }
      return { leadId, status: "no_events" };
    }

    const normalizedStatus = normalizeCalendlyStatus(primary.event.status);
    const isCanceled = normalizedStatus === APPOINTMENT_STATUS.CANCELED;

    // Check if this is a state transition
    const wasBooked =
      lead.appointmentStatus === APPOINTMENT_STATUS.CONFIRMED ||
      Boolean((lead.calendlyInviteeUri || lead.calendlyScheduledEventUri) && lead.appointmentStatus !== APPOINTMENT_STATUS.CANCELED);
    const wasCanceled = lead.appointmentStatus === APPOINTMENT_STATUS.CANCELED;
    const isNewBooking = !wasBooked && !isCanceled;
    const isNewCancellation = wasBooked && isCanceled;
    const eventUriChanged = lead.calendlyScheduledEventUri !== primary.event.uri;

    // Determine if we need to update
    const needsUpdate =
      eventUriChanged ||
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
        scheduledEventUri: primary.event.uri,
        inviteeUri: primary.invitee?.uri,
        appointmentStatus: normalizedStatus,
      };
    }

    // Build update data
    const startTime = new Date(primary.event.start_time);
    const endTime = new Date(primary.event.end_time);
    const inviteeUri = primary.invitee?.uri || lead.calendlyInviteeUri;

    // Dual-write: upsert Appointment + update Lead rollups atomically (Phase 34c)
    if (!opts.dryRun) {
      // Only upsert if we have an invitee URI (idempotency key for Calendly)
      if (inviteeUri) {
        await upsertAppointmentWithRollup({
          leadId,
          provider: "CALENDLY",
          source: mapSourceToPrismaEnum(source),
          calendlyInviteeUri: inviteeUri,
          calendlyScheduledEventUri: primary.event.uri,
          startAt: startTime,
          endAt: endTime,
          status: mapStringToAppointmentStatus(normalizedStatus),
          canceledAt: isCanceled ? new Date() : null,
        });
      } else {
        // Fallback: update lead directly if no invitee URI (shouldn't happen normally)
        console.warn(`[Calendly Reconcile] No invitee URI for lead ${leadId}, updating lead only`);
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            calendlyScheduledEventUri: primary.event.uri,
            appointmentStartAt: startTime,
            appointmentEndAt: endTime,
            appointmentStatus: normalizedStatus,
            appointmentProvider: "CALENDLY",
            appointmentSource: source,
            appointmentLastCheckedAt: new Date(),
            bookedSlot: startTime.toISOString(),
            appointmentCanceledAt: isCanceled ? new Date() : null,
            status: isCanceled && lead.status === "meeting-booked" ? "qualified" : (isCanceled ? lead.status : "meeting-booked"),
          },
        });
      }

      // Apply side effects for new bookings
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
          provider: "CALENDLY",
        });
      }
    }

    return {
      leadId,
      status: isCanceled ? "canceled" : "booked",
      scheduledEventUri: primary.event.uri,
      inviteeUri: primary.invitee?.uri,
      appointmentStatus: normalizedStatus,
      startTime: primary.event.start_time,
      endTime: primary.event.end_time,
      wasTransition: isNewBooking || isNewCancellation,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Calendly Reconcile] Error reconciling lead ${leadId}:`, message);
    return { leadId, status: "error", error: message };
  }
}

/**
 * Reconcile an existing Calendly booking by event URI.
 * Used when we already have calendlyScheduledEventUri and want to refresh its status.
 */
export async function reconcileCalendlyBookingByUri(
  leadId: string,
  scheduledEventUri: string,
  opts: CalendlyReconcileOptions = {}
): Promise<CalendlyReconcileResult> {
  const source = opts.source || APPOINTMENT_SOURCE.RECONCILE_CRON;

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        email: true,
        calendlyInviteeUri: true,
        calendlyScheduledEventUri: true,
        appointmentStatus: true,
        appointmentBookedAt: true,
        status: true,
        clientId: true,
        client: {
          select: {
            calendlyAccessToken: true,
          },
        },
      },
    });

    if (!lead) {
      return { leadId, status: "error", error: "Lead not found" };
    }

    if (!lead.client.calendlyAccessToken) {
      return { leadId, status: "skipped", error: "No Calendly access token configured" };
    }

    const eventResult = await getCalendlyScheduledEvent(lead.client.calendlyAccessToken, scheduledEventUri);

    if (!eventResult.success) {
      console.warn(`[Calendly Reconcile] Event ${scheduledEventUri} not found for lead ${leadId}`);
      return { leadId, status: "error", error: eventResult.error };
    }

    const event = eventResult.data;
    if (!event) {
      return { leadId, status: "no_events" };
    }

    const normalizedStatus = normalizeCalendlyStatus(event.status);
    const isCanceled = normalizedStatus === APPOINTMENT_STATUS.CANCELED;

    const startTime = new Date(event.start_time);
    const endTime = new Date(event.end_time);

    // Dual-write: upsert Appointment + update Lead rollups atomically (Phase 34c)
    if (!opts.dryRun) {
      // Use existing invitee URI if available as idempotency key
      if (lead.calendlyInviteeUri) {
        await upsertAppointmentWithRollup({
          leadId,
          provider: "CALENDLY",
          source: mapSourceToPrismaEnum(source),
          calendlyInviteeUri: lead.calendlyInviteeUri,
          calendlyScheduledEventUri: event.uri,
          startAt: startTime,
          endAt: endTime,
          status: mapStringToAppointmentStatus(normalizedStatus),
          canceledAt: isCanceled ? new Date() : null,
        });
      } else {
        // Fallback: update lead directly if no invitee URI
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            calendlyScheduledEventUri: event.uri,
            appointmentStartAt: startTime,
            appointmentEndAt: endTime,
            appointmentStatus: normalizedStatus,
            appointmentSource: source,
            appointmentLastCheckedAt: new Date(),
            appointmentCanceledAt: isCanceled ? new Date() : null,
            status: isCanceled && lead.status === "meeting-booked" ? "qualified" : lead.status,
          },
        });
      }
    }

    return {
      leadId,
      status: isCanceled ? "canceled" : "booked",
      scheduledEventUri: event.uri,
      appointmentStatus: normalizedStatus,
      startTime: event.start_time,
      endTime: event.end_time,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Calendly Reconcile] Error reconciling event ${scheduledEventUri} for lead ${leadId}:`, message);
    return { leadId, status: "error", error: message };
  }
}
