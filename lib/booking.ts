import { prisma } from "@/lib/prisma";
import { autoStartPostBookingSequenceIfEligible } from "@/lib/followup-automation";
import { createGHLAppointment, getGHLContact, type GHLAppointment } from "@/lib/ghl-api";
import { getWorkspaceAvailabilityCache } from "@/lib/availability-cache";
import { ensureGhlContactIdForLead } from "@/lib/ghl-contacts";
import { createCalendlyInvitee } from "@/lib/calendly-api";
import { resolveCalendlyEventTypeUuidFromLink, toCalendlyEventTypeUri } from "@/lib/calendly-link";
import { upsertAppointmentWithRollup } from "@/lib/appointment-upsert";
import { AppointmentStatus, AppointmentSource } from "@prisma/client";

export interface BookingResult {
  success: boolean;
  provider?: "ghl" | "calendly";
  appointmentId?: string;
  appointment?: GHLAppointment;
  calendly?: { inviteeUri: string; scheduledEventUri: string | null };
  error?: string;
}

export interface OfferedSlot {
  datetime: string; // ISO format
  label: string; // Human-readable (e.g., "3pm EST on Thursday")
  offeredAt: string; // When this slot was offered
}

export async function storeOfferedSlots(
  leadId: string,
  slots: OfferedSlot[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { offeredSlots: JSON.stringify(slots) },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to store offered slots:", error);
    return { success: false, error: "Failed to store offered slots" };
  }
}

export async function getOfferedSlots(leadId: string): Promise<OfferedSlot[]> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { offeredSlots: true },
    });

    if (!lead?.offeredSlots) return [];
    return JSON.parse(lead.offeredSlots) as OfferedSlot[];
  } catch (error) {
    console.error("Failed to get offered slots:", error);
    return [];
  }
}

export async function clearOfferedSlots(leadId: string): Promise<void> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { offeredSlots: null },
    });
  } catch {
    console.error("Failed to clear offered slots");
  }
}

export async function shouldAutoBook(leadId: string): Promise<{
  shouldBook: boolean;
  reason?: string;
}> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!lead) {
      return { shouldBook: false, reason: "Lead not found" };
    }

    const alreadyBooked =
      lead.status === "meeting-booked" ||
      !!lead.ghlAppointmentId ||
      !!lead.calendlyInviteeUri ||
      !!lead.calendlyScheduledEventUri ||
      !!lead.appointmentBookedAt;
    if (alreadyBooked) {
      return { shouldBook: false, reason: "Lead already has an appointment booked" };
    }

    const workspaceEnabled = lead.client.settings?.autoBookMeetings ?? false;
    const leadEnabled = lead.autoBookMeetingsEnabled ?? true;

    if (!workspaceEnabled) {
      return { shouldBook: false, reason: "Workspace auto-booking is disabled" };
    }

    if (!leadEnabled) {
      return { shouldBook: false, reason: "Lead has auto-booking disabled" };
    }

    return { shouldBook: true };
  } catch (error) {
    console.error("Failed to check auto-book setting:", error);
    return { shouldBook: false, reason: "Failed to check auto-book setting" };
  }
}

export async function bookMeetingForLead(
  leadId: string,
  selectedSlot: string,
  opts?: { calendarIdOverride?: string }
): Promise<BookingResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { client: { include: { settings: true } } },
  });
  if (!lead) return { success: false, error: "Lead not found" };

  const provider = lead.client.settings?.meetingBookingProvider === "CALENDLY" ? "calendly" : "ghl";
  return provider === "calendly"
    ? bookMeetingOnCalendly(leadId, selectedSlot)
    : bookMeetingOnGHL(leadId, selectedSlot, opts?.calendarIdOverride);
}

export async function bookMeetingOnGHL(
  leadId: string,
  selectedSlot: string,
  calendarIdOverride?: string
): Promise<BookingResult> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const alreadyBooked =
      lead.status === "meeting-booked" ||
      !!lead.ghlAppointmentId ||
      !!lead.calendlyInviteeUri ||
      !!lead.calendlyScheduledEventUri ||
      !!lead.appointmentBookedAt;
    if (alreadyBooked) {
      return { success: false, error: "Lead already has an appointment booked" };
    }

    const client = lead.client;
    const settings = client.settings;

    if (!client.ghlLocationId || !client.ghlPrivateKey) {
      return { success: false, error: "GHL credentials not configured for this workspace" };
    }

    const calendarId = calendarIdOverride || settings?.ghlDefaultCalendarId;
    if (!calendarId) {
      return { success: false, error: "No GHL calendar configured" };
    }

    const ensureContact = await ensureGhlContactIdForLead(leadId, { allowCreateWithoutPhone: true });
    if (!ensureContact.success || !ensureContact.ghlContactId) {
      return { success: false, error: ensureContact.error || "Failed to resolve GHL contact for lead" };
    }

    const ghlContactId = ensureContact.ghlContactId;

    try {
      const cache = await getWorkspaceAvailabilityCache(client.id, { refreshIfStale: true });
      const availabilityCalendarId =
        cache?.calendarType === "ghl" ? cache.providerMeta?.ghlCalendarId || null : null;

      const mismatch = !!availabilityCalendarId && !!calendarId && availabilityCalendarId !== calendarId;

      if (mismatch) {
        const now = Date.now();
        const endDate = now + 30 * 24 * 60 * 60 * 1000;
        const resp = await fetch(
          `https://backend.leadconnectorhq.com/calendars/${encodeURIComponent(
            calendarId
          )}/free-slots?startDate=${now}&endDate=${endDate}&timezone=UTC`,
          { headers: { Accept: "application/json" } }
        );

        if (resp.ok) {
          const data = await resp.json();
          const available = new Set<string>();
          for (const [key, value] of Object.entries(data || {})) {
            if (key === "traceId") continue;
            const daySlots = (value as any)?.slots;
            if (!Array.isArray(daySlots)) continue;
            for (const slot of daySlots) {
              const startTime = typeof slot === "string" ? slot : (slot as any)?.startTime;
              if (typeof startTime === "string" && startTime) {
                const iso = new Date(startTime).toISOString();
                available.add(iso);
              }
            }
          }

          const selectedIso = new Date(selectedSlot).toISOString();
          if (!available.has(selectedIso)) {
            return {
              success: false,
              error:
                "That time is no longer available on the booking calendar. Please refresh availability and pick another slot.",
            };
          }
        }
      }
    } catch (error) {
      console.warn("[bookMeetingOnGHL] Preflight availability check failed:", error);
    }

    const durationMinutes = settings?.meetingDurationMinutes || 30;
    const startTime = new Date(selectedSlot);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Lead";
    const companyName = settings?.companyName || client.name;
    let title = settings?.meetingTitle || "Intro to {companyName}";
    title = title
      .replace("{companyName}", companyName)
      .replace("{leadName}", leadName)
      .replace("{firstName}", lead.firstName || "");

    const appointmentResult = await createGHLAppointment(
      {
        calendarId,
        locationId: client.ghlLocationId,
        contactId: ghlContactId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        title,
        appointmentStatus: "confirmed",
        assignedUserId: settings?.ghlAssignedUserId || undefined,
        notes: `Booked via ZRG Dashboard\nLead ID: ${leadId}`,
      },
      client.ghlPrivateKey
    );

    if (!appointmentResult.success || !appointmentResult.data?.id) {
      return { success: false, error: appointmentResult.error || "Failed to create appointment in GHL" };
    }

    // Dual-write: create Appointment + update Lead rollups atomically (Phase 34c)
    await upsertAppointmentWithRollup({
      leadId,
      provider: "GHL",
      source: AppointmentSource.AUTO_BOOK,
      ghlAppointmentId: appointmentResult.data.id,
      startAt: startTime,
      endAt: endTime,
      status: AppointmentStatus.CONFIRMED,
    });

    // Clear offered slots after successful booking
    await prisma.lead.update({
      where: { id: leadId },
      data: { offeredSlots: null },
    });

    await autoStartPostBookingSequenceIfEligible({ leadId });

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

    return {
      success: true,
      provider: "ghl",
      appointmentId: appointmentResult.data.id,
      appointment: appointmentResult.data,
    };
  } catch (error) {
    console.error("Failed to book meeting on GHL:", error);
    return { success: false, error: "Failed to book meeting" };
  }
}

export async function bookMeetingOnCalendly(leadId: string, selectedSlot: string): Promise<BookingResult> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const alreadyBooked =
      lead.status === "meeting-booked" ||
      !!lead.ghlAppointmentId ||
      !!lead.calendlyInviteeUri ||
      !!lead.calendlyScheduledEventUri ||
      !!lead.appointmentBookedAt;
    if (alreadyBooked) {
      return { success: false, error: "Lead already has an appointment booked" };
    }

    const client = lead.client;
    const settings = client.settings;

    if (!client.calendlyAccessToken) {
      return { success: false, error: "Calendly access token not configured for this workspace" };
    }

    const startTimeIso = new Date(selectedSlot).toISOString();

    let eventTypeUri = (settings?.calendlyEventTypeUri || "").trim();
    if (!eventTypeUri) {
      const link = (settings?.calendlyEventTypeLink || "").trim();
      if (!link) {
        return { success: false, error: "No Calendly event type configured" };
      }

      const resolved = await resolveCalendlyEventTypeUuidFromLink(link);
      if (!resolved?.uuid) {
        return { success: false, error: "Failed to resolve Calendly event type from link" };
      }

      eventTypeUri = toCalendlyEventTypeUri(resolved.uuid);

      await prisma.workspaceSettings.update({
        where: { clientId: client.id },
        data: { calendlyEventTypeUri: eventTypeUri },
      });
    }

	    let inviteeEmail = lead.email?.trim() || "";
	    if (!inviteeEmail && lead.ghlContactId && client.ghlPrivateKey) {
	      const contact = await getGHLContact(lead.ghlContactId, client.ghlPrivateKey, { locationId: client.ghlLocationId || undefined });
	      const email = contact.success ? contact.data?.contact?.email?.trim() : "";
	      if (email) {
	        inviteeEmail = email;
	        await prisma.lead.update({ where: { id: leadId }, data: { email } });
	      }
    }

    if (!inviteeEmail) {
      return { success: false, error: "Lead email is required for Calendly booking" };
    }

    const inviteeName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || "Lead";
    const inviteeTz = lead.timezone || settings?.timezone || "UTC";

    const invitee = await createCalendlyInvitee(client.calendlyAccessToken, {
      eventTypeUri,
      startTimeIso,
      invitee: {
        email: inviteeEmail,
        name: inviteeName,
        timezone: inviteeTz,
      },
    });

    if (!invitee.success) {
      return { success: false, error: invitee.error || "Failed to create Calendly invitee" };
    }

    const meetingStartTime = new Date(selectedSlot);
    const meetingEndTime = new Date(meetingStartTime.getTime() + (settings?.meetingDurationMinutes || 30) * 60 * 1000);

    // Dual-write: create Appointment + update Lead rollups atomically (Phase 34c)
    await upsertAppointmentWithRollup({
      leadId,
      provider: "CALENDLY",
      source: AppointmentSource.AUTO_BOOK,
      calendlyInviteeUri: invitee.data.inviteeUri,
      calendlyScheduledEventUri: invitee.data.scheduledEventUri,
      startAt: meetingStartTime,
      endAt: meetingEndTime,
      status: AppointmentStatus.CONFIRMED,
    });

    // Clear offered slots after successful booking
    await prisma.lead.update({
      where: { id: leadId },
      data: { offeredSlots: null },
    });

    await autoStartPostBookingSequenceIfEligible({ leadId });

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

    return {
      success: true,
      provider: "calendly",
      appointmentId: invitee.data.scheduledEventUri || invitee.data.inviteeUri,
      calendly: invitee.data,
    };
  } catch (error) {
    console.error("Failed to book meeting on Calendly:", error);
    return { success: false, error: "Failed to book meeting" };
  }
}
