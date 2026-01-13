/**
 * GoHighLevel API Client
 * 
 * Handles all API calls to GHL's v2 API for conversations and workflows.
 */

import "./server-dns";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-04-15";
const GHL_CONTACTS_API_VERSION = "2021-07-28";

const GHL_RATE_WINDOW_MS = 10_000;
const DEFAULT_GHL_REQUESTS_PER_10S = 90; // buffer under the documented 100/10s burst limit
const DEFAULT_GHL_MAX_429_RETRIES = 3;
const DEFAULT_GHL_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_GHL_MAX_NETWORK_RETRIES = 1;

interface GHLApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
  errorCode?: "sms_dnd";
  errorMessage?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function redactPotentialPii(value: string): string {
  // Best-effort redaction to avoid leaking emails/phones in logs or user-facing errors.
  return (
    value
      // emails
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
      // phone-ish sequences (very loose)
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]")
  );
}

function isSmsDndErrorMessage(message: string): boolean {
  const lower = (message || "").toLowerCase();
  return (
    lower.includes("dnd is active") ||
    (lower.includes("dnd") && lower.includes("sms") && lower.includes("cannot send"))
  );
}

function parseGhlErrorPayload(errorText: string): { message?: string; errorCode?: "sms_dnd" } {
  const parsed = tryParseJson<{ message?: unknown }>(errorText);
  const message = typeof parsed?.message === "string" ? parsed.message : undefined;
  const candidate = message || errorText;
  const errorCode = isSmsDndErrorMessage(candidate) ? "sms_dnd" : undefined;
  return { message, errorCode };
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

type GhlRateLimiterState = {
  nextAllowedAtMs: number;
  queue: Promise<void>;
};

const ghlRateLimiters = new Map<string, GhlRateLimiterState>();

async function throttleGhlRequest(key: string): Promise<void> {
  const configured = Number(process.env.GHL_REQUESTS_PER_10S || "");
  const requestsPerWindow =
    Number.isFinite(configured) && configured > 0 ? Math.min(100, Math.floor(configured)) : DEFAULT_GHL_REQUESTS_PER_10S;

  const minIntervalMs = Math.max(1, Math.ceil(GHL_RATE_WINDOW_MS / requestsPerWindow));

  const now = Date.now();
  const state = ghlRateLimiters.get(key) || { nextAllowedAtMs: now, queue: Promise.resolve() };

  state.queue = state.queue
    .catch(() => undefined)
    .then(async () => {
      const waitMs = Math.max(0, state.nextAllowedAtMs - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      state.nextAllowedAtMs = Math.max(state.nextAllowedAtMs, Date.now()) + minIntervalMs;
    });

  ghlRateLimiters.set(key, state);
  return state.queue;
}

interface GHLConversation {
  id: string;
  contactId: string;
  locationId: string;
  lastMessageBody: string;
  lastMessageDate: string;
  type: string;
  unreadCount: number;
}

function normalizeGhlConversationSearchResult(data: unknown): GHLConversation | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  if (typeof record.id === "string") return record as unknown as GHLConversation;

  const candidates: unknown[] = [];

  if (record.conversation) candidates.push(record.conversation);
  if (Array.isArray(record.conversations) && record.conversations.length) candidates.push(record.conversations[0]);
  if (Array.isArray(record.results) && record.results.length) candidates.push(record.results[0]);

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const candidateRecord = candidate as Record<string, unknown>;
    if (typeof candidateRecord.id === "string") return candidateRecord as unknown as GHLConversation;
  }

  return null;
}

interface GHLMessage {
  id: string;
  body: string;
  direction: string;
  status: string;
  dateAdded: string;
  messageType: string;
}

interface GHLWorkflow {
  id: string;
  name: string;
  status: string;
  locationId: string;
  createdAt: string;
}

interface GHLSendMessageResponse {
  conversationId: string;
  messageId: string;
  message: string;
  contactId: string;
  dateAdded: string;
}

/**
 * Make an authenticated request to the GHL API
 */
async function ghlRequest<T>(
  endpoint: string,
  privateKey: string,
  options: RequestInit = {},
  rateLimitKey?: string
): Promise<GHLApiResponse<T>> {
  try {
    const url = `${GHL_API_BASE}${endpoint}`;

    const requestKey = rateLimitKey || privateKey;
    const configuredMaxRetries = Number(process.env.GHL_MAX_429_RETRIES || "");
    const max429Retries =
      Number.isFinite(configuredMaxRetries) && configuredMaxRetries >= 0
        ? Math.floor(configuredMaxRetries)
        : DEFAULT_GHL_MAX_429_RETRIES;

    const configuredTimeoutMs = Number(process.env.GHL_FETCH_TIMEOUT_MS || "");
    const timeoutMs =
      Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
        ? Math.floor(configuredTimeoutMs)
        : DEFAULT_GHL_FETCH_TIMEOUT_MS;

    const configuredNetworkRetries = Number(process.env.GHL_MAX_NETWORK_RETRIES || "");
    const maxNetworkRetries =
      Number.isFinite(configuredNetworkRetries) && configuredNetworkRetries >= 0
        ? Math.floor(configuredNetworkRetries)
        : DEFAULT_GHL_MAX_NETWORK_RETRIES;

    const method = (options.method || "GET").toUpperCase();
    const maxAttempts = Math.max(max429Retries, maxNetworkRetries);

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      await throttleGhlRequest(requestKey);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${privateKey}`,
            Version: GHL_API_VERSION,
            "Content-Type": "application/json",
            ...options.headers,
          },
        });

        if (response.status === 429 && attempt < max429Retries) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After")) ?? 10_000;
          const jitterMs = Math.floor(Math.random() * 250);
          console.warn(`[GHL] Rate limited (429). Retrying after ${retryAfterMs + jitterMs}ms.`);
          await sleep(retryAfterMs + jitterMs);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          const parsed = parseGhlErrorPayload(errorText);
          const safeMessage = redactPotentialPii(parsed.message || "").trim();

          console.error(
            `[GHL] API error ${response.status} ${method} ${endpoint}${safeMessage ? `: ${safeMessage}` : ""}`
          );

          return {
            success: false,
            error: `GHL API error: ${response.status}${safeMessage ? ` - ${safeMessage}` : ""}`,
            statusCode: response.status,
            errorCode: parsed.errorCode,
            errorMessage: safeMessage || undefined,
          };
        }

        // Some endpoints can return empty bodies; handle that gracefully.
        const text = await response.text();
        if (!text) return { success: true, data: undefined as unknown as T };

        const parsedJson = tryParseJson<T>(text);
        if (!parsedJson) {
          return { success: false, error: "GHL API returned non-JSON response" };
        }

        return { success: true, data: parsedJson };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isAbort = error instanceof Error && error.name === "AbortError";
        const safeMessage = redactPotentialPii(message).trim();

        const canRetry = method === "GET" && attempt < maxNetworkRetries;
        if (canRetry) {
          const backoffMs = 500 + attempt * 500;
          console.warn(
            `[GHL] Network error (${isAbort ? "timeout" : "fetch failed"}) on ${method} ${endpoint}. Retrying after ${backoffMs}ms.`
          );
          await sleep(backoffMs);
          continue;
        }

        console.error(`[GHL] Request failed ${method} ${endpoint}${safeMessage ? `: ${safeMessage}` : ""}`);
        return { success: false, error: isAbort ? "GHL request timed out" : safeMessage || "GHL request failed" };
      } finally {
        clearTimeout(timeout);
      }
    }

    if (method === "GET") {
      return { success: false, error: "GHL request failed (max retries exceeded)" };
    }
    return { success: false, error: "GHL API rate limited (max retries exceeded)" };
  } catch (error) {
    console.error("GHL API request failed:", error instanceof Error ? error.message : error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send an SMS message via GHL API
 * 
 * @param contactId - The GHL contact ID
 * @param message - The message content
 * @param privateKey - The GHL private integration key
 */
export async function sendSMS(
  contactId: string,
  message: string,
  privateKey: string,
  opts?: { locationId?: string }
): Promise<GHLApiResponse<GHLSendMessageResponse>> {
  return ghlRequest<GHLSendMessageResponse>(
    "/conversations/messages",
    privateKey,
    {
      method: "POST",
      body: JSON.stringify({
        type: "SMS",
        contactId,
        message,
      }),
    },
    opts?.locationId
  );
}

/**
 * Get conversation by contact ID
 * 
 * @param contactId - The GHL contact ID
 * @param privateKey - The GHL private integration key
 */
export async function getConversationByContact(
  contactId: string,
  privateKey: string,
  opts?: { locationId?: string }
): Promise<GHLApiResponse<GHLConversation | null>> {
  const params = new URLSearchParams();
  params.set("contactId", contactId);
  if (opts?.locationId) params.set("locationId", opts.locationId);

  const result = await ghlRequest<unknown>(`/conversations/search?${params.toString()}`, privateKey, {}, opts?.locationId);
  if (!result.success) return result as GHLApiResponse<GHLConversation | null>;

  return {
    ...result,
    data: normalizeGhlConversationSearchResult(result.data),
  };
}

/**
 * Get messages from a conversation
 * 
 * @param conversationId - The GHL conversation ID
 * @param privateKey - The GHL private integration key
 */
export async function getConversationMessages(
  conversationId: string,
  privateKey: string
): Promise<GHLApiResponse<{ messages: GHLMessage[] }>> {
  return ghlRequest<{ messages: GHLMessage[] }>(
    `/conversations/${conversationId}/messages`,
    privateKey
  );
}

/**
 * Get all workflows for a location
 * 
 * @param locationId - The GHL location ID
 * @param privateKey - The GHL private integration key
 */
export async function getWorkflows(
  locationId: string,
  privateKey: string
): Promise<GHLApiResponse<{ workflows: GHLWorkflow[] }>> {
  return ghlRequest<{ workflows: GHLWorkflow[] }>(
    `/workflows/?locationId=${locationId}`,
    privateKey,
    {},
    locationId
  );
}

/**
 * Get a specific workflow by ID
 * 
 * @param workflowId - The GHL workflow ID
 * @param privateKey - The GHL private integration key
 */
export async function getWorkflow(
  workflowId: string,
  privateKey: string
): Promise<GHLApiResponse<GHLWorkflow>> {
  return ghlRequest<GHLWorkflow>(
    `/workflows/${workflowId}`,
    privateKey
  );
}

/**
 * Exported message structure from GHL
 */
export interface GHLExportedMessage {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  type: number;
  locationId: string;
  attachments: unknown[];
  body: string;
  contactId: string;
  contentType: string;
  conversationId: string;
  dateAdded: string;
  dateUpdated: string;
  altId?: string;
  messageType: string;
  userId?: string;
  source?: string;
}

interface GHLExportResponse {
  messages: GHLExportedMessage[];
  nextCursor: string | null;
  total: number;
  traceId: string;
}

/**
 * Export messages for a contact from GHL
 * Uses the /conversations/messages/export endpoint
 * 
 * @param locationId - The GHL location ID
 * @param contactId - The GHL contact ID
 * @param privateKey - The GHL private integration key
 * @param channel - The channel type (default: SMS)
 */
export async function exportMessages(
  locationId: string,
  contactId: string,
  privateKey: string,
  channel: string = "SMS",
  opts?: { cursor?: string | null }
): Promise<GHLApiResponse<GHLExportResponse>> {
  const params = new URLSearchParams();
  params.set("locationId", locationId);
  params.set("contactId", contactId);
  params.set("channel", channel);
  if (opts?.cursor) params.set("cursor", opts.cursor);

  return ghlRequest<GHLExportResponse>(
    `/conversations/messages/export?${params.toString()}`,
    privateKey,
    {},
    locationId
  );
}

// =============================================================================
// Calendar & Appointment Management
// =============================================================================

/**
 * GHL Calendar structure
 */
export interface GHLCalendar {
  id: string;
  locationId: string;
  name: string;
  description?: string;
  slug?: string;
  isActive: boolean;
  calendarType?: string;
  teamMembers?: Array<{
    id: string;
    name: string;
    email: string;
  }>;
}

/**
 * GHL User/Team Member structure
 */
export interface GHLUser {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
  permissions?: Record<string, unknown>;
}

/**
 * GHL Contact structure
 */
export interface GHLContact {
  id: string;
  locationId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  tags?: string[];
  source?: string;
  dateAdded?: string;
  dateUpdated?: string;
}

/**
 * GHL Appointment structure
 */
export interface GHLAppointment {
  id: string;
  calendarId: string;
  locationId: string;
  contactId: string;
  title: string;
  startTime: string;
  endTime: string;
  appointmentStatus: string;
  assignedUserId?: string;
  notes?: string;
  address?: string;
  dateAdded?: string;
  dateUpdated?: string;
}

/**
 * Parameters for creating an appointment
 */
export interface CreateAppointmentParams {
  calendarId: string;
  locationId: string;
  contactId: string;
  startTime: string;      // ISO format
  endTime: string;        // ISO format
  title: string;
  appointmentStatus?: string;  // Default: "confirmed"
  assignedUserId?: string;
  notes?: string;
}

/**
 * Parameters for creating a contact
 */
export interface CreateContactParams {
  locationId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  source?: string;
  tags?: string[];
}

export interface GHLContactSearchFilter {
  field?: string;
  operator?: string;
  value?: unknown;
  group?: "AND" | "OR";
  filters?: GHLContactSearchFilter[];
}

export interface GHLContactSearchSort {
  field: string;
  direction: "asc" | "desc";
}

export interface SearchContactsAdvancedParams {
  locationId: string;
  page?: number;
  pageLimit: number;
  searchAfter?: unknown[];
  filters?: GHLContactSearchFilter[];
  sort?: GHLContactSearchSort[];
  query?: string;
}

export interface SearchContactsAdvancedResponse {
  contacts: Array<GHLContact & Record<string, unknown>>;
  total?: number;
  traceId?: string;
}

export interface UpsertContactParams {
  locationId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  website?: string;
  timezone?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  source?: string;
}

/**
 * Get all calendars for a location
 * 
 * @param locationId - The GHL location ID
 * @param privateKey - The GHL private integration key
 */
export async function getGHLCalendars(
  locationId: string,
  privateKey: string
): Promise<GHLApiResponse<{ calendars: GHLCalendar[] }>> {
  return ghlRequest<{ calendars: GHLCalendar[] }>(
    `/calendars/?locationId=${encodeURIComponent(locationId)}`,
    privateKey,
    {},
    locationId
  );
}

/**
 * Get all users/team members for a location
 * 
 * @param locationId - The GHL location ID
 * @param privateKey - The GHL private integration key
 */
export async function getGHLUsers(
  locationId: string,
  privateKey: string
): Promise<GHLApiResponse<{ users: GHLUser[] }>> {
  return ghlRequest<{ users: GHLUser[] }>(
    `/users/?locationId=${encodeURIComponent(locationId)}`,
    privateKey,
    {},
    locationId
  );
}

/**
 * Create a new contact in GHL
 * 
 * @param params - Contact creation parameters
 * @param privateKey - The GHL private integration key
 */
export async function createGHLContact(
  params: CreateContactParams,
  privateKey: string
): Promise<GHLApiResponse<{ contact: GHLContact }>> {
  return ghlRequest<{ contact: GHLContact }>(
    "/contacts/",
    privateKey,
    {
      method: "POST",
      body: JSON.stringify(params),
      headers: { Version: GHL_CONTACTS_API_VERSION },
    },
    params.locationId
  );
}

/**
 * Get a contact by ID
 * 
 * @param contactId - The GHL contact ID
 * @param privateKey - The GHL private integration key
 */
export async function getGHLContact(
  contactId: string,
  privateKey: string,
  opts?: { locationId?: string }
): Promise<GHLApiResponse<{ contact: GHLContact }>> {
  return ghlRequest<{ contact: GHLContact }>(
    `/contacts/${encodeURIComponent(contactId)}`,
    privateKey,
    { headers: { Version: GHL_CONTACTS_API_VERSION } },
    opts?.locationId
  );
}

export type UpdateContactParams = Omit<UpsertContactParams, "locationId">;

/**
 * Update an existing contact by ID (PUT /contacts/{contactId})
 *
 * Used to patch missing standard fields (like phone) without risking duplicates.
 */
export async function updateGHLContact(
  contactId: string,
  params: UpdateContactParams,
  privateKey: string,
  opts?: { locationId?: string }
): Promise<GHLApiResponse<{ contact?: GHLContact }>> {
  return ghlRequest<{ contact?: GHLContact }>(
    `/contacts/${encodeURIComponent(contactId)}`,
    privateKey,
    {
      method: "PUT",
      body: JSON.stringify(params),
      headers: { Version: GHL_CONTACTS_API_VERSION },
    },
    opts?.locationId
  );
}

/**
 * Advanced Search Contacts (POST /contacts/search)
 *
 * Uses advanced filters/sort/pagination. Prefer this over older lookup/search variants.
 */
export async function searchGHLContactsAdvanced(
  params: SearchContactsAdvancedParams,
  privateKey: string
): Promise<GHLApiResponse<SearchContactsAdvancedResponse>> {
  return ghlRequest<SearchContactsAdvancedResponse>("/contacts/search", privateKey, {
    method: "POST",
    body: JSON.stringify(params),
    headers: { Version: GHL_CONTACTS_API_VERSION },
  }, params.locationId);
}

/**
 * Upsert a contact (POST /contacts/upsert)
 *
 * Creates or updates a contact based on the Location "Allow Duplicate Contact" configuration.
 * Important: Do NOT pass tags here unless you intend to overwrite all tags.
 */
export async function upsertGHLContact(
  params: UpsertContactParams,
  privateKey: string
): Promise<GHLApiResponse<{ contactId: string }>> {
  return ghlRequest<{ contactId: string }>("/contacts/upsert", privateKey, {
    method: "POST",
    body: JSON.stringify(params),
    headers: { Version: GHL_CONTACTS_API_VERSION },
  }, params.locationId);
}

/**
 * Create a new appointment in GHL
 * 
 * @param params - Appointment creation parameters
 * @param privateKey - The GHL private integration key
 */
export async function createGHLAppointment(
  params: CreateAppointmentParams,
  privateKey: string
): Promise<GHLApiResponse<GHLAppointment>> {
  const body = {
    ...params,
    appointmentStatus: params.appointmentStatus || "confirmed",
  };

  return ghlRequest<GHLAppointment>(
    "/calendars/events/appointments",
    privateKey,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    params.locationId
  );
}

/**
 * Update an existing appointment in GHL
 * 
 * @param eventId - The appointment/event ID
 * @param params - Partial appointment parameters to update
 * @param privateKey - The GHL private integration key
 */
export async function updateGHLAppointment(
  eventId: string,
  params: Partial<CreateAppointmentParams>,
  privateKey: string
): Promise<GHLApiResponse<GHLAppointment>> {
  return ghlRequest<GHLAppointment>(
    `/calendars/events/appointments/${encodeURIComponent(eventId)}`,
    privateKey,
    {
      method: "PUT",
      body: JSON.stringify(params),
    }
  );
}

/**
 * Delete/cancel an appointment in GHL
 * 
 * @param eventId - The appointment/event ID
 * @param privateKey - The GHL private integration key
 */
export async function deleteGHLAppointment(
  eventId: string,
  privateKey: string
): Promise<GHLApiResponse<{ message: string }>> {
  return ghlRequest<{ message: string }>(
    `/calendars/events/${encodeURIComponent(eventId)}`,
    privateKey,
    {
      method: "DELETE",
    }
  );
}

/**
 * Test GHL connection by fetching calendars
 * Returns success if API key is valid
 * 
 * @param locationId - The GHL location ID
 * @param privateKey - The GHL private integration key
 */
export async function testGHLConnection(
  locationId: string,
  privateKey: string
): Promise<GHLApiResponse<{ valid: boolean; calendarCount: number }>> {
  const result = await getGHLCalendars(locationId, privateKey);

  if (result.success && result.data) {
    return {
      success: true,
      data: {
        valid: true,
        calendarCount: result.data.calendars?.length || 0,
      },
    };
  }

  return {
    success: false,
    error: result.error || "Failed to connect to GHL",
  };
}

export type { GHLConversation, GHLMessage, GHLWorkflow, GHLSendMessageResponse };
