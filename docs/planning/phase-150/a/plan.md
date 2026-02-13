# Phase 150a — Tim Diagnostics + Custom Variable Source Audit (EmailBison + GHL)

## Focus
Establish a precise, evidence-backed failure map for Tim Blais by identifying where LinkedIn and SMS prerequisites are sourced, transformed, and dropped across EmailBison and GHL paths.

## Inputs
- `docs/planning/phase-150/plan.md`
- Existing Phase 148 LinkedIn field-split behavior and in-flight edits
- Tim workspace identifiers:
  - `clientId = 779e97c3-e7bd-4c1a-9c46-fe54310ae71f`
  - `emailBisonWorkspaceId = 42`
  - `ghlLocationId = LzhHJDGBhIyHwHRLyJtZ`

## Work
1. Pull a Tim-scoped diagnostics dataset (lead rows, due follow-up steps, recent send errors, enrichment state).
2. Inspect raw/custom variable payloads used by:
   - EmailBison ingestion and post-process enrichment
   - GHL SMS webhook `customData` and related trigger payloads
3. Build a key-frequency and precedence matrix for:
   - LinkedIn profile-like keys
   - LinkedIn company-like keys
   - Phone keys used by SMS send path
4. Identify concrete mismatch cases:
   - Company URL captured while profile URL existed in same payload
   - SMS attempts failing due phone formatting/source gaps
5. Produce a red-team list of weak spots mapped to exact files/functions.

## Output
- Diagnostics artifact documenting:
  - Source keys observed in Tim payloads
  - Current precedence behavior vs expected behavior
  - Concrete failing lead examples and root-cause tags
- Prioritized implementation checklist for 150b and 150c.

## Handoff
Use the diagnostics matrix as the single source of truth for extraction/precedence code changes in 150b and SMS normalization boundaries in 150c.
