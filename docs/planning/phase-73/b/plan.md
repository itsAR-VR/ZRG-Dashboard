# Phase 73b — Save-Time Validation + Activation Gating

## Focus

Enforce safety at the source of truth:
- block saving/updating follow-up steps that contain **unknown** variables
- allow saving templates with known variables (with warnings), but **block activation** if required workspace setup is missing

## Inputs

- Phase 73a: `lib/followup-template.ts` token registry + extraction helpers
- Server actions:
  - `actions/followup-sequence-actions.ts` (`createFollowUpSequence`, `updateFollowUpSequence`, `toggleSequenceActive`)
  - `actions/settings-actions.ts` (`getUserSettings` / WorkspaceSettings fields)
- Workspace configuration stored in DB:
  - `WorkspaceSettings.aiPersonaName`, `companyName`, `targetResult`, `qualificationQuestions`
  - booking link source: default `calendarLink` + booking provider settings

## Work

### Step 1 — Block unknown variables on create/update

**File:** `actions/followup-sequence-actions.ts`

In `createFollowUpSequence` and `updateFollowUpSequence`:
- For each step:
  - validate `messageTemplate` and `subject` (when present) using `getUnknownFollowUpTemplateTokens(...)`
- If any unknown tokens exist:
  - return `{ success: false, error: "Unknown template variables: ..." }`
  - include the step index / stepOrder in the error so it’s obvious what to fix

### Step 2 — Gate sequence activation on missing workspace setup

**File:** `actions/followup-sequence-actions.ts`

Update `toggleSequenceActive`:
- If toggling **ON** (activating), validate the sequence’s steps against workspace settings:
  - Determine which workspace-level tokens are referenced anywhere in the sequence (scan all step templates + subjects).
  - Fetch `WorkspaceSettings` and `calendarLink` default for the client.
  - If referenced but missing:
    - `{senderName}`/`{name}` → require `aiPersonaName`
    - `{companyName}`/`{company}` → require `companyName`
    - `{result}`/`{achieving result}` → require `targetResult`
    - `{qualificationQuestion1/2}` → require non-empty `qualificationQuestions` JSON
    - `{calendarLink}`/`{link}` → require a resolvable booking link (at minimum: default calendar link exists)
- If missing setup exists, do not activate; return `{ success: false, error: "Follow-up setup incomplete: ..." }`

Note: lead-specific variables (firstName/email/phone/etc) cannot be validated at activation time; those are enforced at send-time (Phase 73d) and at manual start time (Phase 73c).

### Step 3 — Tests

Extend `lib/__tests__/followup-template.test.ts` or add a focused new test file for validation helpers if needed, but keep it DB-free.

## Output

- `actions/followup-sequence-actions.ts` now blocks create/update when unknown tokens are present (per-step error listing).
- Activation now validates workspace setup when toggling ON and blocks with `Follow-up setup incomplete: ...` when required settings/calendar link are missing.

## Handoff

Phase 73c surfaces the new errors/warnings in UI and exposes variable visibility for admins.
