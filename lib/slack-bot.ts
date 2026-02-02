import "server-only";

type SlackApiResponse<T> = { ok: boolean; error?: string } & T;

export type SlackConversation = {
  id: string;
  name: string;
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
};

export type SlackUser = {
  id: string;
  name: string;
  real_name?: string;
  profile?: {
    email?: string;
    image_48?: string;
    display_name?: string;
  };
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
};

function getSlackTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.SLACK_TIMEOUT_MS || "8000", 10);
  if (!Number.isFinite(parsed)) return 8_000;
  return Math.max(1_000, Math.min(60_000, parsed));
}

async function slackGet<T>(
  token: string,
  path: string,
  query: Record<string, string | number | undefined>
): Promise<SlackApiResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getSlackTimeoutMs());

  try {
    const url = new URL(`https://slack.com/api/${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });

    return (await response.json()) as SlackApiResponse<T>;
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: isAbort ? "Slack request timed out" : "Slack request failed" } as SlackApiResponse<T>;
  } finally {
    clearTimeout(timeout);
  }
}

async function slackPost<T>(token: string, path: string, body: unknown): Promise<SlackApiResponse<T>> {
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
      cache: "no-store",
    });

    return (await response.json()) as SlackApiResponse<T>;
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: isAbort ? "Slack request timed out" : "Slack request failed" } as SlackApiResponse<T>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function slackAuthTest(
  token: string
): Promise<{ success: boolean; team?: string; user?: string; error?: string }> {
  const trimmed = token.trim();
  if (!trimmed) return { success: false, error: "Missing Slack bot token" };

  const res = await slackGet<{ team?: string; user?: string }>(trimmed, "auth.test", {});
  if (!res.ok) return { success: false, error: res.error || "Slack auth.test failed" };

  return {
    success: true,
    team: typeof res.team === "string" ? res.team : undefined,
    user: typeof res.user === "string" ? res.user : undefined,
  };
}

export async function slackListConversations(opts: {
  token: string;
  types?: Array<"public_channel" | "private_channel">;
  limit?: number;
}): Promise<{ success: boolean; channels?: SlackConversation[]; error?: string }> {
  const trimmed = opts.token.trim();
  if (!trimmed) return { success: false, error: "Missing Slack bot token" };

  const types = (opts.types && opts.types.length > 0 ? opts.types : ["public_channel", "private_channel"]).join(",");
  const pageLimit = Math.max(1, Math.min(200, opts.limit ?? 200));

  const channels: SlackConversation[] = [];
  let cursor: string | undefined = undefined;

  for (let page = 0; page < 6; page += 1) {
    const res: SlackApiResponse<{
      channels?: SlackConversation[];
      response_metadata?: { next_cursor?: string };
    }> = await slackGet(trimmed, "conversations.list", {
      types,
      limit: pageLimit,
      cursor,
      exclude_archived: "true",
    });

    if (!res.ok) return { success: false, error: res.error || "Slack conversations.list failed" };

    if (Array.isArray(res.channels)) {
      for (const channel of res.channels) {
        if (!channel?.id || !channel?.name) continue;
        channels.push(channel);
      }
    }

    const next = res.response_metadata?.next_cursor;
    const nextCursor = typeof next === "string" && next.trim() ? next.trim() : null;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return { success: true, channels };
}

export async function slackListUsers(opts: {
  token: string;
  limit?: number;
}): Promise<{ success: boolean; users?: SlackUser[]; error?: string }> {
  const trimmed = opts.token.trim();
  if (!trimmed) return { success: false, error: "Missing Slack bot token" };

  const pageLimit = Math.max(1, Math.min(200, opts.limit ?? 200));
  const users: SlackUser[] = [];
  let cursor: string | undefined = undefined;

  for (let page = 0; page < 6; page += 1) {
    const res: SlackApiResponse<{
      members?: SlackUser[];
      response_metadata?: { next_cursor?: string };
    }> = await slackGet(trimmed, "users.list", {
      limit: pageLimit,
      cursor,
    });

    if (!res.ok) return { success: false, error: res.error || "Slack users.list failed" };

    if (Array.isArray(res.members)) {
      for (const member of res.members) {
        if (!member?.id) continue;
        if (member.deleted || member.is_bot || member.is_app_user) continue;
        users.push(member);
      }
    }

    const next = res.response_metadata?.next_cursor;
    const nextCursor = typeof next === "string" && next.trim() ? next.trim() : null;
    if (!nextCursor) break;
    cursor = nextCursor;
  }

  return { success: true, users };
}

export async function slackPostMessage(opts: {
  token: string;
  channelId: string;
  text: string;
  blocks?: unknown[];
}): Promise<{ success: boolean; error?: string }> {
  const trimmed = opts.token.trim();
  if (!trimmed) return { success: false, error: "Missing Slack bot token" };

  const channelId = (opts.channelId || "").trim();
  if (!channelId) return { success: false, error: "Missing Slack channel ID" };

  const res = await slackPost<{ ts?: string }>(trimmed, "chat.postMessage", {
    channel: channelId,
    text: opts.text,
    ...(opts.blocks ? { blocks: opts.blocks } : {}),
  });

  if (!res.ok) return { success: false, error: res.error || "Slack chat.postMessage failed" };
  return { success: true };
}
