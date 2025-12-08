/**
 * Unipile API client for LinkedIn messaging integration
 * Supports DMs, InMails, and Connection Requests with waterfall logic
 */

import crypto from "crypto";

// Base URL for Unipile API
const UNIPILE_BASE_URL = "https://api6.unipile.com:13443/api/v1";

// Connection status types
export type LinkedInConnectionStatus = "CONNECTED" | "PENDING" | "NOT_CONNECTED";

export interface ConnectionCheckResult {
  status: LinkedInConnectionStatus;
  canSendDM: boolean;
  canSendInMail: boolean;
  hasOpenProfile: boolean;
  linkedinMemberId?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  messageType?: "dm" | "inmail" | "connection_request";
  error?: string;
}

export interface InMailBalanceResult {
  available: number;
  used: number;
  total: number;
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
    "Accept": "application/json",
  };
}

/**
 * Extract LinkedIn member ID from profile URL using Unipile
 * Unipile uses the profile URL to look up the member
 */
function extractLinkedInIdentifier(linkedinUrl: string): string {
  // Unipile accepts full LinkedIn URLs
  // Normalize URL format
  let url = linkedinUrl.trim();
  if (!url.startsWith("http")) {
    url = "https://" + url;
  }
  return url;
}

/**
 * Check connection status with a LinkedIn user
 * Determines if we can send DM, InMail, or need to send Connection Request
 */
export async function checkLinkedInConnection(
  accountId: string,
  linkedinUrl: string
): Promise<ConnectionCheckResult> {
  const identifier = extractLinkedInIdentifier(linkedinUrl);
  
  try {
    // Unipile uses POST /users/provider_id to get user profile
    const response = await fetch(`${UNIPILE_BASE_URL}/users/provider_id`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        account_id: accountId,
        provider_id: identifier,
        linkedin_url: linkedinUrl,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error(`[Unipile] Connection check failed (${response.status}):`, error);
      
      // If user not found, they're not connected
      return {
        status: "NOT_CONNECTED",
        canSendDM: false,
        canSendInMail: false,
        hasOpenProfile: false,
      };
    }
    
    const data = await response.json();
    
    // Determine connection status from response
    const isConnected = data.is_connection === true || data.connection_degree === 1;
    const isPending = data.pending_connection === true;
    const hasOpenProfile = data.open_profile === true || data.is_open_profile === true;
    
    let status: LinkedInConnectionStatus = "NOT_CONNECTED";
    if (isConnected) {
      status = "CONNECTED";
    } else if (isPending) {
      status = "PENDING";
    }
    
    return {
      status,
      canSendDM: isConnected,
      canSendInMail: !isConnected && (hasOpenProfile || data.inmail_available === true),
      hasOpenProfile,
      linkedinMemberId: data.id || data.member_id || data.provider_id,
    };
  } catch (error) {
    console.error("[Unipile] Connection check error:", error);
    return {
      status: "NOT_CONNECTED",
      canSendDM: false,
      canSendInMail: false,
      hasOpenProfile: false,
    };
  }
}

/**
 * Send a direct message to a connected LinkedIn user
 */
export async function sendLinkedInDM(
  accountId: string,
  linkedinUrl: string,
  message: string,
  linkedinMemberId?: string
): Promise<SendResult> {
  console.log(`[Unipile] Sending DM to ${linkedinUrl}`);
  
  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/chats`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        account_id: accountId,
        attendees_ids: linkedinMemberId ? [linkedinMemberId] : undefined,
        linkedin_url: linkedinMemberId ? undefined : linkedinUrl,
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
    console.log(`[Unipile] DM sent successfully, message ID: ${data.id || data.message_id}`);
    
    return {
      success: true,
      messageId: data.id || data.message_id,
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
 */
export async function sendLinkedInInMail(
  accountId: string,
  linkedinUrl: string,
  message: string,
  subject: string,
  linkedinMemberId?: string
): Promise<SendResult> {
  console.log(`[Unipile] Sending InMail to ${linkedinUrl}`);
  
  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/messages/inmail`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        account_id: accountId,
        recipient_id: linkedinMemberId,
        linkedin_url: linkedinMemberId ? undefined : linkedinUrl,
        subject: subject,
        body: message,
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
    console.log(`[Unipile] InMail sent successfully, message ID: ${data.id || data.message_id}`);
    
    return {
      success: true,
      messageId: data.id || data.message_id,
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
 */
export async function sendLinkedInConnectionRequest(
  accountId: string,
  linkedinUrl: string,
  note: string,
  linkedinMemberId?: string
): Promise<SendResult> {
  console.log(`[Unipile] Sending connection request to ${linkedinUrl}`);
  
  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/users/invite`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        account_id: accountId,
        provider_id: linkedinMemberId,
        linkedin_url: linkedinMemberId ? undefined : linkedinUrl,
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
    console.log(`[Unipile] Connection request sent successfully`);
    
    return {
      success: true,
      messageId: data.id || data.invitation_id,
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
 */
export async function checkInMailBalance(accountId: string): Promise<InMailBalanceResult | null> {
  try {
    const response = await fetch(`${UNIPILE_BASE_URL}/accounts/${accountId}/inmail_balance`, {
      method: "GET",
      headers: getHeaders(),
    });
    
    if (!response.ok) {
      console.error(`[Unipile] InMail balance check failed (${response.status})`);
      return null;
    }
    
    const data = await response.json();
    
    return {
      available: data.available || data.remaining || 0,
      used: data.used || 0,
      total: data.total || data.limit || 0,
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
  
  // 1. Check connection status
  const connectionStatus = await checkLinkedInConnection(accountId, linkedinUrl);
  const memberId = connectionStatus.linkedinMemberId;
  
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
 * Verify HMAC signature from Unipile webhook
 */
export function verifyUnipileWebhookSignature(
  payload: string,
  signature: string
): boolean {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET;
  
  if (!secret) {
    console.warn("[Unipile] UNIPILE_WEBHOOK_SECRET not configured, skipping signature verification");
    return true; // Allow in development
  }
  
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  
  // Handle signature formats (with or without algorithm prefix)
  const cleanSignature = signature.replace(/^sha256=/, "");
  
  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(cleanSignature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}
