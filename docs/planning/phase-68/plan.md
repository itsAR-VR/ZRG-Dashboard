# Phase 68 — Follow-Up Trigger Clarity & Admin Visibility

## Purpose
Improve follow-up sequence UI/UX to accurately reflect actual trigger behavior and provide admin visibility into active follow-up instances per lead.

## Context
The follow-up sequence manager currently displays "Manual trigger only" for sequences like "Meeting Requested Day 1/2/5/7" based on the `triggerOn` schema field. However, Phase 66 introduced code-based triggers (`autoStartMeetingRequestedSequenceOnSetterEmailReply`) that start sequences independently of the cron-based `triggerOn` field. This causes confusion because:

1. **UI mismatch**: "Manual trigger only" label doesn't reflect that the sequence auto-starts when a setter sends their first email reply
2. **No visibility**: Admins cannot see which leads have active follow-up instances or what triggered them
3. **Trigger semantics**: The `triggerOn` field controls cron behavior, but code can trigger sequences independently

### Current Trigger Architecture

| Sequence | `triggerOn` Value | Actual Trigger |
|----------|-------------------|----------------|
| Meeting Requested | `manual` | Code: `autoStartMeetingRequestedSequenceOnSetterEmailReply()` on setter's first email |
| Re-engagement Follow-up | `no_response` | Cron + backfill (requires positive sentiment + prior reply) |
| Custom sequences | User-selected | As configured |

## Objectives
* [x] Update follow-up sequence UI to accurately describe trigger behavior for built-in sequences
* [x] Add admin visibility panel showing active follow-up instances per lead
* [x] Document trigger semantics clearly in the UI (tooltip or help text)
* [ ] Consider adding a "trigger log" or audit trail for follow-up instance creation (deferred — requires schema change)

## Constraints
- Do not change existing trigger behavior (Phase 66 logic is correct)
- Maintain backwards compatibility with existing sequences
- UI changes should be non-disruptive to current workflows
- No new database migrations if possible (use existing `FollowUpInstance` data)

## Success Criteria
- [x] "Meeting Requested" sequence shows accurate trigger description (e.g., "On setter email reply")
- [x] Admin can view active follow-up instances for a lead in the CRM or inbox
- [x] Help text or documentation clarifies the difference between cron triggers and code triggers
- [x] `npm run lint`, `npm run build` pass

## Subphase Index
* a — Audit trigger display logic and plan UI improvements
* b — Update sequence card to show accurate trigger labels
* c — Add follow-up instance visibility to lead detail or inbox
* d — Documentation and help text
* e — Review and cleanup

## Related Phases
| Phase | Overlap | Coordination |
|-------|---------|--------------|
| Phase 66 | `lib/followup-automation.ts` trigger logic | Read-only — don't change trigger behavior |
| Phase 62 | `FollowUpInstance` model | Use existing data for visibility |

## Phase Summary

### Completed
All objectives and success criteria met.

### Changes Made

| File | Change |
|------|--------|
| `components/dashboard/followup-sequence-manager.tsx` | Added `BUILT_IN_TRIGGER_OVERRIDES` map, `getTriggerDisplay()` helper, Info icon with tooltips, collapsible help section |
| `components/dashboard/crm-drawer.tsx` | Added "Started" date to follow-up instance display |

### Key Discoveries

1. **Follow-up instance visibility already existed** in `crm-drawer.tsx` — shows sequence name, status, step progress, next due date, and pause/resume/cancel actions
2. **Trigger audit trail deferred** — adding a `triggeredBy` field requires schema migration and updates to all sequence start paths

### Verification

- `npm run lint`: 0 errors (18 pre-existing warnings)
- `npm run build`: Passes
