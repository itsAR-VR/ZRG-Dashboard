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
  const resolved = await resolveBookingLink(clientId, settings);
  return resolved.bookingLink;
}

export async function resolveBookingLink(
  clientId: string,
  settings: Pick<WorkspaceSettings, "meetingBookingProvider" | "calendlyEventTypeLink"> | null
): Promise<{ bookingLink: string | null; hasPublicOverride: boolean }> {
  const provider = settings?.meetingBookingProvider ?? "GHL";

  if (provider === "CALENDLY") {
    const calendarLink = await prisma.calendarLink.findFirst({
      where: {
        clientId,
        isDefault: true,
      },
      select: { url: true, publicUrl: true },
    });

    const publicUrl = (calendarLink?.publicUrl || "").trim();
    if (publicUrl) {
      return { bookingLink: publicUrl, hasPublicOverride: true };
    }

    const settingsLink = (settings?.calendlyEventTypeLink || "").trim();
    const url = (calendarLink?.url || "").trim();

    return { bookingLink: settingsLink || url || null, hasPublicOverride: false };
  }

  const calendarLink = await prisma.calendarLink.findFirst({
    where: {
      clientId,
      isDefault: true,
    },
    select: { url: true, publicUrl: true },
  });

  const publicUrl = (calendarLink?.publicUrl || "").trim();
  const url = (calendarLink?.url || "").trim();
  return {
    bookingLink: publicUrl || url || null,
    hasPublicOverride: Boolean(publicUrl),
  };
}
