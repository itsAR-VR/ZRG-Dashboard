# Phase 121a — Email Quote Stripping Hardening + Regression Fixtures

## Focus
Harden email cleaning so the "reply-only" body reliably strips quoted threads (especially Gmail HTML where "On ... wrote:" can be split across lines), and add regression tests that reproduce the false auto-book trigger class.

## Inputs
- Root context: `docs/planning/phase-121/plan.md`
- Current cleaning implementation: `lib/email-cleaning.ts:stripQuotedSections()` and `cleanEmailBody(...)`
- Existing tests: `lib/__tests__/email-cleaning.test.ts`

## Work
1. Add regression tests in `lib/__tests__/email-cleaning.test.ts`:
   - Case: reply text + Gmail-style quoted header where `On Mon, Jan 6, 2025 at 10:00 AM` is on one line and `John Doe <john@example.com> wrote:` is on the next line → cleaned output must ONLY contain the reply.
   - Case: quoted thread includes offered availability slots ("I have availability at 3pm EST on Thursday") → cleaned output must exclude the quoted availability.
   - Case: `>` prefixed lines mixed with non-prefixed quote boundary → both stripped.
   - Case: forwarded message markers (`Begin forwarded message:`, `---------- Forwarded message ----------`) → stripped.
   - Ensure existing 4 null-byte tests still pass.
2. Update `lib/email-cleaning.ts:stripQuotedSections()` (currently PRIVATE, line 9):
   - Current regex `/On .*wrote:/i` at line 17 uses `.` which does NOT match `\n`. Replace with a line-oriented boundary scan:
     - Scan lines sequentially. If a line matches `/^On\s.+/i`, look ahead 1-2 lines for a line ending in `wrote:` (case-insensitive).
     - If found, treat the `On ...` line as the quote boundary (truncate at that index).
     - Keep existing single-line `On ... wrote:` match as fast path.
   - Add forward markers to `threadMarkers[]`: `/^Begin forwarded message:/im`, `/^-{5,}\s*Forwarded message\s*-{5,}$/im`.
   - Keep existing `>`-prefixed line filtering and signature trimming.
3. Create a NEW exported function (the private `stripQuotedSections` stays internal):
   ```typescript
   export function stripEmailQuotedSectionsForAutomation(text: string): string {
     return stripQuotedSections(text);
   }
   ```
   This thin wrapper allows pipeline code to re-clean without depending on `cleanEmailBody()` (which expects HTML/text inputs, not pre-cleaned text).

## Validation (RED TEAM)
- `node --import tsx --test lib/__tests__/email-cleaning.test.ts` — pass
- `npm test` — pass
- New tests must FAIL if the multi-line `On...wrote:` fix is reverted.
- Verify: `stripEmailQuotedSectionsForAutomation("Hello\n\nOn Mon wrote:\nquoted text")` returns `"Hello"`.

## Output
- Improved quote stripping behavior in `lib/email-cleaning.ts`.
- Regression tests in `lib/__tests__/email-cleaning.test.ts` that fail on old behavior and pass on new behavior.

## Handoff
Proceed to Phase 121b to ensure ingestion/storage never falls back to raw HTML/text in `message.body` when cleaned reply-only content is empty.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Hardened quoted-thread boundary detection to handle Gmail multi-line `On ... wrote:` and forwarded-message markers.
  - Added the exported helper `stripEmailQuotedSectionsForAutomation(...)` for defense-in-depth in automation paths.
  - Added regression tests for multi-line quote stripping and forwarded message stripping.
- Commands run:
  - `npm test` — pass (includes `lib/__tests__/email-cleaning.test.ts`)
- Blockers:
  - None.
- Next concrete steps:
  - Phase 121b (webhook storage semantics) and Phase 121d (automation-time re-cleaning) ensure quoted content cannot re-enter automation via legacy DB content.
