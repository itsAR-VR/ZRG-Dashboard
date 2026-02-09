# Phase 121d — Defense in Depth in Post-Process Pipelines + Validation Notes

## Focus
Apply a second layer of protection so legacy messages (already stored with quoted thread content) cannot trigger auto-booking. Re-clean inbound email text immediately before calling `processMessageForAutoBooking(...)` in post-processing jobs.

## Inputs
- Phase 121a helper: `stripEmailQuotedSectionsForAutomation(...)` in `lib/email-cleaning.ts`.
- Email inbound post-process pipeline: `lib/inbound-post-process/pipeline.ts`.
- Background job: `lib/background-jobs/email-inbound-post-process.ts`.

## Work
1. In `lib/inbound-post-process/pipeline.ts` (around line 267-286):
   - Add import: `import { stripEmailQuotedSectionsForAutomation } from "@/lib/email-cleaning";`
   - Before auto-booking call at line 286:
     ```typescript
     const inboundForAutoBook = stripEmailQuotedSectionsForAutomation(inboundText).trim();
     ```
   - Replace auto-booking call:
     ```typescript
     const autoBook = inboundForAutoBook
       ? await processMessageForAutoBooking(lead.id, inboundForAutoBook, { channel: "email", messageId: message.id })
       : { booked: false as const };
     ```
   - Also apply re-cleaning to `inboundText` before snooze detection (line 268) for consistency.
2. In `lib/background-jobs/email-inbound-post-process.ts` (around line 709-894):
   - Add import: `import { stripEmailQuotedSectionsForAutomation } from "@/lib/email-cleaning";`
   - Before auto-booking call at line 894:
     ```typescript
     const inboundForAutoBook = stripEmailQuotedSectionsForAutomation(inboundText).trim();
     ```
   - Replace auto-booking call to use `inboundForAutoBook` instead of `inboundText`.
3. Check SmartLead and Instantly background jobs:
   - `lib/background-jobs/smartlead-inbound-post-process.ts` — if it calls `processMessageForAutoBooking`, apply the same re-cleaning.
   - `lib/background-jobs/instantly-inbound-post-process.ts` — same check.
   - These jobs may also receive email content that includes quoted threads.
4. Validation checklist:
   - `npm test` — all tests pass
   - `npm run lint` — no new warnings
   - `npm run build` — TypeScript compiles
5. Operational verification notes (post-deploy):
   - Monitor Slack auto-book notifications for 24h after deploy.
   - Spot-check inbound email threads containing quoted availability; confirm no spurious booking.

## Validation (RED TEAM)
- Verify `stripEmailQuotedSectionsForAutomation` is imported and used in BOTH pipeline files.
- Test: legacy message with `body = "Thanks!\n\nOn Mon wrote:\nI have availability at 3pm"` → auto-booking sees only "Thanks!" after re-cleaning.
- `npm test && npm run lint && npm run build` must all pass.

## Output
- Auto-book calls from inbound email post-processing only see reply-only text, even if DB contains legacy noisy content.
- A documented validation + verification checklist for shipping.

## Handoff
After validation, proceed to implementation and ship. If any regression is detected in email display, keep `Message.body` as reply-only (possibly empty) and do not expose rawHtml/rawText in UI.
