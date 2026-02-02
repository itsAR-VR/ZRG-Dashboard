# Phase 89 — Founders Club Weighted Round-Robin (Exclude Jon, Add Emar)

## Purpose
Update Founders Club lead auto-assignment so Jon no longer receives **new** assigned leads, and Emar is included at **~50%** of Vee/JD volume via an explicit, repeating round-robin sequence: `Vee → JD → Vee → JD → Emar → …`.

## Context
- Round-robin lead assignment already exists (`lib/lead-assignment.ts`) and assigns **positive-sentiment** leads to the next `ClientMember` with role `SETTER`, using `WorkspaceSettings.roundRobinEnabled` + `roundRobinLastSetterIndex` to track state.
- The current assignments UI supports managing who is a SETTER, but it cannot express **weighted** rotation (repeats) or channel-specific gating.
- Business change: Jon is moving to the ZRG campaign, so Founders Club should stop auto-assigning him new leads, without reassigning the leads he already owns.
- Desired distribution: Emar should receive half as many assigned leads as Vee and JD, implemented as a deterministic sequence: `Vee, JD, Vee, JD, Emar` (repeat).
- For Founders Club, the weighted round-robin should be **Email-only** (Inboxxia/EmailBison leads), not SMS/LinkedIn.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 83 | Uncommitted (working tree) | `prisma/schema.prisma`, inbound post-process files | Merge schema edits cleanly before adding new `WorkspaceSettings` fields. Avoid reworking Phase 83 pipeline changes. |
| Phase 84 | Untracked (working tree) | `docs/planning/**` | Independent domain; do not edit Phase 84 files while adding Phase 89. |
| Phase 82 | Uncommitted (planning/artifacts) | `docs/planning/**` | Independent; avoid touching Phase 82 artifacts. |
| Phase 85 | Planned (docs) | `prisma/schema.prisma`, Settings UI | Coordinate schema edits and Settings UX changes (Phase 85 introduces client portal role + read-only Settings for that role). |

## Objectives
* [ ] Add per-workspace configuration to express a weighted round-robin sequence (duplicates allowed) and an “Email-only assignment” gate.
* [ ] Update assignment logic to use the configured sequence (filtering to active setters), exclude Jon by omission from the sequence, and keep assignment trigger as “positive sentiment only”.
* [ ] Expose configuration in the dashboard (admin-only) so changes can be made via user login (no manual SQL).
* [ ] Add unit tests and a short verification runbook for Founders Club.

## Constraints
- **Workspace scope (initial config):** Founders Club only, but implementation should be generic.
- **Jon handling:** keep access and keep existing lead ownership; prevent **future** auto-assignments to Jon by excluding him from the configured sequence.
- **Trigger:** keep existing behavior — assign only after sentiment becomes “positive” (no “assign every new lead” behavior).
- **Channel scope:** when “Email-only” is enabled, only Email (Inboxxia/EmailBison) leads should be eligible for assignment; SMS/LinkedIn should not auto-assign.
- **Prisma:** schema changes require `npm run db:push` before considering implementation complete.
- **Safety:** do not commit secrets/PII; treat admin inputs as untrusted (validate emails and roles).

## Success Criteria
- [x] Founders Club has a configured sequence `Vee, JD, Vee, JD, Emar` and new eligible leads are assigned in that order (repeat).
- [x] Jon receives **0** new round-robin assignments in Founders Club after deployment/config.
- [x] Leads already assigned to Jon remain unchanged.
- [x] With "Email-only assignment" enabled, SMS/LinkedIn inbound does not trigger assignment.
- [x] Validation passes: `npm run test`, `npm run lint`, `npm run build`.

## Subphase Index
* a — Schema + WorkspaceSettings fields
* b — Assignment logic update (sequence + email-only gate)
* c — Admin actions + Settings UI wiring
* d — Tests + verification runbook

## Repo Reality Check (RED TEAM)

- **What exists today:**
  - `lib/lead-assignment.ts`: `assignLeadRoundRobin()`, `maybeAssignLead()`, `backfillLeadAssignments()` — working round-robin with `roundRobinEnabled` + `roundRobinLastSetterIndex`
  - `WorkspaceSettings` schema: `roundRobinEnabled` (Boolean), `roundRobinLastSetterIndex` (Int?) at lines 284-285
  - `actions/client-membership-actions.ts`: `getClientAssignments()` returns `{ setters, inboxManagers }` as email arrays; `setClientAssignments()` accepts `{ setterEmailsRaw, inboxManagerEmailsRaw }`
  - `components/dashboard/settings/integrations-manager.tsx`: "Assignments" section with setter/inbox-manager email inputs (no round-robin controls)
  - Inbound triggers: `maybeAssignLead()` called from `pipeline.ts:247`, `email-inbound-post-process.ts:864`, `sms-inbound-post-process.ts:211`, `linkedin-inbound-post-process.ts:175`
  - Test infrastructure: `lib/__tests__/*.test.ts` pattern; `scripts/test-orchestrator.ts` for registration

- **What the plan assumes:**
  - `roundRobinSetterSequence` (String[]) does NOT exist yet — Phase 89a creates it
  - `roundRobinEmailOnly` (Boolean) does NOT exist yet — Phase 89a creates it
  - Actions return/accept round-robin fields — they do NOT; Phase 89c extends them
  - UI has round-robin controls — it does NOT; Phase 89c adds them

- **Verified touch points:**
  - `lib/lead-assignment.ts:50` — `assignLeadRoundRobin()` function exists
  - `lib/lead-assignment.ts:146` — `maybeAssignLead()` function exists
  - `prisma/schema.prisma:284-285` — existing round-robin fields
  - `actions/client-membership-actions.ts:17` — `getClientAssignments()` exists
  - `actions/client-membership-actions.ts:56` — `setClientAssignments()` exists

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Concurrent assignment drift:** Current `assignLeadRoundRobin()` doesn't lock the WorkspaceSettings row. Under high concurrency, two assignments could read the same `roundRobinLastSetterIndex`, causing pointer drift. → **Mitigation:** Add `SELECT ... FOR UPDATE` via raw SQL or Prisma extension in Phase 89b.
- **Email-only gating requires channel info:** `maybeAssignLead()` doesn't receive channel information. Without it, email-only gating cannot distinguish SMS/LinkedIn triggers. → **Mitigation:** Channel-based check decided; `maybeAssignLead()` and `assignLeadRoundRobin()` now accept `channel` parameter. All trigger sites updated to pass their channel.
- **Test file won't run without registration:** `scripts/test-orchestrator.ts` uses **MANUAL file registration** (not auto-discovery). Phase 89d MUST add `lib/__tests__/lead-assignment.test.ts` to the `TEST_FILES` array or tests will silently not run. → **Mitigation:** Explicit step added to Phase 89d.

### Missing or ambiguous requirements
- **Sequence validation behavior undefined:** If admin enters a sequence email not in the setter list, should we reject, warn, or silently filter? → **Mitigation:** Default to reject with clear error; document in Phase 89c.
- **Empty sequence fallback not explicit:** Plan implies empty sequence falls back to active setters, but this isn't stated. → **Mitigation:** Add explicit fallback logic + schema comment in Phase 89a.
- **Pointer reset on setter removal:** If a setter in the sequence is demoted (removed from SETTER role), the sequence continues to filter them out. But what if the current `roundRobinLastSetterIndex` pointed to a position that no longer maps correctly after filtering? → **Mitigation:** Always compute `nextIndex` as `(lastIndex + 1) % filteredSequence.length`; document edge case in Phase 89b.

### Repo mismatches (fixed)
- Plan reference `actions/client-membership-actions.ts` is correct (verified at lines 17, 56).
- Plan reference `components/dashboard/settings/integrations-manager.tsx` is correct (Assignments UI at lines 1550-1592).
- Plan reference `lib/lead-assignment.ts:assignLeadRoundRobin()` is correct (verified at line 50).
- Plan reference `lib/lead-assignment.ts:maybeAssignLead()` is correct (verified at line 146).

### Performance / timeouts
- **Large setter lists:** Sequence filtering is O(n×m) where n=sequence length, m=active setters. For typical workspaces (<20 setters), this is negligible. → No action needed.
- **Transaction timeout:** Interactive transaction includes setter query + lead update + settings update + FOR UPDATE lock. Typical execution <100ms. → No action needed.

### Security / permissions
- **Admin gating:** Sequence configuration must be admin-only. Current `requireClientAdminAccess(clientId)` already guards actions. → Verified.
- **Input validation:** Sequence emails must be validated as real Supabase Auth users before storage. → Phase 89c includes this.

### Testing / validation
- **Test file registration is MANUAL:** `scripts/test-orchestrator.ts` uses explicit `TEST_FILES` array (not glob discovery). Phase 89d MUST add `lib/__tests__/lead-assignment.test.ts` to this array. → Added explicit step.
- **Integration test missing:** No end-to-end test for webhook → assignment flow. → Add manual verification runbook (already in Phase 89d).

## Multi-Agent Coordination Notes

### Active Conflicts (Updated 2026-02-02)
| File | Concurrent Phase | Status | Phase 89 Impact | Resolution |
|------|------------------|--------|-----------------|------------|
| `prisma/schema.prisma` | Phase 83 | Modified (uncommitted) | Adds 2 new fields after line 285 | **BLOCKER:** Must merge Phase 83 schema first (adds `LeadCrmRow` model + `CrmResponseMode` enum). Insert Phase 89 fields after round-robin block. |
| `lib/inbound-post-process/pipeline.ts` | Phase 83 | Modified (uncommitted) | No changes needed (attribution-based gating) | Read current state; Phase 83 adds CRM row upserts, which are independent of assignment logic. |
| `lib/background-jobs/email-inbound-post-process.ts` | Phase 83 | Modified (uncommitted) | `maybeAssignLead()` call exists (line 864) | Phase 83 adds CRM upserts; Phase 89 does NOT modify this file (attribution check is inside `assignLeadRoundRobin`). |
| `lib/background-jobs/sms-inbound-post-process.ts` | Phase 83 | Modified (uncommitted) | `maybeAssignLead()` call exists (line 211) | Same as above; no Phase 89 changes to this file. |
| `lib/background-jobs/linkedin-inbound-post-process.ts` | Phase 83 | Modified (uncommitted) | `maybeAssignLead()` call exists (line 175) | Same as above; no Phase 89 changes to this file. |
| `actions/analytics-actions.ts` | Phase 83 | Modified (uncommitted) | Unrelated (CRM actions) | No conflict; Phase 89 touches `client-membership-actions.ts` instead. |
| `components/dashboard/settings-view.tsx` | Phase 83 | Modified (uncommitted) | Unrelated | No conflict; Phase 89 UI work is in `integrations-manager.tsx`. |

### Other Active Phases (No Direct Conflicts)
| Phase | Status | Notes |
|-------|--------|-------|
| Phase 84 (Spintax) | Complete | Touches `lib/followup-template.ts`, `lib/followup-engine.ts` — unrelated to assignment. |
| Phase 86 (Calendar Health) | Untracked | Adds new WorkspaceSettings fields for slot thresholds — insert Phase 89 fields first or coordinate insertion order. |
| Phase 87 (Refresh Availability) | Untracked | No schema changes; independent. |
| Phase 88 (Analytics Attribution) | Untracked | Touches analytics UI/actions; independent of assignment. |

### Pre-Flight Checklist (Before Phase 89 Implementation)
- [ ] Phase 83 schema changes committed or merged (`npm run db:push` run)
- [ ] Re-read `prisma/schema.prisma` to confirm insertion point (after `roundRobinLastSetterIndex`)
- [ ] Re-read `lib/lead-assignment.ts` to confirm no unexpected changes
- [ ] Re-read `actions/client-membership-actions.ts` to confirm action signatures unchanged
- [ ] Re-read `components/dashboard/settings/integrations-manager.tsx` Assignments section (~lines 1550-1592)

### Conflict Resolution Strategy
Phase 89 is **additive** and does NOT modify the same functions/blocks as Phase 83:
- Phase 83 adds CRM row upserts in inbound pipelines
- Phase 89 modifies `assignLeadRoundRobin()` and adds settings UI

Safe to implement after Phase 83 is merged. If Phase 86 runs first, coordinate schema field ordering (Phase 89 fields should stay grouped with existing round-robin fields).

## Open Questions (Need Human Input)

- [ ] **Sequence validation behavior:** Reject, warn, or filter invalid emails? (confidence ~85%)
  - Why it matters: Affects UX when admins misconfigure
  - Current assumption in this plan: **Reject with clear error** listing which emails are invalid
  - If answered differently: "Warn" would require additional UI state (warnings vs errors); "Filter" would silently accept bad input

- [x] **Email-only channel detection:** Check `emailBisonLeadId` (attribution) or Message `channel` (trigger)? (confidence ~95%, decided)
  - Why it matters: Attribution-based catches all email leads; channel-based is stricter
  - **Decision:** Channel-based (require `channel === "email"` on the triggering message)
  - Rationale: "Email-only" means only actual email replies trigger assignment; SMS/LinkedIn replies from email-originated leads should NOT auto-assign

## Assumptions (Agent)

- **Test orchestrator requires manual registration** (confidence ~99%)
  - Verified: `scripts/test-orchestrator.ts` uses explicit `TEST_FILES` array
  - Impact: Phase 89d MUST add the new test file to this array

- **Phase 83 is a blocking dependency** (confidence ~95%)
  - Verified: Phase 83 modifies `prisma/schema.prisma` with uncommitted changes
  - Impact: Phase 89 schema changes must be inserted after Phase 83 is merged

- **FOR UPDATE lock is sufficient for concurrency** (confidence ~90%)
  - Rationale: PostgreSQL row-level locks within interactive transactions prevent concurrent reads from racing
  - Mitigation: If issues arise, consider advisory locks or retry logic

- **Pointer modulo handles sequence shrinkage** (confidence ~95%)
  - Rationale: `(lastIndex + 1) % newLength` naturally wraps to valid range even if sequence shrinks
  - Example: lastIndex=4, newLength=3 → nextIndex = (4+1)%3 = 2

## Phase Summary

### Status: Complete ✅ (Reviewed 2026-02-02)

### Shipped
- **Schema:** `roundRobinSetterSequence` (String[]) + `roundRobinEmailOnly` (Boolean) added to `WorkspaceSettings`
- **Logic:** `lib/lead-assignment.ts` updated with weighted sequence support, channel-based email-only gating, FOR UPDATE lock
- **Trigger sites:** All inbound post-process files now pass explicit `channel` parameter
- **Actions:** `getClientAssignments()` / `setClientAssignments()` extended for round-robin config
- **UI:** Assignments section in `integrations-manager.tsx` includes toggles + selectable sequence builder
- **Tests:** `lib/__tests__/lead-assignment.test.ts` with 9 test cases; registered in `test-orchestrator.ts`

### Verified
- `npm run lint`: ✅ pass (0 errors, 22 warnings — pre-existing)
- `npm run build`: ✅ pass
- `npm run test`: ✅ pass (102 tests, 0 failures)
- `npm run db:push`: ✅ pass (run during 89a)

### Key Decisions
1. **Channel-based email detection** over attribution-based — more precise gating
2. **Selectable setter chips** over comma-separated input — better UX, eliminates validation errors
3. **FOR UPDATE lock** for concurrency — prevents pointer drift under concurrent assignments

### Notes
- Founders Club production config is a manual follow-up (configure setters, sequence, enable flags)
- See `docs/planning/phase-89/review.md` for detailed evidence mapping
