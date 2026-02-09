# Phase 121b — Webhook Storage Semantics (No Raw Fallback) + Safe Compliance Classification

## Focus
Ensure inbound email storage never writes raw HTML/text (including quoted threads) into `Message.body`. Keep `Message.body` automation-safe and UI-safe (reply-only plain text). Preserve opt-out/bounce safety classification without needing to display raw content.

## Inputs
- Phase 121a outputs: hardened quote stripping + `stripEmailQuotedSectionsForAutomation(...)`.
- Inbound email webhook: `app/api/webhooks/email/route.ts`.
- Storage schema: `Message.body`, `Message.rawText`, `Message.rawHtml`.

## Work
1. Update `app/api/webhooks/email/route.ts` at ALL 4 locations where `cleanedBodyForStorage` is set:
   - **EmailBison reply** (line 620): `const cleanedBodyForStorage = cleaned.cleaned || contentForClassification;` → change to `const cleanedBodyForStorage = cleaned.cleaned;`
   - **Instantly** (line 1168): same change
   - **Inboxxia** (line 1400): same change
   - **Inboxxia scheduled** (line 1718): same change
   - Result: `Message.body` will be empty string when cleaning yields nothing (reply-only was empty or entirely quoted). This is safe — raw content is preserved in `rawText`/`rawHtml` columns.
2. Safety classification (opt-out/bounce) — update `inboundCombinedForSafety` at all 4 locations:
   - Current: `Subject: ${replySubject ?? ""} | ${cleaned.cleaned || contentForClassification}` — this ALREADY falls through to `contentForClassification` which can contain raw thread text.
   - New: build `inboundCombinedForSafety` using `cleaned.cleaned` when available. When `cleaned.cleaned` is empty, derive safety text by re-running `stripEmailQuotedSectionsForAutomation()` on `cleaned.rawText || cleaned.rawHtml || ""` (strip HTML tags first if HTML). This ensures opt-out/bounce keywords in the latest reply are detected without leaking quoted threads.
   - Extract a helper function to avoid repeating this logic 4 times:
     ```typescript
     function buildSafetyText(cleaned: { cleaned: string; rawText?: string; rawHtml?: string }, subject: string): string {
       const body = cleaned.cleaned || stripEmailQuotedSectionsForAutomation(
         cleaned.rawText || htmlToPlainSafe(cleaned.rawHtml || "")
       );
       return `Subject: ${subject} | ${body}`;
     }
     ```
3. Verify no other webhook paths reintroduce raw fallback:
   - Grep for `contentForClassification` in `message.body` or `body:` assignments → confirm none remain.

## Validation (RED TEAM)
- `npm run build` — no TypeScript errors from empty `cleanedBodyForStorage`.
- Manual check: send a test inbound email that is 100% quoted thread (no new reply text). Confirm `Message.body` is stored as `""` (not raw HTML).
- Manual check: send a test opt-out reply ("unsubscribe") buried in a quoted thread. Confirm `mustBlacklist` is still true.

## Output
- Inbound email messages are stored with an automation-safe `Message.body` that cannot contain quoted threads.
- Compliance safety checks still work when `Message.body` is empty.

## Handoff
Proceed to Phase 121c to harden auto-booking gating so generic acceptance cannot book based on long/non-scheduling messages.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated all inbound email webhook ingestion paths to store `Message.body = cleaned.cleaned` (no raw fallback; can be empty).
  - Added `buildInboundCombinedForSafety(...)` so opt-out/bounce checks still have a safe “latest reply” string even when `cleaned.cleaned` is empty.
- Commands run:
  - `npm run build` — pass
  - `npm test` — pass
- Blockers:
  - None.
- Next concrete steps:
  - Phase 121c: tighten generic acceptance + time-proposal triggers to fail closed on non-ack messages.
