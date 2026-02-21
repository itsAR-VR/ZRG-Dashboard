# Phase 178b — Code Trace + Fix: Process 4/5 Eligibility + Scheduler Link Handling + Prompt Disambiguation

## Focus
Trace and fix the specific gates that prevented Process 5 downstream handling and caused Process 4 false positives, while ensuring Process 4/5 actions can trigger under Interested and other sentiments.

## Inputs
- Phase 178a: validated lead/message IDs and routing outcomes.

## Work
- Process 5 (external scheduler link) handling:
  - Ensure scheduler link extraction recognizes relevant providers (including Notion) and can persist `Lead.externalSchedulingLink` when the inbound text explicitly instructs booking via that link.
  - Ensure the “lead scheduler link” follow-up task path is not sentiment-gated.
  - Key task creation off the booking-process router outcome (`processId=5`) to avoid missing valid phrasing variants.
- Process 4 (callback) handling:
  - Ensure call-request tasking can be triggered when booking-process routing detects callback intent, even if sentiment tag differs.
  - Ensure soft scheduled-call language does not get routed as callback intent.
- Prompt updates (AI-based disambiguation):
  - Booking process router prompt: Process 4 reserved for callback intent only.
  - Sentiment prompts: classify scheduled-call intent as meeting scheduling; reserve Call Requested for callback.

## Output
- Implemented Process 5 downstream handling hardening:
  - Notion scheduler links are recognized as scheduler links:
    - `lib/scheduling-link.ts`
  - Lead scheduler-link handler can use an observed link from the full message (signature included) even when the “reply-only” text strips the URL:
    - `lib/lead-scheduler-link.ts`
    - Call sites pass `observedSchedulerLink`:
      - `lib/inbound-post-process/pipeline.ts`
      - `lib/background-jobs/email-inbound-post-process.ts`
      - `lib/background-jobs/sms-inbound-post-process.ts`
      - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - Scheduler-link tasking can be forced by booking-process routing (`processId=5`) via `forceBookingProcess5` (fallback remains explicit-instruction based when not forced):
    - `lib/lead-scheduler-link.ts`
    - Forced invocation after action-signal detection in:
      - `lib/inbound-post-process/pipeline.ts`
      - `lib/background-jobs/email-inbound-post-process.ts`
      - `lib/background-jobs/sms-inbound-post-process.ts`
      - `lib/background-jobs/linkedin-inbound-post-process.ts`
- Implemented Process 4 eligibility hardening:
  - Call-request tasks can be created when booking-process routing detects callback intent under other sentiments (force option):
    - `lib/call-requested.ts`
    - Call sites:
      - `lib/inbound-post-process/pipeline.ts`
      - `lib/background-jobs/email-inbound-post-process.ts`
      - `lib/background-jobs/sms-inbound-post-process.ts`
      - `lib/background-jobs/linkedin-inbound-post-process.ts`
- Prompt disambiguation updates to reduce “soft scheduled call” => callback/process 4:
  - `lib/ai/prompt-registry.ts`
  - `lib/action-signal-detector.ts`
  - `lib/ai/prompts/sentiment-classify-v1.ts`
  - `lib/sentiment.ts`

## Handoff
Phase 178c should run full validation (including NTTAN replay) and write `docs/planning/phase-178/review.md`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Connected Process 5 “router says process 5, but no task created” gap: reply-only signature trimming + non-awaited link persistence could leave `externalSchedulingLink` unavailable for the handler.
  - Implemented `observedSchedulerLink` plumbing so the handler can create the `lead_scheduler_link` task reliably when the link is in the signature/footer.
  - Added router-driven forcing (`forceBookingProcess5`) so Process 5 tasking is keyed off the booking router outcome.
- Commands run:
  - None (code edits only).
- Blockers:
  - None.
- Next concrete steps:
  - Run `npm run build` and NTTAN gates for Phase 178 (Phase 178c).
