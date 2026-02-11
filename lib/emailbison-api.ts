export interface EmailBisonCampaign {
  id: string;
  name: string;
  status?: string;
}

export interface EmailBisonPaginationMeta {
  current_page?: number | null;
  last_page?: number | null;
  per_page?: number | null;
  total?: number | null;
  [key: string]: unknown;
}

export interface EmailBisonPaginationLinks {
  first?: string | null;
  last?: string | null;
  prev?: string | null;
  next?: string | null;
  [key: string]: unknown;
}

export interface EmailBisonCampaignLead {
  id: number;
  email?: string | null;
  email_address?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  lead_campaign_data?: Array<{ emails_sent?: number | null; [key: string]: unknown }> | null;
  [key: string]: unknown;
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

export interface EmailBisonScheduledEmail {
  id: number;
  lead_id?: number;
  sequence_step_id?: number;
  email_subject?: string | null;
  email_body?: string | null;
  status?: string | null;
  sent_at?: string | null;
  scheduled_date?: string | null;
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

export type EmailBisonRequestOptions = {
  /**
   * EmailBison base host for this request (hostname only).
   * Example: `send.meetinboxxia.com`
   */
  baseHost?: string | null;
};

// Deployment fallback for EmailBison base URL. Per-workspace base hosts should take precedence when provided.
const DEFAULT_EMAILBISON_BASE_URL = (process.env.EMAILBISON_BASE_URL || "https://send.meetinboxxia.com").replace(/\/+$/, "");

function truncateForLog(value: string, maxLen = 500): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}…`;
}

export function resolveEmailBisonBaseUrl(baseHost?: string | null): string {
  const candidate = typeof baseHost === "string" ? baseHost.trim() : "";
  if (!candidate) return DEFAULT_EMAILBISON_BASE_URL;

  const normalized = candidate.replace(/\/+$/, "");
  const withScheme = normalized.startsWith("http://") || normalized.startsWith("https://")
    ? normalized
    : `https://${normalized}`;

  try {
    const url = new URL(withScheme);
    return url.origin;
  } catch {
    return DEFAULT_EMAILBISON_BASE_URL;
  }
}

function resolveEmailBisonBaseHost(baseHost?: string | null): string {
  const baseUrl = resolveEmailBisonBaseUrl(baseHost);
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

function formatEmailBisonAuthFailure(status: number, upstreamMessage: string | null | undefined, baseHost?: string | null): string {
  const host = resolveEmailBisonBaseHost(baseHost);
  const hint = upstreamMessage ? ` (${truncateForLog(upstreamMessage, 200)})` : "";

  return (
    `EmailBison authentication failed (${status})${hint}. ` +
    "This often means a URL/API key mismatch (the key does not exist for this base URL) or an invalid/expired key. " +
    "Update your API key in Settings → Integrations. " +
    `If the key is correct, confirm the EmailBison base host matches your account (Settings → Integrations → EmailBison Base Host; current host: ${host}).`
  );
}

function formatEmailBisonHttpError(
  status: number,
  endpoint: string,
  upstreamMessage: string | null | undefined,
  baseHost?: string | null
): string {
  const host = resolveEmailBisonBaseHost(baseHost);
  const message = upstreamMessage ? truncateForLog(upstreamMessage, 200) : "Unknown error";
  return `EmailBison ${endpoint} failed (${status}) [host=${host}]: ${message}`;
}

async function readJsonOrTextSafe(
  response: Response
): Promise<{ json: any | null; text: string | null }> {
  try {
    const text = await response.text();
    if (!text) return { json: null, text: null };
    try {
      return { json: JSON.parse(text), text };
    } catch {
      return { json: null, text };
    }
  } catch {
    return { json: null, text: null };
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

function redactEmailBisonUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    const [withoutQuery] = url.split("?");
    return withoutQuery || url;
  }
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
          console.log(`[EmailBison] Request cancelled by caller: ${redactEmailBisonUrlForLog(url)}`);
        } else {
          console.error(`[EmailBison] Non-retryable error (${abortKind}): ${lastError.message}`);
        }
        throw lastError;
      }

      // If we have retries left, wait and try again
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(
          `[EmailBison] Retry ${attempt + 1}/${maxRetries} after ${delay}ms (${abortKind}): ${redactEmailBisonUrlForLog(url)}`
        );
        await sleep(delay);
        continue;
      }

      // Out of retries
      console.error(
        `[EmailBison] All ${maxRetries + 1} attempts failed for ${redactEmailBisonUrlForLog(url)}: ${lastError.message}`
      );
      throw lastError;
    }
  }

  throw lastError ?? new Error("Unexpected: no error captured");
}

export async function fetchEmailBisonCampaigns(
  apiKey: string,
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; data?: EmailBisonCampaign[]; error?: string }> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const host = resolveEmailBisonBaseHost(opts.baseHost);
  const baseUrl = `${baseOrigin}/api/campaigns`;
  const endpoint = "GET /api/campaigns";

  try {
    const byId = new Map<string, EmailBisonCampaign>();
    const visited = new Set<string>();
    let pagesFetched = 0;
    let nextUrl: string | null = baseUrl;

    while (nextUrl) {
      pagesFetched += 1;
      if (pagesFetched > 200) {
        console.warn("[EmailBison] Campaigns fetch aborted: exceeded max pages", {
          endpoint,
          host,
        });
        return { success: false, error: "EmailBison campaigns fetch aborted: exceeded max pages (possible pagination loop)." };
      }

      if (visited.has(nextUrl)) {
        console.warn("[EmailBison] Campaigns fetch aborted: pagination loop detected", {
          endpoint,
          host,
          url: redactEmailBisonUrlForLog(nextUrl),
        });
        return { success: false, error: "EmailBison campaigns fetch aborted: pagination loop detected." };
      }
      visited.add(nextUrl);

      const response = await emailBisonFetch(nextUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const { json: body, text } = await readJsonOrTextSafe(response);
        const upstreamError =
          body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

        if (response.status === 401 || response.status === 403) {
          console.warn("[EmailBison] Campaigns fetch auth failed:", {
            status: response.status,
            endpoint,
            host,
            error: upstreamError ?? "Unknown error",
          });
          return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamError, opts.baseHost) };
        }

        console.warn("[EmailBison] Campaigns fetch failed:", {
          status: response.status,
          endpoint,
          host,
          error: upstreamError ?? "Unknown error",
        });
        return {
          success: false,
          error: formatEmailBisonHttpError(response.status, "campaigns fetch", upstreamError, opts.baseHost),
        };
      }

      const { json: data, text } = await readJsonOrTextSafe(response);
      if (!data) {
        console.warn("[EmailBison] Campaigns fetch succeeded but response was not JSON:", {
          endpoint,
          host,
          preview: typeof text === "string" ? truncateForLog(text) : null,
        });
        return { success: false, error: "EmailBison campaigns fetch succeeded but returned an invalid response." };
      }

      const campaignsArray: any[] =
        Array.isArray(data)
          ? data
          : Array.isArray(data?.campaigns)
            ? data.campaigns
            : Array.isArray(data?.data)
              ? data.data
              : Array.isArray(data?.data?.campaigns)
                ? data.data.campaigns
                : Array.isArray(data?.results)
                  ? data.results
                  : [];

      for (const c of campaignsArray) {
        const id = String(c?.id ?? c?.bisonCampaignId ?? c?.campaignId ?? "").trim();
        if (!id) continue;
        byId.set(id, {
          id,
          name: (c?.name || c?.title || "Untitled Campaign").toString(),
          status: c?.status,
        });
      }

      const rawNextLink = data?.links?.next;
      const nextLink = typeof rawNextLink === "string" && rawNextLink.trim().length > 0 ? rawNextLink.trim() : null;
      if (nextLink) {
        const resolvedNext = (() => {
          try {
            return new URL(nextLink, baseOrigin).toString();
          } catch {
            return null;
          }
        })();

        if (resolvedNext) {
          const originOk = (() => {
            try {
              return new URL(resolvedNext).origin === baseOrigin;
            } catch {
              return false;
            }
          })();

          if (originOk) {
            nextUrl = resolvedNext;
            continue;
          }

          console.warn("[EmailBison] Ignoring campaigns pagination next link with unexpected origin", {
            endpoint,
            host,
            next: redactEmailBisonUrlForLog(resolvedNext),
          });
        }
      }

      const currentPage = Number(data?.meta?.current_page);
      const lastPage = Number(data?.meta?.last_page);
      if (Number.isFinite(currentPage) && Number.isFinite(lastPage) && currentPage < lastPage) {
        nextUrl = `${baseUrl}?page=${currentPage + 1}`;
        continue;
      }

      nextUrl = null;
    }

    console.log("[EmailBison] Campaigns fetch succeeded", {
      host,
      campaigns: byId.size,
      pages: pagesFetched,
    });

    return { success: true, data: Array.from(byId.values()) };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch campaigns:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function fetchEmailBisonCampaignLeadsPage(
  apiKey: string,
  bisonCampaignId: string,
  page: number,
  opts: EmailBisonRequestOptions = {}
): Promise<{
  success: boolean;
  data?: EmailBisonCampaignLead[];
  meta?: EmailBisonPaginationMeta;
  links?: EmailBisonPaginationLinks;
  error?: string;
}> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const host = resolveEmailBisonBaseHost(opts.baseHost);
  const pageNum = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const url = `${baseOrigin}/api/campaigns/${encodeURIComponent(bisonCampaignId)}/leads?page=${pageNum}`;

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamError =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        console.warn("[EmailBison] Campaign leads fetch auth failed:", {
          status: response.status,
          endpoint: "GET /api/campaigns/:id/leads",
          host,
          error: upstreamError ?? "Unknown error",
        });
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamError, opts.baseHost) };
      }

      console.warn("[EmailBison] Campaign leads fetch failed:", {
        status: response.status,
        endpoint: "GET /api/campaigns/:id/leads",
        host,
        error: upstreamError ?? "Unknown error",
      });
      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "campaign leads fetch", upstreamError, opts.baseHost),
      };
    }

    const { json: body, text } = await readJsonOrTextSafe(response);
    if (!body) {
      console.warn("[EmailBison] Campaign leads fetch succeeded but response was not JSON:", {
        host,
        endpoint: "GET /api/campaigns/:id/leads",
        preview: typeof text === "string" ? truncateForLog(text) : null,
      });
      return { success: false, error: "EmailBison campaign leads fetch succeeded but returned an invalid response." };
    }

    const list: EmailBisonCampaignLead[] =
      Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.leads) ? body.leads : [];

    const meta: EmailBisonPaginationMeta | undefined =
      body?.meta && typeof body.meta === "object"
        ? (body.meta as EmailBisonPaginationMeta)
        : body?.data?.meta && typeof body.data.meta === "object"
          ? (body.data.meta as EmailBisonPaginationMeta)
          : undefined;

    const links: EmailBisonPaginationLinks | undefined =
      body?.links && typeof body.links === "object"
        ? (body.links as EmailBisonPaginationLinks)
        : body?.data?.links && typeof body.data.links === "object"
          ? (body.data.links as EmailBisonPaginationLinks)
          : undefined;

    return { success: true, data: list, meta, links };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch campaign leads:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

function parseEmailBisonNumericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    return normalized > 0 ? normalized : null;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * Stop future emails for selected leads in a given EmailBison campaign.
 *
 * Docs: POST /api/campaigns/{campaign_id}/leads/stop-future-emails
 */
export async function stopEmailBisonCampaignFutureEmailsForLeads(
  apiKey: string,
  bisonCampaignId: string,
  leadIds: Array<string | number>,
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; message?: string; error?: string }> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const host = resolveEmailBisonBaseHost(opts.baseHost);
  const url = `${baseOrigin}/api/campaigns/${encodeURIComponent(bisonCampaignId)}/leads/stop-future-emails`;
  const endpoint = "POST /api/campaigns/:id/leads/stop-future-emails";

  const parsedLeadIds = leadIds
    .map((id) => parseEmailBisonNumericId(id))
    .filter((id): id is number => id !== null);

  if (parsedLeadIds.length === 0) {
    return { success: false, error: "No valid EmailBison lead IDs provided." };
  }

  try {
    const response = await emailBisonFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lead_ids: parsedLeadIds }),
    });

    if (!response.ok) {
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamMessage =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        console.warn("[EmailBison] Stop future emails auth failed:", {
          status: response.status,
          endpoint,
          host,
          error: upstreamMessage ?? "Unknown error",
        });
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamMessage, opts.baseHost) };
      }

      console.warn("[EmailBison] Stop future emails failed:", {
        status: response.status,
        endpoint,
        host,
        error: upstreamMessage ?? "Unknown error",
      });
      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "stop future emails", upstreamMessage, opts.baseHost),
      };
    }

    const { json: body, text } = await readJsonOrTextSafe(response);
    if (!body) {
      console.warn("[EmailBison] Stop future emails succeeded but response was not JSON:", {
        endpoint,
        host,
        preview: typeof text === "string" ? truncateForLog(text) : null,
      });
      return {
        success: false,
        error: "EmailBison stop future emails returned an empty or invalid response.",
      };
    }

    const successRaw = body?.data?.success ?? body?.success;
    const messageRaw = body?.data?.message ?? body?.message;
    const message = typeof messageRaw === "string" ? messageRaw : undefined;

    if (typeof successRaw !== "boolean") {
      console.warn("[EmailBison] Stop future emails response missing success flag:", {
        endpoint,
        host,
        hasBody: Boolean(body),
        hasData: Boolean(body?.data),
      });
      return {
        success: false,
        error: "EmailBison stop future emails response was missing a success flag.",
      };
    }

    if (!successRaw) {
      return {
        success: false,
        error: message ? `EmailBison stop future emails reported failure: ${message}` : "EmailBison stop future emails reported failure.",
      };
    }

    return { success: true, message };
  } catch (error) {
    console.error("[EmailBison] Failed to stop future emails:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function sendEmailBisonReply(
  apiKey: string,
  replyId: string,
  payload: EmailBisonReplyPayload,
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; data?: any; error?: string }> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const host = resolveEmailBisonBaseHost(opts.baseHost);
  const url = `${baseOrigin}/api/replies/${replyId}/reply`;

  console.log(`[EmailBison] Sending reply ${replyId}`, {
    toCount: payload.to_emails.length,
    senderEmailId: payload.sender_email_id,
    subjectLen: (payload.subject ?? "").length,
    messageLen: payload.message.length,
    contentType: payload.content_type ?? "text",
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
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamMessage =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        console.warn("[EmailBison] Reply send auth failed:", {
          status: response.status,
          endpoint: "POST /api/replies/:id/reply",
          host,
          error: upstreamMessage ?? "Unknown error",
        });
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamMessage, opts.baseHost) };
      }

      console.warn("[EmailBison] Reply send failed:", {
        status: response.status,
        endpoint: "POST /api/replies/:id/reply",
        host,
        error: upstreamMessage ?? "Unknown error",
      });
      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "reply send", upstreamMessage, opts.baseHost),
      };
    }

    const { json: body } = await readJsonOrTextSafe(response);
    console.log(`[EmailBison] Reply sent successfully (${replyId})`);
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
  bisonLeadId: string,
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; data?: EmailBisonReplyMessage[]; error?: string }> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const host = resolveEmailBisonBaseHost(opts.baseHost);
  const url = `${baseOrigin}/api/leads/${bisonLeadId}/replies?filters[folder]=all`;

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
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamMessage =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        console.warn("[EmailBison] Replies fetch auth failed:", {
          status: response.status,
          endpoint: "GET /api/leads/:id/replies",
          host,
          error: upstreamMessage ?? "Unknown error",
        });
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamMessage, opts.baseHost) };
      }

      console.warn("[EmailBison] Replies fetch failed:", {
        status: response.status,
        endpoint: "GET /api/leads/:id/replies",
        host,
        error: upstreamMessage ?? "Unknown error",
      });
      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "replies fetch", upstreamMessage, opts.baseHost),
      };
    }

    const { json: data, text } = await readJsonOrTextSafe(response);
    if (!data) {
      console.warn("[EmailBison] Replies fetch succeeded but response was not JSON:", {
        host,
        endpoint: "GET /api/leads/:id/replies",
        preview: typeof text === "string" ? truncateForLog(text) : null,
      });
      return { success: false, error: "EmailBison replies fetch succeeded but returned an invalid response." };
    }

    // Handle both array response and object with replies property
    const repliesArray: EmailBisonReplyMessage[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.replies)
          ? data.replies
          : [];

    console.log(`[EmailBison] Found ${repliesArray.length} replies for lead ${bisonLeadId}`);
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
  bisonLeadId: string,
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; data?: EmailBisonSentEmail[]; error?: string }> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const host = resolveEmailBisonBaseHost(opts.baseHost);
  const url = `${baseOrigin}/api/leads/${bisonLeadId}/sent-emails`;

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
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamMessage =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        console.warn("[EmailBison] Sent emails fetch auth failed:", {
          status: response.status,
          endpoint: "GET /api/leads/:id/sent-emails",
          host,
          error: upstreamMessage ?? "Unknown error",
        });
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamMessage, opts.baseHost) };
      }

      console.warn("[EmailBison] Sent emails fetch failed:", {
        status: response.status,
        endpoint: "GET /api/leads/:id/sent-emails",
        host,
        error: upstreamMessage ?? "Unknown error",
      });
      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "sent-emails fetch", upstreamMessage, opts.baseHost),
      };
    }

    const { json: data, text } = await readJsonOrTextSafe(response);
    if (!data) {
      console.warn("[EmailBison] Sent emails fetch succeeded but response was not JSON:", {
        host,
        endpoint: "GET /api/leads/:id/sent-emails",
        preview: typeof text === "string" ? truncateForLog(text) : null,
      });
      return { success: false, error: "EmailBison sent emails fetch succeeded but returned an invalid response." };
    }

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
 * Fetch scheduled emails for a lead from EmailBison (pre-send queue).
 * Used for "first touch availability" injection where we must respect the scheduled send time.
 */
export async function fetchEmailBisonScheduledEmails(
  apiKey: string,
  bisonLeadId: string,
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; data?: EmailBisonScheduledEmail[]; error?: string }> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const host = resolveEmailBisonBaseHost(opts.baseHost);
  const url = `${baseOrigin}/api/leads/${encodeURIComponent(bisonLeadId)}/scheduled-emails`;

  console.log(`[EmailBison] Fetching scheduled emails for lead ${bisonLeadId}`);

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamMessage =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        console.warn("[EmailBison] Scheduled emails fetch auth failed:", {
          status: response.status,
          endpoint: "GET /api/leads/:id/scheduled-emails",
          host,
          error: upstreamMessage ?? "Unknown error",
        });
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamMessage, opts.baseHost) };
      }

      console.warn("[EmailBison] Scheduled emails fetch failed:", {
        status: response.status,
        endpoint: "GET /api/leads/:id/scheduled-emails",
        host,
        error: upstreamMessage ?? "Unknown error",
      });
      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "scheduled-emails fetch", upstreamMessage, opts.baseHost),
      };
    }

    const { json: data, text } = await readJsonOrTextSafe(response);
    if (!data) {
      console.warn("[EmailBison] Scheduled emails fetch succeeded but response was not JSON:", {
        host,
        endpoint: "GET /api/leads/:id/scheduled-emails",
        preview: typeof text === "string" ? truncateForLog(text) : null,
      });
      return { success: false, error: "EmailBison scheduled emails fetch succeeded but returned an invalid response." };
    }

    const scheduledEmailsArray: EmailBisonScheduledEmail[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.scheduled_emails)
          ? data.scheduled_emails
          : Array.isArray(data?.scheduledEmails)
            ? data.scheduledEmails
            : [];

    console.log(`[EmailBison] Found ${scheduledEmailsArray.length} scheduled emails for lead ${bisonLeadId}`);
    return { success: true, data: scheduledEmailsArray };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch scheduled emails:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Patch a lead on EmailBison.
 * Currently used for setting lead custom variables (e.g. availability slot sentences for first-touch emails).
 */
export async function patchEmailBisonLead(
  apiKey: string,
  bisonLeadId: string,
  payload: { custom_variables?: EmailBisonCustomVariable[] },
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; data?: any; error?: string }> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const host = resolveEmailBisonBaseHost(opts.baseHost);
  const url = `${baseOrigin}/api/leads/${encodeURIComponent(bisonLeadId)}`;

  try {
    const response = await emailBisonFetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamMessage =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        console.warn("[EmailBison] Lead patch auth failed:", {
          status: response.status,
          endpoint: "PATCH /api/leads/:id",
          host,
          error: upstreamMessage ?? "Unknown error",
        });
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamMessage, opts.baseHost) };
      }

      console.warn("[EmailBison] Lead patch failed:", {
        status: response.status,
        endpoint: "PATCH /api/leads/:id",
        host,
        error: upstreamMessage ?? "Unknown error",
      });
      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "lead patch", upstreamMessage, opts.baseHost),
      };
    }

    const { json: body } = await readJsonOrTextSafe(response);
    return { success: true, data: body };
  } catch (error) {
    console.error("[EmailBison] Failed to patch lead:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
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
  },
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; data?: EmailBisonReplyMessage[]; error?: string }> {
  const encoded = encodeURIComponent(leadId);
  const qs = new URLSearchParams();

  if (filters?.folder) qs.set("filters[folder]", filters.folder);
  if (filters?.campaign_id != null) qs.set("filters[campaign_id]", String(filters.campaign_id));
  if (filters?.sender_email_id != null) qs.set("filters[sender_email_id]", String(filters.sender_email_id));
  if (filters?.search) qs.set("filters[search]", filters.search);
  if (filters?.read != null) qs.set("filters[read]", String(filters.read));

  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const url = `${baseOrigin}/api/leads/${encoded}/replies${qs.toString() ? `?${qs.toString()}` : ""}`;

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamMessage =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamMessage, opts.baseHost) };
      }

      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "lead replies fetch", upstreamMessage, opts.baseHost),
      };
    }

    const { json: body } = await readJsonOrTextSafe(response);
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
  url: string,
  opts: EmailBisonRequestOptions
): Promise<{ success: boolean; data?: EmailBisonLeadListItem[]; error?: string }> {
  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamError =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamError, opts.baseHost) };
      }

      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "leads fetch", upstreamError, opts.baseHost),
      };
    }

    const { json: body } = await readJsonOrTextSafe(response);
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
  email: string,
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; leadId?: string; error?: string }> {
  const needle = email.trim().toLowerCase();
  if (!needle) return { success: false, error: "missing_email" };

  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const candidates = [
    `${baseOrigin}/api/leads?filters[search]=${encodeURIComponent(needle)}&per_page=200`,
    `${baseOrigin}/api/leads?search=${encodeURIComponent(needle)}&per_page=200`,
    `${baseOrigin}/api/leads?filters[email]=${encodeURIComponent(needle)}&per_page=200`,
    `${baseOrigin}/api/leads?filters[email_address]=${encodeURIComponent(needle)}&per_page=200`,
  ];

  for (const url of candidates) {
    const res = await fetchEmailBisonLeadsListByUrl(apiKey, url, opts);
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
  filters?: { folder?: string; search?: string },
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; data?: EmailBisonReplyMessage[]; error?: string }> {
  const qs = new URLSearchParams();
  if (filters?.folder) qs.set("filters[folder]", filters.folder);
  if (filters?.search) qs.set("filters[search]", filters.search);

  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const url = `${baseOrigin}/api/replies${qs.toString() ? `?${qs.toString()}` : ""}`;

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamError =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamError, opts.baseHost) };
      }

      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "replies fetch", upstreamError, opts.baseHost),
      };
    }

    const { json: body } = await readJsonOrTextSafe(response);
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
  apiKey: string,
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; data?: EmailBisonSenderEmailAccount[]; error?: string }> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const url = `${baseOrigin}/api/sender-emails`;

  try {
    const response = await emailBisonFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamError =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);

      if (response.status === 401 || response.status === 403) {
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamError, opts.baseHost) };
      }

      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "sender-emails fetch", upstreamError, opts.baseHost),
      };
    }

    const { json: body } = await readJsonOrTextSafe(response);
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
  },
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; leadId?: string; error?: string }> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const host = resolveEmailBisonBaseHost(opts.baseHost);
  const url = `${baseOrigin}/api/leads`;

  console.log("[EmailBison] Creating lead");

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
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamError =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);
      if (response.status === 401 || response.status === 403) {
        console.warn("[EmailBison] Lead creation auth failed:", {
          status: response.status,
          endpoint: "POST /api/leads",
          host,
          error: upstreamError ?? "Unknown error",
        });
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamError, opts.baseHost) };
      }

      console.warn("[EmailBison] Lead creation failed:", {
        status: response.status,
        endpoint: "POST /api/leads",
        host,
        error: upstreamError ?? "Unknown error",
      });
      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "lead creation", upstreamError, opts.baseHost),
      };
    }

    const { json: data } = await readJsonOrTextSafe(response);
    if (!data) {
      return { success: false, error: "EmailBison lead creation succeeded but returned an invalid response." };
    }

    // The response should contain the created lead with its ID
    const leadId = data?.id || data?.lead?.id || data?.data?.id;

    if (!leadId) {
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
  bisonLeadId: string,
  opts: EmailBisonRequestOptions = {}
): Promise<{ success: boolean; data?: EmailBisonLeadDetails; error?: string }> {
  const baseOrigin = resolveEmailBisonBaseUrl(opts.baseHost);
  const host = resolveEmailBisonBaseHost(opts.baseHost);
  const url = `${baseOrigin}/api/leads/${bisonLeadId}`;

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
      const { json: body, text } = await readJsonOrTextSafe(response);
      const upstreamError =
        body?.error || body?.message || (typeof text === "string" ? truncateForLog(text) : null);
      if (response.status === 401 || response.status === 403) {
        console.warn("[EmailBison] Lead fetch auth failed:", {
          status: response.status,
          endpoint: "GET /api/leads/:id",
          host,
          error: upstreamError ?? "Unknown error",
        });
        return { success: false, error: formatEmailBisonAuthFailure(response.status, upstreamError, opts.baseHost) };
      }

      console.warn("[EmailBison] Lead fetch failed:", {
        status: response.status,
        endpoint: "GET /api/leads/:id",
        host,
        error: upstreamError ?? "Unknown error",
      });
      return {
        success: false,
        error: formatEmailBisonHttpError(response.status, "lead fetch", upstreamError, opts.baseHost),
      };
    }

    const { json: data } = await readJsonOrTextSafe(response);
    if (!data) {
      return { success: false, error: "EmailBison lead fetch succeeded but returned an invalid response." };
    }

    // Handle response format - could be direct lead object or wrapped
    const leadData: EmailBisonLeadDetails = data?.lead || data?.data || data;

    if (!leadData?.id) {
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
