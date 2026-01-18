# Phase 31d — Add Unipile Disconnection Notification to Workspace Admins

## Focus
Surface Unipile "disconnected_account" errors to workspace admins via FollowUpTask or Slack notification so they can reconnect their LinkedIn accounts.

## Inputs
- From 31c: Webhook response times are now fast
- Error observed: `[Unipile] Connection check failed (401): {"status":401,"type":"errors/disconnected_account","title":"Disconnected account","detail":"The account appears to be disconnected from the provider service."}`
- This happens in `/api/cron/followups` when trying to send LinkedIn messages
- Current behavior: Logs error, continues to next lead (correct for cron resilience)
- Problem: Workspace admin doesn't know their LinkedIn is disconnected

## Work

### 1. Identify Unipile error detection points
- `lib/unipile-api.ts` — `checkLinkedInConnection`, `sendLinkedInDM`, `sendLinkedInInMail`
- Followups cron — `/api/cron/followups`
- LinkedIn webhook — if exists

### 2. Create disconnection detection helper
```typescript
// lib/unipile-api.ts
export function isDisconnectedAccountError(error: unknown): boolean {
  if (typeof error === "string") {
    return error.includes("disconnected_account");
  }
  if (error && typeof error === "object") {
    const msg = (error as any).message || (error as any).detail || "";
    return msg.includes("disconnected_account") || msg.includes("Disconnected account");
  }
  return false;
}

export function parseUnipileErrorResponse(responseText: string): { isDisconnected: boolean; detail: string } {
  try {
    const parsed = JSON.parse(responseText);
    return {
      isDisconnected: parsed.type === "errors/disconnected_account" || parsed.status === 401,
      detail: parsed.detail || parsed.message || responseText,
    };
  } catch {
    return { isDisconnected: false, detail: responseText };
  }
}
```

### 3. Create workspace notification helper
```typescript
// lib/workspace-notifications.ts
export async function notifyWorkspaceDisconnection(opts: {
  clientId: string;
  integration: "linkedin" | "ghl" | "emailbison";
  errorDetail: string;
  dedupeKey: string;
}): Promise<void> {
  // Check if we've already notified recently (dedup by day)
  const existing = await prisma.followUpTask.findFirst({
    where: {
      clientId: opts.clientId,
      type: "INTEGRATION_DISCONNECTED",
      metadata: { path: ["dedupeKey"], equals: opts.dedupeKey },
      createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (existing) return;

  // Create FollowUpTask for dashboard visibility
  await prisma.followUpTask.create({
    data: {
      clientId: opts.clientId,
      type: "INTEGRATION_DISCONNECTED",
      priority: "HIGH",
      title: `${opts.integration.toUpperCase()} account disconnected`,
      description: `Your ${opts.integration} integration needs to be reconnected. Error: ${opts.errorDetail}`,
      metadata: { dedupeKey: opts.dedupeKey, integration: opts.integration },
    },
  });

  // Also send Slack notification if configured
  await sendWorkspaceSlackAlert(opts.clientId, {
    text: `[Integration Alert] ${opts.integration.toUpperCase()} disconnected: ${opts.errorDetail}`,
  });
}
```

### 4. Integrate into Unipile API calls
Update `checkLinkedInConnection` and send functions:
```typescript
export async function checkLinkedInConnection(
  accountId: string,
  linkedinUrl: string,
  clientId?: string // Add for notification
): Promise<ConnectionCheckResult> {
  // ...existing code...

  if (!response.ok) {
    const errorText = await response.text();
    const { isDisconnected, detail } = parseUnipileErrorResponse(errorText);

    console.error(`[Unipile] Connection check failed (${response.status}):`, errorText);

    if (isDisconnected && clientId) {
      await notifyWorkspaceDisconnection({
        clientId,
        integration: "linkedin",
        errorDetail: detail,
        dedupeKey: `unipile_disconnected:${clientId}:${new Date().toISOString().split("T")[0]}`,
      }).catch(console.error);
    }

    // ...rest of error handling...
  }
}
```

### 5. Update followups cron to pass clientId
Ensure the cron passes workspace context to Unipile calls:
```typescript
// In /api/cron/followups
const connectionCheck = await checkLinkedInConnection(
  accountId,
  lead.linkedinUrl,
  client.id // Pass for notification
);
```

### 6. Dashboard visibility
- FollowUpTask with type `INTEGRATION_DISCONNECTED` should appear in dashboard task list
- May need to add UI handling for this task type
- Link to Settings > Integrations for reconnection

## Output

**SKIPPED - Superseded by 31j**

This subphase assumed `FollowUpTask` has `clientId`, `priority`, `title`, `description`, and `metadata` fields. Per RED TEAM analysis (root plan.md), `FollowUpTask` is lead-scoped and does NOT have these fields.

The correct implementation approach is in **31j** which:
- Extends `Client` with integration health fields (`unipileConnectionStatus`, etc.)
- Uses UI banner + optional deduped Slack instead of FollowUpTask

## Handoff
Skip to 31f. Unipile notifications will be implemented in 31j using schema-consistent approach.
