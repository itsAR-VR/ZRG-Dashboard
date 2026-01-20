# Phase 45g — Verification (Lint/Build + Smoke Checks)

## Focus

Validate Phase 45 implementation end-to-end:

- Builds cleanly (lint + build)
- Draft generation no longer persists placeholder booking links or truncated URLs
- Bulk regeneration UI works for both modes (pending-only + all-eligible)

## Inputs

- Phase 45f output

## Work

### 1) Static verification

```bash
npm run lint
npm run build
```

### 2) Smoke checks (manual)

- Settings → AI Personality (admin):
  - bulk regeneration card renders
  - pending-only mode runs and reports progress
  - all-eligible mode requires confirmation and runs
- Draft generation:
  - If booking link is missing, drafts do not include `{insert booking link}` (or similar placeholders)
  - If OpenAI response hits `max_output_tokens`, we retry instead of saving partial output

## Output

- `npm run lint`: ✅ passed (warnings only; no new Phase 45 errors observed)
- `npm run build`: ✅ passed
- Manual smoke checks: not executed in this environment (requires running app + authenticated admin session)

## Handoff

Finalize Phase 45 by:
- checking off root Success Criteria in `docs/planning/phase-45/plan.md`
- adding a short Phase Summary (decisions + env vars)
- optionally creating `docs/planning/phase-45/review.md` with verification notes
