import "@/lib/server-dns";

const CALENDLY_API_BASE_URL = "https://api.calendly.com";

export type CalendlyApiResult<T> = { success: true; data: T } | { success: false; error: string; status?: number };

function toAbsoluteCalendlyUrl(pathOrUrl: string): string {
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return CALENDLY_API_BASE_URL;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `${CALENDLY_API_BASE_URL}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

async function calendlyRequest<T>(
  accessToken: string,
  pathOrUrl: string,
  init: RequestInit = {}
): Promise<CalendlyApiResult<T>> {
  const token = accessToken.trim();
  if (!token) return { success: false, error: "Missing Calendly access token" };

  const url = toAbsoluteCalendlyUrl(pathOrUrl);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
    const resp = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
    });

    const text = await resp.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!resp.ok) {
      const message =
        (json && typeof json === "object" && "message" in json && typeof (json as any).message === "string"
          ? (json as any).message
          : null) ||
        `Calendly API request failed (${resp.status})`;
      return { success: false, error: message, status: resp.status };
    }

    return { success: true, data: json as T };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Calendly API request failed" };
  }
}

export interface CalendlyUserMe {
  uri: string;
  name?: string;
  email?: string;
  timezone?: string;
  current_organization?: string;
}

export async function getCalendlyUserMe(
  accessToken: string
): Promise<
  CalendlyApiResult<{
    userUri: string;
    organizationUri: string;
    name: string | null;
    email: string | null;
    timezone: string | null;
  }>
> {
  const res = await calendlyRequest<{ resource?: CalendlyUserMe }>(accessToken, "/users/me");
  if (!res.success) return res;

  const resource = res.data?.resource;
  if (!resource || typeof resource !== "object") return { success: false, error: "Calendly /users/me missing resource" };
  if (!resource.uri || typeof resource.uri !== "string") return { success: false, error: "Calendly /users/me missing uri" };
  if (!resource.current_organization || typeof resource.current_organization !== "string") {
    return { success: false, error: "Calendly /users/me missing current_organization" };
  }

  return {
    success: true,
    data: {
      userUri: resource.uri,
      organizationUri: resource.current_organization,
      name: typeof resource.name === "string" && resource.name.trim() ? resource.name.trim() : null,
      email: typeof resource.email === "string" && resource.email.trim() ? resource.email.trim() : null,
      timezone: typeof resource.timezone === "string" && resource.timezone.trim() ? resource.timezone.trim() : null,
    },
  };
}

export interface CalendlyWebhookSubscription {
  uri: string;
  callback_url?: string;
  events?: string[];
  organization?: string;
  scope?: string;
  signing_key?: string;
  state?: string;
  created_at?: string;
}

export async function getCalendlyWebhookSubscription(
  accessToken: string,
  subscriptionUri: string
): Promise<CalendlyApiResult<CalendlyWebhookSubscription>> {
  const res = await calendlyRequest<{ resource?: CalendlyWebhookSubscription }>(accessToken, subscriptionUri);
  if (!res.success) return res;

  const resource = res.data?.resource;
  if (!resource?.uri || typeof resource.uri !== "string") {
    return { success: false, error: "Calendly webhook subscription response missing resource.uri" };
  }
  return { success: true, data: resource };
}

export async function deleteCalendlyWebhookSubscription(
  accessToken: string,
  subscriptionUri: string
): Promise<CalendlyApiResult<{ deleted: true }>> {
  const res = await calendlyRequest<unknown>(accessToken, subscriptionUri, { method: "DELETE" });
  if (!res.success) return res;
  return { success: true, data: { deleted: true } };
}

export async function createCalendlyWebhookSubscription(
  accessToken: string,
  params: {
    url: string;
    events: Array<"invitee.created" | "invitee.canceled">;
    organizationUri: string;
    scope: "organization" | "user";
  }
): Promise<CalendlyApiResult<CalendlyWebhookSubscription>> {
  const res = await calendlyRequest<{ resource?: CalendlyWebhookSubscription }>(accessToken, "/webhook_subscriptions", {
    method: "POST",
    body: JSON.stringify({
      url: params.url,
      events: params.events,
      organization: params.organizationUri,
      scope: params.scope,
    }),
  });
  if (!res.success) return res;

  const resource = res.data?.resource;
  if (!resource?.uri || typeof resource.uri !== "string") {
    return { success: false, error: "Calendly webhook subscription create response missing resource.uri" };
  }
  return { success: true, data: resource };
}

export async function createCalendlyInvitee(
  accessToken: string,
  params: {
    eventTypeUri: string;
    startTimeIso: string;
    invitee: {
      email: string;
      name: string;
      timezone?: string;
    };
  }
): Promise<
  CalendlyApiResult<{
    inviteeUri: string;
    scheduledEventUri: string | null;
  }>
> {
  const res = await calendlyRequest<{ resource?: any }>(accessToken, "/invitees", {
    method: "POST",
    body: JSON.stringify({
      event_type: params.eventTypeUri,
      start_time: params.startTimeIso,
      invitee: {
        email: params.invitee.email,
        name: params.invitee.name,
        timezone: params.invitee.timezone,
      },
    }),
  });
  if (!res.success) return res;

  const resource = res.data?.resource;
  const inviteeUri =
    resource && typeof resource === "object" && typeof resource.uri === "string" ? resource.uri : null;
  if (!inviteeUri) return { success: false, error: "Calendly invitee create response missing resource.uri" };

  const scheduledEvent =
    resource && typeof resource === "object" && resource.scheduled_event !== undefined ? resource.scheduled_event : null;
  const scheduledEventUri =
    typeof scheduledEvent === "string"
      ? scheduledEvent
      : scheduledEvent && typeof scheduledEvent === "object" && typeof (scheduledEvent as any).uri === "string"
        ? (scheduledEvent as any).uri
        : null;

  return { success: true, data: { inviteeUri, scheduledEventUri } };
}
