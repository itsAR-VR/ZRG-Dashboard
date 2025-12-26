/**
 * GoHighLevel API Client
 * 
 * Handles all API calls to GHL's v2 API for conversations and workflows.
 */

import "@/lib/server-dns";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-04-15";
const GHL_CONTACTS_API_VERSION = "2021-07-28";

interface GHLApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
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
  options: RequestInit = {}
): Promise<GHLApiResponse<T>> {
  try {
    const url = `${GHL_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${privateKey}`,
        Version: GHL_API_VERSION,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`GHL API error (${response.status}):`, errorText);
      return {
        success: false,
        error: `GHL API error: ${response.status} - ${errorText}`,
      };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error("GHL API request failed:", error);
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
  privateKey: string
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
    }
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
  privateKey: string
): Promise<GHLApiResponse<GHLConversation>> {
  return ghlRequest<GHLConversation>(
    `/conversations/search?contactId=${contactId}`,
    privateKey
  );
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
    privateKey
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
  channel: string = "SMS"
): Promise<GHLApiResponse<GHLExportResponse>> {
  const params = new URLSearchParams({
    locationId,
    contactId,
    channel,
  });

  return ghlRequest<GHLExportResponse>(
    `/conversations/messages/export?${params.toString()}`,
    privateKey
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
    privateKey
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
    privateKey
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
    }
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
  privateKey: string
): Promise<GHLApiResponse<{ contact: GHLContact }>> {
  return ghlRequest<{ contact: GHLContact }>(
    `/contacts/${encodeURIComponent(contactId)}`,
    privateKey,
    { headers: { Version: GHL_CONTACTS_API_VERSION } }
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
  privateKey: string
): Promise<GHLApiResponse<{ contact?: GHLContact }>> {
  return ghlRequest<{ contact?: GHLContact }>(
    `/contacts/${encodeURIComponent(contactId)}`,
    privateKey,
    {
      method: "PUT",
      body: JSON.stringify(params),
      headers: { Version: GHL_CONTACTS_API_VERSION },
    }
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
  });
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
  });
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
    }
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
