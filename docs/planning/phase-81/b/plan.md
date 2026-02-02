# Phase 81b — API: Add Slack `users.list` and `sendSlackDmByUserId`

## Focus

Add Slack API functions for listing workspace members and sending DMs by user ID (skipping email lookup).

## Inputs

- Phase 81a: Schema fields ready for storing cached members
- Existing pattern: `lib/slack-bot.ts` has `slackListConversations()` as reference
- Existing pattern: `lib/slack-dm.ts` has `sendSlackDmByEmail()` as reference

## Work

### 1. Add `slackListUsers()` to `lib/slack-bot.ts`

**Purpose**: Enumerate all human members in a Slack workspace.

```typescript
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
    const res = await slackGet<{
      members?: SlackUser[];
      response_metadata?: { next_cursor?: string };
    }>(trimmed, "users.list", {
      limit: pageLimit,
      cursor,
    });

    if (!res.ok) return { success: false, error: res.error || "Slack users.list failed" };

    if (Array.isArray(res.members)) {
      for (const member of res.members) {
        // Filter: only human users (not bots, not deleted, not app users)
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
```

**Key behaviors**:
- Paginate up to 6 pages (matches `slackListConversations` pattern)
- Filter out bots, deleted users, and app users
- Return human members only

### 2. Add `sendSlackDmByUserId()` to `lib/slack-dm.ts`

**Purpose**: Send DM directly by Slack user ID (more efficient when we already have the ID).

```typescript
export async function sendSlackDmByUserId(opts: {
  userId: string;
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

  const channelId = await openDmChannel(opts.userId);
  if (!channelId) return { success: false, error: "Slack DM channel open failed" };

  const res = await slackPost<{ ts?: string }>("chat.postMessage", {
    channel: channelId,
    text: opts.text,
    ...(opts.blocks ? { blocks: opts.blocks } : {}),
  });

  if (!res.ok) {
    return { success: false, error: res.error || "Slack message failed" };
  }

  return {
    success: true,
    messageTs: res.ts,
    channelId,
  };
}
```

**Key difference from `sendSlackDmByEmail`**:
- Skips `lookupSlackUserIdByEmail()` step
- Goes directly to `openDmChannel()` with the user ID
- Same deduplication and message posting logic

### 3. Validation

- [ ] Run `npm run lint` — should pass
- [ ] Run `npm run build` — should pass
- [ ] (Optional) Test with script: Call `slackListUsers()` with a workspace token

## Output

- `lib/slack-bot.ts`: Added `SlackUser` type + `slackListUsers()` pagination/filtering
- `lib/slack-dm.ts`: Added `sendSlackDmByUserId()` and token-scoped helpers:
  - `sendSlackDmByUserIdWithToken()`
  - `updateSlackMessageWithToken()`
  - token-scoped DM channel caching

## Handoff

Slack API functions are ready for Phase 81c to create server actions that call them and manage the member cache.
