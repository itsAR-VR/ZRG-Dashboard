export interface EmailBisonCampaign {
  id: string;
  name: string;
  status?: string;
}

// Custom variable from EmailBison lead
export interface EmailBisonCustomVariable {
  name: string;
  value: string;
}

// Full lead details from EmailBison API
export interface EmailBisonLeadDetails {
  id: number;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  title?: string | null;
  status?: string | null;
  custom_variables?: EmailBisonCustomVariable[];
}

export interface EmailBisonRecipient {
  name: string | null;
  email_address: string;
}

export interface EmailBisonReplyPayload {
  message: string;
  sender_email_id: number;
  to_emails: EmailBisonRecipient[];
  subject?: string;
  cc_emails?: EmailBisonRecipient[];
  bcc_emails?: EmailBisonRecipient[];
  inject_previous_email_body?: boolean;
  content_type?: "text" | "html";
}

// Response types for fetching replies
export interface EmailBisonReplyMessage {
  id: number;
  uuid?: string | null;
  // API examples show `subject`; older codepaths sometimes used `email_subject`.
  subject?: string | null;
  email_subject?: string | null;
  from_email_address?: string | null;
  from_name?: string | null;
  primary_to_email_address?: string | null;
  to?: { address: string; name: string | null }[] | null;
  cc?: { address: string; name: string | null }[] | null;
  bcc?: { address: string; name: string | null }[] | null;
  html_body?: string | null;
  text_body?: string | null;
  raw_body?: string | null;
  raw_message_id?: string | null;
  date_received?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  automated_reply?: boolean | null;
  interested?: boolean | null;
  type?: string | null;
  folder?: string | null;
  lead_id?: number | null;
  campaign_id?: number | null;
  sender_email_id?: number | null;
  // Threading fields
  thread_id?: string | null;
  in_reply_to?: string | null;
  message_id?: string | null;
}

export interface EmailBisonSentEmail {
  id: number;
  lead_id?: number;
  sequence_step_id?: number;
  email_subject?: string | null;
  email_body?: string | null;
  status?: string | null;
  sent_at?: string | null;
  scheduled_date_local?: string | null;
  raw_message_id?: string | null;
}

export interface EmailBisonSenderEmailAccount {
  id: number;
  email?: string | null;
  email_address?: string | null;
  name?: string | null;
  status?: string | null;
  provider?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // Allow unknown provider fields without breaking parsing
  [key: string]: unknown;
}

export interface EmailBisonLeadListItem {
  id: number;
  email?: string | null;
  email_address?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  [key: string]: unknown;
}

const INBOXXIA_BASE_URL = "https://send.meetinboxxia.com";

async function parseJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getEmailBisonTimeoutMs(): number {
  // Default increased from 15s to 30s for better resilience under load
  const parsed = Number.parseInt(process.env.EMAILBISON_TIMEOUT_MS || "30000", 10);
  if (!Number.isFinite(parsed)) return 30_000;
  return Math.max(1_000, Math.min(120_000, parsed));
}

function getEmailBisonMaxRetries(): number {
  const parsed = Number.parseInt(process.env.EMAILBISON_MAX_RETRIES || "2", 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(0, Math.min(5, parsed));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if an error is retryable (timeout, network issues).
 * Caller cancellation is NOT retryable.
 */
function isRetryableError(error: unknown, callerAborted: boolean): boolean {
  // Never retry if the caller cancelled the request (navigation, request shutdown)
  if (callerAborted) return false;

  if (error instanceof Error) {
    const name = error.name;
    const msg = error.message;

    // Timeout abort (our own deadline)
    if (name === "AbortError") return true;

    // Network errors
    if (msg.includes("ECONNRESET")) return true;
    if (msg.includes("ETIMEDOUT")) return true;
    if (msg.includes("ENOTFOUND")) return true;
    if (msg.includes("fetch failed")) return true;
  }
  return false;
}

/**
 * Determine the abort "kind" for logging purposes.
 */
function classifyAbort(error: unknown, callerAborted: boolean): "timeout" | "caller" | "unknown" {
  if (callerAborted) return "caller";
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "unknown";
}

interface EmailBisonFetchOptions {
  /** Max retries (default: EMAILBISON_MAX_RETRIES env or 2). Only applies to GET requests. */
  maxRetries?: number;
  /** Base delay for exponential backoff (default: 1000ms) */
  retryDelayMs?: number;
}

async function emailBisonFetch(
  url: string,
  init: RequestInit,
  opts?: EmailBisonFetchOptions
): Promise<Response> {
  const timeoutMs = getEmailBisonTimeoutMs();
  const method = (init.method || "GET").toUpperCase();

  // Only retry GET requests (safe/idempotent)
  const maxRetries = method === "GET" ? (opts?.maxRetries ?? getEmailBisonMaxRetries()) : 0;
  const baseDelay = opts?.retryDelayMs ?? 1000;

  // Track if caller's signal is aborted
  let callerAborted = init.signal?.aborted ?? false;
  if (init.signal && !callerAborted) {
    init.signal.addEventListener("abort", () => {
      callerAborted = true;
    }, { once: true });
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // If caller has already aborted, propagate immediately
    if (callerAborted) {
      clearTimeout(timeout);
      throw new Error("Request cancelled by caller");
    }

    // Link caller's signal to our controller
    if (init.signal) {
      init.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error : new Error(String(error));

      const abortKind = classifyAbort(error, callerAborted);

      // Don't retry non-retryable errors
      if (!isRetryableError(error, callerAborted)) {
        if (abortKind === "caller") {
          console.log(`[EmailBison] Request cancelled by caller: ${url}`);
        } else {
          console.error(`[EmailBison] Non-retryable error (${abortKind}): ${lastError.message}`);
        }
        throw lastError;
      }

      // If we have retries left, wait and try again
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(
          `[EmailBison] Retry ${attempt + 1}/${maxRetries} after ${delay}ms (${abortKind}): ${url}`
        );
        await sleep(delay);
        continue;
      }

      // Out of retries
      console.error(
        `[EmailBison] All ${maxRetries + 1} attempts failed for ${url}: ${lastError.message}`
      );
      throw lastError;
    }
  }

  throw lastError ?? new Error("Unexpected: no error captured");
}

export async function fetchEmailBisonCampaigns(
  apiKey: string
): Promise<{ success: boolean; data?: EmailBisonCampaign[]; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/campaigns`;

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      return {
        success: false,
        error: `EmailBison campaigns fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"
          }`,
      };
    }

    const data = (await response.json()) as any;
    const campaignsArray: any[] =
      Array.isArray(data) ? data : Array.isArray(data?.campaigns) ? data.campaigns : [];

    const campaigns: EmailBisonCampaign[] = campaignsArray.map((c) => ({
      id: String(c.id ?? c.bisonCampaignId ?? c.campaignId ?? ""),
      name: c.name || c.title || "Untitled Campaign",
      status: c.status,
    }));

    return { success: true, data: campaigns };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch campaigns:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendEmailBisonReply(
  apiKey: string,
  replyId: string,
  payload: EmailBisonReplyPayload
): Promise<{ success: boolean; data?: any; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/replies/${replyId}/reply`;

  console.log(`[EmailBison] Sending reply to ${replyId}:`, {
    to: payload.to_emails.map(e => e.email_address),
    sender_email_id: payload.sender_email_id,
    subject: payload.subject,
    messagePreview: payload.message.substring(0, 50) + "...",
  });

  try {
    const response = await emailBisonFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      console.error(`[EmailBison] Reply send failed (${response.status}):`, body);
      return {
        success: false,
        error: `EmailBison reply send failed (${response.status}): ${body?.error || body?.message || JSON.stringify(body) || "Unknown error"}`,
      };
    }

    const body = await parseJsonSafe(response);
    console.log(`[EmailBison] Reply sent successfully:`, body);
    return { success: true, data: body };
  } catch (error) {
    console.error("[EmailBison] Failed to send reply:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch all replies for a lead from EmailBison
 * Used for syncing email conversation history
 */
export async function fetchEmailBisonReplies(
  apiKey: string,
  bisonLeadId: string
): Promise<{ success: boolean; data?: EmailBisonReplyMessage[]; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/leads/${bisonLeadId}/replies?filters[folder]=all`;

  console.log(`[EmailBison] Fetching replies for lead ${bisonLeadId}`);

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      console.error(`[EmailBison] Replies fetch failed (${response.status}):`, body);
      return {
        success: false,
        error: `EmailBison replies fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"}`,
      };
    }

    const data = await response.json();

    // Handle both array response and object with replies property
    const repliesArray: EmailBisonReplyMessage[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.replies)
          ? data.replies
          : [];

    console.log(`[EmailBison] Found ${repliesArray.length} replies for lead ${bisonLeadId}:`,
      repliesArray.map(r => ({
        id: r.id,
        subject: (r.subject ?? r.email_subject ?? "")?.substring(0, 30),
        from: r.from_email_address,
        folder: r.folder,
        type: r.type,
        date: r.date_received || r.created_at,
      }))
    );
    return { success: true, data: repliesArray };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch replies:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch all sent emails for a lead from EmailBison
 * Used for syncing outbound campaign emails
 */
export async function fetchEmailBisonSentEmails(
  apiKey: string,
  bisonLeadId: string
): Promise<{ success: boolean; data?: EmailBisonSentEmail[]; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/leads/${bisonLeadId}/sent-emails`;

  console.log(`[EmailBison] Fetching sent emails for lead ${bisonLeadId}`);

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      console.error(`[EmailBison] Sent emails fetch failed (${response.status}):`, body);
      return {
        success: false,
        error: `EmailBison sent emails fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"}`,
      };
    }

    const data = await response.json();

    // Handle both array response and object with sent_emails property
    const sentEmailsArray: EmailBisonSentEmail[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.sent_emails)
          ? data.sent_emails
          : [];

    console.log(`[EmailBison] Found ${sentEmailsArray.length} sent emails for lead ${bisonLeadId}`);
    return { success: true, data: sentEmailsArray };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch sent emails:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch replies for a lead by lead_id.
 * Supports filtering via query params like filters[folder]=sent.
 */
export async function fetchEmailBisonLeadReplies(
  apiKey: string,
  leadId: string,
  filters?: {
    folder?: string;
    campaign_id?: number | string;
    sender_email_id?: number | string;
    search?: string;
    read?: boolean;
  }
): Promise<{ success: boolean; data?: EmailBisonReplyMessage[]; error?: string }> {
  const encoded = encodeURIComponent(leadId);
  const qs = new URLSearchParams();

  if (filters?.folder) qs.set("filters[folder]", filters.folder);
  if (filters?.campaign_id != null) qs.set("filters[campaign_id]", String(filters.campaign_id));
  if (filters?.sender_email_id != null) qs.set("filters[sender_email_id]", String(filters.sender_email_id));
  if (filters?.search) qs.set("filters[search]", filters.search);
  if (filters?.read != null) qs.set("filters[read]", String(filters.read));

  const url = `${INBOXXIA_BASE_URL}/api/leads/${encoded}/replies${qs.toString() ? `?${qs.toString()}` : ""}`;

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      return {
        success: false,
        error: `EmailBison lead replies fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"}`,
      };
    }

    const body = await parseJsonSafe(response);
    const repliesArray: EmailBisonReplyMessage[] =
      Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.replies) ? body.replies : [];

    return { success: true, data: repliesArray };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch lead replies:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function fetchEmailBisonLeadsListByUrl(
  apiKey: string,
  url: string
): Promise<{ success: boolean; data?: EmailBisonLeadListItem[]; error?: string }> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      return {
        success: false,
        error: `EmailBison leads fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"}`,
      };
    }

    const body = await parseJsonSafe(response);
    const list: EmailBisonLeadListItem[] =
      Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.leads) ? body.leads : [];

    return { success: true, data: list };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch leads:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Best-effort lookup for EmailBison lead_id by email address.
 * Tries a few common query param patterns used by MeetInboxXia/EmailBison.
 */
export async function findEmailBisonLeadIdByEmail(
  apiKey: string,
  email: string
): Promise<{ success: boolean; leadId?: string; error?: string }> {
  const needle = email.trim().toLowerCase();
  if (!needle) return { success: false, error: "missing_email" };

  const candidates = [
    `${INBOXXIA_BASE_URL}/api/leads?filters[search]=${encodeURIComponent(needle)}&per_page=200`,
    `${INBOXXIA_BASE_URL}/api/leads?search=${encodeURIComponent(needle)}&per_page=200`,
    `${INBOXXIA_BASE_URL}/api/leads?filters[email]=${encodeURIComponent(needle)}&per_page=200`,
    `${INBOXXIA_BASE_URL}/api/leads?filters[email_address]=${encodeURIComponent(needle)}&per_page=200`,
  ];

  for (const url of candidates) {
    const res = await fetchEmailBisonLeadsListByUrl(apiKey, url);
    if (!res.success || !res.data) continue;

    const match = res.data.find((l) => {
      const e = String((l.email_address ?? l.email ?? "") || "").trim().toLowerCase();
      return e === needle;
    });

    if (match?.id != null) return { success: true, leadId: String(match.id) };
  }

  return { success: false, error: "not_found" };
}

/**
 * Fetch a list of replies across the whole workspace.
 * Useful as a fallback to discover lead_id when /api/leads searching is unavailable.
 */
export async function fetchEmailBisonRepliesGlobal(
  apiKey: string,
  filters?: { folder?: string; search?: string }
): Promise<{ success: boolean; data?: EmailBisonReplyMessage[]; error?: string }> {
  const qs = new URLSearchParams();
  if (filters?.folder) qs.set("filters[folder]", filters.folder);
  if (filters?.search) qs.set("filters[search]", filters.search);

  const url = `${INBOXXIA_BASE_URL}/api/replies${qs.toString() ? `?${qs.toString()}` : ""}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      return {
        success: false,
        error: `EmailBison replies fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"}`,
      };
    }

    const body = await parseJsonSafe(response);
    const replies: EmailBisonReplyMessage[] =
      Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.replies) ? body.replies : [];

    return { success: true, data: replies };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch global replies:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Fetch all sender email accounts for the workspace associated with the API key.
 */
export async function fetchEmailBisonSenderEmails(
  apiKey: string
): Promise<{ success: boolean; data?: EmailBisonSenderEmailAccount[]; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/sender-emails`;

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      return {
        success: false,
        error: `EmailBison sender-emails fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"}`,
      };
    }

    const body = await parseJsonSafe(response);
    const list: EmailBisonSenderEmailAccount[] =
      Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.sender_emails) ? body.sender_emails : [];

    return { success: true, data: list };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch sender emails:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Create a new lead in EmailBison
 * Used for UNTRACKED_REPLY events where the sender isn't in any campaign
 * Returns the created lead's ID which becomes emailBisonLeadId
 */
export async function createEmailBisonLead(
  apiKey: string,
  leadData: {
    email: string;
    first_name?: string | null;
    last_name?: string | null;
  }
): Promise<{ success: boolean; leadId?: string; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/leads`;

  console.log(`[EmailBison] Creating lead for email: ${leadData.email}`);

  try {
    const response = await emailBisonFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: leadData.email,
        first_name: leadData.first_name || undefined,
        last_name: leadData.last_name || undefined,
      }),
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      console.error(`[EmailBison] Lead creation failed (${response.status}):`, body);
      return {
        success: false,
        error: `EmailBison lead creation failed (${response.status}): ${body?.error || body?.message || "Unknown error"}`,
      };
    }

    const data = await response.json();

    // The response should contain the created lead with its ID
    const leadId = data?.id || data?.lead?.id || data?.data?.id;

    if (!leadId) {
      console.error("[EmailBison] Lead created but no ID returned:", data);
      return {
        success: false,
        error: "Lead created but no ID returned from EmailBison",
      };
    }

    console.log(`[EmailBison] Created lead with ID: ${leadId}`);
    return { success: true, leadId: String(leadId) };
  } catch (error) {
    console.error("[EmailBison] Failed to create lead:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch full lead details from EmailBison including custom variables
 * Used to extract LinkedIn URL and other enrichment data
 */
export async function fetchEmailBisonLead(
  apiKey: string,
  bisonLeadId: string
): Promise<{ success: boolean; data?: EmailBisonLeadDetails; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/leads/${bisonLeadId}`;

  console.log(`[EmailBison] Fetching lead details for ID: ${bisonLeadId}`);

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      console.error(`[EmailBison] Lead fetch failed (${response.status}):`, body);
      return {
        success: false,
        error: `EmailBison lead fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"}`,
      };
    }

    const data = await response.json();

    // Handle response format - could be direct lead object or wrapped
    const leadData: EmailBisonLeadDetails = data?.lead || data?.data || data;

    if (!leadData?.id) {
      console.error("[EmailBison] Lead fetch returned no data:", data);
      return {
        success: false,
        error: "Lead fetch returned no data from EmailBison",
      };
    }

    console.log(`[EmailBison] Fetched lead ${leadData.id} with ${leadData.custom_variables?.length || 0} custom variables`);

    return { success: true, data: leadData };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch lead:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Extract specific custom variable value from EmailBison lead data
 * Variable names are case-insensitive
 */
export function getCustomVariable(
  customVars: EmailBisonCustomVariable[] | undefined,
  variableName: string
): string | null {
  if (!customVars || customVars.length === 0) return null;

  const lowerName = variableName.toLowerCase();
  const found = customVars.find(
    (cv) => cv.name.toLowerCase() === lowerName || cv.name.toLowerCase().replace(/[_\s]/g, "") === lowerName.replace(/[_\s]/g, "")
  );

  return found?.value?.trim() || null;
}
