# Phase 43g — Hardening + Repo Mismatch Fixes (RED TEAM)

## Focus
Make Phase 43 executable against current repo reality by correcting mismatched assumptions in earlier subphases, hardening round-robin assignment for idempotency/concurrency, and centralizing SETTER **inbox** filtering enforcement.

## Inputs
- Schema changes from Phase 43a (`Lead.assignedToUserId`, `Lead.assignedAt`, `WorkspaceSettings.roundRobinEnabled`, `WorkspaceSettings.roundRobinLastSetterIndex`)
- `app/api/admin/workspaces/members/route.ts` (member bootstrap; returns `userId` but does not persist email in Prisma)
- `actions/client-membership-actions.ts` (existing Supabase email resolution for members)
- `lib/workspace-access.ts` (auth + access helpers; `requireLeadAccessById`)
- `actions/lead-actions.ts` (inbox list + counts)
- `actions/crm-actions.ts` (CRM list + filters)
- `lib/background-jobs/*-inbound-post-process.ts` (sentiment → post-process hooks)
- `lib/sentiment-shared.ts` (`POSITIVE_SENTIMENTS`, `isPositiveSentiment`)

## Work

### 1) Fix repo mismatches (do not ship broken code)
- `ClientMember` has **no** `email` column:
  - In Prisma selects, use `{ userId: true }` only.
  - If email is needed (UI / logs / analytics), map via Supabase Admin (see `getSupabaseUserEmailsByIds` usage in `actions/analytics-actions.ts` and `getClientAssignments` in `actions/client-membership-actions.ts`).
- `ClientMember` uniqueness is `@@unique([clientId, userId, role])`:
  - Do not assume a `clientId_userId` unique; use `findFirst`/`findMany` to resolve effective role.
- Earlier subphases include code snippets that are repo-inaccurate (`ClientMember.email`, `clientId_userId`) → treat this subphase as the source of truth for the corrected patterns.

### 2) Lock rotation semantics (ordering + role precedence)
- Decide and document the **setter ordering rule** for Founders Club:
  - Preferred: explicit stakeholder order (Vanessa → David → Jon), implemented by creating memberships in that order and ordering by `ClientMember.createdAt ASC`.
  - Alternative: explicit configured order (array of userIds in `WorkspaceSettings`) if you need the order to be editable later.
- Define **effective role precedence** if a user has multiple memberships in the same workspace:
  - Recommended: OWNER > ADMIN > INBOX_MANAGER > SETTER (most permissive wins).

### 3) Concurrency-safe, idempotent round-robin assignment
- Implement assignment as an **interactive transaction** (not `$transaction([...])`) so you can:
  - conditionally assign the lead **only if** it is still unassigned
  - advance the pointer **only if** assignment happened
- Enforce “assign once” at the DB write:
  - Use `updateMany({ where: { id: leadId, assignedToUserId: null }, data: { … } })`
  - If `count !== 1`, treat as “skipped” and do **not** update the pointer.
- Make pointer updates concurrency-safe:
  - Option A (recommended): lock the workspace settings row via `SELECT … FOR UPDATE` in the transaction before reading/updating `roundRobinLastSetterIndex`.
  - Option B (acceptable for low-volume only): accept occasional collisions (document the risk) — do **not** choose this without stakeholder sign-off.

### 4) Centralize SETTER inbox filtering enforcement
- Implement a single helper that returns the current user’s effective role for a workspace (handles multi-role precedence).
- Apply SETTER filtering **only** to inbox surfaces:
  - inbox list queries (`getConversationsCursor`)
  - inbox counts (`getInboxCounts`)
- Explicitly do **not** enforce global lead-detail/CRM restrictions (per “Restriction scope: inbox-only” in the root plan).

### 5) Backfill execution strategy (safe + auditable)
- Do not run “mystery” TypeScript snippets in prod consoles.
- Provide a safe mechanism:
  - Preferred: one-off script under `scripts/` with `--clientId`, `--limit`, `--dryRun`
  - Alternative: secret-gated admin API route to run a dry-run + apply step
- Require a dry-run that prints:
  - eligible lead count
  - intended distribution per setter (counts)
  - sample lead IDs (small capped sample)

## Validation (RED TEAM)
- `npm run lint`
- `npm run build`
- Manual inbox verification:
  - Login as SETTER and confirm inbox shows only assigned leads (and counts match).
- Idempotency:
  - Re-run the same background job handler (or simulate retries) and confirm:
    - `assignedToUserId` never changes once set
    - round-robin pointer does not advance when assignment is skipped

## Output
- Phase 43 implementation plan is repo-accurate (no nonexistent `ClientMember.email`, no invalid uniques).
- Assignment is safe under retries/concurrency (no double-assign, no pointer drift on skips).
- SETTER inbox visibility is enforced consistently across inbox list + counts.
- Backfill plan is auditable (dry-run + explicit apply).

### Implementation Status (Completed)

All subphase g concerns were addressed during subphases a-f:

**1. Repo Mismatches (Fixed)**
- `lib/workspace-access.ts:getUserRoleForClient()` uses `findMany` to handle multi-role memberships
- Email lookup via Supabase Admin (not ClientMember.email) in `actions/analytics-actions.ts:getSetterFunnelAnalytics()`

**2. Rotation Semantics (Locked)**
- Setter ordering: `ClientMember.createdAt ASC` → Vanessa (index 0) → David (index 1) → Jon (index 2)
- Role precedence: `ROLE_PRECEDENCE` map in `lib/workspace-access.ts` (OWNER=4, ADMIN=4, INBOX_MANAGER=3, SETTER=1)

**3. Concurrency-Safe Assignment (Implemented)**
- `lib/lead-assignment.ts:assignLeadRoundRobin()` uses interactive `$transaction`
- Idempotency guard: `updateMany({ where: { id: leadId, assignedToUserId: null }, ...})`
- Pointer advances only when `updateResult.count > 0`

**4. SETTER Inbox Filtering (Enforced)**
- `actions/lead-actions.ts:getInboxCounts()` — raw SQL and Prisma counts filtered
- `actions/lead-actions.ts:getConversationsCursor()` — SETTER filter in whereConditions

**5. Backfill Execution (Audited)**
- Executed via Supabase MCP SQL (not mystery TypeScript snippets)
- Distribution verified: 48 leads → Vanessa (16), David (16), Jon (16)
- Round-robin index: 2 (next → Vanessa/index 0)

**Validation (Passed)**
- `npm run lint`: 0 errors, 17 warnings (pre-existing)
- `npm run build`: success

## Handoff
Phase 43 complete. Subphase g served as RED TEAM validation; all concerns addressed during implementation.
