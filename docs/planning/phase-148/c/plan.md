# Phase 148c — Runtime Reliability (Follow-Ups + Sender)

## Focus
Prevent follow-up task starvation and confusing runtime failures when leads have only company URLs or otherwise invalid LinkedIn profile prerequisites. **This subphase supersedes Phase 147's LinkedIn work entirely** (per resolved decision). Phase 147 only ships SMS fixes.

## Inputs
- Updated schema and ingestion semantics from Phase 148a/148b
- Follow-up engine execution rules: `lib/followup-engine.ts`
- LinkedIn send path: `lib/system-sender.ts`, `lib/unipile-api.ts`
- Phase 147 RED TEAM findings for reference (F1: `extractLinkedInPublicIdentifier` fallback bug, F5: backstop filter)

## Work

### 1. Sender Validation — `lib/system-sender.ts` (F5)
- In `sendLinkedInMessageSystem()` (line ~294), after existing null checks, add profile URL validation:
  ```typescript
  const validProfile = normalizeLinkedInUrl(lead.linkedinUrl);
  if (!validProfile) {
    return {
      success: false,
      error: "LinkedIn URL is not a personal profile — cannot send",
      isInvalidProfileUrl: true,
    };
  }
  ```
- This catches company URLs, malformed URLs, and other non-profile variants BEFORE they reach Unipile.
- The typed error field `isInvalidProfileUrl` lets the follow-up engine classify it as "skip-and-advance".

### 2. `extractLinkedInPublicIdentifier` Defense-in-Depth — `lib/unipile-api.ts`
- Lines 175-179: For non-`/in/` URLs, the fallback returns the last path segment. Company URL `linkedin.com/company/acme-corp` returns `"acme-corp"` as a person identifier.
- With sender validation (point 1), this should never receive a company URL. But add explicit defense:
  ```typescript
  // Reject company paths explicitly
  if (/\/company\//i.test(pathname)) return "";
  ```

### 3. Follow-Up Engine — `lib/followup-engine.ts`

#### Eligibility (channel availability)
- Treat LinkedIn channel eligibility as "profile URL exists" — not just "any LinkedIn URL exists".
- Where the engine checks `lead.linkedinUrl` for LinkedIn eligibility (lines ~1206, ~1235), add validation: `normalizeLinkedInUrl(lead.linkedinUrl)` — returns null for company URLs.

#### Skip-and-Advance for Invalid Profile URL
- For due LinkedIn follow-up tasks where `normalizeLinkedInUrl(lead.linkedinUrl)` is null (company URL or invalid):
  - Mark task as skipped with reason: `"LinkedIn skipped — URL is a company page, not a personal profile"`
  - Advance the instance to the next step (avoid infinite retries).
  - Use the existing `advance: true` skip pattern (11+ existing sites use this pattern).
  - Ensure "skipped" does not re-run later unless explicitly designed.

#### Skip-and-Advance for Sender Failure
- When `system-sender` returns `{ isInvalidProfileUrl: true }`, classify as skip-and-advance (not "pause forever").
- Record skip reason in `FollowUpTask.suggestedMessage` using existing plain-text convention.

#### Backstop Batch Filter (line ~2741)
- Currently only filters `!linkedinUrl` (missing). Update to: `!normalizeLinkedInUrl(lead.linkedinUrl)` — this returns null for company URLs, catching them at batch level before individual execution.
- After Phase 148d backfill, this guard is a no-op (no company URLs left in `linkedinUrl`), but it must exist during the transition window.

### 4. Error Messages
- When only `linkedinCompanyUrl` exists on a lead, error/skip messages should be informative:
  - `"LinkedIn skipped — lead has company page URL only (no personal profile)"`
  - Not: `"LinkedIn skipped — lead has no LinkedIn URL"` (misleading when company URL exists)

### 5. Logging
- Add log signatures for runtime observability:
  - `[LINKEDIN] Company URL skipped — leadId={id}, url={url}` (follow-up engine skip)
  - `[LINKEDIN] Invalid profile URL rejected — leadId={id}, url={url}` (system-sender rejection)

## Output
- Follow-up instances cannot starve on company-only LinkedIn data.
- Unipile send calls never receive a company URL as the target.
- Phase 147 LinkedIn work is superseded — update Phase 147 plan to mark 147b as superseded.
- Regression tests cover: profile-only eligible, company-only skip, invalid URL skip, advance behavior, sender rejection.

## Handoff
Proceed to Phase 148d to backfill existing data globally so historical leads stop triggering the old failure mode.
