# Phase 162 — Call-Request Signatures + Auto-Send Safety + Slot-Confirmation Correctness (Founders Club)

## Purpose
Fix the end-to-end FC inbound→AI pipeline so “call me at the number below/in my signature” is handled correctly (Slack notified, no redundant phone-number ask, no unintended auto-send), and stop the system from injecting arbitrary availability slots into booked confirmations.

## Context
We have a concrete regression in Founders Club email handling (example lead: `emad@tradefinancecompany.com`):
- Inbound email body: “you may reach me at direct contact number below” (phone is present in signature and already stored on the Lead).
- System drafted/sent: “Which number should we call?” (incorrect; we already have it).
- Expected behavior:
  - Route as Booking Process **4** (Call Requested) when the intent is to call using a number in the signature.
  - Send a Slack notification for the call request.
  - Per user decision: **do not auto-reply** when call intent is detected and a phone number is on file; notify only.
  - Also per user decision: do **not** create a “call task” unless sentiment is explicitly `Call Requested` (notify-only for signature-style contact language when sentiment is `Interested`).

Root causes discovered in repo + DB:
- Draft generation uses **signature-stripped** text (`stripEmailQuotedSectionsForAutomation`), so call intent + signature phone can be invisible to generators.
- `notifyActionSignals()` only posts to Slack when `signals.length > 0`; route-only outcomes can silently skip notifications.
- Booking-process router output for the example was `processId=3 (uncertain)` and no signals were emitted, so Slack notify didn’t happen.
- Auto-send evaluator approved “ask for phone number” because it wasn’t reliably aware that the lead phone is already on file.

Separate correctness issue:
- `applyShouldBookNowConfirmationIfNeeded()` had logic that could fall back to `firstOfferedSlot` when it couldn’t map a slot explicitly referenced in the draft, causing incorrect booked confirmations and triggering `slot_mismatch` / `date_mismatch` invariants.

Key locked decisions from user:
- **Call Reply behavior:** If Booking Process 4 (call intent) is detected and we already have a phone number on file: **no auto-reply**.
- **Process 4 trigger policy:** “reach me at direct contact number below” (number in signature) with sentiment `Interested`: **notify only** (no call task unless sentiment is `Call Requested`).
- **PII in prompts:** pass phone number to **draft + evaluator** prompts if needed, but enforce guardrails so it never appears in the outbound message.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 160 | Active | `components/dashboard/settings-view.tsx`, `next.config.mjs` (Knowledge Assets upload) | Phase 162 must avoid Settings IA/upload changes; keep edits scoped to AI + inbound pipelines. |
| Phase 159 | Active | `components/dashboard/settings-view.tsx`, `next.config.mjs` (Knowledge Assets 413 hotfix) | Do not touch large-upload/413 mitigation codepaths in this phase. |
| Phase 158 | Active | Analytics + response timing + AI draft booking conversion stats (`actions/*`, `lib/response-timing/*`) | Phase 162 should not expand analytics scope; only touch those files if required for action-signal/auto-send correctness. |
| Phase 156 | Active | Settings IA refactor (`components/dashboard/settings-view.tsx`) | Do not modify Settings layout in this phase (except possibly documentation-only changes). |
| Phase 161 | Active | Inbox read API incident triage (`app/api/inbox/conversations/*`) | Independent; no coordination needed. |
| Uncommitted working tree | Active | Many modified `lib/*` AI files present | Phase 162 must consolidate and verify these changes before committing/pushing. |

## Objectives
* [ ] Fix slot confirmation logic so booked confirmations never inject arbitrary availability.
* [ ] Improve action-signal routing for “call me at number below/signature” so it reliably routes to Process 4 and triggers Slack notify.
* [ ] Ensure auto-send evaluation and auto-send execution respect “phone on file” and “call intent” policy (skip auto-send, notify only).
* [ ] Fix `auto_send_revise` structured output schema so revision loop stops throwing 400s.
* [ ] Add regression tests/fixtures for the above.
* [ ] Validate with AI behavior gates (NTTAN) and replay against Founders Club.

## Constraints
- **LLM-first**: prefer AI routing/extraction into structured JSON; deterministic actions should be powered by that structured output.
- Avoid FC-only hardcoding in shared libraries; if FC-specific behavior is required, gate it via `resolveWorkspacePolicyProfile()`.
- Safety: prevent outbound drafts from containing phone numbers even if phone is provided as internal prompt context.
- Keep changes isolated: do not regress Knowledge Assets, Settings IA, or Inbox Read API workstreams.

## Success Criteria
- Slot confirmations: no more `firstOfferedSlot`-style injection; `slot_mismatch`/`date_mismatch` caused by arbitrary slot selection is eliminated.
- Action signal: “direct contact number below” style replies produce a `call_requested` signal and Slack notify fires (deduped).
- Auto-send: when call intent is detected and the lead has a phone on file, auto-send returns `skip` (no outbound message sent).
- Revision agent: `auto_send_revise` no longer errors with invalid schema; revision loop works end-to-end.
- Validation gates pass (NTTAN):
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`

## Subphase Index
* a — Preflight: Repro Packet + Working Tree Reconciliation
* b — Fix Slot-Confirmation Selection + Tests
* c — Action-Signal: Process 4 Routing + Slack Notify Reliability
* d — Auto-Send Safety: Phone-On-File + Call-Intent Policy + Revision Schema Fix
* e — Drafting Guardrails: Phone Context + “Don’t Ask Which Number” + No-PII Output
* f — NTTAN Validation + FC Replay Evidence + Commit/Push Checklist
