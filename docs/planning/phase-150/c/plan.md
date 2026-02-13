# Phase 150c — SMS Sendability Hardening (AI Normalization + Skip/Advance + UI Notice)

## Focus
Guarantee SMS steps do not stall by normalizing phone inputs at send time and converting unrecoverable phone states into auditable skip-and-advance outcomes.

## Inputs
- `docs/planning/phase-150/a/plan.md` failure taxonomy
- `docs/planning/phase-150/b/plan.md` stabilized LinkedIn ingestion behavior
- Current runtime send paths in:
  - `lib/system-sender.ts`
  - `lib/followup-engine.ts`
  - relevant dashboard lead SMS UI surface

## Work
1. Implement AI-only phone normalization before every SMS send:
   - model: `gpt-5-nano`
   - max retries: 2
   - output contract: valid sendable normalized phone or explicit failure reason
2. Wire follow-up execution behavior:
   - on valid normalized phone: proceed with send path
   - on non-recoverable invalid phone: skip-and-advance with persisted audit context
3. Persist audit data needed for diagnostics:
   - failure reason
   - attempt count
   - last normalization status
4. Add/adjust UI notice in lead SMS panel:
   - actionable, neutral tone
   - visible until next successful SMS send
5. Add tests for:
   - successful normalization/send
   - retry success
   - terminal failure skip-and-advance
   - banner lifecycle (set on failure, clear on success)

## Output
- SMS runtime behavior that is deterministic under invalid phone conditions and transparent to operators in both database records and UI.

## Handoff
Provide new telemetry fields and error reason taxonomy to 150d for monitoring/alerting and to 150e for canary acceptance checks.
