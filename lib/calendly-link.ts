import "@/lib/server-dns";

type ParsedCalendlyUrl =
  | { kind: "event"; profileSlug: string; eventSlug: string }
  | { kind: "single"; slug: string };

type CalendlyEventInfo = { uuid: string; availabilityTimezone?: string };

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
    if (message.toLowerCase().includes("abort")) return null;
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseCalendlyUrl(url: string): ParsedCalendlyUrl | null {
  try {
    const cleanUrl = url.split("?")[0];
    const urlObj = new URL(cleanUrl);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);

    if (pathParts.length >= 2) {
      return { kind: "event", profileSlug: pathParts[0]!, eventSlug: pathParts[1]! };
    }
    if (pathParts.length === 1) {
      return { kind: "single", slug: pathParts[0]! };
    }
  } catch {
    // ignore
  }
  return null;
}

async function getCalendlyEventUUID(profileSlug: string, eventSlug: string): Promise<CalendlyEventInfo | null> {
  const data = await fetchJsonWithTimeout(
    `https://calendly.com/api/booking/event_types/lookup?event_type_slug=${encodeURIComponent(eventSlug)}&profile_slug=${encodeURIComponent(profileSlug)}`,
    CALENDLY_DEFAULT_TIMEOUT_MS
  );
  if (!data?.uuid) return null;
  return { uuid: data.uuid, availabilityTimezone: data.availability_timezone || undefined };
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
  return { uuid: first.uuid, availabilityTimezone: profile.timezone || undefined };
}

async function getCalendlySchedulingLinkUUID(slug: string): Promise<CalendlyEventInfo | null> {
  const linkData = await fetchJsonWithTimeout(
    `https://calendly.com/api/booking/scheduling_links/${encodeURIComponent(slug)}`,
    CALENDLY_DEFAULT_TIMEOUT_MS
  );
  if (!linkData?.owner_uuid) return null;

  const eventData = await fetchJsonWithTimeout(
    `https://calendly.com/api/booking/event_types/lookup?share_uuid=${encodeURIComponent(linkData.owner_uuid)}`,
    CALENDLY_DEFAULT_TIMEOUT_MS
  );
  if (!eventData?.uuid) return null;

  return { uuid: eventData.uuid, availabilityTimezone: eventData.availability_timezone || undefined };
}

export async function resolveCalendlyEventTypeUuidFromLink(url: string): Promise<CalendlyEventInfo | null> {
  const parsed = parseCalendlyUrl(url);
  if (!parsed) return null;

  if (parsed.kind === "event") {
    return (await getCalendlyEventUUID(parsed.profileSlug, parsed.eventSlug)) ?? (await getCalendlySchedulingLinkUUID(parsed.eventSlug));
  }

  return (await getCalendlySchedulingLinkUUID(parsed.slug)) ?? (await getCalendlyProfileDefaultEventInfo(parsed.slug));
}

export function toCalendlyEventTypeUri(uuid: string): string {
  return `https://api.calendly.com/event_types/${uuid}`;
}

