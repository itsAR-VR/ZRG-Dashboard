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
    questionsAndAnswers?: Array<{
      question: string;
      answer: string;
      position: number;
    }>;
  }
): Promise<
  CalendlyApiResult<{
    inviteeUri: string;
    scheduledEventUri: string | null;
  }>
> {
  const questionsAndAnswers = Array.isArray(params.questionsAndAnswers)
    ? params.questionsAndAnswers
        .map((qa) => ({
          question: typeof qa.question === "string" ? qa.question.trim() : "",
          answer: typeof qa.answer === "string" ? qa.answer.trim() : "",
          position: Number.isFinite(qa.position) ? Math.max(0, Math.trunc(qa.position)) : 0,
        }))
        .filter((qa) => qa.question && qa.answer)
    : [];

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
      ...(questionsAndAnswers.length > 0 ? { questions_and_answers: questionsAndAnswers } : {}),
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

export type CalendlyEventTypeCustomQuestion = {
  name: string;
  type?: string | null;
  position: number;
  enabled?: boolean | null;
  required?: boolean | null;
};

export type CalendlyEventType = {
  uri: string;
  name?: string | null;
  scheduling_url?: string | null;
  custom_questions: CalendlyEventTypeCustomQuestion[];
};

function toCustomQuestions(raw: unknown): CalendlyEventTypeCustomQuestion[] {
  if (!Array.isArray(raw)) return [];

  const result: CalendlyEventTypeCustomQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const position = typeof record.position === "number" && Number.isFinite(record.position) ? Math.trunc(record.position) : null;
    if (!name || position === null) continue;
    result.push({
      name,
      type: typeof record.type === "string" ? record.type : null,
      position,
      enabled: typeof record.enabled === "boolean" ? record.enabled : null,
      required: typeof record.required === "boolean" ? record.required : null,
    });
  }
  return result;
}

export async function getCalendlyEventType(
  accessToken: string,
  eventTypeUri: string
): Promise<CalendlyApiResult<CalendlyEventType>> {
  const res = await calendlyRequest<{ resource?: any }>(accessToken, eventTypeUri);
  if (!res.success) return res;

  const resource = res.data?.resource;
  const uri = resource && typeof resource === "object" && typeof resource.uri === "string" ? resource.uri : null;
  if (!uri) return { success: false, error: "Calendly event type response missing resource.uri" };

  return {
    success: true,
    data: {
      uri,
      name: resource && typeof resource === "object" && typeof resource.name === "string" ? resource.name : null,
      scheduling_url:
        resource && typeof resource === "object" && typeof resource.scheduling_url === "string" ? resource.scheduling_url : null,
      custom_questions: toCustomQuestions(resource && typeof resource === "object" ? resource.custom_questions : null),
    },
  };
}

// =============================================================================
// Reconciliation Helpers (Phase 28c)
// =============================================================================

/**
 * Calendly scheduled event structure (from GET /scheduled_events)
 */
export interface CalendlyScheduledEvent {
  uri: string;
  name?: string;
  status: "active" | "canceled";
  start_time: string;
  end_time: string;
  event_type?: string;
  location?: {
    type?: string;
    location?: string;
    join_url?: string;
  };
  created_at?: string;
  updated_at?: string;
  cancellation?: {
    canceled_by?: string;
    reason?: string;
  };
}

/**
 * Calendly invitee structure (from GET /scheduled_events/{uuid}/invitees)
 */
export interface CalendlyInvitee {
  uri: string;
  email: string;
  name?: string;
  status: "active" | "canceled";
  timezone?: string;
  reschedule_url?: string;
  cancel_url?: string;
  created_at?: string;
  updated_at?: string;
  no_show?: {
    uri?: string;
    created_at?: string;
  } | null;
  questions_and_answers?: Array<{
    question: string;
    answer: string;
    position: number;
  }>;
}

export interface ListScheduledEventsParams {
  organizationUri?: string;
  userUri?: string;
  inviteeEmail?: string;
  minStartTime?: string; // ISO datetime
  maxStartTime?: string; // ISO datetime
  status?: "active" | "canceled";
  pageToken?: string;
  count?: number; // Max 100
}

export interface ListScheduledEventsResponse {
  collection: CalendlyScheduledEvent[];
  pagination: {
    count: number;
    next_page?: string;
    next_page_token?: string;
    previous_page?: string;
    previous_page_token?: string;
  };
}

/**
 * List scheduled events with optional filters.
 * Supports filtering by invitee email, time range, and status.
 *
 * @param accessToken - Calendly access token
 * @param params - Query parameters
 */
export async function listCalendlyScheduledEvents(
  accessToken: string,
  params: ListScheduledEventsParams
): Promise<CalendlyApiResult<ListScheduledEventsResponse>> {
  const queryParams = new URLSearchParams();

  if (params.organizationUri) queryParams.set("organization", params.organizationUri);
  if (params.userUri) queryParams.set("user", params.userUri);
  if (params.inviteeEmail) queryParams.set("invitee_email", params.inviteeEmail.toLowerCase());
  if (params.minStartTime) queryParams.set("min_start_time", params.minStartTime);
  if (params.maxStartTime) queryParams.set("max_start_time", params.maxStartTime);
  if (params.status) queryParams.set("status", params.status);
  if (params.pageToken) queryParams.set("page_token", params.pageToken);
  if (params.count) queryParams.set("count", String(Math.min(100, params.count)));

  const url = `/scheduled_events?${queryParams.toString()}`;
  return calendlyRequest<ListScheduledEventsResponse>(accessToken, url);
}

export interface ListEventInviteesResponse {
  collection: CalendlyInvitee[];
  pagination: {
    count: number;
    next_page?: string;
    next_page_token?: string;
  };
}

/**
 * Get invitees for a scheduled event.
 *
 * @param accessToken - Calendly access token
 * @param scheduledEventUri - Full URI of the scheduled event
 */
export async function listCalendlyEventInvitees(
  accessToken: string,
  scheduledEventUri: string
): Promise<CalendlyApiResult<ListEventInviteesResponse>> {
  // Append /invitees to the event URI
  const url = `${scheduledEventUri}/invitees`;
  return calendlyRequest<ListEventInviteesResponse>(accessToken, url);
}

/**
 * Get a single scheduled event by URI.
 *
 * @param accessToken - Calendly access token
 * @param scheduledEventUri - Full URI of the scheduled event
 */
export async function getCalendlyScheduledEvent(
  accessToken: string,
  scheduledEventUri: string
): Promise<CalendlyApiResult<CalendlyScheduledEvent>> {
  const res = await calendlyRequest<{ resource?: CalendlyScheduledEvent }>(accessToken, scheduledEventUri);
  if (!res.success) return res;

  const resource = res.data?.resource;
  if (!resource?.uri) {
    return { success: false, error: "Calendly scheduled event response missing resource" };
  }
  return { success: true, data: resource };
}

export async function cancelCalendlyScheduledEvent(
  accessToken: string,
  scheduledEventUri: string,
  opts?: { reason?: string }
): Promise<CalendlyApiResult<{ canceled: true }>> {
  const url = `${scheduledEventUri}/cancellation`;
  const res = await calendlyRequest<unknown>(accessToken, url, {
    method: "POST",
    body: JSON.stringify({ reason: opts?.reason || "" }),
  });
  if (!res.success) return res;
  return { success: true, data: { canceled: true } };
}
