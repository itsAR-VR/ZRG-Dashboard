/**
 * Unipile API client for LinkedIn messaging integration
 * Supports DMs, InMails, and Connection Requests with waterfall logic
 *
 * API Documentation: https://developer.unipile.com/reference
 */

import { NextRequest } from "next/server";

/**
 * Get Unipile API base URL from environment
 * DSN format: https://apiXX.unipile.com:PORT
 */
function getBaseUrl(): string {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) {
    throw new Error("UNIPILE_DSN not configured");
  }
  // Ensure we have /api/v1 suffix
  return `${dsn}/api/v1`;
}

// Connection status types
export type LinkedInConnectionStatus = "CONNECTED" | "PENDING" | "NOT_CONNECTED";

export interface ConnectionCheckResult {
  status: LinkedInConnectionStatus;
  canSendDM: boolean;
  canSendInMail: boolean;
  hasOpenProfile: boolean;
  linkedinMemberId?: string;
  publicIdentifier?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  chatId?: string;
  messageType?: "dm" | "inmail" | "connection_request";
  error?: string;
}

export interface InMailBalanceResult {
  available: number;
  premium: number | null;
  recruiter: number | null;
  salesNavigator: number | null;
}

/**
 * Get Unipile API headers with authentication
 */
function getHeaders(): HeadersInit {
  const apiKey = process.env.UNIPILE_API_KEY;
  if (!apiKey) {
    throw new Error("UNIPILE_API_KEY not configured");
  }

  return {
    "X-API-KEY": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/**
 * Extract LinkedIn public identifier (username) from profile URL
 * Example: https://linkedin.com/in/andy-smith-75960337 -> andy-smith-75960337
 *
 * The Unipile API accepts this public identifier in GET /api/v1/users/{identifier}
 */
export function extractLinkedInPublicIdentifier(linkedinUrl: string): string {
  if (!linkedinUrl) {
    return "";
  }

  let url = linkedinUrl.trim();

  // Handle URLs without protocol
  if (!url.startsWith("http")) {
    url = "https://" + url;
  }

  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;

    // Match /in/username or /in/username/
    const match = pathname.match(/\/in\/([^\/]+)\/?/);
    if (match && match[1]) {
      return match[1];
    }

    // Fallback: return the last non-empty segment
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      return segments[segments.length - 1];
    }
  } catch {
    // If URL parsing fails, try simple regex extraction
    const simpleMatch = linkedinUrl.match(/\/in\/([^\/\?]+)/);
    if (simpleMatch && simpleMatch[1]) {
      return simpleMatch[1];
    }
  }

  return "";
}

/**
 * Check connection status with a LinkedIn user
 * Uses GET /api/v1/users/{identifier}?account_id=...
 *
 * Determines if we can send DM, InMail, or need to send Connection Request
 */
export async function checkLinkedInConnection(
  accountId: string,
  linkedinUrl: string
): Promise<ConnectionCheckResult> {
  const publicIdentifier = extractLinkedInPublicIdentifier(linkedinUrl);

  if (!publicIdentifier) {
    console.error("[Unipile] Could not extract public identifier from URL:", linkedinUrl);
    return {
      status: "NOT_CONNECTED",
      canSendDM: false,
      canSendInMail: false,
      hasOpenProfile: false,
    };
  }

  try {
    // Unipile API: GET /api/v1/users/{identifier}?account_id=...
    const url = `${getBaseUrl()}/users/${encodeURIComponent(publicIdentifier)}?account_id=${encodeURIComponent(accountId)}`;

    console.log(`[Unipile] Checking connection status for: ${publicIdentifier}`);

    const response = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Unipile] Connection check failed (${response.status}):`, error);

      // If user not found or error, assume not connected
      return {
        status: "NOT_CONNECTED",
        canSendDM: false,
        canSendInMail: false,
        hasOpenProfile: false,
        publicIdentifier,
      };
    }

    const data = await response.json();

    // Extract connection info from response
    // network_distance: SELF, DISTANCE_1 (1st degree), DISTANCE_2, DISTANCE_3, OUT_OF_NETWORK
    const networkDistance = data.specifics?.network_distance || data.network_distance;
    const isConnected = networkDistance === "DISTANCE_1" || networkDistance === "SELF";
    const isPending = data.specifics?.pending_invitation === true || data.pending_invitation === true;
    const hasOpenProfile = data.open_profile === true || data.specifics?.open_profile === true;

    // Get provider_id for messaging
    const providerId = data.provider_id || data.id || data.specifics?.member_urn;

    let status: LinkedInConnectionStatus = "NOT_CONNECTED";
    if (isConnected) {
      status = "CONNECTED";
    } else if (isPending) {
      status = "PENDING";
    }

    console.log(`[Unipile] Connection status for ${publicIdentifier}: ${status}, hasOpenProfile: ${hasOpenProfile}`);

    return {
      status,
      canSendDM: isConnected,
      canSendInMail: !isConnected && hasOpenProfile,
      hasOpenProfile,
      linkedinMemberId: providerId,
      publicIdentifier,
    };
  } catch (error) {
    console.error("[Unipile] Connection check error:", error);
    return {
      status: "NOT_CONNECTED",
      canSendDM: false,
      canSendInMail: false,
      hasOpenProfile: false,
      publicIdentifier,
    };
  }
}

/**
 * Send a direct message to a connected LinkedIn user
 * Uses POST /api/v1/chats with attendees_ids
 */
export async function sendLinkedInDM(
  accountId: string,
  linkedinUrl: string,
  message: string,
  linkedinMemberId?: string
): Promise<SendResult> {
  console.log(`[Unipile] Sending DM to ${linkedinUrl}`);

  // We need the provider_id (member ID) to send a message
  // If not provided, we need to fetch it first
  let providerId = linkedinMemberId;

  if (!providerId) {
    const connectionResult = await checkLinkedInConnection(accountId, linkedinUrl);
    providerId = connectionResult.linkedinMemberId;

    if (!providerId) {
      return {
        success: false,
        error: "Could not resolve LinkedIn member ID for messaging",
      };
    }
  }

  try {
    // Unipile API: POST /api/v1/chats
    const response = await fetch(`${getBaseUrl()}/chats`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        account_id: accountId,
        attendees_ids: [providerId],
        text: message,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Unipile] DM send failed (${response.status}):`, error);
      return {
        success: false,
        error: `Failed to send DM (${response.status}): ${error}`,
      };
    }

    const data = await response.json();
    console.log(`[Unipile] DM sent successfully, chat ID: ${data.chat_id}, message ID: ${data.message_id}`);

    return {
      success: true,
      messageId: data.message_id,
      chatId: data.chat_id,
      messageType: "dm",
    };
  } catch (error) {
    console.error("[Unipile] DM send error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send an InMail to a LinkedIn user (requires Premium/Sales Nav credits or Open Profile)
 * Uses POST /api/v1/chats with linkedin.inmail=true
 */
export async function sendLinkedInInMail(
  accountId: string,
  linkedinUrl: string,
  message: string,
  subject: string,
  linkedinMemberId?: string
): Promise<SendResult> {
  console.log(`[Unipile] Sending InMail to ${linkedinUrl}`);

  // We need the provider_id (member ID) to send a message
  let providerId = linkedinMemberId;

  if (!providerId) {
    const connectionResult = await checkLinkedInConnection(accountId, linkedinUrl);
    providerId = connectionResult.linkedinMemberId;

    if (!providerId) {
      return {
        success: false,
        error: "Could not resolve LinkedIn member ID for InMail",
      };
    }
  }

  try {
    // Unipile API: POST /api/v1/chats with linkedin.inmail=true
    const response = await fetch(`${getBaseUrl()}/chats`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        account_id: accountId,
        attendees_ids: [providerId],
        text: message,
        subject: subject,
        linkedin: {
          inmail: true,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Unipile] InMail send failed (${response.status}):`, error);

      // Check if failure is due to no credits
      if (error.includes("credit") || error.includes("balance") || response.status === 402) {
        return {
          success: false,
          error: "NO_INMAIL_CREDITS",
        };
      }

      return {
        success: false,
        error: `Failed to send InMail (${response.status}): ${error}`,
      };
    }

    const data = await response.json();
    console.log(`[Unipile] InMail sent successfully, chat ID: ${data.chat_id}, message ID: ${data.message_id}`);

    return {
      success: true,
      messageId: data.message_id,
      chatId: data.chat_id,
      messageType: "inmail",
    };
  } catch (error) {
    console.error("[Unipile] InMail send error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Send a connection request to a LinkedIn user
 * Uses POST /api/v1/users/invite
 */
export async function sendLinkedInConnectionRequest(
  accountId: string,
  linkedinUrl: string,
  note: string,
  linkedinMemberId?: string
): Promise<SendResult> {
  console.log(`[Unipile] Sending connection request to ${linkedinUrl}`);

  // We need the provider_id to send an invitation
  let providerId = linkedinMemberId;

  if (!providerId) {
    const connectionResult = await checkLinkedInConnection(accountId, linkedinUrl);
    providerId = connectionResult.linkedinMemberId;

    if (!providerId) {
      return {
        success: false,
        error: "Could not resolve LinkedIn member ID for connection request",
      };
    }
  }

  try {
    // Unipile API: POST /api/v1/users/invite
    const response = await fetch(`${getBaseUrl()}/users/invite`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        account_id: accountId,
        provider_id: providerId,
        message: note.slice(0, 300), // LinkedIn limits connection notes to 300 chars
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Unipile] Connection request failed (${response.status}):`, error);
      return {
        success: false,
        error: `Failed to send connection request (${response.status}): ${error}`,
      };
    }

    const data = await response.json();
    console.log(`[Unipile] Connection request sent successfully, invitation ID: ${data.invitation_id}`);

    return {
      success: true,
      messageId: data.invitation_id,
      messageType: "connection_request",
    };
  } catch (error) {
    console.error("[Unipile] Connection request error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check InMail balance for an account
 * Uses GET /api/v1/linkedin/inmail_balance?account_id=...
 */
export async function checkInMailBalance(accountId: string): Promise<InMailBalanceResult | null> {
  try {
    // Unipile API: GET /api/v1/linkedin/inmail_balance?account_id=...
    const url = `${getBaseUrl()}/linkedin/inmail_balance?account_id=${encodeURIComponent(accountId)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      console.error(`[Unipile] InMail balance check failed (${response.status})`);
      return null;
    }

    const data = await response.json();

    // Response format: { object: "LinkedinInmailBalance", premium: number|null, recruiter: number|null, sales_navigator: number|null }
    const premium = data.premium ?? 0;
    const recruiter = data.recruiter ?? 0;
    const salesNavigator = data.sales_navigator ?? 0;

    // Calculate total available
    const available = (premium || 0) + (recruiter || 0) + (salesNavigator || 0);

    return {
      available,
      premium,
      recruiter,
      salesNavigator,
    };
  } catch (error) {
    console.error("[Unipile] InMail balance check error:", error);
    return null;
  }
}

/**
 * Waterfall send logic: Try DM -> InMail -> Connection Request
 * Returns the result of whichever method succeeded
 */
export async function sendLinkedInMessageWithWaterfall(
  accountId: string,
  linkedinUrl: string,
  message: string,
  connectionNote?: string,
  inMailSubject?: string
): Promise<SendResult & { attemptedMethods: string[] }> {
  const attemptedMethods: string[] = [];

  // 1. Check connection status first (this also gets the member ID)
  const connectionStatus = await checkLinkedInConnection(accountId, linkedinUrl);
  const memberId = connectionStatus.linkedinMemberId;

  if (!memberId) {
    return {
      success: false,
      error: "Could not resolve LinkedIn member ID",
      attemptedMethods: ["connection_check_failed"],
    };
  }

  // 2. If connected, send DM
  if (connectionStatus.canSendDM) {
    attemptedMethods.push("dm");
    const dmResult = await sendLinkedInDM(accountId, linkedinUrl, message, memberId);
    return { ...dmResult, attemptedMethods };
  }

  // 3. If pending connection, can't do anything yet
  if (connectionStatus.status === "PENDING") {
    return {
      success: false,
      error: "Connection request is pending",
      attemptedMethods: ["pending_check"],
    };
  }

  // 4. If not connected, try InMail (if Open Profile or has credits)
  if (connectionStatus.canSendInMail) {
    attemptedMethods.push("inmail");
    const subject = inMailSubject || "Quick question";
    const inMailResult = await sendLinkedInInMail(accountId, linkedinUrl, message, subject, memberId);

    if (inMailResult.success) {
      return { ...inMailResult, attemptedMethods };
    }

    // If InMail failed due to no credits, fall through to connection request
    if (inMailResult.error !== "NO_INMAIL_CREDITS") {
      return { ...inMailResult, attemptedMethods };
    }
  }

  // 5. Fallback: Send connection request
  attemptedMethods.push("connection_request");
  const note = connectionNote || message.slice(0, 300);
  const connectionResult = await sendLinkedInConnectionRequest(accountId, linkedinUrl, note, memberId);

  return { ...connectionResult, attemptedMethods };
}

/**
 * Verify Unipile webhook using custom header authentication
 * Unipile sends a custom header (x-unipile-secret) that you define when creating the webhook
 */
export function verifyUnipileWebhookSecret(request: NextRequest): boolean {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET;

  if (!secret) {
    console.warn("[Unipile] UNIPILE_WEBHOOK_SECRET not configured, skipping verification");
    return true; // Allow in development
  }

  // Unipile sends the secret in a custom header you define when creating the webhook
  const receivedSecret = request.headers.get("x-unipile-secret");

  if (!receivedSecret) {
    console.error("[Unipile] Missing x-unipile-secret header");
    return false;
  }

  return receivedSecret === secret;
}
