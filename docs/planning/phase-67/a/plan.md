# Phase 67a — Inventory + Consolidation Plan

## Focus
Create a definitive inventory of all unpushed changes, map them to their originating phases (62–66), and define a clean commit/branch strategy for a direct-to-prod release.

## Inputs
- `git status -sb` and `git diff --name-only`
- Phase plans: `docs/planning/phase-62/plan.md`, `phase-63/plan.md`, `phase-64/plan.md`, `phase-65/plan.md`, `phase-66/plan.md`
- Current working tree changes in:
  - `prisma/schema.prisma`
  - `lib/availability-cache.ts`, `lib/booking.ts`, `lib/followup-engine.ts`, `lib/ai-drafts.ts`, `lib/slot-offer-ledger.ts`
  - `app/api/cron/availability/route.ts`
  - `actions/booking-actions.ts`
  - Untracked: `lib/booking-target-selector.ts`, `docs/planning/phase-64/*`, `docs/planning/phase-62/j/*`

## Work
1. Capture an inventory table of changed files → phase mapping (62–66) and expected purpose.
2. Identify overlap hotspots:
   - `lib/ai-drafts.ts` (Phase 62/64/63)
   - `lib/followup-engine.ts` (Phase 62/66)
   - `prisma/schema.prisma` (Phase 62/61/66)
3. Create a release branch name and commit grouping plan (e.g., schema+availability, error-hardening, AI-auto readiness, docs).
4. Ensure `.gitignore` additions are intentional (e.g., `logs_result copy.json`).
5. Produce a “commit plan” list with ordered commits and descriptions.

## Output

**Completed:** Created `docs/planning/phase-67/a/inventory.md` with:

### Key Findings

1. **Minimal Uncommitted Changes:** Only 2 tracked files modified (`lib/availability-cache.ts`, `lib/booking-target-selector.ts`) plus the phase-67 docs directory
2. **No Overlaps:** These changes are post-Phase 62j work extending Calendly URI support — no conflicts with any other phase
3. **Single Commit Strategy:** All changes can be committed as a single "Phase 62k" commit

### File → Phase → Intent Mapping

| File | Phase | Intent |
|------|-------|--------|
| `lib/availability-cache.ts` | 62k (extends 62j) | Calendly URI field support, UUID extraction from URI |
| `lib/booking-target-selector.ts` | 62k (extends 62j) | Extract deterministic booking target logic, enforce missing-answers invariant |

### Validation Results

- **Lint:** ✅ 0 errors (18 warnings — pre-existing)
- **Build:** ✅ Passes successfully

### Commit Plan

| Order | Commit Title | Files |
|-------|--------------|-------|
| 1 | Phase 62k: Calendly URI support + booking target invariant | `lib/availability-cache.ts`, `lib/booking-target-selector.ts` |

## Handoff

**→ Phase 67b:** The inventory confirms the working tree is clean and ready. Subphase b should now focus on running `npm run logs:check` to identify the "six known error signatures" mentioned in the phase purpose. The uncommitted changes are unrelated to error hardening — they're additive Calendly improvements that can be committed at any point during this phase.
