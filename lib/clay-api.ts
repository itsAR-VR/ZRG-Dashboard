/**
 * Clay API client for lead data enrichment
 * Platform-level integration (single workspace)
 * Two separate tables: LinkedIn enrichment and Phone enrichment
 */

import crypto from "crypto";

export interface ClayEnrichmentRequest {
  leadId: string;        // For callback matching
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
}

export interface ClayEnrichmentResult {
  success: boolean;
  error?: string;
}

// Rate limiting: max requests per minute
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

// In-memory rate limit tracking
let requestCount = 0;
let windowStart = Date.now();

/**
 * Check and update rate limit
 * Returns true if request is allowed, false if rate limited
 */
function checkRateLimit(): boolean {
  const now = Date.now();

  // Reset window if expired
  if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
    requestCount = 0;
    windowStart = now;
  }

  if (requestCount >= RATE_LIMIT_MAX) {
    return false;
  }

  requestCount++;
  return true;
}

/**
 * Send lead to Clay for LinkedIn profile enrichment
 * Uses CLAY_LINKEDIN_TABLE_WEBHOOK_URL
 */
export async function sendToClayForLinkedInEnrichment(
  request: ClayEnrichmentRequest
): Promise<ClayEnrichmentResult> {
  const webhookUrl = process.env.CLAY_LINKEDIN_TABLE_WEBHOOK_URL;

  if (!webhookUrl) {
    console.error("[Clay] CLAY_LINKEDIN_TABLE_WEBHOOK_URL not configured");
    return { success: false, error: "Clay LinkedIn webhook URL not configured" };
  }

  if (!checkRateLimit()) {
    console.warn(`[Clay] Rate limit exceeded for LinkedIn enrichment, lead ${request.leadId} will be processed by cron`);
    return { success: false, error: "Rate limit exceeded - queued for batch processing" };
  }

  return sendToClayTable(webhookUrl, request, "LinkedIn");
}

/**
 * Send lead to Clay for phone number enrichment
 * Uses CLAY_PHONE_TABLE_WEBHOOK_URL
 */
export async function sendToClayForPhoneEnrichment(
  request: ClayEnrichmentRequest
): Promise<ClayEnrichmentResult> {
  const webhookUrl = process.env.CLAY_PHONE_TABLE_WEBHOOK_URL;

  if (!webhookUrl) {
    console.error("[Clay] CLAY_PHONE_TABLE_WEBHOOK_URL not configured");
    return { success: false, error: "Clay Phone webhook URL not configured" };
  }

  if (!checkRateLimit()) {
    console.warn(`[Clay] Rate limit exceeded for Phone enrichment, lead ${request.leadId} will be processed by cron`);
    return { success: false, error: "Rate limit exceeded - queued for batch processing" };
  }

  return sendToClayTable(webhookUrl, request, "Phone");
}

/**
 * Generic function to send data to a Clay table webhook
 */
async function sendToClayTable(
  webhookUrl: string,
  request: ClayEnrichmentRequest,
  tableType: "LinkedIn" | "Phone"
): Promise<ClayEnrichmentResult> {
  console.log(`[Clay] Sending lead ${request.leadId} (${request.email}) to ${tableType} table`);

  try {
    const payload = {
      leadId: request.leadId,
      email: request.email,
      firstName: request.firstName || "",
      lastName: request.lastName || "",
      company: request.company || "",
      // Add callback URL for Clay to send results back
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/clay`,
      enrichmentType: tableType.toLowerCase(), // 'linkedin' or 'phone'
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Clay] ${tableType} enrichment request failed (${response.status}):`, errorText);
      return {
        success: false,
        error: `Clay ${tableType} enrichment failed (${response.status})`,
      };
    }

    console.log(`[Clay] Successfully sent lead ${request.leadId} to ${tableType} table`);
    return { success: true };
  } catch (error) {
    console.error(`[Clay] Failed to send to ${tableType} table:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Trigger enrichment for a lead based on what data is missing
 * - Missing LinkedIn -> Send to LinkedIn table
 * - Missing phone -> Send to Phone table  
 * - Missing both -> Send to both tables
 */
export async function triggerEnrichmentForLead(
  leadId: string,
  email: string,
  firstName?: string,
  lastName?: string,
  company?: string,
  missingLinkedIn: boolean = true,
  missingPhone: boolean = true
): Promise<{ linkedInSent: boolean; phoneSent: boolean }> {
  const request: ClayEnrichmentRequest = {
    leadId,
    email,
    firstName,
    lastName,
    company,
  };

  const results = { linkedInSent: false, phoneSent: false };

  if (missingLinkedIn) {
    const linkedInResult = await sendToClayForLinkedInEnrichment(request);
    results.linkedInSent = linkedInResult.success;
  }

  if (missingPhone) {
    const phoneResult = await sendToClayForPhoneEnrichment(request);
    results.phoneSent = phoneResult.success;
  }

  return results;
}

/**
 * Verify HMAC signature from Clay webhook callback
 */
export function verifyClayWebhookSignature(
  payload: string,
  signature: string
): boolean {
  const secret = process.env.CLAY_CALLBACK_SECRET;

  if (!secret) {
    console.warn("[Clay] CLAY_CALLBACK_SECRET not configured, skipping signature verification");
    return true; // Allow in development
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}
