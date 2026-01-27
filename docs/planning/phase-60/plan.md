# Phase 60 — Booking Process Reference Panel (5 Booking Processes Documentation UI)

## Purpose
Add a Booking Processes Reference Panel to the Settings UI that explains all 5 booking processes from Phase 52, showing their triggers, behaviors, and usage scenarios so users have a clear frame of reference for how the system handles each booking scenario.

## Context
Phase 52 implemented **5 distinct booking processes** that the AI supports:

1. **Send booking link on interest** (no suggested times) — lead self-schedules; reply includes qualification question(s)
2. **We already sent specific times** in the initial email (via EmailBison `availability_slot`) — lead picks one and the system auto-books
3. **Lead replies with times they can do** — system auto-books an available time when confidence is high
4. **Lead says "call me"** and provides their cell — system creates a call task and can notify the client (Notification Center-dependent)
5. **Lead sends their calendar link** — AI captures it and flags for manual review (full automation planned as follow-on)

**The Problem:** The current UI (BookingProcessManager in Settings) shows templates for creating booking processes, but:
- Templates 2-5 have minimal stage configurations because they're about **inbound behavior** (auto-booking, call tasks, scheduler link capture), not **outbound draft instructions**
- There is some limited documentation today (e.g., “Booking Notices” callouts for Process 5), but no **single reference** that explains all 5 processes end-to-end
- Users don't understand the difference between outbound instructions (Process 1) and inbound reactions (Processes 2-5)
- Key prerequisites aren’t obvious (auto-booking enabled, booking provider configured, Notification Center rules)

**The Solution:** Add a reference panel that:
- Explains all 5 booking processes with clear descriptions
- Shows which behaviors are outbound (draft instructions) vs inbound (system reactions)
- Provides examples of what triggers each process
- Indicates process maturity (fully automated vs manual review)

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 59 | Active (in working tree) | Domain: follow-up sequences | No direct overlap; Phase 59 focuses on sequence messaging, not booking UI |
| Phase 58 | Complete | Calendar link handling | No conflict; booking processes use calendar links but don't modify them |
| Phase 52 | Complete | Booking processes | Phase 60 documents Phase 52's features; no code changes to booking logic |

## Pre-Flight Conflict Check (Multi-Agent)

- Working tree has uncommitted changes from Phase 59 (follow-up sequencing)
- Files this phase will touch:
  - `components/dashboard/settings-view.tsx` (add reference panel)
  - `components/dashboard/settings/booking-process-reference.tsx` (new component)
- No overlap with Phase 59's modified files (`actions/followup-sequence-actions.ts`, `lib/followup-*`)

## Objectives
* [x] Create a `BookingProcessReference` component that explains all 5 booking processes
* [x] Display clear distinction between outbound (draft) vs inbound (reaction) processes
* [x] Show process triggers, behaviors, and examples for each process
* [x] Indicate process maturity/limitations (e.g., Process 5 is manual review only)
* [x] Include a compact "Prereqs/Requirements" line per process (settings + data dependencies)
* [x] Add the reference panel to the Settings Booking tab
* [x] Show the relevant template name for each process (so users can map docs ↔ templates)

## Constraints
- **Read-only reference**: This is documentation/help content, not configuration
- **Existing UI**: Integrate with existing Settings structure without disrupting BookingProcessManager
- **Accurate descriptions**: Must match Phase 52's actual implementation behavior
- **No booking logic changes**: This phase adds documentation UI only
- **No new UI deps**: Use existing `components/ui/*` primitives (Accordion/Card/Badge already exist)
- **Compact prereqs**: Keep prerequisites scannable (1 short line per process; only include what meaningfully changes expectations)

## Non-Goals
- Changing booking automation behavior (Phase 52/55 logic)
- Reworking BookingProcessManager UX (CRUD/templates) beyond placing the reference panel
- Adding deep-linking from templates → docs (ok as a follow-on if desired)

## Success Criteria
- [x] Reference panel displays all 5 booking processes with clear descriptions
- [x] Each process shows: name, type (outbound/inbound), trigger, behavior, example
- [x] Each process includes a compact "Prereqs/Requirements" line (where applicable)
- [x] Template labels match `BOOKING_PROCESS_TEMPLATES.slice(0, 5).map(t => t.name)`
- [x] Process 5 clearly indicates "manual review" limitation
- [x] Reference panel is accessible from Settings (Booking section)
- [x] `npm run lint` passes
- [x] `npm run build` passes

## Subphase Index
* a — Design reference panel content (process descriptions, triggers, behaviors)
* b — Create `BookingProcessReference` component
* c — Integrate into Settings UI
* d — Polish, verify, and document
* e — RED TEAM hardening: repo reality fixes + drift-proof content
* f — Add compact prereqs per process (content + UI)

## Repo Reality Check (RED TEAM)

- What exists today:
  - Booking process templates: `lib/booking-process-templates.ts` (10 templates, first 5 are "defaults")
  - Booking process manager: `components/dashboard/settings/booking-process-manager.tsx`
  - Booking tab already includes a “Booking Notices” card in `components/dashboard/settings-view.tsx` (some Process 5 documentation exists)
  - Booking process instructions: `lib/booking-process-instructions.ts`
  - Booking stage templates: `lib/booking-stage-templates.ts`
  - Auto-booking logic: `lib/followup-engine.ts:processMessageForAutoBooking()`
  - Call task creation: `lib/call-requested.ts:ensureCallRequestedTask()`
  - Scheduler link handling: `lib/scheduling-link.ts`, `lib/lead-scheduler-link.ts`
  - Notification center: `lib/notification-center.ts`
  - UI primitives already present and used in Settings: `components/ui/accordion.tsx`, `components/ui/card.tsx`, `components/ui/badge.tsx`
- What this plan assumes:
  - We're adding documentation UI, not changing booking behavior
  - The 5 processes from Phase 52 are already implemented and working
- Verified touch points:
  - `components/dashboard/settings-view.tsx` (where booking settings live)
  - `components/dashboard/settings/` (where the new component will go)
  - `lib/booking-process-templates.ts:BOOKING_PROCESS_TEMPLATES` (source-of-truth for template names)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Inaccurate documentation**: If descriptions don't match actual behavior, users will be confused
- **Stale content**: If booking processes change in future phases, the reference panel needs updates

### Missing or ambiguous requirements
- (Resolved) The reference panel should include a compact **Prereqs/Requirements** line per process (tracked in Phase 60f).

### Repo mismatches (fix the plan)
- The Booking tab already surfaces some Process 5 limitations (Booking Notices). The reference panel should complement (not duplicate/conflict with) that content.
- Subphase 60a uses shorthand template names in the UI outline; the canonical names are in `lib/booking-process-templates.ts` and should be used to avoid drift.
- Subphase 60b/60c mention adding Accordion via shadcn CLI; `components/ui/accordion.tsx` already exists and is already used in `components/dashboard/settings-view.tsx`.
- Import style: `components/dashboard/settings-view.tsx` uses local `./settings/*` imports; integration should follow that pattern.

### Testing / validation
- Add a simple “drift check” during review: confirm the 5 template names shown in the panel match `BOOKING_PROCESS_TEMPLATES.slice(0, 5).map(t => t.name)`.

## Assumptions (Agent)

- Assumption: Keep the existing “Booking Notices” card and place the reference panel directly below it (confidence ~95%).
  - Mitigation check: if the booking tab feels too dense, collapse the reference panel by default or move it below BookingProcessManager.
- Assumption: Use template names exactly as defined in `lib/booking-process-templates.ts` (confidence ~95%).
  - Mitigation check: if template names are expected to be user-editable later, switch to a looser “Suggested template” mapping.

## Open Questions (Need Human Input)
- [x] Include a compact "Requirements/Prereqs" line per process? → Yes (keep it visually compact; include only meaningful deps like auto-book enablement, booking provider, EmailBison first-touch times, Notification Center rules). (resolved 2026-01-27)

## Phase Summary

### What Shipped
- **New component**: `components/dashboard/settings/booking-process-reference.tsx`
  - Accordion-style reference panel documenting all 5 booking processes
  - Clear "Outbound" vs "Inbound" badge distinction
  - "Manual Review" badge for Process 5
  - Per-process: description, trigger, behavior, example, prereqs (where applicable), template name
- **Integration**: Added to Settings → Booking tab between "Booking Notices" card and BookingProcessManager

### Key Decisions
1. **Placement**: Reference panel positioned after "Booking Notices" and before BookingProcessManager for logical flow (docs → CRUD)
2. **Template names**: Used exact names from `lib/booking-process-templates.ts` to avoid drift
3. **Prereqs**: Included compact requirements line per process (e.g., "Auto-booking enabled, EmailBison first-touch times configured")
4. **No duplication**: Complements existing "Booking Notices" dropdown rather than replacing it

### Files Changed
- `components/dashboard/settings/booking-process-reference.tsx` (new)
- `components/dashboard/settings-view.tsx` (import + render)

### Verification (2026-01-27)
- `npm run lint`: ✅ pass (warnings only, pre-existing)
- `npm run build`: ✅ pass

### Follow-ups (Optional)
- Deep-link from templates dialog to corresponding reference panel section
- Add visual flow diagrams for each process
- Consider collapsing reference panel by default if Booking tab becomes dense
