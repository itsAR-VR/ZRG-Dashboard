/**
 * GoHighLevel API Client
 * 
 * Handles all API calls to GHL's v2 API for conversations and workflows.
 */

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-04-15";

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

export type { GHLConversation, GHLMessage, GHLWorkflow, GHLSendMessageResponse };

