# Phase 73d — Send-Time Blocking (No Placeholders) + Instance Visibility

## Focus

Guarantee automated follow-ups never send with unresolved variables by enforcing send-time validation and surfacing clear “blocked” reasons in the UI.

## Inputs

- Phase 73a: strict template helpers from `lib/followup-template.ts`
- Follow-up execution path:
  - `lib/followup-engine.ts` (`executeFollowUpStep`, `generateFollowUpMessage`)
- UI visibility for paused instances:
  - `components/dashboard/follow-ups-view.tsx` (currently only special-cases `pausedReason === "lead_replied"`)

## Work

### Step 1 — Update message generation to return missing-variable errors

**File:** `lib/followup-engine.ts`

Refactor so message generation can return a “blocked” result:
- Use `applyFollowUpTemplateVariablesStrict(...)` for:
  - `step.messageTemplate`
  - `step.subject`
- If `missing.length > 0` for either:
  - do **not** send
  - return an execution result that includes a clear reason list (e.g., `Missing template variables: {companyName}, {calendarLink}`)

Hard constraint: do not introduce placeholders or defaults anywhere in follow-up sends.
- No `"[calendar link]"`, no `"[qualification question 1]"`, no `"there"`, no `"achieving your goals"`, no generic availability text.

### Step 2 — Pause instances when blocked (don’t silently skip)

When blocked due to missing variables/config:
- set follow-up instance `status="paused"`
- set `pausedReason` to a reason code that the UI can categorize (Master Inbox + Follow-ups view):
  - `missing_workspace_setup: <items>` (e.g., `missing_workspace_setup: companyName, aiPersonaName, targetResult`)
  - `missing_lead_data: <items>` (e.g., `missing_lead_data: firstName, leadCompanyName`)
  - `missing_booking_link: <items>` (e.g., `missing_booking_link: default_calendar_link`)
  - `missing_availability: <items>` (e.g., `missing_availability: no_slots`)
- Do **not** advance steps when blocked; the instance stays paused until the missing items are fixed (user decision).

### Step 3 — UI: show blocked reason for paused instances

**Files:** `components/dashboard/follow-ups-view.tsx`, `components/dashboard/conversation-card.tsx`

Update the paused instance card:
- If `instance.status === "paused"` and `instance.pausedReason` is set:
  - show a warning line with the reason (not just for `"lead_replied"`)
  - keep the “Resume” action available, but users should understand it will remain blocked until setup is fixed

Update Master Inbox conversation cards:
- show a badge when a lead has a follow-up paused for a “missing_*” reason:
  - `Follow-ups blocked — missing lead data`
  - or `Follow-ups blocked — missing setup`

## Output

- `lib/followup-engine.ts` now pauses instances with `missing_*` reason codes derived from strict template errors (no placeholders).
- `components/dashboard/follow-ups-view.tsx` now renders friendly copy for `missing_lead_data`, `missing_workspace_setup`, `missing_booking_link`, and `missing_availability`.

## Handoff

Phase 73e wires new tests into the orchestrator and runs full verification (`lint`, `build`, `test`) plus manual QA.
