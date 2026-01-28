"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { autoStartPostBookingSequenceIfEligible } from "@/lib/followup-automation";
import {
    createGHLAppointment,
    getGHLCalendars,
    getGHLUsers,
    testGHLConnection,
    type GHLCalendar,
    type GHLUser,
    type GHLAppointment,
} from "@/lib/ghl-api";
import { getWorkspaceAvailabilityCache, getWorkspaceAvailabilitySlotsUtc } from "@/lib/availability-cache";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { formatAvailabilitySlots } from "@/lib/availability-format";
import { getWorkspaceSlotOfferCountsForRange } from "@/lib/slot-offer-ledger";
import { ensureGhlContactIdForLead } from "@/lib/ghl-contacts";
import { requireClientAccess, requireClientAdminAccess, requireLeadAccessById } from "@/lib/workspace-access";
import { resolveCalendlyEventTypeUuidFromLink } from "@/lib/calendly-link";
import { AppointmentStatus, type AvailabilitySource, type MeetingBookingProvider, type AppointmentSource } from "@prisma/client";

// Re-export types for use in components
export type { GHLCalendar, GHLUser, GHLAppointment };

// =============================================================================
// Types
// =============================================================================

export interface BookingResult {
    success: boolean;
    appointmentId?: string;
    appointment?: GHLAppointment;
    error?: string;
}

export interface OfferedSlot {
    datetime: string;  // ISO format
    label: string;     // Human-readable (e.g., "3pm EST on Thursday")
    offeredAt: string; // When this slot was offered
    availabilitySource?: AvailabilitySource;
}

export interface BookingAvailabilitySlot {
    datetime: string; // ISO UTC
    label: string; // Display label in lead/workspace TZ
    offeredCount: number; // How many times this slot has been offered
}

// =============================================================================
// Auto-Book Logic
// =============================================================================

/**
 * Check if auto-booking is enabled for a lead
 * Logic:
 * - workspace ON + lead ON = true
 * - workspace ON + lead OFF = false (lead opted out)
 * - workspace OFF + lead ON = false (workspace is the master kill-switch)
 * - workspace OFF + lead OFF = false
 */
export async function shouldAutoBook(leadId: string): Promise<{
    shouldBook: boolean;
    reason?: string;
}> {
    try {
        await requireLeadAccessById(leadId);
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
            return { shouldBook: false, reason: "Auto-booking disabled for this lead" };
        }

        return { shouldBook: true };

    } catch (error) {
        console.error("Error checking auto-book status:", error);
        return { shouldBook: false, reason: "Error checking auto-book status" };
    }
}

/**
 * Update lead's auto-book setting
 */
export async function updateLeadAutoBookSetting(
    leadId: string,
    enabled: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        await requireLeadAccessById(leadId);
        await prisma.lead.update({
            where: { id: leadId },
            data: { autoBookMeetingsEnabled: enabled },
        });

        revalidatePath("/");
        return { success: true };
    } catch (error) {
        console.error("Failed to update lead auto-book setting:", error);
        return { success: false, error: "Failed to update setting" };
    }
}

/**
 * When workspace auto-book is enabled, set all leads in that workspace to enabled
 */
export async function setWorkspaceAutoBookEnabled(
    clientId: string,
    enabled: boolean
): Promise<{ success: boolean; updatedCount: number; error?: string }> {
    try {
        await requireClientAdminAccess(clientId);
        // Update workspace setting
        await prisma.workspaceSettings.upsert({
            where: { clientId },
            update: { autoBookMeetings: enabled },
            create: {
                clientId,
                autoBookMeetings: enabled,
            },
        });

        // If enabling, set all leads to enabled (they can individually opt-out later)
        if (enabled) {
            const result = await prisma.lead.updateMany({
                where: { clientId },
                data: { autoBookMeetingsEnabled: true },
            });

            revalidatePath("/");
            return { success: true, updatedCount: result.count };
        }

        revalidatePath("/");
        return { success: true, updatedCount: 0 };
    } catch (error) {
        console.error("Failed to update workspace auto-book setting:", error);
        return { success: false, updatedCount: 0, error: "Failed to update setting" };
    }
}

// =============================================================================
// Slot Management
// =============================================================================

/**
 * Store offered slots on a lead for tracking
 */
export async function storeOfferedSlots(
    leadId: string,
    slots: OfferedSlot[]
): Promise<{ success: boolean; error?: string }> {
    try {
        await requireLeadAccessById(leadId);
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

/**
 * Get offered slots for a lead
 */
export async function getOfferedSlots(leadId: string): Promise<OfferedSlot[]> {
    try {
        await requireLeadAccessById(leadId);
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

/**
 * Clear offered slots after booking
 */
export async function clearOfferedSlots(leadId: string): Promise<void> {
    try {
        await requireLeadAccessById(leadId);
        await prisma.lead.update({
            where: { id: leadId },
            data: { offeredSlots: null },
        });
    } catch {
        console.error("Failed to clear offered slots");
    }
}

// =============================================================================
// GHL Settings Helpers
// =============================================================================

/**
 * Fetch GHL calendars for a workspace (for settings dropdown)
 */
export async function fetchGHLCalendarsForWorkspace(
    clientId: string
): Promise<{ success: boolean; calendars?: GHLCalendar[]; error?: string }> {
    try {
        await requireClientAdminAccess(clientId);
        const client = await prisma.client.findUnique({
            where: { id: clientId },
        });

        if (!client?.ghlLocationId || !client?.ghlPrivateKey) {
            return { success: false, error: "GHL credentials not configured" };
        }

        const result = await getGHLCalendars(client.ghlLocationId, client.ghlPrivateKey);

        if (result.success && result.data) {
            return { success: true, calendars: result.data.calendars };
        }

        return { success: false, error: result.error || "Failed to fetch calendars" };
    } catch (error) {
        console.error("Failed to fetch GHL calendars:", error);
        return { success: false, error: "Failed to fetch calendars" };
    }
}

/**
 * Fetch GHL users/team members for a workspace (for settings dropdown)
 */
export async function fetchGHLUsersForWorkspace(
    clientId: string
): Promise<{ success: boolean; users?: GHLUser[]; error?: string }> {
    try {
        await requireClientAdminAccess(clientId);
        const client = await prisma.client.findUnique({
            where: { id: clientId },
        });

        if (!client?.ghlLocationId || !client?.ghlPrivateKey) {
            return { success: false, error: "GHL credentials not configured" };
        }

        const result = await getGHLUsers(client.ghlLocationId, client.ghlPrivateKey);

        if (result.success && result.data) {
            return { success: true, users: result.data.users };
        }

        return { success: false, error: result.error || "Failed to fetch users" };
    } catch (error) {
        console.error("Failed to fetch GHL users:", error);
        return { success: false, error: "Failed to fetch users" };
    }
}

/**
 * Test GHL connection for a workspace
 */
export async function testGHLConnectionForWorkspace(
    clientId: string
): Promise<{ success: boolean; calendarCount?: number; error?: string }> {
    try {
        await requireClientAdminAccess(clientId);
        const client = await prisma.client.findUnique({
            where: { id: clientId },
        });

        if (!client?.ghlLocationId || !client?.ghlPrivateKey) {
            return { success: false, error: "GHL credentials not configured" };
        }

        const result = await testGHLConnection(client.ghlLocationId, client.ghlPrivateKey);

        if (result.success && result.data) {
            return { success: true, calendarCount: result.data.calendarCount };
        }

        return { success: false, error: result.error || "Connection test failed" };
    } catch (error) {
        console.error("Failed to test GHL connection:", error);
        return { success: false, error: "Connection test failed" };
    }
}

// =============================================================================
// Main Booking Function
// =============================================================================

/**
 * Book a meeting on GHL for a lead
 * 
 * @param leadId - The lead to book for
 * @param selectedSlot - The ISO datetime of the selected slot
 * @param calendarIdOverride - Optional calendar ID override (uses workspace default if not provided)
 */
export async function bookMeetingOnGHL(
    leadId: string,
    selectedSlot: string,
    calendarIdOverride?: string
): Promise<BookingResult> {
    try {
        await requireLeadAccessById(leadId);
        // Get lead with client and settings
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

        // Validate GHL credentials
        if (!client.ghlLocationId || !client.ghlPrivateKey) {
            return { success: false, error: "GHL credentials not configured for this workspace" };
        }

        // Get calendar ID
        const calendarId = calendarIdOverride || settings?.ghlDefaultCalendarId;
        if (!calendarId) {
            return { success: false, error: "No GHL calendar configured" };
        }

        // Ensure the lead is linked to a GHL contact (search-first, upsert standard fields).
        const ensureContact = await ensureGhlContactIdForLead(leadId, { allowCreateWithoutPhone: true });
        if (!ensureContact.success || !ensureContact.ghlContactId) {
            return { success: false, error: ensureContact.error || "Failed to resolve GHL contact for lead" };
        }

        const ghlContactId = ensureContact.ghlContactId;

        // If availability calendar (default CalendarLink) differs from booking calendar, do a preflight check
        // to avoid booking a slot that isn't actually free on the booking calendar.
        try {
            const cache = await getWorkspaceAvailabilityCache(client.id, { refreshIfStale: true });
            const availabilityCalendarId =
                cache?.calendarType === "ghl" ? cache.providerMeta?.ghlCalendarId || null : null;

            const mismatch =
                !!availabilityCalendarId &&
                !!calendarId &&
                availabilityCalendarId !== calendarId;

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
                            const startTime =
                                typeof slot === "string" ? slot : (slot as any)?.startTime;
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

        // Calculate end time based on meeting duration
        const durationMinutes = settings?.meetingDurationMinutes || 30;
        const startTime = new Date(selectedSlot);
        const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

        // Generate meeting title
        const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Lead";
        const companyName = settings?.companyName || client.name;
        let title = settings?.meetingTitle || "Intro to {companyName}";
        title = title
            .replace("{companyName}", companyName)
            .replace("{leadName}", leadName)
            .replace("{firstName}", lead.firstName || "");

        // Create appointment in GHL
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

        // Update lead with appointment info
        await prisma.lead.update({
            where: { id: leadId },
            data: {
                ghlAppointmentId: appointmentResult.data.id,
                appointmentBookedAt: new Date(),
                bookedSlot: selectedSlot,
                status: "meeting-booked",
                offeredSlots: null, // Clear offered slots
            },
        });

        await autoStartPostBookingSequenceIfEligible({ leadId });

        // Stop any non-post-booking sequences once a meeting is booked
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

        revalidatePath("/");

        return {
            success: true,
            appointmentId: appointmentResult.data.id,
            appointment: appointmentResult.data,
        };
    } catch (error) {
        console.error("Failed to book meeting on GHL:", error);
        return { success: false, error: "Failed to book meeting" };
    }
}

/**
 * Get booking status for a lead
 */
export async function getLeadBookingStatus(leadId: string): Promise<{
    hasAppointment: boolean;
    appointmentId?: string;
    bookedAt?: Date;
    bookedSlot?: string;
}> {
    try {
        await requireLeadAccessById(leadId);
        const lead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: {
                ghlAppointmentId: true,
                calendlyInviteeUri: true,
                calendlyScheduledEventUri: true,
                appointmentBookedAt: true,
                bookedSlot: true,
            },
        });

        return {
            hasAppointment:
              !!lead?.appointmentBookedAt ||
              !!lead?.ghlAppointmentId ||
              !!lead?.calendlyInviteeUri ||
              !!lead?.calendlyScheduledEventUri,
            appointmentId: lead?.ghlAppointmentId || lead?.calendlyScheduledEventUri || lead?.calendlyInviteeUri || undefined,
            bookedAt: lead?.appointmentBookedAt || undefined,
            bookedSlot: lead?.bookedSlot || undefined,
        };
    } catch (error) {
        console.error("Failed to get booking status:", error);
        return { hasAppointment: false };
    }
}

/**
 * Check if workspace has GHL booking configured
 */
export async function isGHLBookingConfigured(clientId: string): Promise<boolean> {
    try {
        await requireClientAccess(clientId);
        const client = await prisma.client.findUnique({
            where: { id: clientId },
            include: { settings: true },
        });

        return !!(
            client?.ghlLocationId &&
            client?.ghlPrivateKey &&
            client?.settings?.ghlDefaultCalendarId
        );
    } catch {
        return false;
    }
}

// =============================================================================
// Calendar Availability (Server Action Wrapper)
// =============================================================================

/**
 * Get formatted availability slots for a lead (server action wrapper)
 * This wraps the calendar-availability module function for use in client components
 */
export async function getFormattedAvailabilityForLead(
    clientId: string,
    leadId?: string
): Promise<Array<{ datetime: string; label: string }>> {
    await requireClientAccess(clientId);
    if (leadId) {
        const { clientId: leadClientId } = await requireLeadAccessById(leadId);
        if (leadClientId !== clientId) {
            throw new Error("Lead does not belong to this workspace");
        }
    }
    const [settings, availability] = await Promise.all([
        prisma.workspaceSettings.findUnique({
            where: { clientId },
            select: { calendarSlotsToShow: true, timezone: true },
        }),
        getWorkspaceAvailabilitySlotsUtc(clientId, { refreshIfStale: true }),
    ]);

    if (availability.lastError?.startsWith("Unsupported meeting duration")) {
        throw new Error(availability.lastError);
    }

    const limit = settings?.calendarSlotsToShow || 3;

    if (!leadId) {
        const timeZone = settings?.timezone || "UTC";
        return formatAvailabilitySlots({
            slotsUtcIso: availability.slotsUtc,
            timeZone,
            mode: "explicit_tz",
            limit,
        });
    }

    const tzResult = await ensureLeadTimezone(leadId);
    const timeZone = tzResult.timezone || settings?.timezone || "UTC";
    const mode = tzResult.source === "workspace_fallback" ? "explicit_tz" : "your_time";

    return formatAvailabilitySlots({
        slotsUtcIso: availability.slotsUtc,
        timeZone,
        mode,
        limit,
    });
}

/**
 * Get booking availability for the CRM booking modal.
 * - Returns ALL slots from the 30-day availability cache (not limited by calendarSlotsToShow)
 * - Formats in the lead timezone when available ("your time"), else explicit TZ
 * - Includes a soft distribution signal: offeredCount per slot (workspace-wide)
 */
export async function getBookingAvailabilityForLead(
    clientId: string,
    leadId: string
): Promise<BookingAvailabilitySlot[]> {
    await requireClientAccess(clientId);
    const { clientId: leadClientId } = await requireLeadAccessById(leadId);
    if (leadClientId !== clientId) {
        throw new Error("Lead does not belong to this workspace");
    }
    const [settings, availability, lead] = await Promise.all([
        prisma.workspaceSettings.findUnique({
            where: { clientId },
            select: { timezone: true },
        }),
        getWorkspaceAvailabilitySlotsUtc(clientId, { refreshIfStale: true }),
        prisma.lead.findUnique({
            where: { id: leadId },
            select: { snoozedUntil: true },
        }),
    ]);

    if (availability.lastError?.startsWith("Unsupported meeting duration")) {
        throw new Error(availability.lastError);
    }

    const tzResult = await ensureLeadTimezone(leadId);
    const timeZone = tzResult.timezone || settings?.timezone || "UTC";
    const mode = tzResult.source === "workspace_fallback" ? "explicit_tz" : "your_time";

    const now = new Date();
    const cutoff = lead?.snoozedUntil && lead.snoozedUntil > now ? lead.snoozedUntil : null;

    const slotsUtc = cutoff
        ? availability.slotsUtc.filter((iso) => {
            const t = new Date(iso).getTime();
            return Number.isFinite(t) && t >= cutoff.getTime();
        })
        : availability.slotsUtc;

    const formatted = formatAvailabilitySlots({
        slotsUtcIso: slotsUtc,
        timeZone,
        mode,
        limit: slotsUtc.length,
    });

    const rangeEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const offerCounts = await getWorkspaceSlotOfferCountsForRange(clientId, now, rangeEnd);

    return formatted.map((slot) => ({
        datetime: slot.datetime,
        label: slot.label,
        offeredCount: offerCounts.get(slot.datetime) ?? 0,
    }));
}

export async function getGhlCalendarMismatchInfo(clientId: string): Promise<{
    success: boolean;
    ghlDefaultCalendarId?: string | null;
    calendarLinkGhlCalendarId?: string | null;
    mismatch?: boolean;
    lastError?: string | null;
}> {
    await requireClientAccess(clientId);
    const settings = await prisma.workspaceSettings.findUnique({
        where: { clientId },
        select: { ghlDefaultCalendarId: true },
    });

    const ghlDefaultCalendarId = settings?.ghlDefaultCalendarId || null;

    let cache:
        | (Awaited<ReturnType<typeof getWorkspaceAvailabilityCache>> & {
              providerMeta?: { ghlCalendarId?: string | null };
          })
        | null = null;
    let cacheError: string | null = null;

    try {
        cache = await getWorkspaceAvailabilityCache(clientId, { refreshIfStale: true });
    } catch (error) {
        cacheError = error instanceof Error ? error.message : "Unknown error";
        console.warn("[getGhlCalendarMismatchInfo] availability cache unavailable:", cacheError);
    }

    const calendarLinkGhlCalendarId =
        cache?.calendarType === "ghl" ? (cache as any)?.providerMeta?.ghlCalendarId || null : null;

    const mismatch =
        !!ghlDefaultCalendarId &&
        !!calendarLinkGhlCalendarId &&
        ghlDefaultCalendarId !== calendarLinkGhlCalendarId;

    return {
        success: true,
        ghlDefaultCalendarId,
        calendarLinkGhlCalendarId,
        mismatch,
        lastError: cacheError ?? cache?.lastError ?? null,
    };
}

function extractCalendlyEventTypeUuidFromUri(input: string | null | undefined): string | null {
    const raw = typeof input === "string" ? input.trim() : "";
    if (!raw) return null;

    // Accept:
    // - https://api.calendly.com/event_types/<uuid>
    // - /event_types/<uuid>
    // - event_types/<uuid>
    try {
        const url = new URL(raw);
        const parts = url.pathname.split("/").filter(Boolean);
        const idx = parts.findIndex((p) => p === "event_types");
        if (idx !== -1 && parts[idx + 1]) return parts[idx + 1]!;
    } catch {
        // ignore non-URL inputs
    }

    const match = raw.match(/event_types\/([^/?#]+)/i);
    return match?.[1] ?? null;
}

export async function getCalendlyCalendarMismatchInfo(clientId: string): Promise<{
    success: boolean;
    calendlyEventTypeUuid?: string | null;
    calendarLinkCalendlyEventTypeUuid?: string | null;
    mismatch?: boolean;
    lastError?: string | null;
}> {
    await requireClientAccess(clientId);

    const settings = await prisma.workspaceSettings.findUnique({
        where: { clientId },
        select: { calendlyEventTypeUri: true, calendlyEventTypeLink: true },
    });

    let calendlyEventTypeUuid = extractCalendlyEventTypeUuidFromUri(settings?.calendlyEventTypeUri);

    if (!calendlyEventTypeUuid) {
        const link = settings?.calendlyEventTypeLink?.trim() || "";
        if (link) {
            const resolved = await resolveCalendlyEventTypeUuidFromLink(link).catch(() => null);
            calendlyEventTypeUuid = resolved?.uuid || null;
        }
    }

    let cache:
        | (Awaited<ReturnType<typeof getWorkspaceAvailabilityCache>> & {
              providerMeta?: { calendlyEventTypeUuid?: string | null };
          })
        | null = null;
    let cacheError: string | null = null;

    try {
        cache = await getWorkspaceAvailabilityCache(clientId, { refreshIfStale: true });
    } catch (error) {
        cacheError = error instanceof Error ? error.message : "Unknown error";
        console.warn("[getCalendlyCalendarMismatchInfo] availability cache unavailable:", cacheError);
    }

    const calendarLinkCalendlyEventTypeUuid =
        cache?.calendarType === "calendly" ? (cache as any)?.providerMeta?.calendlyEventTypeUuid || null : null;

    const mismatch =
        !!calendlyEventTypeUuid &&
        !!calendarLinkCalendlyEventTypeUuid &&
        calendlyEventTypeUuid !== calendarLinkCalendlyEventTypeUuid;

    return {
        success: true,
        calendlyEventTypeUuid,
        calendarLinkCalendlyEventTypeUuid,
        mismatch,
        lastError: cacheError ?? cache?.lastError ?? null,
    };
}

// =============================================================================
// Appointment History (Phase 34e)
// =============================================================================

/**
 * DTO for appointment history timeline item
 */
export interface AppointmentHistoryItem {
    id: string;
    provider: MeetingBookingProvider;
    source: AppointmentSource;
    status: AppointmentStatus;
    startAt: string | null; // ISO string
    endAt: string | null; // ISO string
    canceledAt: string | null; // ISO string
    cancelReason: string | null;
    createdAt: string; // ISO string
    // Provider external IDs for linking out
    ghlAppointmentId: string | null;
    calendlyInviteeUri: string | null;
    calendlyScheduledEventUri: string | null;
    // Reschedule chain
    rescheduledFromId: string | null;
}

/**
 * Get appointment history for a lead
 * Returns a bounded list of appointments ordered by creation date (most recent first)
 */
export async function getLeadAppointmentHistory(
    leadId: string,
    opts?: { limit?: number }
): Promise<{ success: boolean; appointments: AppointmentHistoryItem[]; error?: string }> {
    try {
        await requireLeadAccessById(leadId);

        const limit = opts?.limit ?? 20;

        const appointments = await prisma.appointment.findMany({
            where: { leadId },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: {
                id: true,
                provider: true,
                source: true,
                status: true,
                startAt: true,
                endAt: true,
                canceledAt: true,
                cancelReason: true,
                createdAt: true,
                ghlAppointmentId: true,
                calendlyInviteeUri: true,
                calendlyScheduledEventUri: true,
                rescheduledFromId: true,
            },
        });

        // Convert dates to ISO strings for safe serialization
        const items: AppointmentHistoryItem[] = appointments.map((apt) => ({
            id: apt.id,
            provider: apt.provider,
            source: apt.source,
            status: apt.status,
            startAt: apt.startAt?.toISOString() ?? null,
            endAt: apt.endAt?.toISOString() ?? null,
            canceledAt: apt.canceledAt?.toISOString() ?? null,
            cancelReason: apt.cancelReason,
            createdAt: apt.createdAt.toISOString(),
            ghlAppointmentId: apt.ghlAppointmentId,
            calendlyInviteeUri: apt.calendlyInviteeUri,
            calendlyScheduledEventUri: apt.calendlyScheduledEventUri,
            rescheduledFromId: apt.rescheduledFromId,
        }));

        return { success: true, appointments: items };
    } catch (error) {
        console.error("Failed to get appointment history:", error);
        return { success: false, appointments: [], error: "Failed to load appointment history" };
    }
}

/**
 * Get enhanced booking status that includes appointment history count
 * Used to determine if we should show the history timeline
 */
export async function getLeadBookingStatusEnhanced(leadId: string): Promise<{
    hasAppointment: boolean;
    appointmentId?: string;
    bookedAt?: Date;
    bookedSlot?: string;
    appointmentCount: number;
    hasHistory: boolean;
}> {
    try {
        await requireLeadAccessById(leadId);

        const [lead, appointmentCount] = await Promise.all([
            prisma.lead.findUnique({
                where: { id: leadId },
                select: {
                    ghlAppointmentId: true,
                    calendlyInviteeUri: true,
                    calendlyScheduledEventUri: true,
                    appointmentBookedAt: true,
                    bookedSlot: true,
                },
            }),
            prisma.appointment.count({
                where: { leadId },
            }),
        ]);

        return {
            hasAppointment:
                !!lead?.appointmentBookedAt ||
                !!lead?.ghlAppointmentId ||
                !!lead?.calendlyInviteeUri ||
                !!lead?.calendlyScheduledEventUri,
            appointmentId:
                lead?.ghlAppointmentId ||
                lead?.calendlyScheduledEventUri ||
                lead?.calendlyInviteeUri ||
                undefined,
            bookedAt: lead?.appointmentBookedAt || undefined,
            bookedSlot: lead?.bookedSlot || undefined,
            appointmentCount,
            hasHistory: appointmentCount > 0,
        };
    } catch (error) {
        console.error("Failed to get enhanced booking status:", error);
        return { hasAppointment: false, appointmentCount: 0, hasHistory: false };
    }
}
