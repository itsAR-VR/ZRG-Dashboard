# Phase 109a — Audit + Reproduction

## Focus
Confirm the exact failure mode(s) causing “drafts not populating when lead is marked Interested,” and lock the minimal set of code touchpoints for the fix.

## Inputs
- User report: drafts not appearing / not auto-generated after manual sentiment update to Interested.
- Logs artifact: `logs_result (2).json`.
- Code paths:
  - `actions/crm-actions.ts` → `updateLeadSentimentTag`
  - `components/dashboard/action-station.tsx` → draft fetch `useEffect`
  - `lib/ai-drafts.ts` → `generateResponseDraft`
  - `app/api/webhooks/email/route.ts` + `lib/email-cleaning.ts` → email ingestion
  - `app/api/cron/insights/booked-summaries/route.ts` + `lib/insights-chat/thread-extractor.ts` → max_output_tokens failures

## Work
1. Validate current behavior in code:
   - Confirm `updateLeadSentimentTag` does not call `generateResponseDraft`.
   - Confirm ActionStation draft fetch effect does not re-run on sentiment changes.
2. Identify what “populate” means in UI:
   - Verify drafts are sourced exclusively from `getPendingDrafts` server action.
   - Verify UI auto-populates compose box from the most recent pending draft.
3. Triage logs:
   - Extract and summarize any `draft`-related events.
   - Confirm `/api/webhooks/email` null-byte error exists and identify which DB write likely failed.
   - Quantify Insights cron failures and identify the error category (`max_output_tokens`).
4. Confirm SMS/LinkedIn situation:
   - Verify SMS and LinkedIn draft generation is triggered via their inbound post-process jobs.
   - Identify what is missing for manual sentiment changes (should be channel-agnostic).

## Output
- Confirmed root causes:
  - Backend: `actions/crm-actions.ts:updateLeadSentimentTag` does not generate drafts when sentiment becomes eligible.
  - Frontend: `components/dashboard/action-station.tsx` draft fetch effect deps did not include sentiment, so drafts would not refetch after manual updates.
- Log triage confirmed two adjacent issues that can suppress drafts or create noise:
  - `/api/webhooks/email`: Postgres UTF-8 error from null bytes (`0x00`) in provider payloads.
  - `/api/cron/insights/booked-summaries`: frequent `max_output_tokens` incomplete outputs.
- Scope confirmation:
  - SMS + LinkedIn draft generation works via inbound post-processing; the missing manual sentiment trigger is channel-agnostic.

## Handoff
Proceed to Phase 109b to implement draft generation on manual sentiment changes.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Located the missing backend trigger (`updateLeadSentimentTag`) and missing UI refetch trigger (ActionStation `useEffect` deps).
  - Parsed `logs_result (2).json` to confirm the null-byte ingestion error and frequent `max_output_tokens` failures.
- Commands run:
  - `rg -n "updateLeadSentimentTag|shouldGenerateDraft|getPendingDrafts" ...` — confirmed trigger/refetch gaps
  - `python3` (log parsing) — confirmed `/api/webhooks/email` `0x00` error and booked-summaries `max_output_tokens` volume
- Blockers:
  - None.
- Next concrete steps:
  - Implement manual-sentiment draft generation (109b).
  - Harden meeting overseer gate (109c), email cleaning + webhook sanitization (109d), UI refetch behavior (109e), and insights retry budget bump (109f).
