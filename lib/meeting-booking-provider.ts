import { prisma } from "@/lib/prisma";
import type { Lead, WorkspaceSettings, MeetingBookingProvider } from "@prisma/client";
import { APPOINTMENT_STATUS, hasProviderEvidence } from "@/lib/meeting-lifecycle";

/**
 * Check if a lead is considered "meeting booked".
 *
 * Phase 28 semantics:
 * - If appointmentStatus is present, use it: booked = has evidence AND status !== "canceled"
 * - Fallback (pre-reconciliation leads): provider evidence alone means booked
 *
 * The workspace's meetingBookingProvider is used to determine which provider's
 * evidence to prioritize, but we now check all providers for completeness.
 */
export function isMeetingBooked(
  lead: Pick<Lead, "ghlAppointmentId" | "calendlyInviteeUri" | "calendlyScheduledEventUri" | "appointmentStatus">,
  settings: Pick<WorkspaceSettings, "meetingBookingProvider">
): boolean {
  // Phase 28: If we have appointmentStatus, use the new lifecycle semantics
  if (lead.appointmentStatus) {
    if (lead.appointmentStatus === APPOINTMENT_STATUS.CANCELED) {
      return false;
    }
    // Any other status with provider evidence = booked
    return hasProviderEvidence(lead);
  }

  // Fallback for pre-Phase 28 leads: check provider evidence based on workspace setting
  const provider: MeetingBookingProvider = settings.meetingBookingProvider;
  if (provider === "CALENDLY") {
    return Boolean(lead.calendlyInviteeUri || lead.calendlyScheduledEventUri);
  }
  return Boolean(lead.ghlAppointmentId);
}

export async function getBookingLink(
  clientId: string,
  settings: Pick<WorkspaceSettings, "meetingBookingProvider" | "calendlyEventTypeLink"> | null
): Promise<string | null> {
  const provider = settings?.meetingBookingProvider ?? "GHL";

  if (provider === "CALENDLY") {
    const link = (settings?.calendlyEventTypeLink || "").trim();
    return link || null;
  }

  const calendarLink = await prisma.calendarLink.findFirst({
    where: {
      clientId,
      isDefault: true,
    },
    select: { url: true },
  });

  const url = (calendarLink?.url || "").trim();
  return url || null;
}

