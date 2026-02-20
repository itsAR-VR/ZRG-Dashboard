import "server-only";

import { prisma } from "@/lib/prisma";
import { detectCalendarType, fetchCalendlyAvailability, fetchGHLAvailabilityWithMeta, fetchHubSpotAvailability, type AvailabilitySlot } from "@/lib/calendar-availability";
import { getWorkspaceAvailabilitySlotsUtc } from "@/lib/availability-cache";
import { getBookingLink } from "@/lib/meeting-booking-provider";
import { getPublicAppUrl } from "@/lib/app-url";

function buildLeadUrl(leadId: string): string {
  const base = getPublicAppUrl();
  return `${base}/?view=inbox&leadId=${encodeURIComponent(leadId)}`;
}

function formatInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

async function fetchLeadSchedulerAvailability(url: string): Promise<{ slots: AvailabilitySlot[]; calendarType: string; error?: string }> {
  const calendarType = detectCalendarType(url);
  const days = 14;

  try {
    switch (calendarType) {
      case "calendly": {
        const slots = await fetchCalendlyAvailability(url, days);
        return { slots, calendarType };
      }
      case "hubspot": {
        const slots = await fetchHubSpotAvailability(url, days);
        return { slots, calendarType };
      }
      case "ghl": {
        const result = await fetchGHLAvailabilityWithMeta(url, days);
        return { slots: result.slots, calendarType, ...(result.error ? { error: result.error } : {}) };
      }
      default:
        return { slots: [], calendarType: "unknown", error: "Unsupported scheduler link" };
    }
  } catch (error) {
    return { slots: [], calendarType, error: error instanceof Error ? error.message : "Failed to fetch scheduler availability" };
  }
}

export async function handleLeadSchedulerLinkIfPresent(opts: {
  leadId: string;
  latestInboundText?: string | null;
}): Promise<{ handled: boolean; outcome?: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: {
      id: true,
      clientId: true,
      sentimentTag: true,
      externalSchedulingLink: true,
      client: {
        select: {
          name: true,
          settings: { select: { timezone: true, meetingBookingProvider: true, calendlyEventTypeLink: true } },
        },
      },
    },
  });
  if (!lead) return { handled: false, outcome: "lead_not_found" };

  const url = (lead.externalSchedulingLink || "").trim();
  if (!url) return { handled: false, outcome: "no_scheduler_link" };

  // Safety: only act when the lead explicitly wants us to book via their link.
  // Interested leads can still include explicit scheduler-link routing intent.
  const schedulingIntentSentiments = new Set(["Meeting Requested", "Meeting Booked", "Interested"]);
  if (!schedulingIntentSentiments.has(lead.sentimentTag ?? "")) {
    return { handled: false, outcome: "sentiment_not_scheduling_intent" };
  }

  const isMeetingRequested = lead.sentimentTag === "Meeting Requested";

  const existingTask = await prisma.followUpTask.findFirst({
    where: { leadId: lead.id, status: "pending", campaignName: "lead_scheduler_link" },
    select: { id: true },
  });
  if (existingTask) return { handled: true, outcome: "task_already_exists" };

  const workspaceAvailability = await getWorkspaceAvailabilitySlotsUtc(lead.clientId, { refreshIfStale: true });
  const workspaceSet = new Set(workspaceAvailability.slotsUtc);

  const leadAvailability = await fetchLeadSchedulerAvailability(url);
  const overlap = leadAvailability.slots
    .map((s) => s.startTime.toISOString())
    .find((iso) => workspaceSet.has(iso));

  const tz = lead.client.settings?.timezone || "America/New_York";
  const bookingLink = await getBookingLink(lead.clientId, lead.client.settings ?? null).catch(() => null);
  const leadUrl = buildLeadUrl(lead.id);

  if (!overlap) {
    const header = isMeetingRequested
      ? `Lead shared their scheduler link (${leadAvailability.calendarType}). Consider booking via their calendar or asking for their preferred times/timezone.`
      : `Lead asked us to book via their scheduler link (${leadAvailability.calendarType}), but no clear overlap found in the next 14 days.`;

    const suggestion = [
      header,
      `Lead link: ${url}`,
      bookingLink ? `Fallback: ask them to book on our link: ${bookingLink}` : null,
      `Lead thread: ${leadUrl}`,
    ]
      .filter(Boolean)
      .join("\n");

    await prisma.followUpTask.create({
      data: {
        leadId: lead.id,
        type: "email",
        dueDate: new Date(),
        status: "pending",
        campaignName: "lead_scheduler_link",
        suggestedMessage: suggestion,
      },
    });

    return { handled: true, outcome: "created_manual_task_no_overlap" };
  }

  const chosen = new Date(overlap);
  const header = isMeetingRequested
    ? `Lead shared their scheduler link (${leadAvailability.calendarType}). Consider booking via their calendar or asking for their preferred times/timezone.`
    : `Lead asked us to book via their scheduler link (${leadAvailability.calendarType}).`;

  const suggestion = [
    header,
    `Suggested overlap: ${formatInTimeZone(chosen, tz)} (${tz})`,
    `Lead link: ${url}`,
    `Lead thread: ${leadUrl}`,
    "",
    `Automation note: booking via third-party scheduler is not yet fully automated for all providers; please book this slot on the lead's link.`,
  ].join("\n");

  await prisma.followUpTask.create({
    data: {
      leadId: lead.id,
      type: "email",
      dueDate: new Date(),
      status: "pending",
      campaignName: "lead_scheduler_link",
      suggestedMessage: suggestion,
    },
  });

  return { handled: true, outcome: "created_manual_task_with_overlap" };
}
