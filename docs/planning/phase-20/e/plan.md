# Phase 20e — Observability + Config Healing (EmailBison Sender IDs, Surfaced Errors, Docs)

## Focus
Reduce operational noise and make issues self-healing where possible: fix recurring EmailBison invalid sender ID errors, improve error surfacing, and document the new reliability knobs.

## Inputs
- Vercel logs showing: `[EmailBison] Reply send failed (422): The selected sender email id is invalid.`
- Email send paths (`actions/email-actions.ts`, `actions/message-actions.ts`).
- Availability cache error surfacing (`lib/availability-cache.ts`, dashboard UI).

## Work
1. Ensure all outbound email send paths share the same “invalid sender ID” fallback and persist a corrected mapping when possible.
2. Surface availability/cache and sender-config issues in a workspace-scoped place (UI or logs) without leaking PII.
3. Update `README.md` with new env vars for draft budgets/timeouts, availability timeouts, and sync concurrency.

## Output
- EmailBison “invalid sender_email_id” errors are now self-healing:
  - `actions/email-actions.ts` marks the failing `EmailBisonSenderEmailSnapshot` as `isSendable=false` (`status=invalid_sender_email_id`) and retries once with a different sendable sender.
  - `lib/reactivation-engine.ts` marks snapshot sender IDs missing from the provider API response as `isSendable=false` (`status=missing_in_provider`) so stale IDs stop being selected.
- Documented new reliability knobs:
  - `README.md` documents draft timeouts/token knobs, `SUPABASE_MIDDLEWARE_TIMEOUT_MS`, and the updated `SYNC_ALL_CONCURRENCY` default.

## Handoff
Proceed to Phase 20 wrap-up: check off success criteria in `docs/planning/phase-20/plan.md`, add a Phase Summary, then run `npm run lint` and `npm run build` before shipping.
