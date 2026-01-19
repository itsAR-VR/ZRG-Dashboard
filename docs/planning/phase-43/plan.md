# Phase 43 — Round-Robin Lead Assignment for Founders Club Setters

## Purpose
Implement automatic round-robin lead assignment for setter accounts in the Founders Club workspace, with inbox filtering so setters only see their assigned leads, plus per-setter funnel analytics.

## Context
**Business Need:** The Founders Club workspace has multiple setters who should work on distinct subsets of incoming leads. When a lead shows positive engagement (Interested, Information Requested, Call Requested, Meeting Requested), the system should automatically assign that lead to the next setter in rotation. Each setter only sees their assigned leads in the inbox, while admins/owners see everything.

**Workspace:** Founders Club (`ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`)

**Setter Accounts to Create:**
- `vanessa@zeroriskgrowth.com`
- `david@zeroriskgrowth.com`
- `jon@zeroriskgrowth.com`

**Backfill Scope:** Assign all currently-positive unassigned leads to setters (expected ~35 total).

**Key Design Decisions:**
1. Assignment triggers on sentiment change to positive status (not on every message)
2. Once assigned, a lead stays with its setter (no reassignment on subsequent messages)
3. Setter ordering is deterministic and matches stakeholder expectations: Vanessa → David → Jon (see **Decisions Locked** for ordering implementation)
4. Round-robin pointer updates are concurrency-safe and idempotent (no double-assign, no pointer increment when assignment is skipped)
5. Inbox-only restriction: SETTER sees only assigned leads in the inbox views; ADMIN, INBOX_MANAGER, and workspace owners see all

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 42 | Active (uncommitted) | Files: `prisma/schema.prisma`, `actions/lead-actions.ts`, `lib/workspace-access.ts`, `lib/background-jobs/*` | Phase 42 changes are auth/error hardening. Phase 43 adds new fields/logic (additive, not conflicting). Ensure working tree is committed or stashed before applying schema changes. |
| Phase 41 | Active (uncommitted) | Files: `actions/email-campaign-actions.ts` | No direct overlap with lead assignment. |
| Phase 40 | Active (uncommitted) | Files: `scripts/crawl4ai/*` | No overlap. |

## Pre-Flight Conflict Check

- [ ] Run `git status --porcelain` and confirm Phase 42/41/40 changes are committed or coordinated
- [ ] Re-read current state of `prisma/schema.prisma` before adding fields
- [ ] Run `npm run db:push` after schema changes and before continuing

## Repo Reality Check (RED TEAM)

- What exists today:
  - Background job post-processors exist for all 5 inbound channels:
    - `lib/background-jobs/sms-inbound-post-process.ts`
    - `lib/background-jobs/linkedin-inbound-post-process.ts`
    - `lib/background-jobs/smartlead-inbound-post-process.ts`
    - `lib/background-jobs/instantly-inbound-post-process.ts`
    - `lib/background-jobs/email-inbound-post-process.ts`
  - Admin API for member bootstrap exists at `app/api/admin/workspaces/members/route.ts` and returns `{ userId, role, workspaceId, workspaceName }`.
  - `ClientMember` stores `{ clientId, userId, role }` (no `email` column). Email lookups are done via Supabase Admin helpers (see `actions/client-membership-actions.ts:getClientAssignments()`).
  - `ClientMember` uniqueness is `@@unique([clientId, userId, role])` (not `clientId_userId`), so “get role” queries must use `findFirst`/`findMany`.
  - Sentiment tags and positive sentiment constants exist in `lib/sentiment-shared.ts` (`POSITIVE_SENTIMENTS`, `isPositiveSentiment`).
- What the plan assumes:
  - Round-robin enablement is workspace-scoped via `WorkspaceSettings` and defaults to off.
  - Restriction scope is inbox-only: SETTER filtering is enforced for inbox list + counts (server-side), but other lead surfaces may remain unfiltered per product intent.
- Verified touch points:
  - `prisma/schema.prisma`: `model Lead`, `model WorkspaceSettings`, `model ClientMember`, `enum ClientMemberRole`
  - `app/api/admin/workspaces/members/route.ts` (secret-gated member upsert)
  - `actions/lead-actions.ts` (`getInboxCounts`, `getConversationsCursor`)
  - `lib/workspace-access.ts` (`resolveClientScope`, `getUserRoleForClient`, `isSetterRole`)

## Objectives

* [ ] Add `assignedToUserId` and `assignedAt` fields to Lead model
* [ ] Add `roundRobinEnabled` and `roundRobinLastSetterIndex` to WorkspaceSettings
* [ ] Create setter accounts for Founders Club workspace
* [ ] Implement round-robin assignment logic in `lib/lead-assignment.ts`
* [ ] Hook assignment into all 5 background job post-processors
* [ ] Filter inbox by `assignedToUserId` for SETTER role
* [ ] Enable round-robin for Founders Club and backfill all currently-positive unassigned leads
* [ ] Add per-setter funnel analytics (assigned → responded → positive → meeting → booked)

## Constraints

- Lead assignment is additive; existing leads without `assignedToUserId` remain visible to admins
- Assignment is one-time: once a lead has `assignedToUserId`, it doesn't change
- Round-robin index is updated atomically with lead assignment (transaction)
- SETTER filtering is strict: setters ONLY see their assigned leads (no unassigned leads)
- Setter accounts use generated secure passwords (shared securely, not logged)

## Non-Goals

- Changing assignment after initial assignment (manual reassignment UI is out of scope)
- Complex load balancing or performance-based assignment
- Setter availability/schedule-aware assignment
- Real-time assignment notifications (setters see leads on next inbox refresh)

## Success Criteria

- [ ] Schema changes applied: `Lead.assignedToUserId`, `Lead.assignedAt`, `WorkspaceSettings.roundRobinEnabled`, `WorkspaceSettings.roundRobinLastSetterIndex`
- [ ] 3 setter accounts created and can log in to Founders Club workspace
- [ ] New positive-sentiment leads are automatically assigned round-robin
- [ ] Setters see only their assigned leads in inbox
- [ ] Admins/owners still see all leads
- [ ] All currently-positive unassigned leads are distributed roughly evenly across the 3 setters (expected ~35 total)
- [ ] Per-setter analytics show: assigned count, response rate, positive rate, booking rate
- [x] `npm run build` passes with no TypeScript errors

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Double-assignment or pointer drift under concurrency** → assignment must be idempotent (`Lead.assignedToUserId` only set once) and the round-robin pointer must only advance when an assignment actually happens (interactive transaction + conditional update).
- **Inbox-only restriction leakage**: if any non-inbox surfaces remain unfiltered (CRM, direct lead fetch actions), setters can still view other leads → accepted per scope, but document clearly so it’s not treated as a “bug” later.
- **Setter ordering surprises** (UUID sort is not “Vanessa → David → Jon”) → lock an ordering rule that matches stakeholder expectations (createdAt order or explicit configured order).

### Missing or ambiguous requirements
- Backfill selection is underspecified (“all currently-positive unassigned leads”):
  - which exact criteria define the set (sentimentTag only vs additional filters like status, lastInboundAt recency, excludes blacklisted/OOO)?
  - should backfill assign *all* eligible leads regardless of age, or apply a recency limit (e.g., only leads with recent inbound)?

### Repo mismatches (fix the plan)
- `ClientMember` has **no** `email` column → do not `select: { email: true }` in Prisma; use Supabase Admin lookup when emails are needed for display/logging.
- There is no `clientId_userId` unique on `ClientMember` → role resolution must use `findFirst`/`findMany` (or add a helper that handles multi-role precedence).

### Performance / timeouts
- Round-robin assignment adds extra DB work to background jobs; keep it bounded:
  - avoid extra roundtrips per message when possible
  - keep assignment logic lightweight (no external calls in the post-process path)

### Security / permissions
- Ensure inbox-only SETTER restrictions apply consistently:
  - inbox list queries
  - inbox counts/badges

### Testing / validation
- Add explicit validations beyond “setter inbox looks right”:
  - concurrency/idempotency: multiple retries of the same background job must not reassign or drift the pointer
  - inbox filtering: SETTER only sees leads where `assignedToUserId === userId`

### Multi-agent coordination
- Phase 42 touches `prisma/schema.prisma`, `actions/lead-actions.ts`, and `lib/workspace-access.ts` in the current working tree → Phase 43 should be implemented on a clean/merged base to avoid schema drift and access-control regressions.

## Decisions Locked (User Confirmed)

- [x] Setter rotation order: Vanessa → David → Jon
  - Implementation: create memberships in that order and compute ordering by `ClientMember.createdAt ASC`.
- [x] Backfill semantics: assign **all currently-positive unassigned leads** (no explicit limit)
- [x] Restriction scope: inbox-only (filter inbox list/counts; do not enforce global lead-detail/CRM access restrictions)

## Assumptions (Agent)

- Assumption: “Positive engagement” means `POSITIVE_SENTIMENTS` from `lib/sentiment-shared.ts` (confidence ~95%).
  - Mitigation check: confirm stakeholders do not want “Meeting Booked” to also trigger assignment.
- Assumption: If a user has multiple roles in the same workspace (possible due to `@@unique([clientId, userId, role])`), the effective role precedence is OWNER > ADMIN > INBOX_MANAGER > SETTER (confidence ~90%).
  - Mitigation check: confirm no users are intentionally dual-role (e.g., SETTER + ADMIN) and how they should be treated for filtering.

## Subphase Index

* a — Schema changes (Lead + WorkspaceSettings fields)
* b — Setter account creation + round-robin enable
* c — Lead assignment logic (`lib/lead-assignment.ts`)
* d — Background job integration (5 post-processors)
* e — Inbox filtering for SETTER role
* f — Per-setter funnel analytics + verification
* g — Hardening + repo mismatch fixes (role resolution, concurrency/idempotency, backfill safety) (RED TEAM)

## Phase Summary

- Shipped (repo evidence):
  - Schema fields exist in `prisma/schema.prisma` (`Lead.assignedToUserId`, `Lead.assignedAt`, `WorkspaceSettings.roundRobinEnabled`, `WorkspaceSettings.roundRobinLastSetterIndex`).
  - Inbox filtering code exists in `actions/lead-actions.ts` and role helpers exist in `lib/workspace-access.ts`.
  - Background-job assignment hooks + setter funnel analytics are present in the working tree (see `docs/planning/phase-43/review.md`).
- Verified (combined working tree state, 2026-01-19):
  - `npm run lint`: pass (0 errors, 17 warnings)
  - `npm run build`: pass
- Notes:
  - Some Phase 43 implementation artifacts are currently uncommitted/untracked (notably `lib/lead-assignment.ts`), so a clean checkout may fail until those are committed.
  - This working tree also includes unrelated Phase 40 Crawl4AI deployment changes; lint/build results are for the combined state.
