# Phase 81c — Actions: Server Actions for Member Listing and Recipient Management

## Focus

Create server actions for fetching Slack members, managing the cache, and updating approval recipients.

## Inputs

- Phase 81a: Schema fields `slackMembersCacheJson`, `slackMembersCachedAt`, `slackAutoSendApprovalRecipients`
- Phase 81b: `slackListUsers()` API function available
- Existing pattern: `actions/slack-integration-actions.ts` has token management actions

## Work

### 1. Create Type Definitions

**File**: `lib/auto-send/get-approval-recipients.ts` (new file)

```typescript
import "server-only";
import { prisma } from "@/lib/prisma";

export type SlackApprovalRecipient = {
  id: string;           // Slack user ID (U...)
  email: string;        // For display / fallback
  displayName: string;  // User's display name
  avatarUrl?: string;   // Profile image URL
};

/**
 * Get configured approval recipients for a workspace.
 * Returns empty array if not configured.
 */
export async function getConfiguredApprovalRecipients(
  clientId: string
): Promise<SlackApprovalRecipient[]> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { slackAutoSendApprovalRecipients: true },
  });

  if (!settings?.slackAutoSendApprovalRecipients) return [];

  try {
    const parsed = settings.slackAutoSendApprovalRecipients as unknown;
    if (!Array.isArray(parsed)) return [];

    // Validate each recipient has required fields
    return parsed.filter((r): r is SlackApprovalRecipient =>
      typeof r === "object" && r !== null &&
      typeof r.id === "string" &&
      typeof r.email === "string" &&
      typeof r.displayName === "string"
    );
  } catch {
    return [];
  }
}
```

### 2. Add Server Actions

**File**: `actions/slack-integration-actions.ts`

Add four new actions:

```typescript
import { slackListUsers, type SlackUser } from "@/lib/slack-bot";
import type { SlackApprovalRecipient } from "@/lib/auto-send/get-approval-recipients";

const SLACK_MEMBERS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Refresh Slack members cache for a workspace.
 */
export async function refreshSlackMembersCache(clientId: string): Promise<{
  success: boolean;
  members?: SlackApprovalRecipient[];
  error?: string;
}> {
  // 1. Get workspace token
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { slackBotToken: true },
  });

  if (!client?.slackBotToken) {
    return { success: false, error: "Slack bot token not configured" };
  }

  // 2. Fetch members from Slack API
  const result = await slackListUsers({ token: client.slackBotToken });
  if (!result.success || !result.users) {
    return { success: false, error: result.error || "Failed to fetch Slack members" };
  }

  // 3. Transform to our format
  const members: SlackApprovalRecipient[] = result.users
    .filter((u) => u.profile?.email) // Only users with email
    .map((u) => ({
      id: u.id,
      email: u.profile!.email!,
      displayName: u.profile?.display_name || u.real_name || u.name,
      avatarUrl: u.profile?.image_48,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // 4. Store in cache
  await prisma.workspaceSettings.upsert({
    where: { clientId },
    create: {
      clientId,
      slackMembersCacheJson: members as unknown as Prisma.JsonValue,
      slackMembersCachedAt: new Date(),
    },
    update: {
      slackMembersCacheJson: members as unknown as Prisma.JsonValue,
      slackMembersCachedAt: new Date(),
    },
  });

  return { success: true, members };
}

/**
 * Get Slack members (from cache if fresh, else refresh).
 */
export async function getSlackMembers(clientId: string): Promise<{
  success: boolean;
  members?: SlackApprovalRecipient[];
  cachedAt?: Date;
  error?: string;
}> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { slackMembersCacheJson: true, slackMembersCachedAt: true },
  });

  const cachedAt = settings?.slackMembersCachedAt;
  const cacheAge = cachedAt ? Date.now() - cachedAt.getTime() : Infinity;

  // If cache is fresh (< 1 hour), return cached
  if (cacheAge < SLACK_MEMBERS_CACHE_TTL_MS && settings?.slackMembersCacheJson) {
    const members = settings.slackMembersCacheJson as unknown as SlackApprovalRecipient[];
    return { success: true, members, cachedAt };
  }

  // Otherwise, refresh
  const result = await refreshSlackMembersCache(clientId);
  return {
    ...result,
    cachedAt: result.success ? new Date() : undefined,
  };
}

/**
 * Update selected approval recipients for a workspace.
 */
export async function updateSlackApprovalRecipients(
  clientId: string,
  recipients: SlackApprovalRecipient[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.workspaceSettings.upsert({
      where: { clientId },
      create: {
        clientId,
        slackAutoSendApprovalRecipients: recipients as unknown as Prisma.JsonValue,
      },
      update: {
        slackAutoSendApprovalRecipients: recipients as unknown as Prisma.JsonValue,
      },
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update recipients"
    };
  }
}

/**
 * Get current approval recipients for a workspace.
 */
export async function getSlackApprovalRecipients(clientId: string): Promise<{
  success: boolean;
  recipients?: SlackApprovalRecipient[];
  error?: string;
}> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { slackAutoSendApprovalRecipients: true },
  });

  if (!settings?.slackAutoSendApprovalRecipients) {
    return { success: true, recipients: [] };
  }

  const recipients = settings.slackAutoSendApprovalRecipients as unknown as SlackApprovalRecipient[];
  return { success: true, recipients };
}
```

### 3. Validation

- [ ] Run `npm run lint` — should pass
- [ ] Run `npm run build` — should pass

## Output

- `lib/auto-send/get-approval-recipients.ts`: Recipient type + normalization helper + `getSlackAutoSendApprovalConfig()`
- `actions/slack-integration-actions.ts`: Member cache actions and approval recipient CRUD (admin-gated)

## Handoff

Server actions are ready for:
- Phase 81d: Orchestrator will use `getConfiguredApprovalRecipients()`
- Phase 81e: UI will use `getSlackMembers()`, `updateSlackApprovalRecipients()`, etc.
