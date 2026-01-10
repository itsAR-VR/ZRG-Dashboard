import { prisma } from "@/lib/prisma";
import type { Lead, WorkspaceSettings, MeetingBookingProvider } from "@prisma/client";

export function isMeetingBooked(
  lead: Pick<Lead, "ghlAppointmentId" | "calendlyInviteeUri" | "calendlyScheduledEventUri">,
  settings: Pick<WorkspaceSettings, "meetingBookingProvider">
): boolean {
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

