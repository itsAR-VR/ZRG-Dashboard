export type SlackBlock = {
  type: string;
  block_id?: string;
  text?: { type: "plain_text" | "mrkdwn"; text: string; emoji?: boolean };
  fields?: Array<{ type: "mrkdwn"; text: string }>;
  elements?: Array<SlackButtonElement>;
  accessory?: unknown;
};

export type SlackButtonElement = {
  type: "button";
  text: { type: "plain_text"; text: string; emoji?: boolean };
  action_id: string;
  value?: string;
  url?: string;
  style?: "primary" | "danger";
};

type SlackApiResponse<T> = { ok: boolean; error?: string } & T;

const userIdCache = new Map<string, string>();
const dmChannelCache = new Map<string, string>();
const dedupeCache = new Map<string, number>();

function getSlackTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.SLACK_TIMEOUT_MS || "8000", 10);
  if (!Number.isFinite(parsed)) return 8_000;
  return Math.max(1_000, Math.min(60_000, parsed));
}

function getSlackBotToken(): string | null {
  const token = (process.env.SLACK_BOT_TOKEN || "").trim();
  return token ? token : null;
}

async function slackGet<T>(path: string, query: Record<string, string>): Promise<SlackApiResponse<T>> {
  const token = getSlackBotToken();
  if (!token) return { ok: false, error: "SLACK_BOT_TOKEN not configured" } as SlackApiResponse<T>;

  const url = new URL(`https://slack.com/api/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getSlackTimeoutMs());

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    const json = (await response.json()) as SlackApiResponse<T>;
    return json;
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: isAbort ? "Slack request timed out" : (error instanceof Error ? error.message : "Slack request failed") } as SlackApiResponse<T>;
  } finally {
    clearTimeout(timeout);
  }
}

async function slackPost<T>(path: string, body: unknown): Promise<SlackApiResponse<T>> {
  const token = getSlackBotToken();
  if (!token) return { ok: false, error: "SLACK_BOT_TOKEN not configured" } as SlackApiResponse<T>;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getSlackTimeoutMs());

  try {
    const response = await fetch(`https://slack.com/api/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const json = (await response.json()) as SlackApiResponse<T>;
    return json;
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: isAbort ? "Slack request timed out" : (error instanceof Error ? error.message : "Slack request failed") } as SlackApiResponse<T>;
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupSlackUserIdByEmail(email: string): Promise<string | null> {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;

  const envJon = (process.env.SLACK_JON_USER_ID || "").trim();
  if (normalized === "jonandmika@gmail.com" && envJon) {
    return envJon;
  }

  const cached = userIdCache.get(normalized);
  if (cached) return cached;

  const res = await slackGet<{ user?: { id?: string } }>("users.lookupByEmail", { email: normalized });
  const userId = res.ok ? (res.user?.id || null) : null;
  if (!userId) return null;

  userIdCache.set(normalized, userId);
  return userId;
}

async function openDmChannel(userId: string): Promise<string | null> {
  const cached = dmChannelCache.get(userId);
  if (cached) return cached;

  const res = await slackPost<{ channel?: { id?: string } }>("conversations.open", { users: userId });
  const channelId = res.ok ? (res.channel?.id || null) : null;
  if (!channelId) return null;

  dmChannelCache.set(userId, channelId);
  return channelId;
}

export type SlackDmResult = {
  success: boolean;
  skipped?: boolean;
  error?: string;
  // Phase 70: Return message metadata for interactive button updates
  messageTs?: string;
  channelId?: string;
};

export async function sendSlackDmByEmail(opts: {
  email: string;
  text: string;
  blocks?: SlackBlock[];
  dedupeKey?: string;
  dedupeTtlMs?: number;
}): Promise<SlackDmResult> {
  const ttlMs = Math.max(1_000, opts.dedupeTtlMs ?? 10 * 60 * 1000);

  if (opts.dedupeKey) {
    const last = dedupeCache.get(opts.dedupeKey);
    const now = Date.now();
    if (last && now - last < ttlMs) {
      return { success: true, skipped: true };
    }
    dedupeCache.set(opts.dedupeKey, now);
  }

  const userId = await lookupSlackUserIdByEmail(opts.email);
  if (!userId) return { success: false, error: "Slack user lookup failed" };

  const channelId = await openDmChannel(userId);
  if (!channelId) return { success: false, error: "Slack DM channel open failed" };

  const res = await slackPost<{ ts?: string }>("chat.postMessage", {
    channel: channelId,
    text: opts.text,
    ...(opts.blocks ? { blocks: opts.blocks } : {}),
  });

  if (!res.ok) {
    return { success: false, error: res.error || "Slack message failed" };
  }

  // Phase 70: Return message metadata for interactive button updates
  return {
    success: true,
    messageTs: res.ts,
    channelId,
  };
}

/**
 * Update an existing Slack message.
 *
 * Used by the Slack interactions webhook to update button states after approval.
 */
export async function updateSlackMessage(opts: {
  channelId: string;
  messageTs: string;
  text: string;
  blocks?: SlackBlock[];
}): Promise<{ success: boolean; error?: string }> {
  const res = await slackPost<{ ok: boolean }>("chat.update", {
    channel: opts.channelId,
    ts: opts.messageTs,
    text: opts.text,
    ...(opts.blocks ? { blocks: opts.blocks } : {}),
  });

  if (!res.ok) {
    return { success: false, error: res.error || "Slack message update failed" };
  }

  return { success: true };
}
