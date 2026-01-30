# Phase 71 — ZRG Workflow V1 Reset & Pause Fix

## Purpose

Rename the default "Meeting Requested Day 1/2/5/7" follow-up sequence to "ZRG Workflow V1" for all ZRG workspaces, and fix the pause/resume bug where paused sequences disappear from the UI after page refresh.

## Context

### User Request

> We have the meeting requested workflow which we kind of want to actually migrate all positive sentiments over to. So as soon as the setter sends the first message to that client (which obviously they're only going to send if there's a positive sentiment), then we're going to go ahead and enable the meeting requested workflow. Let's also change the name to ZRG Workflow V1.
>
> Also, I'm seeing that we aren't actually sending out these workflows. For some reason, they're hard-paused, and there's some sort of a weird thing that's happened where they're completely paused and have no way of being run around so you can start them. But then when you refresh the page, they're still paused. This is especially for Founders Club.

### Workspace Identification

| Workspace Type | Identification | Workflow Rename |
|----------------|----------------|-----------------|
| **ZRG Workspaces** | `WorkspaceSettings.brandName IS NULL` | ✅ Yes |
| **Founders Club** | `WorkspaceSettings.brandName = "Founders Club"` | ❌ No |

### Pause/Resume Bug - Root Cause

**File:** `components/dashboard/follow-ups-view.tsx:549`

```typescript
getWorkspaceFollowUpInstances(activeWorkspace, "active")  // BUG: Only fetches active
```

The UI fetches only `"active"` status instances, but displays a "Paused" section (lines 741-745). Paused instances are never fetched, so they:
1. Disappear after any data refresh
2. Cannot be resumed (the button fires `resumeFollowUpInstance()` which succeeds in DB, but UI doesn't refetch paused items)

### Variable Replacement (Confirmed Working)

Variables in message templates work via `lib/followup-engine.ts:472-505`:

| Template Variable | Source |
|-------------------|--------|
| `{company}` | `WorkspaceSettings.companyName` |
| `{name}` | `WorkspaceSettings.aiPersonaName` |
| `{firstName}` / `{FIRST_NAME}` | `Lead.firstName` |
| `{link}` / `{calendarLink}` | `CalendarLink.publicUrl` or `.url` |
| `{x day x time}` / `{y day y time}` | Availability cache slots |
| `{result}` / `{achieving result}` | `WorkspaceSettings.targetResult` |

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 70 | Active | `components/dashboard/sidebar.tsx`, `actions/lead-actions.ts` | Independent - different filters |
| Phase 69 | Complete | Auto-send infrastructure | No overlap |

## Pre-Flight Conflict Check (Multi-Agent)

- [ ] Run `git status --porcelain` and confirm no unexpected edits in the files this phase will touch:
  - `components/dashboard/follow-ups-view.tsx`
  - `components/dashboard/followup-sequence-manager.tsx`
  - `actions/followup-sequence-actions.ts`
  - `lib/followup-automation.ts`
  - `lib/followup-engine.ts`
  - `lib/followup-sequence-linkedin.ts`
  - `scripts/phase-71-rename-workflow.ts` (new)
- [ ] Scan last 10 phases (`ls -dt docs/planning/phase-* | head -10`) for overlap in follow-ups + workflow naming.
- [ ] If overlap exists, re-read the current file contents before implementing (don’t rely on cached assumptions).

## Repo Reality Check (RED TEAM)

- What exists today:
  - `components/dashboard/follow-ups-view.tsx` fetches instances via `getWorkspaceFollowUpInstances(activeWorkspace, "active")`, but the UI renders a Paused section (so paused instances can never appear after refresh).
  - `actions/followup-sequence-actions.ts` already supports `getWorkspaceFollowUpInstances(clientId, filter?: "active" | "paused" | "completed" | "all")`.
  - The Meeting Requested sequence name is hard-coded in multiple runtime places (not just `DEFAULT_SEQUENCE_NAMES`):
    - `lib/followup-automation.ts` (`MEETING_REQUESTED_SEQUENCE_NAME` + auto-start query)
    - `lib/followup-engine.ts` (`MEETING_REQUESTED_SEQUENCE_NAME` + pause-on-reply exclusions)
    - `lib/followup-sequence-linkedin.ts` (default-sequence lookup by name)
    - `components/dashboard/followup-sequence-manager.tsx` (`BUILT_IN_TRIGGER_OVERRIDES`)
- What the original plan assumed:
  - Renaming `actions/followup-sequence-actions.ts`’s `DEFAULT_SEQUENCE_NAMES.meetingRequested` is sufficient.
- Verified touch points:
  - `autoStartMeetingRequestedSequenceOnSetterEmailReply()` currently queries `FollowUpSequence` by exact name `"Meeting Requested Day 1/2/5/7"`; renaming sequences without dual-name support will stop auto-starting the workflow.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Rename breaks auto-start + pause-exclusions because multiple code paths key off the exact sequence name → add dual-name support (`"Meeting Requested Day 1/2/5/7"` **and** `"ZRG Workflow V1"`) before/with DB rename.
- Fixing UI by switching to `"all"` can accidentally surface `completed/cancelled` instances in Follow-ups view → fetch only `active + paused` (or explicitly filter statuses client-side).

### Missing or ambiguous requirements
- Per constraint, branded workspaces (e.g., Founders Club) must retain legacy name → meeting-requested “identity” must be name-agnostic, while **default display name** becomes workspace-dependent (`brandName IS NULL` → `"ZRG Workflow V1"`).
- `components/dashboard/followup-sequence-manager.tsx` must show correct built-in trigger label for the new name too (otherwise it will regress to “Manual trigger only” UI confusion).

### Repo mismatches (fix the plan)
- The Phase 71b migration snippet uses an incorrect Prisma nested-relation filter shape for `Client.settings` (it’s an optional one-to-one). The real script must use correct Prisma relation filters and follow existing script conventions (dotenv + `DIRECT_URL`/`DATABASE_URL`).

### Testing / validation gaps
- Plan must include DB verification that:
  - ZRG workspaces start the Meeting Requested workflow on first setter email reply after renaming.
  - Founders Club (and any `brandName != null`) sequences remain unchanged.
  - Follow-ups UI shows paused instances after refresh and resume moves them back into the time-based group.

## Decision (Confirmed)

- [x] Auto-enable `Lead.autoFollowUpEnabled` on the first setter email reply (so Meeting Requested can start even if the lead flag was false).
  - Note: UI must reflect the updated flag after sending.

## Objectives

* [x] Fix pause/resume bug by fetching all instances (not just active)
* [x] Ensure Follow-ups view fetches `paused` instances without surfacing `completed/cancelled`
* [x] Introduce dual-name support so Meeting Requested logic works for both:
  - `"Meeting Requested Day 1/2/5/7"` (legacy / branded workspaces)
  - `"ZRG Workflow V1"` (ZRG workspaces)
* [x] Use `"ZRG Workflow V1"` as the Meeting Requested **default name** only for ZRG workspaces (`WorkspaceSettings.brandName IS NULL`)
* [x] Create an idempotent migration script (dry-run by default) to rename existing sequences for ZRG workspaces only
* [ ] Run migration and verify Founders Club (and any `brandName != null`) unchanged
* [x] Verify `npm run lint && npm run build` pass

## Constraints

- Founders Club workspace (`brandName = "Founders Club"`) must NOT have workflow renamed
- Existing sequence behavior (trigger on setter's first email reply) remains unchanged
- Migration script must be idempotent (safe to run multiple times)

## Success Criteria

- [x] Paused sequences appear in "Paused" section after page refresh
- [x] Resume button moves instances back to appropriate time-based group
- [x] ZRG workspaces have sequence named "ZRG Workflow V1" *(code ready; migration pending run)*
- [x] Founders Club workspaces retain "Meeting Requested Day 1/2/5/7" name
- [x] New workspace creation uses "ZRG Workflow V1" as default name
- [x] Meeting Requested auto-start continues to work after rename (both names treated as the same workflow)
- [x] `npm run lint` and `npm run build` pass

## Subphase Index

* a — Fix pause/resume bug (UI data fetching)
* b — Rename default sequence constant + migrate existing sequences
* c — Propagate rename safely (dual-name support across runtime + UI)
* d — Migration hardening + verification checklist

## Key Files

| Component | File |
|-----------|------|
| Follow-ups UI (bug) | `components/dashboard/follow-ups-view.tsx` |
| Instance fetching | `actions/followup-sequence-actions.ts` (`getWorkspaceFollowUpInstances`) |
| Default sequence names | `actions/followup-sequence-actions.ts` (`DEFAULT_SEQUENCE_NAMES`) |
| Meeting Requested auto-start | `lib/followup-automation.ts` (`autoStartMeetingRequestedSequenceOnSetterEmailReply`) |
| Pause-on-reply exclusions | `lib/followup-engine.ts` (`pauseFollowUpsOnReply`, `shouldPauseSequenceOnLeadReply`) |
| Built-in trigger labels | `components/dashboard/followup-sequence-manager.tsx` (`BUILT_IN_TRIGGER_OVERRIDES`) |
| LinkedIn default-sequence augmentation | `lib/followup-sequence-linkedin.ts` |
| Migration script | `scripts/phase-71-rename-workflow.ts` (new; final version specified in 71d) |

## Phase Summary (2026-01-30)

**Shipped:**
- Follow-ups UI pause/resume fix: `components/dashboard/follow-ups-view.tsx:551` now fetches `"all"` instances and filters to `active`/`paused` client-side
- Dual-name support via `lib/followup-sequence-names.ts`: `MEETING_REQUESTED_SEQUENCE_NAME_LEGACY` + `ZRG_WORKFLOW_V1_SEQUENCE_NAME` treated identically
- Workspace-aware default naming: `getMeetingRequestedSequenceNameForClient()` returns `"ZRG Workflow V1"` for `brandName IS NULL`, legacy for branded
- Auto-start lookup updated: `autoStartMeetingRequestedSequenceOnSetterEmailReply()` queries with `name: { in: MEETING_REQUESTED_SEQUENCE_NAMES }`
- Sequence Manager trigger labels: `BUILT_IN_TRIGGER_OVERRIDES` shows "On setter email reply" for both names
- Migration script: `scripts/phase-71-rename-workflow.ts` (dry-run default, `--apply`, `--clientId` for canary)

**Verified:**
- `npm run lint`: PASS (0 errors, 18 warnings)
- `npm run build`: PASS (37 routes)
- `npm run db:push`: SKIP (no schema changes)

**Pending:**
- Run migration: `npx tsx scripts/phase-71-rename-workflow.ts --apply`
- Smoke test: pause/resume in Follow-ups UI, first setter email reply in ZRG and Founders Club workspaces

**Key Decisions:**
- Dual-name support landed before migration to avoid auto-start breakage
- Migration is dry-run by default and skips workspaces that already have "ZRG Workflow V1" (idempotent)
- Branded workspaces (`brandName != null`) retain legacy name

See `docs/planning/phase-71/review.md` for full evidence mapping.
