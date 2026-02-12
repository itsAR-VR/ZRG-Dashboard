# Phase 143c — SMS + LinkedIn Pipeline Integration

## Focus

Wire action signal detection into SMS and LinkedIn pipelines. Note: these channels rarely have email signatures, so Tier 2 AI disambiguation will almost never trigger — but the code path is present for consistency.

## Inputs

- `lib/action-signal-detector.ts` from Phase 143a
- Pattern from Phase 143b
- `lib/background-jobs/sms-inbound-post-process.ts` (has uncommitted Phase 139/140 changes — re-read before editing)
- `lib/background-jobs/linkedin-inbound-post-process.ts`

## Work

### 1. SMS Pipeline (`lib/background-jobs/sms-inbound-post-process.ts`)

Insert after `handleLeadSchedulerLinkIfPresent` (line ~266), before draft generation (line ~280):

- Gate: `isPositiveSentiment(newSentiment)`
- For SMS: `strippedText = inboundText` (SMS has no signature stripping — body IS the full text)
- `fullText = messageBody` (same — no quoted sections in SMS)
- This means Tier 2 will never trigger for SMS (strippedText === fullText, so link-in-signature condition is impossible)
- Pass `actionSignals` to `generateResponseDraft` opts

### 2. LinkedIn Pipeline (`lib/background-jobs/linkedin-inbound-post-process.ts`)

Insert after `handleLeadSchedulerLinkIfPresent` (line ~234), before draft generation (line ~300):

- Gate: `isPositiveSentiment(newSentiment)`
- For LinkedIn: `strippedText = messageBody` (LinkedIn messages don't have traditional signatures)
- `fullText = messageBody`
- Same as SMS — Tier 2 won't trigger
- Pass `actionSignals` to `generateResponseDraft` opts

### 3. Both insertions must follow the fail-safe pattern

- try/catch with non-fatal warning
- notifyActionSignals as fire-and-forget (.catch(() => undefined))

## Progress This Turn (Terminus Maximus)
- Work done:
  - Wired action-signal detection + Slack notification + `actionSignals` passthrough in `lib/background-jobs/sms-inbound-post-process.ts`.
  - Wired action-signal detection + Slack notification + `actionSignals` passthrough in `lib/background-jobs/linkedin-inbound-post-process.ts`.
  - Added parity wiring for background email processing in `lib/background-jobs/email-inbound-post-process.ts` (Phase 143 root now enforces both email paths).
- Commands run:
  - `rg --line-number "actionSignals|detectActionSignals|notifyActionSignals" lib/background-jobs/sms-inbound-post-process.ts lib/background-jobs/linkedin-inbound-post-process.ts lib/background-jobs/email-inbound-post-process.ts` — pass (expected callsites present).
- Blockers:
  - None.
- Next concrete steps:
  - Complete subphase 143d typing/prompt injection in `lib/ai-drafts.ts`.
  - Complete subphase 143e tests + verification gates.

## Output

- SMS pipeline now runs gated detection, emits Slack notifications, and forwards `actionSignals` into draft generation.
- LinkedIn pipeline now runs gated detection, emits Slack notifications, and forwards `actionSignals` into draft generation.
- Background email pipeline now also runs detection + notification + draft passthrough to maintain parity with `lib/inbound-post-process/pipeline.ts`.
- Coordination notes:
  - Integrated into files concurrently touched by phases 138/139/140; merged by symbol and preserved existing scheduling/auto-send behavior.

## Handoff

Pipeline parity is complete across shared email pipeline, background email pipeline, SMS, and LinkedIn. Proceed to 143d for typed draft-context injection and then 143e for tests/verification.
