# Phase 84 — Spintax for Follow-Up Sequences

## Purpose
Add Spintax support to follow-up sequence step templates (email subject + message body) so sequences can vary copy per lead while staying compatible with the existing `{firstName}` / `{link}` variable system and strict “never send placeholders” rules.

## Context
- Follow-up sequences are authored in `components/dashboard/followup-sequence-manager.tsx` and persisted via `actions/followup-sequence-actions.ts`.
- Follow-up execution and message generation happens in `lib/followup-engine.ts`, which currently renders templates using `renderFollowUpTemplateStrict()` from `lib/followup-template.ts`.
- Template variables use `{...}` and `{{...}}` formats; classic Spintax `{a|b}` conflicts with this syntax. The agreed Spintax syntax is `[[a|b]]`.
- Safety posture: Phase 73 established strict template rendering that blocks automation when:
  - Unknown variables are present
  - Required referenced values are missing
- Spintax must preserve this posture: if the template cannot be safely expanded/rendered, automation should pause and the UI should surface a clear error.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 83 | Uncommitted (working tree) | `prisma/schema.prisma`, analytics UI/actions | Independent domain; ensure clean working tree or coordinate before merging |
| Phase 82 | Uncommitted (planning/artifacts) | `docs/planning/**` | Avoid touching Phase 82 artifacts; safe to add new Phase 84 docs |
| Phase 80 | Complete (per phase docs) | `lib/followup-engine.ts` | Re-read current `generateFollowUpMessage()` implementation before editing; merge carefully |
| Phase 77 | Complete (per phase docs) | `lib/followup-engine.ts` (AI parsing budgets) | Independent sections; avoid rebasing/merging during in-flight changes |
| Phase 75 | Complete (per phase docs) | `lib/followup-engine.ts` (availability formatting) | Independent sections; avoid overlapping edits where possible |

## Objectives
* [x] Implement a minimal, dependency-free Spintax parser/expander for `[[a|b|c]]`
* [x] Choose variants “distributed across leads” (stable per `leadId + stepKey`)
* [x] Integrate Spintax into strict follow-up template rendering (subject + body)
* [x] Add save-time validation for malformed Spintax and surface errors in the sequence editor UI
* [x] Add unit tests covering deterministic expansion, variable substitution within options, and malformed input blocking

## Constraints
- **Syntax:** `[[option1|option2]]` only (v1).
- **Scope:** Follow-up sequences only (step `subject` + `messageTemplate`).
- **Selection:** “Distribute across leads” (stable per lead+step; no persisted round-robin state).
- **No schema changes:** Do not add DB fields or migrations for Spintax.
- **Safety:** Never send raw `[[...]]` or unresolved `{...}` variables; malformed Spintax must block automation with a clear error.
- **Nesting:** Not supported in v1 (explicitly document behavior and error message if nested patterns are detected).

## Success Criteria
- [x] Users can author templates with `[[...|...]]` in the follow-up sequence editor.
- [x] Follow-up execution expands Spintax and then renders template variables; outbound content contains no raw `[[` blocks.
- [x] Malformed Spintax causes:
  - Save-time validation error in the UI (when possible), and
  - Runtime pause/block with a clear error reason if it somehow reaches execution.
- [x] Unit tests pass (`npm run test`) and no TypeScript errors are introduced (`npm run build`).

## Subphase Index
* a — Spintax utility + stable selection hashing
* b — Integrate Spintax into strict template rendering
* c — Wire into follow-up engine + editor validation UX
* d — Tests + verification

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/followup-template.ts`: Strict renderer with `{...}` token validation, signature: `renderFollowUpTemplateStrict({ template, values })`, no Spintax support
  - `lib/__tests__/followup-template.test.ts`: Existing test suite (129 lines) — Spintax tests will be **appended** here
  - `actions/followup-sequence-actions.ts:105`: `getUnknownTokenErrors()` validates unknown tokens at save time; does NOT validate Spintax
  - `lib/followup-engine.ts:429-595`: `generateFollowUpMessage()` calls renderer twice (message + subject)
- What the plan assumes:
  - `step.id` is always present at execution time — **verified** for database-loaded steps; use fallback for preview/unsaved
- Verified touch points:
  - `renderFollowUpTemplateStrict` at `lib/followup-template.ts:132`
  - `generateFollowUpMessage` at `lib/followup-engine.ts:429`
  - `formatTemplateErrors` at `lib/followup-engine.ts:389` — must handle new `spintax_error` type
  - Token regex `/\{\{[^}]+\}\}|\{[^}]+\}/g` does NOT match `[[...]]` — safe

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **stepKey undefined for unsaved steps** → use fallback `step.id || \`order-${step.stepOrder}\`` (fixed in 84c)
- **formatTemplateErrors() not updated** → add handling for `spintax_error` type (fixed in 84b)

### Missing or ambiguous requirements
- **Escape sequences** → clarify escapes only apply inside `[[...]]` blocks
- **Whitespace-only options** → treat as empty and reject

### Repo mismatches (fix the plan)
- Test file `lib/__tests__/followup-template.test.ts` **already exists** — 84d should append tests, not create file

### Performance / timeouts
- Spintax parsing is O(n) string scan; negligible for small templates (~1KB)

### Testing / validation
- Must verify same lead+step → same variant (determinism)
- Must verify different leads → different variants (distribution)

## Assumptions (Agent)

- `step.id` is populated at execution time (~95% confidence)
  - Mitigation: Use fallback `step.id || 'order-${step.stepOrder}'`
- Token regex will not match `[[...]]` (~99% confidence)
  - Verified: Regex only matches `{...}` patterns
- Phase 83 changes are independent (~95% confidence)
  - Verified: Git status shows no overlap with Phase 84 target files

## Phase Summary

### Status: Complete ✅ (Reviewed 2026-02-02)

### Shipped
- `lib/spintax.ts` — NEW: Spintax parser/expander with FNV-1a hashing for deterministic variant selection
- `lib/followup-template.ts` — Extended to expand Spintax and return `spintax_error` on invalid input
- `lib/followup-engine.ts` — Passes `spintaxSeed = ${lead.id}:${stepKey}` for message + subject rendering
- `actions/followup-sequence-actions.ts` — Blocks malformed Spintax on create/update/toggle
- `components/dashboard/followup-sequence-manager.tsx` — Shows Spintax help text and inline errors
- `lib/__tests__/followup-template.test.ts` — Added 4 Spintax-specific tests (determinism, distribution, variables in options, malformed blocking)

### Verification (2026-02-02)
- `npm run test` ✅ (82 tests, 0 failures)
- `npm run lint` ✅ (0 errors, 18 warnings — all pre-existing)
- `npm run build` ✅ (baseline-browser-mapping + middleware deprecation warnings)

### Notes
- No schema changes required (constraint satisfied)
- Backward compatible: templates without `[[` are unaffected
- Coordinate merge with existing Phase 82/83 uncommitted changes in working tree

### Follow-ups
- Manual QA: Create sequence with Spintax, trigger follow-up, verify deterministic variant selection
- Monitor: Watch for `spintax_error` pause reasons in production
