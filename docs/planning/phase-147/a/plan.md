# Phase 147a - Incident Baseline and Deterministic Runtime Contract

## Focus
Convert the investigation evidence into a precise execution contract so implementation can be done without ambiguity.

## Inputs
- `docs/planning/phase-147/plan.md`
- Follow-up runtime behavior in `lib/followup-engine.ts`
- LinkedIn integration behavior in `lib/unipile-api.ts`
- Production incident evidence for Tim Blais workspace (`clientId: 779e97c3-e7bd-4c1a-9c46-fe54310ae71f`)

## Work
1. Capture the exact blocked-path taxonomy from current behavior:
   - LinkedIn: invalid profile target (company/unknown URL), unresolvable member, disconnected account, unreachable recipient, transient provider failure.
   - SMS: missing phone, invalid phone, **invalid country calling code** (`errorCode: "invalid_country_code"` from GHL — `lib/ghl-api.ts:98-99`), phone present but GHL send rejects, transient provider failure.
2. Define deterministic action matrix per blocked path:
   - `sent`
   - `skipped + advance`
   - `skipped + no-advance` (enrichment pending, DND retry window)
   - `error + no-advance` (transient provider failure)
   - Note: `invalid_country_code` is deterministic/unrecoverable => `skipped + advance` (same as missing phone).
3. Lock reason-string contract for follow-up audit tasks — **adopt existing plain-text convention** (matches `lib/followup-engine.ts` lines 1238, 1967, 2751):
   - `"LinkedIn skipped — URL is not a person profile (company/non-person URL)."`
   - `"LinkedIn skipped — unresolvable member target."`
   - `"SMS skipped — invalid country calling code"`
   - Existing: `"SMS skipped — {GHL error message}"` (lines 1954-1977, already works for missing phone)
4. Confirm no-backfill scope and no guardrail-subsystem additions.
5. Document existing skip-and-advance sites to avoid duplication (RED TEAM F3):
   - SMS missing phone: already handled at `lib/followup-engine.ts:1954-1977` — extend, do not reimplement.
   - LinkedIn missing URL: already handled at `lib/followup-engine.ts:1206-1240`.

## Output
A decision-complete runtime contract for LinkedIn and SMS blocked paths, with exact action/advance behavior and reason-string standards.

## Handoff
Phase 147b implements the LinkedIn branch exactly per this contract, including skip-and-advance behavior for non-person URLs and unresolvable member targets.
