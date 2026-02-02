import { prisma } from "@/lib/prisma";
import { autoStartPostBookingSequenceIfEligible } from "@/lib/followup-automation";
import { createGHLAppointment, getGHLContact, type GHLAppointment } from "@/lib/ghl-api";
import { getWorkspaceAvailabilityCache } from "@/lib/availability-cache";
import { ensureGhlContactIdForLead } from "@/lib/ghl-contacts";
import { createCalendlyInvitee, getCalendlyEventType } from "@/lib/calendly-api";
import { resolveCalendlyEventTypeUuidFromLink, toCalendlyEventTypeUri } from "@/lib/calendly-link";
import { upsertAppointmentWithRollup } from "@/lib/appointment-upsert";
import { pauseFollowUpsOnBooking } from "@/lib/followup-engine";
import {
  ensureLeadQualificationAnswersExtracted,
  getLeadQualificationAnswerState,
  getWorkspaceQualificationQuestions,
} from "@/lib/qualification-answer-extraction";
import { AppointmentStatus, AppointmentSource, type AvailabilitySource } from "@prisma/client";

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
  availabilitySource?: AvailabilitySource;
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
  opts?: { calendarIdOverride?: string; availabilitySource?: AvailabilitySource }
): Promise<BookingResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { client: { include: { settings: true } } },
  });
  if (!lead) return { success: false, error: "Lead not found" };

  const provider = lead.client.settings?.meetingBookingProvider === "CALENDLY" ? "calendly" : "ghl";
  if (provider === "calendly") {
    return bookMeetingOnCalendly(leadId, selectedSlot, { availabilitySource: opts?.availabilitySource });
  }

  // If qualification answers are incomplete and a dedicated "no questions" calendar is configured,
  // prefer it to avoid booking failures when questions are required.
  const calendarIdOverride = opts?.calendarIdOverride;
  if (calendarIdOverride) {
    return bookMeetingOnGHL(leadId, selectedSlot, calendarIdOverride, { availabilitySource: opts?.availabilitySource });
  }

  const state = await getLeadQualificationAnswerState({ leadId, clientId: lead.client.id });
  const directBookCalendarId = lead.client.settings?.ghlDirectBookCalendarId?.trim() || "";
  const override =
    opts?.availabilitySource === "DIRECT_BOOK"
      ? directBookCalendarId || undefined
      : opts?.availabilitySource === "DEFAULT"
        ? undefined
        : !state.hasAllRequiredAnswers && directBookCalendarId
          ? directBookCalendarId
          : undefined;

  return bookMeetingOnGHL(leadId, selectedSlot, override, { availabilitySource: opts?.availabilitySource });
}

export async function bookMeetingOnGHL(
  leadId: string,
  selectedSlot: string,
  calendarIdOverride?: string,
  opts?: { availabilitySource?: AvailabilitySource }
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
      const cacheAvailabilitySource: AvailabilitySource =
        opts?.availabilitySource === "DIRECT_BOOK"
          ? "DIRECT_BOOK"
          : opts?.availabilitySource === "DEFAULT"
            ? "DEFAULT"
            : calendarIdOverride && settings?.ghlDirectBookCalendarId && calendarIdOverride === settings.ghlDirectBookCalendarId
              ? "DIRECT_BOOK"
              : "DEFAULT";

      const cache = await getWorkspaceAvailabilityCache(client.id, {
        refreshIfStale: true,
        availabilitySource: cacheAvailabilitySource,
      });
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

    await pauseFollowUpsOnBooking(leadId, { mode: "complete" });

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

function normalizeQuestionKey(text: string): string {
  return (text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export async function bookMeetingOnCalendly(
  leadId: string,
  selectedSlot: string,
  opts?: { availabilitySource?: AvailabilitySource }
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

    const calendlyAccessToken = client.calendlyAccessToken;
    if (!calendlyAccessToken) {
      return { success: false, error: "Calendly access token not configured for this workspace" };
    }

    const startTimeIso = new Date(selectedSlot).toISOString();

    // Ensure qualification answers are extracted before picking an event type.
    const answerState = await ensureLeadQualificationAnswersExtracted({
      leadId,
      clientId: client.id,
      confidenceThreshold: 0.7,
      timeoutMs: 10_000,
    });

    const questions = await getWorkspaceQualificationQuestions(client.id);

    let questionsEventTypeUri = (settings?.calendlyEventTypeUri || "").trim();
    if (!questionsEventTypeUri) {
      const link = (settings?.calendlyEventTypeLink || "").trim();
      if (link) {
        const resolved = await resolveCalendlyEventTypeUuidFromLink(link);
        if (resolved?.uuid) {
          questionsEventTypeUri = toCalendlyEventTypeUri(resolved.uuid);
          await prisma.workspaceSettings.update({
            where: { clientId: client.id },
            data: { calendlyEventTypeUri: questionsEventTypeUri },
          });
        }
      }
    }

    let directBookEventTypeUri = (settings?.calendlyDirectBookEventTypeUri || "").trim();
    if (!directBookEventTypeUri) {
      const link = (settings?.calendlyDirectBookEventTypeLink || "").trim();
      if (link) {
        const resolved = await resolveCalendlyEventTypeUuidFromLink(link);
        if (resolved?.uuid) {
          directBookEventTypeUri = toCalendlyEventTypeUri(resolved.uuid);
          await prisma.workspaceSettings.update({
            where: { clientId: client.id },
            data: { calendlyDirectBookEventTypeUri: directBookEventTypeUri },
          });
        }
      }
    }

    if (!questionsEventTypeUri && !directBookEventTypeUri) {
      return { success: false, error: "No Calendly event type configured" };
    }

    const tryQuestionsEnabled =
      opts?.availabilitySource === "DIRECT_BOOK"
        ? false
        : answerState.hasAllRequiredAnswers && !!questionsEventTypeUri;

    type CalendlyQuestionsAndAnswers = Array<{ question: string; answer: string; position: number }>;

    let selectedEventTypeUri = "";
    let questionsAndAnswers: CalendlyQuestionsAndAnswers | undefined = undefined;
    let questionsEventTypeDetails:
      | (Awaited<ReturnType<typeof getCalendlyEventType>> & { success: true })
      | null = null;

    const loadQuestionsEventType = async () => {
      if (!questionsEventTypeUri) return null;
      if (questionsEventTypeDetails) return questionsEventTypeDetails;
      const res = await getCalendlyEventType(calendlyAccessToken, questionsEventTypeUri);
      questionsEventTypeDetails = res.success ? (res as any) : null;
      return questionsEventTypeDetails;
    };

    if (tryQuestionsEnabled && questionsEventTypeUri) {
      const eventType = await loadQuestionsEventType();
      if (eventType) {
        const positionByQuestionId = new Map<string, { question: string; position: number }>();
        const workspaceByNormalizedText = new Map<string, string>();
        for (const q of questions) {
          workspaceByNormalizedText.set(normalizeQuestionKey(q.question), q.id);
        }

        for (const cq of eventType.data.custom_questions) {
          const normalized = normalizeQuestionKey(cq.name);
          const questionId = workspaceByNormalizedText.get(normalized);
          if (!questionId) continue;
          positionByQuestionId.set(questionId, { question: cq.name, position: cq.position });
        }

        const requiredIds = questions.filter((q) => q.required).map((q) => q.id);
        const missingPosition = requiredIds.filter((id) => !positionByQuestionId.has(id));
        if (missingPosition.length === 0) {
          const built = requiredIds
            .map((id) => {
              const entry = answerState.answers[id];
              const pos = positionByQuestionId.get(id);
              if (!entry?.answer || !pos) return null;
              return { question: pos.question, answer: entry.answer, position: pos.position };
            })
            .filter((qa): qa is { question: string; answer: string; position: number } => !!qa);

          if (built.length === requiredIds.length) {
            selectedEventTypeUri = questionsEventTypeUri;
            questionsAndAnswers = built;
          }
        }
      }
    }

    if (!selectedEventTypeUri) {
      // Direct-book path: prefer explicit direct-book event type, otherwise only fall back to
      // the questions-enabled event type if it doesn't have required custom questions.
      if (directBookEventTypeUri) {
        selectedEventTypeUri = directBookEventTypeUri;
      } else if (questionsEventTypeUri) {
        const eventType = await loadQuestionsEventType();
        const hasRequiredQuestions = !!eventType?.data.custom_questions?.some((q) => q.required);
        if (hasRequiredQuestions) {
          return {
            success: false,
            error:
              "Calendly booking requires qualification questions, but the direct-book (no questions) event type is not configured.",
          };
        }
        selectedEventTypeUri = questionsEventTypeUri;
      }
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

    let invitee = await createCalendlyInvitee(calendlyAccessToken, {
      eventTypeUri: selectedEventTypeUri,
      startTimeIso,
      invitee: {
        email: inviteeEmail,
        name: inviteeName,
        timezone: inviteeTz,
      },
      questionsAndAnswers,
    });

    if (!invitee.success && tryQuestionsEnabled && directBookEventTypeUri) {
      invitee = await createCalendlyInvitee(calendlyAccessToken, {
        eventTypeUri: directBookEventTypeUri,
        startTimeIso,
        invitee: {
          email: inviteeEmail,
          name: inviteeName,
          timezone: inviteeTz,
        },
      });
    }

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

    await pauseFollowUpsOnBooking(leadId, { mode: "complete" });

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
