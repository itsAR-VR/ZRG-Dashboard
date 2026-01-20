# Phase 45c — Server Action for Bulk Regeneration

## Focus

Create a `regenerateAllDrafts()` server action that bulk-regenerates AI drafts for a workspace. This follows the `syncAllConversations()` pattern with index-based cursor pagination and timeout safety.

## Inputs

- Subphases a and b completed: Bug fixes for placeholder text and truncated URLs
- Reference pattern: `actions/message-actions.ts:syncAllConversations()` for cursor/timeout handling
- Eligibility: `shouldGenerateDraft(sentimentTag, email?)` from `lib/ai-drafts.ts` (includes `Follow Up`, excludes bounce senders when email is passed)
- Existing per-lead action: `actions/message-actions.ts:regenerateDraft(leadId, channel)` can be reused (or factor out a system helper to avoid per-lead access checks + per-lead `revalidatePath("/")`)

## Work

### 1. Read reference implementations

Read the following to understand existing patterns:
- `actions/message-actions.ts` - find `syncAllConversations` pattern
- `actions/message-actions.ts` - find `regenerateDraft` (current per-lead regeneration behavior)
- `lib/ai-drafts.ts` - confirm `shouldGenerateDraft(sentimentTag, email?)` signature

### 2. Define return type

```typescript
export type RegenerateAllDraftsResult = {
  success: boolean;
  totalEligible: number;
  processedLeads: number;
  nextCursor: number | null;
  hasMore: boolean;
  regenerated: number;
  skipped: number;
  errors: number;
  error?: string;
};
```

### 3. Implement server action

```typescript
/**
 * Regenerate AI drafts for all positive-sentiment leads in a workspace.
 * Follows syncAllConversations pattern with cursor-based pagination.
 *
 * @param clientId - The workspace ID
 * @param channel - The channel to regenerate drafts for (sms, email, linkedin)
 * @param options.cursor - Index offset for pagination (same semantics as syncAllConversations)
 * @param options.maxSeconds - Maximum execution time before returning (default: 55)
 * @param options.onlyPendingDrafts - If true, only regenerate leads that already have a pending draft for this channel
 */
export async function regenerateAllDrafts(
  clientId: string,
  channel: "sms" | "email" | "linkedin",
  options: { cursor?: number; maxSeconds?: number; onlyPendingDrafts?: boolean } = {}
): Promise<RegenerateAllDraftsResult> {
  const startedAtMs = Date.now();
  const maxSeconds = options.maxSeconds ?? 55; // leave some headroom for serverless timeout
  const deadlineMs = startedAtMs + maxSeconds * 1000;

  // Match syncAllConversations style: default to conservative concurrency unless explicitly set.
  const configuredConcurrency = Number(process.env.REGENERATE_ALL_DRAFTS_CONCURRENCY || "");
  const CONCURRENCY =
    Number.isFinite(configuredConcurrency) && configuredConcurrency > 0 ? Math.floor(configuredConcurrency) : 1;

  const onlyPendingDrafts = options.onlyPendingDrafts ?? true;

  // 1. Require admin access (throws on failure; wrap in try/catch in real implementation like syncAllConversations)
  await requireClientAdminAccess(clientId);

  // 2. Load eligible leads once; use index-based cursor like syncAllConversations.
  // NOTE: We still filter with shouldGenerateDraft(sentimentTag, email?) below so this query can stay simple.
  const leads = await prisma.lead.findMany({
    where: {
      clientId,
      ...(onlyPendingDrafts
        ? { aiDrafts: { some: { status: "pending", channel } } }
        : {}),
    },
    select: {
      id: true,
      sentimentTag: true,
      email: true,
    },
    orderBy: { id: "asc" },
  });

  const totalEligible = leads.length;
  const startIndex = options.cursor && options.cursor > 0 ? Math.floor(options.cursor) : 0;

  let processedLeads = 0;
  let regenerated = 0;
  let skipped = 0;
  let errors = 0;
  let nextIndex: number | null = null;

  // 4. Process in batches
  for (let i = startIndex; i < leads.length; i += CONCURRENCY) {
    if (Date.now() >= deadlineMs) {
      nextIndex = i;
      break;
    }

    const batch = leads.slice(i, i + CONCURRENCY);
    processedLeads += batch.length;

    // Process batch concurrently
    const results = await Promise.allSettled(
      batch.map(async (lead) => {
        try {
          const sentimentTag = lead.sentimentTag || "Neutral";
          const email = channel === "email" ? lead.email : null;

          // Check if draft generation is appropriate (includes Follow Up, excludes bounce senders if email present)
          if (!shouldGenerateDraft(sentimentTag, email)) {
            return { status: "skipped" as const };
          }

          // Regenerate draft
          // NOTE: regenerateDraft currently does requireLeadAccess + revalidatePath("/") per lead;
          // consider factoring out a system helper for bulk use to reduce overhead.
          const draftResult = await regenerateDraft(lead.id, channel);
          return { status: draftResult.success ? ("regenerated" as const) : ("error" as const) };
        } catch (error) {
          console.error(
            `[RegenerateAll] Failed for lead ${lead.id}:`,
            error instanceof Error ? error.message : error
          );
          return { status: "error" as const };
        }
      })
    );

    // Aggregate results
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.status === "regenerated") regenerated++;
        else if (result.value.status === "skipped") skipped++;
        else errors++;
      } else {
        errors++;
      }
    }
  }

  const hasMore = nextIndex != null && nextIndex < leads.length;

  // 5. Return cursor for continuation (like syncAllConversations)
  return {
    success: true,
    totalEligible,
    processedLeads,
    nextCursor: hasMore ? nextIndex : null,
    hasMore,
    regenerated,
    skipped,
    errors,
  };
}
```

### 4. RED TEAM: avoid scope surprises

- Default to `onlyPendingDrafts: true` so the bulk action refreshes existing pending drafts (no surprise new draft creation).
- If “all eligible leads” is desired, add an explicit UI toggle + warning/confirmation.

## Output

- New `regenerateAllDrafts()` server action in `actions/message-actions.ts`
- Type export `RegenerateAllDraftsResult` for UI consumption
- Cursor-based pagination for handling large lead counts
- Time budget enforcement for Vercel timeout safety

## Handoff

Subphase d will create the Settings UI component that calls this server action and displays progress to the user.
