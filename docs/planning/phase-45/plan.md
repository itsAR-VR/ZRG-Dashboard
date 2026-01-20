# Phase 45 — AI Draft Booking Link Fixes + Bulk Regeneration

## Purpose

Fix two bugs where AI drafts output placeholder text (`{insert booking link}`) or truncated URLs (`https://c`) instead of actual booking links, then add a bulk regeneration feature so users can refresh all drafts after fixing AI/persona settings.

## Context

**Bug 1: AI generating `{insert booking link}` placeholder literally**
- **Root cause**: In `lib/booking-process-instructions.ts:177-193`, when `stage.includeBookingLink` is true but `getBookingLink()` returns null (no calendar link configured), **no instruction is added to the prompt**
- The AI sees booking context in the conversation and hallucinates a placeholder based on its training data patterns
- **Fix**: Add explicit "do NOT use placeholder" instruction when booking link is null

**Bug 2: Truncated booking link `https://c`**
- **Root cause**: AI hits output token limits mid-generation, truncating the URL
- **Fix**: Add post-processing validation to detect and remove truncated URLs + placeholder patterns

**Feature Request: Bulk Draft Regeneration**
- **Use case**: After fixing AI persona settings or booking link configuration, users need to refresh all existing drafts
- **Scope (default)**: Regenerate **existing pending** drafts for positive-sentiment leads (Interested, Meeting Requested, Call Requested, Information Requested, Follow Up)
- **Channel**: User-selectable dropdown (SMS, Email, LinkedIn)
- **Location**: Settings page (AI Personality tab) as an admin-only action
- **Pattern**: Follow `syncAllConversations()` for cursor-based pagination + timeout safety (index-based cursor)

## Coordination / Recent Related Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 44 | Complete | None | EmailBison/Calendly auth bugs - unrelated |
| Phase 43 | Complete | None | Lead assignment - unrelated |
| Phase 42 | Complete | `actions/message-actions.ts`, cron | Bulk regen should mirror cursor + `maxSeconds` + concurrency patterns used here |
| Phase 41 | Complete | `components/dashboard/settings-view.tsx` | Add the new admin-only card without disrupting Settings layout |
| Phase 39 | Complete | `lib/ai-drafts.ts`, Settings AI tab | Ensure draft pipeline assumptions match current persona plumbing |
| Phase 38 | Complete | `lib/ai-drafts.ts` | Prefer leveraging existing `max_output_tokens` retry signals over saving partial output |
| Phase 40 | Uncommitted (untracked) | `scripts/crawl4ai/*` | No overlap with AI drafts |

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/booking-process-instructions.ts` only adds booking-link instructions when `getBookingLink(...)` returns a non-empty string (no else branch today).
  - `lib/ai-drafts.ts` persists `draftContent` directly to `AIDraft.content` (`prisma.aIDraft.create` around ~1689) and surfaces `response.incomplete_details?.reason === "max_output_tokens"`.
  - `actions/message-actions.ts` already has:
    - `syncAllConversations(clientId, { cursor, maxSeconds })` where `cursor` is an **index**, not `Lead.id`, and concurrency is `SYNC_ALL_CONCURRENCY` (default 1).
    - `regenerateDraft(leadId, channel)` which rejects existing pending drafts then calls `generateResponseDraft(...)`.
  - `components/dashboard/settings-view.tsx` has an `AI Personality` tab (`TabsContent value="ai"`) and uses `getWorkspaceAdminStatus(...)` → `isWorkspaceAdmin` for admin-only UI.
- What the plan assumes:
  - Bulk regeneration should match the **index-based cursor** semantics used by `syncAllConversations` for UI continuation.
  - Eligibility should be determined via `shouldGenerateDraft(sentimentTag, email?)` (includes `Follow Up`, excludes bounce senders); `POSITIVE_SENTIMENTS` alone is insufficient.
- Verified touch points:
  - `lib/booking-process-instructions.ts:buildStageInstructions` (`stage.includeBookingLink`, `getBookingLink`)
  - `lib/ai-drafts.ts:generateResponseDraft` (`response.incomplete_details`, `prisma.aIDraft.create`)
  - `actions/message-actions.ts:syncAllConversations`, `actions/message-actions.ts:regenerateDraft`
  - `components/dashboard/settings-view.tsx` (`TabsContent value="ai"`, `isWorkspaceAdmin`)

## Objectives

* [x] Fix booking link null case in `lib/booking-process-instructions.ts` (add explicit "no placeholder" instruction)
* [x] Add post-processing sanitization in `lib/ai-drafts.ts` (detect/remove placeholder patterns and truncated URLs)
* [x] Create `regenerateAllDrafts()` server action following `syncAllConversations` pattern
* [x] Add Settings UI for bulk draft regeneration in Settings → AI Personality (channel selector, progress indicator, admin-only)
* [x] Verify fixes with lint + build

## Non-Goals

- No Prisma schema changes in Phase 45.
- No changes to booking provider integrations (Calendly/CalendarLink) beyond prompt instructions.
- No background-job queue for bulk regeneration (cursor-based server action + UI continuation only).

## Constraints

- Bug fixes must be backward-compatible (no schema changes needed)
- Bulk regeneration must respect existing sentiment rules (`shouldGenerateDraft(sentimentTag, email?)`)
- Bulk regeneration must handle timeouts gracefully (cursor-based continuation)
- Concurrency: configurable via `REGENERATE_ALL_DRAFTS_CONCURRENCY` env (default 1, align with `SYNC_ALL_CONCURRENCY`)

## Success Criteria

- [x] No placeholder text (`{insert booking link}`, `[booking link]`, etc.) appears in generated drafts when booking link is null
- [x] Truncated URLs are detected and removed before saving drafts (or the draft is retried instead of saving partial output)
- [x] Warning logged when placeholders or truncated URLs are sanitized
- [x] Bulk regeneration processes all eligible leads per chosen scope (default: pending drafts) with progress tracking
- [x] Bulk regeneration UI shows: processed/total, regenerated count, errors
- [x] `npm run lint` passes
- [x] `npm run build` passes

## Files to Modify

| File | Changes |
|------|---------|
| `lib/booking-process-instructions.ts` | Add `else` branch (lines 192+) for null booking link |
| `lib/ai-drafts.ts` | Add `sanitizeDraftContent()` function, call before save (~line 1686) |
| `actions/message-actions.ts` | Add `regenerateAllDrafts()` server action (~line 1377) |
| `components/dashboard/settings-view.tsx` | Add bulk regeneration Card in AI Personality tab (admin-only) |
| `components/dashboard/settings/bulk-draft-regeneration.tsx` | New card component (channel + mode + progress + continuation) |
| `README.md` | Document `REGENERATE_ALL_DRAFTS_CONCURRENCY` (and any new behavior toggles) |

## Subphase Index

* a — Booking link null case fix (`lib/booking-process-instructions.ts`)
* b — Post-processing sanitization (`lib/ai-drafts.ts`)
* c — Server action for bulk regeneration (`actions/message-actions.ts`)
* d — Settings UI component (`components/dashboard/settings-view.tsx`)
* e — Verification and testing
* f — Implement + harden (all-eligible mode, retries, length bounds)
* g — Verification (lint/build + smoke checks)

---

## Implementation Details

### Step a: Fix booking link null case

**File**: `lib/booking-process-instructions.ts`

Add `else` branch at line 192 (after the `if (bookingLink)` block ends at line 191):

```typescript
// Line 192 (inside buildStageInstructions, after the if (bookingLink) block)
} else {
  // No booking link configured - explicitly tell AI not to use placeholder
  instructions.push(
    `IMPORTANT: No booking link is configured for this workspace. Do NOT include any placeholder text like "{booking link}", "{insert booking link}", "[booking link]", or similar. Instead, ask the lead for their availability or offer to send specific times.`
  );
  console.warn(
    `[BookingProcess] Stage ${stage.stageNumber} requests booking link but none configured for client ${clientId}`
  );
}
```

### Step b: Post-processing sanitization

**File**: `lib/ai-drafts.ts`

Add utility function after imports (~line 50):

```typescript
// Placeholder patterns the AI might generate when no booking link provided
const BOOKING_LINK_PLACEHOLDERS = [
  /\{insert booking link\}/gi,
  /\{booking link\}/gi,
  /\{calendar link\}/gi,
  /\{calendarLink\}/gi,
  /\[insert booking link\]/gi,
  /\[booking link\]/gi,
  /\[your booking link\]/gi,
];

// Truncated URL pattern (URL that ends abruptly)
const TRUNCATED_URL_PATTERN = /https?:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.?(?=\s|$)/g;

/**
 * Sanitize AI draft content by removing placeholder booking links and truncated URLs.
 */
export function sanitizeDraftContent(
  content: string,
  leadId: string,
  channel: string
): string {
  let result = content;
  let hadPlaceholders = false;
  let hadTruncatedUrl = false;

  for (const pattern of BOOKING_LINK_PLACEHOLDERS) {
    const next = result.replace(pattern, "");
    if (next !== result) {
      hadPlaceholders = true;
      result = next;
    }
  }

  const nextAfterTruncated = result.replace(TRUNCATED_URL_PATTERN, "");
  if (nextAfterTruncated !== result) {
    hadTruncatedUrl = true;
    result = nextAfterTruncated;
  }

  if (hadPlaceholders || hadTruncatedUrl) {
    console.warn(
      `[AI Drafts] Sanitized draft for lead ${leadId} (${channel}):`,
      { hadPlaceholders, hadTruncatedUrl }
    );
    // Clean up double spaces and trim
    result = result.replace(/\s{2,}/g, ' ').trim();
  }

  return result;
}
```

Call before saving draft (~line 1686, before `prisma.aIDraft.create`):

```typescript
draftContent = sanitizeDraftContent(draftContent, leadId, channel);
```

**Note (RED TEAM):** If OpenAI returns `response.incomplete_details?.reason === "max_output_tokens"`, prefer retrying with more headroom over saving partial output (sanitization is a last-resort safety net).

### Step c: Server action for bulk regeneration

**File**: `actions/message-actions.ts`

Add after `regenerateDraft` function (~line 1377):

```typescript
// =============================================================================
// Bulk Draft Regeneration (Phase 45)
// =============================================================================

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

/**
 * Regenerate AI drafts for all positive-sentiment leads in a workspace.
 * Follows syncAllConversations pattern with cursor-based pagination.
 */
export async function regenerateAllDrafts(
  clientId: string,
  channel: "sms" | "email" | "linkedin",
  options: { cursor?: number; maxSeconds?: number } = {}
): Promise<RegenerateAllDraftsResult> {
  // Implementation:
  // 1. Require admin access
  // 2. Query leads with eligible sentiments (include "Follow Up") and/or existing pending drafts
  // 3. Filter through shouldGenerateDraft(sentimentTag, email?)
  // 4. Process in batches with Promise.allSettled()
  // 5. Return detailed stats with cursor for continuation
}
```

### Step d: Settings UI component

**File**: `components/dashboard/settings-view.tsx`

Add in Settings → AI Personality tab (admin-only section):

- Channel dropdown (Email, SMS, LinkedIn)
- "Regenerate All Drafts" button
- Progress indicator (processed/total, regenerated, skipped, errors)
- "Continue" button when pagination cursor exists
- "Reset" button to clear progress

---

## Verification Plan

1. **Bug 1 fix verification**:
   - Use a workspace with no CalendarLink or Calendly configured
   - Trigger draft generation for a positive lead
   - Verify no placeholder appears in the draft content
   - Check console for the warning log about missing booking link

2. **Bug 2 fix verification**:
   - Unit test the sanitization function with truncated URLs
   - Verify truncated URLs are removed and logged

3. **Bulk regeneration verification**:
   - Go to Settings > AI Personality tab (as admin)
   - Select "Email" channel
   - Click "Regenerate All Drafts"
   - Verify progress shows and leads are processed
   - Check drafts are updated in database
   - Test continuation with "Continue" button if many leads

4. **Build verification**:
   ```bash
   npm run lint
   npm run build
   ```

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Bulk regeneration accidentally generates *new* drafts for leads that did not already have drafts (surprise volume/cost) → default to “pending drafts only” or add an explicit toggle + confirmation.
- Drafts saved with partial output (esp. when `max_output_tokens` is hit) can truncate URLs → prefer retry/regenerate over “sanitize and save” whenever possible.
- Regex `.test(...)` on `/g` patterns is stateful and can miss matches → implement sanitization via replace+diff (or reset `lastIndex`) and keep the pattern set small.
- Bulk regen that calls `regenerateDraft(...)` per lead will `revalidatePath("/")` per lead → factor out a system helper or defer revalidation to once per run for performance.

### Missing or ambiguous requirements
- Should bulk regeneration target:
  - (A) leads with existing **pending** drafts for the selected channel, or
  - (B) all eligible leads (creating drafts where none exist)?
- Should it overwrite only pending drafts (default) or also approved/rejected?

### Repo mismatches (fix the plan)
- Settings location is the `AI Personality` tab (`value="ai"`), not “AI/Automation”.
- `syncAllConversations` uses an **index-based** cursor + `SYNC_ALL_CONCURRENCY` default 1.
- `shouldGenerateDraft(sentimentTag, email?)` includes `"Follow Up"`; `POSITIVE_SENTIMENTS` alone excludes it.

### Performance / timeouts
- Use `maxSeconds` + index cursor continuation like `syncAllConversations`.
- Default concurrency should be conservative (1) and env-tunable.

### Security / permissions
- Require `requireClientAdminAccess(clientId)` and validate `channel` against the known union.

## Open Questions (Need Human Input)

- [x] Bulk regeneration scope: add “all eligible leads” mode in addition to “pending drafts only”
  - Resolution: UI now supports both; “pending drafts only” remains the default, and “all eligible” is gated by an explicit acknowledgement.
- [x] Truncated URL handling: retry/regenerate on `max_output_tokens` and enforce strict email length bounds
  - Resolution: treat `status === "incomplete"` + `incomplete_details.reason === "max_output_tokens"` as truncated and retry with increasing `max_output_tokens` (bounded), with sanitization as last-resort.

## Assumptions (Agent)

- The UI should use `isWorkspaceAdmin` (via `getWorkspaceAdminStatus`) for gating in Settings. (confidence >= 95%)
  - Mitigation check: confirm a non-admin user can see Settings but should not see/admin-run bulk actions.
- Cursor semantics should match `syncAllConversations` (index-based) so the UI can reuse the same continuation pattern. (confidence >= 90%)
  - Mitigation check: if we prefer `Lead.id` cursor for DB stability, explicitly document the difference and ensure UI doesn’t assume index semantics.

## Phase Summary

- Implemented booking-link placeholder prevention, draft retry/length hardening, and a bulk draft regeneration admin UI (pending-only + all-eligible).
- Added env knobs: `REGENERATE_ALL_DRAFTS_CONCURRENCY`, `OPENAI_EMAIL_DRAFT_MIN_CHARS`, `OPENAI_EMAIL_DRAFT_MAX_CHARS`, `OPENAI_EMAIL_GENERATION_MAX_ATTEMPTS`, `OPENAI_EMAIL_GENERATION_TOKEN_INCREMENT`.
- Verified (2026-01-20):
  - `npm run lint`: pass (0 errors, 17 warnings)
  - `npm run build`: pass
  - `npm run db:push`: skipped (no schema changes)
- Review artifact: `docs/planning/phase-45/review.md`
- Follow-ups: Runtime smoke test recommended for real workspace/admin session.

## References (Docs)

- OpenAI docs: handling `status === "incomplete"` + `incomplete_details.reason === "max_output_tokens"` (may run out during reasoning before any output). https://platform.openai.com/docs/guides/reasoning
- OpenAI Help Center: controlling response length (no “min tokens” setting; enforce min/max length via prompt + retry). https://help.openai.com/en/articles/5072518-controlling-the-length-of-openai-model-responses
