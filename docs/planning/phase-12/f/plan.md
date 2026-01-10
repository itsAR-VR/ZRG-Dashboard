# Phase 12f — ChatGPT Export (leads.csv + messages.jsonl) + UI Button

## Focus
Ship a dashboard export that downloads a dataset suitable for analysis in ChatGPT: `leads.csv` (with names/emails) and `messages.jsonl` (full threaded messages, including `sentBy`).

## Inputs
- Lead + campaign + sentiment fields
- Message/thread storage (including outbound `sentBy` from Phase 12a)
- Provider-aware booking fields from Phase 12d
- Existing export/download patterns in the app (if any)

## Work
- Implement export endpoint(s) that return:
  - `leads.csv`: lead identifiers + name + email + campaign + sentiment + provider + booked fields + industry/headcount
  - `messages.jsonl`: message thread lines including `leadId`, direction, timestamp, body, channel, and `sentBy`
- Decide packaging:
  - Either a single `.zip` containing both files, or two authenticated downloads (prefer `.zip` for UX)
- Add dashboard UI button: “Download dataset for ChatGPT”
- Enforce access control and workspace scoping (export contains PII).
- Verify output formatting (CSV escaping, JSONL per-line valid JSON, deterministic field names).

## Output
- Added ChatGPT export endpoint (zip):
  - `app/api/export/chatgpt/route.ts` (`GET ?clientId=...`)
  - Produces `chatgpt-export-YYYY-MM-DD.zip` containing:
    - `leads.csv` (names/emails + campaign + sentiment + provider + booked fields + industry/headcount)
    - `messages.jsonl` (full threads with `direction`, `sentAt`, `channel`, `sentBy`, `aiDraftId`)
  - Enforces authenticated workspace scoping via `resolveClientScope(clientId)`
- Added dashboard button:
  - `components/dashboard/analytics-view.tsx` header now includes “Download dataset for ChatGPT” (enabled when a workspace is selected)

## Handoff
After Phase 12f, the system has a complete loop: per-campaign auto-send experimentation, provider-aware booking tracking, and reporting/export for analysis.
