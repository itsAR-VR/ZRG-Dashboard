# Phase 71c — Propagate Rename Safely (Dual-Name Support Across Runtime + UI)

## Focus

Make the Meeting Requested workflow **name-agnostic** so both the legacy name and the new name behave identically in automation, pausing logic, LinkedIn augmentation, and UI labeling.

## Inputs

- Phase 71a: Follow-ups UI pause/resume fix
- Phase 71b: Rename intent (but note 71b’s migration snippet is outdated; 71d is authoritative)
- Current name-based logic:
  - `lib/followup-automation.ts` (`MEETING_REQUESTED_SEQUENCE_NAME`, `autoStartMeetingRequestedSequenceOnSetterEmailReply`)
  - `lib/followup-engine.ts` (`MEETING_REQUESTED_SEQUENCE_NAME`, `pauseFollowUpsOnReply`)
  - `actions/followup-sequence-actions.ts` (`DEFAULT_SEQUENCE_NAMES`, `createMeetingRequestedSequence`, Airtable-mode helpers)
  - `lib/followup-sequence-linkedin.ts` (default sequence lookup by name)
  - `components/dashboard/followup-sequence-manager.tsx` (`BUILT_IN_TRIGGER_OVERRIDES`)

## Work

### Step 1 — Add shared constants (single source of truth)

Create a client-safe constants module:

- **File:** `lib/followup-sequence-names.ts` (new)
- **Must export:**
  - `MEETING_REQUESTED_SEQUENCE_NAME_LEGACY = "Meeting Requested Day 1/2/5/7"`
  - `ZRG_WORKFLOW_V1_SEQUENCE_NAME = "ZRG Workflow V1"`
  - `MEETING_REQUESTED_SEQUENCE_NAMES = [MEETING_REQUESTED_SEQUENCE_NAME_LEGACY, ZRG_WORKFLOW_V1_SEQUENCE_NAME] as const`
  - `NO_RESPONSE_SEQUENCE_NAME = "No Response Day 2/5/7"`
  - `POST_BOOKING_SEQUENCE_NAME = "Post-Booking Qualification"`
  - `isMeetingRequestedSequenceName(name: string): boolean` (pure helper)

**Hard constraint:** Do not import Prisma (or any `server-only` module) in this file. It must be safe to import from client components.

### Step 2 — Update Meeting Requested automation to support both names

- **File:** `lib/followup-automation.ts`
- Replace string constants with imports from `lib/followup-sequence-names.ts`.
- Update name-based branching:
  - `shouldTreatAsOutreachSequence(...)` must treat Meeting Requested as response-driven by calling `isMeetingRequestedSequenceName(sequence.name)`.
- Update Meeting Requested auto-start lookup:
  - In `autoStartMeetingRequestedSequenceOnSetterEmailReply(...)`, replace:
    - `where: { clientId, name: MEETING_REQUESTED_SEQUENCE_NAME, isActive: true }`
  - With:
    - `findMany({ where: { clientId, isActive: true, name: { in: MEETING_REQUESTED_SEQUENCE_NAMES } }, select: { id: true, name: true } })`
    - Deterministic selection rule: pick `ZRG_WORKFLOW_V1_SEQUENCE_NAME` if present, else pick legacy.

### Step 3 — Update pause-on-reply exclusions to support both names

- **File:** `lib/followup-engine.ts`
- Replace string constants with imports from `lib/followup-sequence-names.ts`.
- Update `shouldPauseSequenceOnLeadReply(...)` to treat Meeting Requested as response-driven via `isMeetingRequestedSequenceName(sequence.name)`.
- Update `pauseFollowUpsOnReply(...)` query to exclude both Meeting Requested names (use `name: { in: MEETING_REQUESTED_SEQUENCE_NAMES }` inside the `OR` list, or equivalent).

### Step 4 — Update follow-up sequence actions to create the right name per workspace

- **File:** `actions/followup-sequence-actions.ts`
- Import the name constants from `lib/followup-sequence-names.ts`.
- Add a helper to choose the Meeting Requested **default name** per workspace:
  - `async function getMeetingRequestedSequenceNameForClient(clientId: string): Promise<string>`
  - Implementation:
    - `const settings = await prisma.workspaceSettings.findUnique({ where: { clientId }, select: { brandName: true } })`
    - If `settings?.brandName == null` → return `ZRG_WORKFLOW_V1_SEQUENCE_NAME`
    - Else → return `MEETING_REQUESTED_SEQUENCE_NAME_LEGACY`
- In `createMeetingRequestedSequence(clientId)`, set `name: await getMeetingRequestedSequenceNameForClient(clientId)`.
- Update any “default sequences” queries that currently use `DEFAULT_SEQUENCE_NAMES.meetingRequested` so they include both names:
  - `applyAirtableModeToDefaultSequences(...)` must target Meeting Requested regardless of which name it has.
  - Any “ensure default sequences” helpers must remain compatible after rename.

### Step 5 — Update LinkedIn augmentation to support both names

- **File:** `lib/followup-sequence-linkedin.ts`
- Replace the local `DEFAULT_SEQUENCE_NAMES.meetingRequested` usage:
  - Query should use `name: { in: [NO_RESPONSE_SEQUENCE_NAME, ...MEETING_REQUESTED_SEQUENCE_NAMES] }`
  - Template selection should use `isMeetingRequestedSequenceName(sequence.name)` rather than equality to a single string.

### Step 6 — Update Sequence Manager built-in trigger overrides

- **File:** `components/dashboard/followup-sequence-manager.tsx`
- Update `BUILT_IN_TRIGGER_OVERRIDES`:
  - Add an entry for `ZRG_WORKFLOW_V1_SEQUENCE_NAME` with the same label/tooltip as the legacy Meeting Requested entry.
  - (Optional, preferred) Import the constants from `lib/followup-sequence-names.ts` instead of duplicating the string literal.

## Validation (RED TEAM)

- `rg -n "Meeting Requested Day 1/2/5/7|ZRG Workflow V1" lib actions components scripts`
  - Expect: remaining occurrences are either:
    - centralized in `lib/followup-sequence-names.ts`, or
    - in docs/history scripts that intentionally reference the legacy name.
- Manual UI:
  - In Follow-Up Sequence Manager, confirm the trigger label shows **“On setter email reply”** for both Meeting Requested names.
- DB spot checks (via Prisma Studio / SQL):
  - ZRG workspace: sequence name is `"ZRG Workflow V1"`.
  - Branded workspace (`brandName != null`): legacy name remains.
  - In both cases: a first setter email reply starts the Meeting Requested workflow (post-71d migration for ZRG).

## Output

- Meeting Requested workflow logic is name-agnostic (`legacy` + `"ZRG Workflow V1"` behave identically).
- ZRG workspaces default to `"ZRG Workflow V1"` while branded workspaces keep the legacy name.

## Handoff

Proceed to Phase 71d to implement/run the idempotent rename migration and perform end-to-end verification.

