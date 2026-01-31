# Phase 73 — Follow-Up Variable Testing & Verification

## Purpose

Guarantee follow-ups never send with missing/unknown variables or placeholders by:
- blocking templates that contain unknown variables
- blocking sends whenever a referenced variable cannot be resolved
- surfacing vivid, actionable UI warnings/toasts that tell admins what must be configured

## Context

### User Request

> Follow-ups - this we 100% need to be tested and proven that all variables will always work before we launch
>
> There should be no default fallbacks. There should be vivid and clear warnings that showcase an inability for things to send if those variables and items are not set up.
>
> We should block follow-up templates that contain unknown variables… No, we should never ever send a placeholder.

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/followup-engine.ts`:
    - `generateFollowUpMessage()` starts around line 352 and contains the current template substitution block.
    - Empty-string fallbacks for `{senderName}`/`{companyName}` are around lines 486–489.
    - `settings` is fetched from Prisma (`const settings = client?.settings || null;` around line 540).
  - Template deps used by follow-ups:
    - Booking link for `{calendarLink}` comes from `lib/meeting-booking-provider.ts` (`getBookingLink()` hits Prisma `calendarLink`).
    - Availability uses:
      - `lib/availability-cache.ts` (`getWorkspaceAvailabilitySlotsUtc`)
      - `lib/availability-format.ts` (`formatAvailabilitySlots`)
      - `lib/availability-distribution.ts` (`selectDistributedAvailabilitySlots`)
      - `lib/slot-offer-ledger.ts` (`getWorkspaceSlotOfferCountsForRange`)
      - `lib/timezone-inference.ts` (`ensureLeadTimezone`)
      - `lib/qualification-answer-extraction.ts` (`getLeadQualificationAnswerState`)
  - Lead data sources (for lead-level variables):
    - Lead profile fields are stored on the `Lead` model (e.g., `firstName`, `lastName`, `email`, `phone`, `companyName`, `linkedinUrl`).
    - Several of these are populated from EmailBison (e.g., `companyName` via custom variables) and other enrichment pipelines.
  - Test runner:
    - `npm test` runs `scripts/test-orchestrator.ts`, which uses a fixed `TEST_FILES` list (new tests must be added there to run in CI).
- What the plan must NOT assume:
  - Unit tests can import `lib/followup-engine.ts` with no env. In this repo, `lib/prisma.ts` requires `DATABASE_URL` at import-time, and `DATABASE_URL` is typically unset during `npm test`.
- Verified touch points:
  - Node test patterns in:
    - `lib/__tests__/email-participants.test.ts` (simple `test(...)`)
    - `lib/__tests__/emailbison-stop-future-emails.test.ts` (`describe/it` + `mock.method(...)`)

### Variable System Architecture

The follow-up engine substitutes template variables in follow-up content + subject.

Supported variables + aliases (current behavior in `lib/followup-engine.ts`):

| Variable | Source | Required / behavior when missing |
|----------|--------|-------------------------------|
| `{firstName}`, `{FIRST_NAME}`, `{FIRST\_NAME}`, `{{contact.first_name}}`, `{{contact.first\_name}}` | `Lead.firstName` | If used and missing → **block send** + show “Lead info missing first name” |
| `{lastName}` | `Lead.lastName` | If used and missing → **block send** + show “Lead info missing last name” |
| `{email}` | `Lead.email` | If used and missing → **block send** (also already required by email sends) |
| `{phone}` | `Lead.phone` | If used and missing → **block send** (also already required by SMS sends) |
| `{senderName}`, `{name}` | `WorkspaceSettings.aiPersonaName` | If used and missing → **block send** + show “Set AI Persona name” |
| `{companyName}`, `{company}` | `WorkspaceSettings.companyName` | If used and missing → **block send** + show “Set company name” |
| `{leadCompanyName}` | `Lead.companyName` (often populated from EmailBison custom variables / enrichment) | If used and missing → **block send** + show “Lead is missing company name (enrich/fill lead info)” |
| `{result}`, `{achieving result}` | `WorkspaceSettings.targetResult` | If used and missing → **block send** + show “Set target result/outcome” |
| `{calendarLink}`, `{link}` | booking link resolver (`calendarLink` + provider settings) | If used and missing → **block send** + show “Set default calendar link / booking provider” |
| `{availability}` | availability resolver | If used and cannot produce real slots → **block send** + show “Availability not configured/available” |
| `{time 1 day 1}`, `{x day x time}` | availability slots | If used and missing → **block send** |
| `{time 2 day 2}`, `{y day y time}` | availability slots | If used and missing → **block send** |
| `{qualificationQuestion1}`, `{qualification question 1}` | `WorkspaceSettings.qualificationQuestions` | If used and missing → **block send** + show “Set qualification questions” |
| `{qualificationQuestion2}`, `{qualification question 2}` | `WorkspaceSettings.qualificationQuestions` | If used and missing → **block send** + show “Set qualification questions” |

Note: `{companyName}` refers to the **workspace/company context** (your company). `{leadCompanyName}` refers to the **lead’s company** stored on the `Lead` record.

### Critical Finding: Defaults / Placeholders Must Never Send

**Issue:** Current implementation includes multiple default/placeholder fallbacks (e.g., `"there"`, `"achieving your goals"`, `"[calendar link]"`, `"[qualification question 1]"`, and generic availability text). These violate the requirement: **no defaults, no placeholders, never send when missing**.

```
Template: "Hi {firstName}, this is {senderName} from {companyName}. Book here: {calendarLink}"
Result (today): "Hi there, this is  from . Book here: [calendar link]"  ← MUST NEVER SEND
```

**Fix required:**
- Remove all default/placeholder substitutions.
- Add strict validation:
  - **Save-time:** block unknown variables in templates.
  - **Send-time:** if a referenced variable can’t be resolved, do not send; pause/block with an explicit reason.
- Surface UI warnings/toasts that make it obvious what must be configured for follow-ups to work.

### Key Findings

1. Variables are substituted via string replacement today (no enforcement).
2. The UI already exposes some follow-up setup warnings in Settings (but wording implies fallbacks are acceptable).
3. The “always works” guarantee requires **blocking behavior**, not just tests.

### Testing Approach

- Extract template parsing/validation into a Prisma-free module (so tests run with `DATABASE_URL` unset).
- Use Node.js native test module (`node:test`) + `node:assert/strict` (matches existing repo tests).
- Ensure `npm test` actually runs the new tests by updating `scripts/test-orchestrator.ts`.

## Concurrent Phases (Multi-Agent)

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 71 | Active | `lib/followup-engine.ts` | Rebase/merge carefully before touching follow-up engine |
| Phase 72 | Active | `lib/followup-engine.ts`, `actions/lead-actions.ts` | Avoid conflicting follow-up engine edits; keep Phase 73 changes narrowly scoped |
| Phase 70 | Active | `actions/lead-actions.ts` | No direct overlap unless Phase 73 adds template validation to actions |

## Pre-Flight Conflict Check (Multi-Agent)

- [ ] Run `git status --porcelain` and confirm the current state of files Phase 73 will touch:
  - `lib/followup-engine.ts`
  - `actions/followup-sequence-actions.ts`
  - `actions/lead-actions.ts` (Master Inbox payload)
  - `components/dashboard/followup-sequence-manager.tsx`
  - `components/dashboard/conversation-card.tsx`
  - `components/dashboard/settings-view.tsx`
- [ ] Re-scan last 10 phases for overlaps before implementation (`ls -dt docs/planning/phase-* | head -10`)
- [ ] If Phase 71/72 touched `lib/followup-engine.ts`, re-run the Repo Reality Check section above

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

- New tests never run in CI because `scripts/test-orchestrator.ts` uses a fixed `TEST_FILES` list → add the new test file(s) there.
- Tests import `lib/followup-engine.ts` and crash because Prisma requires `DATABASE_URL` at import-time → extract template replacement to a Prisma-free module and test that instead.

### Repo mismatches (fix the plan)

- `lib/availability-data.ts` / `lib/availability-offer-counts.ts` / `lib/lead-timezone.ts` do not exist → correct to `lib/availability-cache.ts` / `lib/slot-offer-ledger.ts` / `lib/timezone-inference.ts`.
- Qualification module is `lib/qualification-answer-extraction.ts` (not `lib/qualification-tracking`).
- `npm test -- <file>` does not run a single test file (orchestrator ignores argv) → use `node --test ...` for single-file runs, or update orchestrator.

### Spec clarity

- Save-time unknown-variable validation and send-time missing-variable blocking are **required** (not optional).

## Objectives

* [x] Build a canonical follow-up template registry (supported tokens + sources) and block unknown variables at save-time
* [x] Remove all default/placeholder fallbacks for follow-up variables (never send placeholders)
* [x] Block follow-up sends when a referenced variable cannot be resolved (with explicit, actionable reasons)
* [x] Add `{leadCompanyName}` token (lead-level company field) with strict “missing blocks send” behavior
* [x] Expose vivid UI warnings + toasts (sequence editor + settings + lead view + Master Inbox) showing what must be set for follow-ups to work
* [x] Ensure tests run under `npm test` and cover all supported tokens + failure modes — **67/67 pass**

## Constraints

- Tests must run with `DATABASE_URL` unset (no DB dependency).
- Use Node.js native test module (`node:test`) + `node:assert/strict`.
- Keep production code changes localized (template helper extraction + validation + blocking behavior).
- No flaky/time-dependent assertions (use deterministic strings/dates in tests).

## Success Criteria

### Template safety
- [x] Templates containing unknown variables are rejected with a clear error listing the unknown tokens.
- [x] No follow-up send can produce placeholder output (e.g., `"[calendar link]"`, `"[qualification question 1]"`) or default fallbacks.

### Runtime safety + visibility
- [x] When a template references a variable that cannot be resolved, the system blocks the send and surfaces:
  - a clear pause/error reason on the instance
  - a clear message in the UI + toast guidance on what to configure
  - a clear “Follow-ups blocked” label in Master Inbox for affected leads

### Quality gates
- [x] Unit tests cover every supported variable + alias and the "missing variable blocks send" behavior.
- [x] `npm test` runs the new test file(s) and passes in a clean env (no `DATABASE_URL` required). — **67/67 pass**
- [x] `npm run lint && npm run build` pass. — **verified 2026-01-31**

## Phase Summary

- Added strict follow-up template registry + rendering with `{leadCompanyName}` support and no placeholders.
- Blocked unknown tokens at save-time and blocked activation/sending with clear `missing_*` pause reasons.
- Surfaced variable visibility + blocked-state warnings in sequence editor, settings, CRM drawer, Follow-ups view, and Master Inbox.
- Added `docs/planning/phase-73/qa-checklist.md`

### Verification Results (2026-01-31)
- `npm test` — **67/67 pass**
- `npm run lint` — **0 errors** (18 pre-existing warnings)
- `npm run build` — **pass**

## Subphase Index

* a — Canonical variable registry + strict template parsing/tests
* b — Save-time validation (unknown tokens + missing workspace config on activation)
* c — UI: variable picker + vivid warnings/toasts (sequence editor + settings + lead view)
* d — Send-time blocking + instance pause reasons (no placeholders)
* e — Test harness wiring + full verification + manual QA

## Key Files

| File | Purpose |
|------|---------|
| `lib/followup-engine.ts` | Calls template substitution + sends follow-ups |
| `lib/followup-template.ts` | **NEW:** Prisma-free template substitution helpers |
| `scripts/test-orchestrator.ts` | Controls what `npm test` runs |
| `lib/__tests__/followup-template.test.ts` | Comprehensive variable substitution test suite |
| `actions/followup-sequence-actions.ts` | Save-time template validation + activation gating |
| `components/dashboard/followup-sequence-manager.tsx` | Variable picker + template warnings/toasts |
| `components/dashboard/settings-view.tsx` | Follow-up setup warnings (must reflect “blocked”, not “fallbacks”) |
| `components/dashboard/crm-drawer.tsx` | Lead variable visibility + start-sequence blocking warnings |
| `components/dashboard/follow-ups-view.tsx` | Surface paused/block reasons for automated follow-ups |
| `actions/lead-actions.ts` | Master Inbox data payload (surface follow-up blocked state) |
| `components/dashboard/conversation-card.tsx` | Master Inbox label/badge for blocked follow-ups |
| `components/dashboard/inbox-view.tsx` | Map new follow-up blocked fields into UI conversation model |

## Open Questions (Need Human Input)

None — decisions locked by user:
- Add `{leadCompanyName}`.
- Allow save with warnings; block activation and sending with clear warnings.
- Pause instances on missing lead variables and surface clearly in Master Inbox.

## Assumptions (Agent)

- Existing Node test patterns in `lib/__tests__` are the preferred conventions to follow. (confidence ~95%)
- It’s acceptable to refactor template substitution into a new Prisma-free module as long as behavior is preserved and missing variables now block sends instead of falling back. (confidence ~90%)
