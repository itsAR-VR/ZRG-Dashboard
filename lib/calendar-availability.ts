/**
 * Calendar Availability Module
 *
 * Fetches real-time availability from Calendly, HubSpot, and GoHighLevel calendars.
 * Based on the n8n workflow patterns for calendar integration.
 */

import { prisma } from "@/lib/prisma";

// =============================================================================
// Types
// =============================================================================

export type CalendarType = "calendly" | "hubspot" | "ghl" | "unknown";

export interface AvailabilitySlot {
    startTime: Date;
    endTime?: Date;
}

export interface AvailabilityResult {
    success: boolean;
    slots: AvailabilitySlot[];
    calendarType: CalendarType;
    calendarName?: string;
    calendarUrl?: string;
    error?: string;
    requiresManualReview?: boolean;
}

// =============================================================================
// Calendar Type Detection
// =============================================================================

/**
 * Detects calendar type from URL patterns
 */
export function detectCalendarType(url: string): CalendarType {
    const lowerUrl = url.toLowerCase();

    // Calendly patterns
    if (lowerUrl.includes("calendly.com")) {
        return "calendly";
    }

    // HubSpot patterns
    if (
        lowerUrl.includes("meetings.hubspot.com") ||
        lowerUrl.includes("hubspot.com/meetings") ||
        lowerUrl.includes("/meetings/")
    ) {
        return "hubspot";
    }

    // GoHighLevel patterns
    if (
        lowerUrl.includes("leadconnectorhq.com") ||
        lowerUrl.includes("gohighlevel.com") ||
        lowerUrl.includes("msgsndr.com") ||
        lowerUrl.includes(".highlevel.") ||
        // Common GHL custom domain patterns
        lowerUrl.includes("/widget/booking/") ||
        lowerUrl.includes("/widget/bookings/")
    ) {
        return "ghl";
    }

    return "unknown";
}

// =============================================================================
// Calendly Integration
// =============================================================================

interface CalendlyEventInfo {
    uuid: string;
    availability_timezone: string;
}

type ParsedCalendlyUrl =
    | { kind: "event"; profileSlug: string; eventSlug: string }
    | { kind: "single"; slug: string };

const CALENDLY_DEFAULT_TIMEOUT_MS = 12_000;

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            headers: { Accept: "application/json" },
            cache: "no-store",
            redirect: "follow",
            signal: controller.signal,
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes("abort")) {
            console.warn("Calendly request timed out:", url);
            return null;
        }
        console.error("Calendly request failed:", url, error);
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchTextWithTimeout(
    url: string,
    init: Omit<RequestInit, "signal">,
    timeoutMs: number
): Promise<{ ok: boolean; status: number; url: string; text: string } | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...init,
            cache: "no-store",
            redirect: "follow",
            signal: controller.signal,
        });

        const text = await response.text();
        return { ok: response.ok, status: response.status, url: response.url, text };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes("abort")) {
            console.warn("Request timed out:", url);
            return null;
        }
        console.error("Request failed:", url, error);
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Parse Calendly URL to extract profile and event slugs
 */
function parseCalendlyUrl(url: string): ParsedCalendlyUrl | null {
    try {
        // Clean URL - remove query params for parsing
        const cleanUrl = url.split("?")[0];
        const urlObj = new URL(cleanUrl);
        const pathParts = urlObj.pathname.split("/").filter(Boolean);

        if (pathParts.length >= 2) {
            return {
                kind: "event",
                profileSlug: pathParts[0]!,
                eventSlug: pathParts[1]!,
            };
        }
        if (pathParts.length === 1) {
            return {
                kind: "single",
                slug: pathParts[0]!,
            };
        }
    } catch {
        // Invalid URL
    }
    return null;
}

/**
 * Get Calendly event UUID from standard URL
 */
async function getCalendlyEventUUID(profileSlug: string, eventSlug: string): Promise<CalendlyEventInfo | null> {
    try {
        const data = await fetchJsonWithTimeout(
            `https://calendly.com/api/booking/event_types/lookup?event_type_slug=${encodeURIComponent(eventSlug)}&profile_slug=${encodeURIComponent(profileSlug)}`,
            CALENDLY_DEFAULT_TIMEOUT_MS
        );

        if (!data) return null;
        return {
            uuid: data.uuid,
            availability_timezone: data.availability_timezone || "UTC",
        };
    } catch (error) {
        console.error("Failed to get Calendly event UUID:", error);
    }
    return null;
}

async function getCalendlyProfileDefaultEventInfo(profileSlug: string): Promise<CalendlyEventInfo | null> {
    const profile = await fetchJsonWithTimeout(
        `https://calendly.com/api/booking/profiles/${encodeURIComponent(profileSlug)}`,
        CALENDLY_DEFAULT_TIMEOUT_MS
    );
    if (!profile) return null;

    const eventTypes = await fetchJsonWithTimeout(
        `https://calendly.com/api/booking/profiles/${encodeURIComponent(profileSlug)}/event_types`,
        CALENDLY_DEFAULT_TIMEOUT_MS
    );

    if (!Array.isArray(eventTypes) || eventTypes.length === 0) return null;

    const first = eventTypes[0];
    if (!first?.uuid) return null;

    if (eventTypes.length > 1) {
        console.warn(
            "Calendly profile URL has multiple event types; using first:",
            profileSlug,
            String(first?.slug || first?.name || "")
        );
    }

    return {
        uuid: first.uuid,
        availability_timezone: profile.timezone || "UTC",
    };
}

/**
 * Get Calendly event UUID from scheduling link
 */
async function getCalendlySchedulingLinkUUID(slug: string): Promise<CalendlyEventInfo | null> {
    try {
        // First, get the scheduling link info
        const linkData = await fetchJsonWithTimeout(
            `https://calendly.com/api/booking/scheduling_links/${encodeURIComponent(slug)}`,
            CALENDLY_DEFAULT_TIMEOUT_MS
        );

        if (!linkData) return null;

        // Then get the event type using the owner_uuid
        const eventData = await fetchJsonWithTimeout(
            `https://calendly.com/api/booking/event_types/lookup?share_uuid=${encodeURIComponent(linkData.owner_uuid)}`,
            CALENDLY_DEFAULT_TIMEOUT_MS
        );
        if (!eventData) return null;

        return {
            uuid: eventData.uuid,
            availability_timezone: eventData.availability_timezone || "UTC",
        };
    } catch (error) {
        console.error("Failed to get Calendly scheduling link UUID:", error);
    }
    return null;
}

/**
 * Fetch availability from Calendly
 */
export async function fetchCalendlyAvailabilityWithMeta(
    url: string,
    days: number = 28,
    opts?: { eventTypeUuid?: string | null; availabilityTimezone?: string | null }
): Promise<{
    slots: AvailabilitySlot[];
    eventTypeUuid: string | null;
    availabilityTimezone: string | null;
}> {
    const cachedUuid = typeof opts?.eventTypeUuid === "string" && opts.eventTypeUuid ? opts.eventTypeUuid : null;
    const cachedTz =
        typeof opts?.availabilityTimezone === "string" && opts.availabilityTimezone ? opts.availabilityTimezone : null;

    if (cachedUuid) {
        try {
            const now = new Date();
            const rangeStart = now.toISOString().split("T")[0];
            const rangeEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

            const data = await fetchJsonWithTimeout(
                `https://calendly.com/api/booking/event_types/${cachedUuid}/calendar/range?range_start=${rangeStart}&range_end=${rangeEnd}&timezone=${encodeURIComponent(cachedTz || "UTC")}`,
                Math.max(CALENDLY_DEFAULT_TIMEOUT_MS, 20_000)
            );

            if (data) {
                const slots: AvailabilitySlot[] = [];

                if (data.days && Array.isArray(data.days)) {
                    for (const day of data.days) {
                        if (day.spots && Array.isArray(day.spots)) {
                            for (const spot of day.spots) {
                                if (spot.start_time) {
                                    slots.push({
                                        startTime: new Date(spot.start_time),
                                    });
                                }
                            }
                        }
                    }
                }

                return { slots, eventTypeUuid: cachedUuid, availabilityTimezone: cachedTz };
            }
        } catch (error) {
            console.error("Failed to fetch Calendly availability using cached event type:", error);
        }
    }

    const parsed = parseCalendlyUrl(url);
    if (!parsed) {
        console.error("Failed to parse Calendly URL:", url);
        return { slots: [], eventTypeUuid: null, availabilityTimezone: null };
    }

    // Try standard URL first, then scheduling link
    let eventInfo: CalendlyEventInfo | null = null;

    if (parsed.kind === "event") {
        eventInfo = await getCalendlyEventUUID(parsed.profileSlug, parsed.eventSlug);
        if (!eventInfo) {
            eventInfo = await getCalendlySchedulingLinkUUID(parsed.eventSlug);
        }
    } else {
        // Single-segment Calendly URLs can be either a scheduling link or a profile slug.
        eventInfo = await getCalendlySchedulingLinkUUID(parsed.slug);
        if (!eventInfo) {
            eventInfo = await getCalendlyProfileDefaultEventInfo(parsed.slug);
        }
    }

    if (!eventInfo) {
        console.error("Could not resolve Calendly event UUID for:", url);
        return { slots: [], eventTypeUuid: null, availabilityTimezone: null };
    }

    try {
        const now = new Date();
        const rangeStart = now.toISOString().split("T")[0];
        const rangeEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        const data = await fetchJsonWithTimeout(
            `https://calendly.com/api/booking/event_types/${eventInfo.uuid}/calendar/range?range_start=${rangeStart}&range_end=${rangeEnd}&timezone=${encodeURIComponent(eventInfo.availability_timezone)}`,
            Math.max(CALENDLY_DEFAULT_TIMEOUT_MS, 20_000)
        );

        if (!data) {
            console.error("Calendly availability request failed");
            return { slots: [], eventTypeUuid: eventInfo.uuid, availabilityTimezone: eventInfo.availability_timezone || null };
        }
        const slots: AvailabilitySlot[] = [];

        // Parse the days/spots structure
        if (data.days && Array.isArray(data.days)) {
            for (const day of data.days) {
                if (day.spots && Array.isArray(day.spots)) {
                    for (const spot of day.spots) {
                        if (spot.start_time) {
                            slots.push({
                                startTime: new Date(spot.start_time),
                            });
                        }
                    }
                }
            }
        }

        return { slots, eventTypeUuid: eventInfo.uuid, availabilityTimezone: eventInfo.availability_timezone || null };
    } catch (error) {
        console.error("Failed to fetch Calendly availability:", error);
        return { slots: [], eventTypeUuid: eventInfo.uuid, availabilityTimezone: eventInfo.availability_timezone || null };
    }
}

export async function fetchCalendlyAvailability(url: string, days: number = 28): Promise<AvailabilitySlot[]> {
    const result = await fetchCalendlyAvailabilityWithMeta(url, days);
    return result.slots;
}

// =============================================================================
// HubSpot Integration
// =============================================================================

/**
 * Parse HubSpot meeting URL to extract slug
 */
function parseHubSpotUrl(url: string): string | null {
    try {
        const urlObj = new URL(url);

        // Pattern: meetings.hubspot.com/{slug}
        if (urlObj.hostname === "meetings.hubspot.com") {
            const slug = urlObj.pathname.split("/").filter(Boolean)[0];
            return slug || null;
        }

        // Pattern: *.hubspot.com/meetings/{slug}
        if (urlObj.pathname.includes("/meetings/")) {
            const parts = urlObj.pathname.split("/meetings/");
            if (parts[1]) {
                return parts[1].split("/")[0].split("?")[0];
            }
        }
    } catch {
        // Invalid URL
    }
    return null;
}

/**
 * Fetch availability from HubSpot
 */
export async function fetchHubSpotAvailability(url: string, days: number = 28): Promise<AvailabilitySlot[]> {
    const slug = parseHubSpotUrl(url);
    if (!slug) {
        console.error("Failed to parse HubSpot URL:", url);
        return [];
    }

    const slots: AvailabilitySlot[] = [];
    const monthsNeeded = Math.ceil(days / 30);

    try {
        for (let monthOffset = 0; monthOffset < monthsNeeded; monthOffset++) {
            const data = await fetchJsonWithTimeout(
                `https://api.hubspot.com/meetings-public/v3/book/availability-page?slug=${encodeURIComponent(slug)}&monthOffset=${monthOffset}&timezone=UTC`,
                CALENDLY_DEFAULT_TIMEOUT_MS
            );

            if (!data) {
                console.error("HubSpot availability request failed");
                break;
            }

            // Parse the availability structure
            // HubSpot returns: linkAvailability.linkAvailabilityByDuration['1800000'].availabilities
            const linkAvailability = data.linkAvailability;
            if (linkAvailability?.linkAvailabilityByDuration) {
                // Enforce 30-minute slots (1800000ms) to match platform booking logic
                const duration30 =
                    (linkAvailability.linkAvailabilityByDuration as any)?.["1800000"] as
                        | { availabilities?: Array<{ startMillisUtc: number }> }
                        | undefined;

                if (duration30?.availabilities && Array.isArray(duration30.availabilities)) {
                    for (const avail of duration30.availabilities) {
                        if (avail.startMillisUtc) {
                            slots.push({
                                startTime: new Date(avail.startMillisUtc),
                            });
                        }
                    }
                }
            }

            // Check if there are more months available
            if (!linkAvailability?.hasMore) {
                break;
            }
        }

        return slots;
    } catch (error) {
        console.error("Failed to fetch HubSpot availability:", error);
        return [];
    }
}

// =============================================================================
// GoHighLevel Integration
// =============================================================================

/**
 * Extract calendar ID from GHL page HTML
 * Parses the __NUXT_DATA__ script to find the calendar ID
 */
function extractGHLCalendarId(html: string): string | null {
    try {
        // Find the NUXT_DATA script tag (Nuxt variants: id="__NUXT_DATA__" or id="NUXT_DATA")
        const nuxtMatch = html.match(/<script[^>]*id="(?:__)?NUXT_DATA(?:__)?"[^>]*>([\s\S]*?)<\/script>/i);
        if (!nuxtMatch) {
            console.error("No __NUXT_DATA__ found in GHL page");
            return null;
        }

        const nuxtJson = nuxtMatch[1].trim();
        const nuxtData = JSON.parse(nuxtJson);

        if (!Array.isArray(nuxtData)) {
            return null;
        }

        // Look for an object whose only key looks like a calendar ID
        // GHL calendar IDs are typically 20+ alphanumeric characters
        for (const item of nuxtData) {
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;

            const keys = Object.keys(item);
            if (keys.length !== 1) continue;

            const key = keys[0];
            if (/^[A-Za-z0-9]{20,}$/.test(key)) {
                return key;
            }
        }
    } catch (error) {
        console.error("Failed to extract GHL calendar ID:", error);
    }
    return null;
}

/**
 * Fetch availability from GoHighLevel
 */
export async function fetchGHLAvailabilityWithMeta(
    url: string,
    days: number = 28,
    opts?: { calendarIdHint?: string | null }
): Promise<{
    slots: AvailabilitySlot[];
    calendarId: string | null;
    resolvedUrl?: string;
    error?: string;
}> {
    try {
        const hint = typeof opts?.calendarIdHint === "string" && opts.calendarIdHint ? opts.calendarIdHint : null;

        if (hint) {
            const now = Date.now();
            const endDate = now + days * 24 * 60 * 60 * 1000;

            const direct = await fetchJsonWithTimeout(
                `https://backend.leadconnectorhq.com/calendars/${hint}/free-slots?startDate=${now}&endDate=${endDate}&timezone=UTC`,
                Math.max(CALENDLY_DEFAULT_TIMEOUT_MS, 15_000)
            );

            if (direct) {
                const slots: AvailabilitySlot[] = [];

                for (const [key, value] of Object.entries(direct)) {
                    if (key === "traceId") continue;

                    const daySlots = (value as any)?.slots;
                    if (Array.isArray(daySlots)) {
                        for (const slot of daySlots) {
                            const startTime = typeof slot === "string" ? slot : (slot as any)?.startTime;
                            if (typeof startTime === "string" && startTime) {
                                slots.push({ startTime: new Date(startTime) });
                            }
                        }
                    }
                }

                return { slots, calendarId: hint, resolvedUrl: url };
            }

            // If the hinted calendarId failed, fall back to resolving from the booking page.
            console.warn("GHL free-slots request failed for cached calendarId; attempting to re-resolve from page.");
        }

        // First, fetch the calendar page HTML to get the calendar ID
        const page = await fetchTextWithTimeout(
            url,
            {
                headers: {
                    Accept: "text/html",
                    "User-Agent": "Mozilla/5.0 (compatible; ZRG-Dashboard/1.0)",
                },
            },
            Math.max(CALENDLY_DEFAULT_TIMEOUT_MS, 15_000)
        );

        if (!page || !page.ok) {
            const status = page?.status || "unknown";
            const resolvedUrl = page?.url;
            console.error("Failed to fetch GHL calendar page:", status);
            return {
                slots: [],
                calendarId: null,
                resolvedUrl,
                error: `GHL booking page fetch failed (${status})`,
            };
        }

        const html = page.text;
        const calendarId = extractGHLCalendarId(html);

        if (!calendarId) {
            console.error("Could not extract calendar ID from GHL page");
            return {
                slots: [],
                calendarId: null,
                resolvedUrl: page.url,
                error: "Could not extract calendar ID from GHL booking page",
            };
        }

        // Now fetch the free slots
        const now = Date.now();
        const endDate = now + days * 24 * 60 * 60 * 1000;

        const data = await fetchJsonWithTimeout(
            `https://backend.leadconnectorhq.com/calendars/${calendarId}/free-slots?startDate=${now}&endDate=${endDate}&timezone=UTC`,
            Math.max(CALENDLY_DEFAULT_TIMEOUT_MS, 15_000)
        );

        if (!data) {
            console.error("GHL free-slots request failed");
            return {
                slots: [],
                calendarId,
                resolvedUrl: page.url,
                error: "GHL free-slots request failed",
            };
        }
        const slots: AvailabilitySlot[] = [];

        // Parse GHL response - it returns date keys with slots arrays
        for (const [key, value] of Object.entries(data)) {
            // Skip metadata keys
            if (key === "traceId") continue;

            const dayData = value as { slots?: unknown[] };
            const daySlots = (dayData as any)?.slots;
            if (Array.isArray(daySlots)) {
                for (const slot of daySlots) {
                    // Some GHL responses return slot ISO strings directly; others use objects with startTime.
                    const startTime =
                        typeof slot === "string"
                            ? slot
                            : (slot as any)?.startTime;
                    if (typeof startTime === "string" && startTime) {
                        slots.push({ startTime: new Date(startTime) });
                    }
                }
            }
        }

        return { slots, calendarId, resolvedUrl: page.url };
    } catch (error) {
        console.error("Failed to fetch GHL availability:", error);
        return { slots: [], calendarId: null, error: error instanceof Error ? error.message : "Unknown error" };
    }
}

/**
 * Fetch availability from GoHighLevel (slots only)
 */
export async function fetchGHLAvailability(url: string, days: number = 28): Promise<AvailabilitySlot[]> {
    const result = await fetchGHLAvailabilityWithMeta(url, days);
    return result.slots;
}

// =============================================================================
// Main Availability Function
// =============================================================================

/**
 * Format availability slots for display in emails
 */
function formatSlotsForDisplay(slots: AvailabilitySlot[], timezone: string, count: number): string[] {
    const formatted: string[] = [];

    for (const slot of slots.slice(0, count)) {
        try {
            const date = slot.startTime;

            // Format: "Mon, Dec 9 · 10:00 AM (America/New_York)"
            const dayPart = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                weekday: "short",
                month: "short",
                day: "numeric",
            }).format(date);

            const timePart = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
            }).format(date);

            formatted.push(`${dayPart} · ${timePart} (${timezone})`);
        } catch (error) {
            console.error("Failed to format slot:", error);
        }
    }

    return formatted;
}

/**
 * Get availability for a lead
 * Resolves the calendar to use (lead preference or workspace default),
 * fetches slots, and converts to the appropriate timezone
 */
export async function getAvailabilityForLead(leadId: string): Promise<AvailabilityResult> {
    try {
        // Fetch lead with calendar preference and client settings
        const lead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: {
                id: true,
                timezone: true,
                preferredCalendarLinkId: true,
                preferredCalendarLink: {
                    select: {
                        id: true,
                        name: true,
                        url: true,
                        type: true,
                    },
                },
                client: {
                    select: {
                        id: true,
                        calendarLinks: {
                            where: { isDefault: true },
                            take: 1,
                            select: {
                                id: true,
                                name: true,
                                url: true,
                                type: true,
                            },
                        },
                        settings: {
                            select: {
                                timezone: true,
                                calendarSlotsToShow: true,
                                calendarLookAheadDays: true,
                            },
                        },
                    },
                },
            },
        });

        if (!lead) {
            return {
                success: false,
                slots: [],
                calendarType: "unknown",
                error: "Lead not found",
                requiresManualReview: true,
            };
        }

        // Determine which calendar to use
        const calendar = lead.preferredCalendarLink || lead.client.calendarLinks[0];

        if (!calendar) {
            return {
                success: false,
                slots: [],
                calendarType: "unknown",
                error: "No calendar configured",
                requiresManualReview: true,
            };
        }

        // Get settings
        const settings = lead.client.settings;
        const slotsToShow = settings?.calendarSlotsToShow || 3;
        const lookAheadDays = settings?.calendarLookAheadDays || 28;
        const timezone = lead.timezone || settings?.timezone || "UTC";

        // Fetch availability based on calendar type
        const calendarType = calendar.type as CalendarType;
        let rawSlots: AvailabilitySlot[] = [];

        switch (calendarType) {
            case "calendly":
                rawSlots = await fetchCalendlyAvailability(calendar.url, lookAheadDays);
                break;
            case "hubspot":
                rawSlots = await fetchHubSpotAvailability(calendar.url, lookAheadDays);
                break;
            case "ghl":
                rawSlots = await fetchGHLAvailability(calendar.url, lookAheadDays);
                break;
            default:
                return {
                    success: false,
                    slots: [],
                    calendarType: "unknown",
                    calendarName: calendar.name,
                    calendarUrl: calendar.url,
                    error: `Unknown calendar type: ${calendar.type}`,
                    requiresManualReview: true,
                };
        }

        if (rawSlots.length === 0) {
            return {
                success: false,
                slots: [],
                calendarType,
                calendarName: calendar.name,
                calendarUrl: calendar.url,
                error: "No availability slots found",
                requiresManualReview: true,
            };
        }

        // Sort slots by date and take only what we need
        rawSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
        const limitedSlots = rawSlots.slice(0, slotsToShow);

        return {
            success: true,
            slots: limitedSlots,
            calendarType,
            calendarName: calendar.name,
            calendarUrl: calendar.url,
        };
    } catch (error) {
        console.error("Failed to get availability for lead:", error);
        return {
            success: false,
            slots: [],
            calendarType: "unknown",
            error: error instanceof Error ? error.message : "Unknown error",
            requiresManualReview: true,
        };
    }
}

/**
 * Get formatted availability strings for a lead (ready for AI prompts)
 * Now includes filtering of booked slots
 */
export async function getFormattedAvailabilityForLead(
    clientId: string,
    leadId?: string
): Promise<Array<{ datetime: string; label: string }>> {
    try {
        // Determine which calendar to use
        const calendarLink = await prisma.calendarLink.findFirst({
            where: {
                clientId,
                isDefault: true,
            },
            select: {
                url: true,
                type: true,
                name: true,
            },
        });

        if (!calendarLink) {
            return [];
        }

        // Get workspace settings
        const settings = await prisma.workspaceSettings.findUnique({
            where: { clientId },
            select: {
                timezone: true,
                calendarSlotsToShow: true,
                calendarLookAheadDays: true,
            },
        });

        const lookAheadDays = settings?.calendarLookAheadDays || 28;
        const slotsToShow = settings?.calendarSlotsToShow || 3;
        const timezone = settings?.timezone || "America/Los_Angeles";

        // Fetch availability based on calendar type
        const calendarType = calendarLink.type as CalendarType;
        let rawSlots: AvailabilitySlot[] = [];

        switch (calendarType) {
            case "calendly":
                rawSlots = await fetchCalendlyAvailability(calendarLink.url, lookAheadDays);
                break;
            case "hubspot":
                rawSlots = await fetchHubSpotAvailability(calendarLink.url, lookAheadDays);
                break;
            case "ghl":
                rawSlots = await fetchGHLAvailability(calendarLink.url, lookAheadDays);
                break;
            default:
                return [];
        }

        if (rawSlots.length === 0) {
            return [];
        }

        // Get booked slots from leads to filter out
        const bookedSlots = await prisma.lead.findMany({
            where: {
                clientId,
                bookedSlot: { not: null },
            },
            select: {
                bookedSlot: true,
            },
        });

        const bookedDatetimes = new Set(
            bookedSlots
                .filter(l => l.bookedSlot)
                .map(l => new Date(l.bookedSlot!).toISOString())
        );

        // Filter out booked slots
        const availableSlots = rawSlots.filter(
            slot => !bookedDatetimes.has(slot.startTime.toISOString())
        );

        // Sort by date
        availableSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

        // Format slots for display
        const formattedSlots = availableSlots.slice(0, slotsToShow * 2).map(slot => {
            const date = slot.startTime;

            const dayPart = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                weekday: "long",
                month: "short",
                day: "numeric",
            }).format(date);

            const timePart = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
            }).format(date);

            return {
                datetime: date.toISOString(),
                label: `${timePart} on ${dayPart}`,
            };
        });

        return formattedSlots.slice(0, slotsToShow);
    } catch (error) {
        console.error("Failed to get formatted availability:", error);
        return [];
    }
}

/**
 * Legacy function for backward compatibility
 */
export async function getFormattedAvailabilityForLeadLegacy(leadId: string): Promise<{
    success: boolean;
    slots: string[];
    calendarUrl?: string;
    error?: string;
    requiresManualReview?: boolean;
}> {
    const result = await getAvailabilityForLead(leadId);

    if (!result.success || result.slots.length === 0) {
        return {
            success: false,
            slots: [],
            calendarUrl: result.calendarUrl,
            error: result.error,
            requiresManualReview: result.requiresManualReview,
        };
    }

    // Get lead timezone for formatting
    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: {
            timezone: true,
            client: {
                select: {
                    settings: {
                        select: {
                            timezone: true,
                            calendarSlotsToShow: true,
                        },
                    },
                },
            },
        },
    });

    const timezone = lead?.timezone || lead?.client?.settings?.timezone || "UTC";
    const slotsToShow = lead?.client?.settings?.calendarSlotsToShow || 3;

    const formattedSlots = formatSlotsForDisplay(result.slots, timezone, slotsToShow);

    return {
        success: true,
        slots: formattedSlots,
        calendarUrl: result.calendarUrl,
    };
}
