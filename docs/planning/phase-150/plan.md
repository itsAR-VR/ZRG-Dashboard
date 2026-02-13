# Phase 150 — Tim Blais Channel Reliability Closure (LinkedIn Source Precedence + SMS Sendability)

## Purpose
Close the remaining "LinkedIn not running" and "SMS not running" failures for Tim Blais by hardening source selection (profile vs company URLs), send-time phone normalization, and execution observability so blocked steps do not silently stall.

## Context
From this conversation, the unresolved risk is no longer basic channel wiring; it is data quality + precedence:
- LinkedIn values may be sourced from the wrong custom variable when both profile and company URLs exist (especially EmailBison + GHL custom variables).
- Some paths still ingest/merge LinkedIn values with permissive logic, which can leave actionable profile data unused.
- SMS failures still occur in unrecoverable phone states; we need deterministic handling that advances sequences and leaves an audit trail.

Locked decisions from the user for this phase:
- Tim Blais is the canary workspace before broad rollout.
- Keep LinkedIn merge policy fill-only (do not overwrite existing profile/company values once populated).
- SMS phone normalization is AI-only and runs before every SMS send.
- SMS phone-normalization model: `gpt-5-nano`, with 2 retries.
- If SMS phone cannot be normalized to a valid sendable number, skip-and-advance (do not block sequence).
- Add an SMS UI notice in the lead SMS panel; keep it visible until next successful SMS send.
- Persist SMS failure audit details (reason + attempt count).
- No feature flag; this behavior is the default path after validation.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 148 | Active (uncommitted) | `app/api/webhooks/*`, `lib/linkedin-utils.ts`, `lib/lead-matching.ts`, `lib/system-sender.ts`, `lib/followup-engine.ts`, `prisma/schema.prisma` | Phase 150 builds directly on 148 semantics; re-read current file state before edits and avoid reverting any in-flight 148 changes. |
| Phase 149 | Active (untracked) | Dashboard client surfaces (`components/dashboard/*`) | UI banner work in 150c must avoid regressing 149 render-loop protections. |
| Phase 146 | Active | Replay tooling (`lib/ai-replay/*`, `scripts/live-ai-replay.ts`) | Use replay tooling as-is; do not modify replay internals in this phase. |

## Objectives
* [ ] Build a concrete Tim-focused diagnostics packet for LinkedIn/SMS failures using real custom-variable payloads.
* [ ] Enforce LinkedIn source precedence so profile URLs are always selected when present, while preserving company URLs in their dedicated field.
* [ ] Add send-time SMS normalization + failure handling that always resolves to send or skip-and-advance with audit context.
* [ ] Add operational visibility so blocked LinkedIn/SMS steps are immediately diagnosable.
* [ ] Validate with required test/replay gates, then execute Tim canary and global rollout.

## Constraints
- Do not revert unrelated dirty worktree changes from concurrent phases.
- Keep `Lead.linkedinUrl` profile-only and `Lead.linkedinCompanyUrl` company-only.
- Preserve fill-only merge semantics for both profile and company URL fields.
- SMS send path must not loop indefinitely on invalid/unusable phones.
- Maintain existing follow-up sequencing semantics (advance on permanent skip conditions).
- Avoid secret exposure in logs/docs/artifacts.

## Success Criteria
- For Tim workspace payloads where both profile and company LinkedIn values exist, `linkedinUrl` stores profile and `linkedinCompanyUrl` stores company consistently across ingestion paths.
- No currently-due LinkedIn follow-up step remains stuck solely due to company URL precedence mistakes.
- SMS follow-up steps either send successfully or skip-and-advance with persisted reason/attempt metadata (no permanent retry loops on invalid phone states).
- Lead SMS panel shows the failure notice until next successful SMS send, then clears automatically.
- Tim canary shows stable progression for LinkedIn + SMS follow-up execution before global rollout.
- Required quality gates pass:
  - `npm run lint`
  - `npm run build`
  - `npm test`
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --limit 20 --concurrency 3`

## Subphase Index
* a — Tim Diagnostics + Custom Variable Source Audit (EmailBison + GHL)
* b — LinkedIn Ingestion Precedence Hardening (Profile Wins, Company Preserved)
* c — SMS Sendability Hardening (AI Normalization + Skip/Advance + UI Notice)
* d — Operational Guardrails (Telemetry, Health Queries, Runbook)
* e — Validation, Canary, and Rollout Decision
