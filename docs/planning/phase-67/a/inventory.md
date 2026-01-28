# Phase 67a — Inventory of Unpushed Changes

## Current State

**Branch:** `main` (up to date with `origin/main`)
**Uncommitted Changes:** 2 tracked files + 1 untracked directory

## Changed Files

| File | Lines Changed | Originating Phase | Purpose |
|------|---------------|-------------------|---------|
| `lib/availability-cache.ts` | +75 -27 | Phase 62j | Add `calendlyEventTypeUri` and `calendlyDirectBookEventTypeUri` support for Calendly URI-based availability resolution; extract UUID from URI for faster availability fetch; fallback chain improvements |
| `lib/booking-target-selector.ts` | +88 -35 | Phase 62j | Extract `determineDeterministicBookingTarget()` function; add Calendly URI fields support; improve warning surfacing for missing configurations; enforce invariant that missing required answers → `no_questions` |

## Untracked Files

| Path | Status | Notes |
|------|--------|-------|
| `docs/planning/phase-67/` | New | This phase's planning docs (will be committed with phase work) |

## Overlap Analysis

### No Overlap with Previous Phases

The uncommitted changes are **post-Phase 62j work** and do not overlap with any other uncommitted phase work:

- **Phase 62j** (commit `5411ffd`): The base for these changes; already committed
- **Phase 66** (commits `d110f1c`, `c7e3bdf`, `1efb2a4`): Follow-up trigger refactor — no file overlap
- **Phase 65** (commit `60ac871`): OpenAI timeout fix in `lib/ai/prompt-runner/runner.ts` — no file overlap
- **Phase 64** (commit `d1fafd4`): Dual booking links with qualification answer support — no file overlap (Phase 64 touched `lib/ai-drafts.ts`, `lib/meeting-booking-provider.ts`)
- **Phase 63** (commit `c88943a`): Error hardening in `lib/supabase/middleware.ts`, `actions/analytics-actions.ts`, `lib/ghl-api.ts`, `lib/ai-drafts.ts` — no file overlap

### Semantic Dependencies

The uncommitted changes **extend** Phase 62j's dual availability work by adding:
1. Support for Calendly's `eventTypeUri` fields (in addition to `eventTypeLink`)
2. A more robust deterministic booking target fallback with explicit invariant enforcement

These are additive improvements and don't conflict with any recent phase commits.

## Commit Grouping Plan

Since all uncommitted work is tightly related to Phase 62j's Calendly URI support, a single commit is appropriate:

### Commit 1 — Phase 62k: Calendly URI support + booking target invariant
**Files:**
- `lib/availability-cache.ts`
- `lib/booking-target-selector.ts`

**Description:**
- Add `calendlyEventTypeUri` and `calendlyDirectBookEventTypeUri` field support
- Extract Calendly event type UUID from URI for availability API calls
- Improve fallback chain for availability URL resolution
- Extract `determineDeterministicBookingTarget()` for clearer logic
- Enforce invariant: missing required answers → `no_questions` (even if unconfigured)
- Surface warnings when booking targets are misconfigured

## Pre-Commit Validation

Before committing:
1. `npm run lint` — verify no lint errors
2. `npm run build` — verify build passes
3. Verify schema is in sync (no `prisma/schema.prisma` changes pending)

## Risk Assessment

**Low Risk** — These changes are:
- Additive (new fields, new helper function)
- Backward compatible (existing field paths still work)
- Well-scoped (only Calendly URI support and booking target improvements)
- No Prisma schema changes required (fields already exist in schema per Phase 62j)
