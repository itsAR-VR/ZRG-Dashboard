/**
 * Clay API client for lead data enrichment
 * Platform-level integration (single workspace)
 * Two separate tables: LinkedIn enrichment and Phone enrichment
 */

import crypto from "crypto";

export interface ClayEnrichmentRequest {
  leadId: string;           // For callback matching
  emailAddress: string;     // Lead's email address
  firstName?: string;
  lastName?: string;
  fullName?: string;        // Computed: firstName + lastName
  companyName?: string;     // From EmailBison company field
  companyDomain?: string;   // From EmailBison 'website' custom var (full URL)
  state?: string;           // From EmailBison 'company state' custom var
  linkedInProfile?: string; // From EmailBison 'linkedin url' custom var or Lead.linkedinUrl
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
 * Build payload for Clay table based on table type
 * Phone table includes linkedInProfile, LinkedIn table does not
 */
function buildClayPayload(
  request: ClayEnrichmentRequest,
  tableType: "LinkedIn" | "Phone"
): Record<string, string> {
  // Compute fullName if not provided
  const fullName = request.fullName || 
    `${request.firstName || ""} ${request.lastName || ""}`.trim();

  // Base payload for both tables
  const basePayload = {
    leadId: request.leadId,
    emailAddress: request.emailAddress,
    firstName: request.firstName || "",
    lastName: request.lastName || "",
    fullName,
    companyName: request.companyName || "",
    companyDomain: request.companyDomain || "",
    state: request.state || "",
  };

  // Phone table includes linkedInProfile (if we have it, helps with enrichment)
  if (tableType === "Phone") {
    return {
      ...basePayload,
      linkedInProfile: request.linkedInProfile || "",
    };
  }

  // LinkedIn table does not include linkedInProfile (that's what we're looking for)
  return basePayload;
}

/**
 * Generic function to send data to a Clay table webhook
 */
async function sendToClayTable(
  webhookUrl: string,
  request: ClayEnrichmentRequest,
  tableType: "LinkedIn" | "Phone"
): Promise<ClayEnrichmentResult> {
  console.log(`[Clay] Sending lead ${request.leadId} (${request.emailAddress}) to ${tableType} table`);

  try {
    const payload = buildClayPayload(request, tableType);

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
  request: ClayEnrichmentRequest,
  missingLinkedIn: boolean = true,
  missingPhone: boolean = true
): Promise<{ linkedInSent: boolean; phoneSent: boolean }> {
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
