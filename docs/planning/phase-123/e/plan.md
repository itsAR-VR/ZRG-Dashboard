# Phase 123e — Gated Long-Term Memory + Pruning + Tests + Rollout/Docs

## Focus
Add a safe pathway for agents to propose long-term memory updates (Lead memory / workspace playbook signals) without uncontrolled writes, implement artifact pruning, complete quality gates, and document operational knobs.

## Inputs
- Phase 123d loop implementation and per-iteration artifacts
- Existing persistent memory:
  - `LeadMemoryEntry` model + actions (`actions/lead-memory-actions.ts`)
  - `LeadMemorySource` enum: `MANUAL`, `SYSTEM`, `INFERENCE`
  - LeadContextBundle redaction rules (`lib/lead-context-bundle.ts`, `lib/lead-memory-context.ts`)
  - `computeLeadMemoryExpiryDate()` in `lib/lead-memory-context.ts` (90-day default)

## Work

### 1. Memory proposal type definition
In `lib/draft-pipeline/types.ts`:
```ts
type MemoryProposal = {
  category: string;        // e.g., "timezone_preference", "scheduling_preference", "objection"
  content: string;         // the proposed fact (max 500 chars)
  ttlDays: number;         // required, proposal must have an expiry
  confidence: number;      // 0-1, how confident the agent is in this fact
}
```

### 2. Safe auto-approve category allowlist
Categories that overseer can auto-approve (TTL still required):
- `timezone_preference`
- `scheduling_preference`
- `communication_preference`
- `availability_pattern`

All other categories → `status=PENDING` (for future human review UI).

### 3. Extend revision agent and overseer outputs
- Revision agent output schema gains `memory_proposals: MemoryProposal[]` (optional, defaults to `[]`)
- Overseer gate output schema gains `memory_proposals: MemoryProposal[]` (optional, defaults to `[]`)
- Overseer approval logic: for each proposal, check if category is in safe allowlist AND ttlDays > 0 AND confidence >= 0.7 → auto-approve

### 4. LeadMemoryEntry status field
Add to `prisma/schema.prisma`:
```prisma
// On LeadMemoryEntry:
status  String  @default("APPROVED")  // "APPROVED" | "PENDING"
```
Nullable with default (safe for existing rows which are all effectively "APPROVED").

Add index: `@@index([status])` for querying pending proposals.

### 5. Apply approved proposals
For auto-approved proposals:
```ts
prisma.leadMemoryEntry.createMany({
  data: proposals.map(p => ({
    clientId,
    leadId,
    category: p.category,
    content: p.content,
    source: "INFERENCE",
    status: "APPROVED",
    expiresAt: computeLeadMemoryExpiryDate(p.ttlDays),
  })),
  skipDuplicates: true  // dedup on (leadId, category, content)
})
```

For pending proposals:
```ts
prisma.leadMemoryEntry.createMany({
  data: proposals.map(p => ({
    clientId,
    leadId,
    category: p.category,
    content: p.content,
    source: "INFERENCE",
    status: "PENDING",
    expiresAt: computeLeadMemoryExpiryDate(p.ttlDays),
  })),
  skipDuplicates: true
})
```

### 6. Deduplication
Before inserting, check `(leadId, category, content, source)`:
- Use `skipDuplicates: true` on `createMany`
- OR add a compound unique index if stronger guarantees needed: `@@unique([leadId, category, content, source])` (consider content length — may need a hash)
- Recommendation: use `skipDuplicates` and add a pre-check query for exact matches

### 7. Persist proposals as artifacts
Regardless of approval status, persist all proposals as `DraftPipelineArtifact`:
- Stage: `memory_proposal`
- Iteration: the loop iteration that produced them
- Payload: `{ proposals: MemoryProposal[], approvedCount: number, pendingCount: number }`
This provides observability even for dropped/pending proposals.

### 8. DraftPipelineRun pruning
Piggyback on `/api/cron/background-jobs`:
- After processing jobs, if remaining time > 10s, run pruning:
  ```sql
  DELETE FROM "DraftPipelineRun"
  WHERE "createdAt" < NOW() - INTERVAL '30 days'
  LIMIT 500
  ```
- Artifacts cascade via `onDelete: Cascade` on the relation
- Env var: `DRAFT_PIPELINE_RUN_RETENTION_DAYS` (default 30)
- Run at most once per cron invocation (use a flag to avoid re-running on concurrent invocations)

### 9. LeadMemoryEntry expired entry cleanup
Extend existing memory cleanup (if any) or add to the pruning step:
- Delete `LeadMemoryEntry` where `expiresAt < NOW()` AND `source = 'INFERENCE'`
- Batch: 500 rows per invocation

### 10. Testing and validation
#### Unit tests:
- Memory proposal gating: safe categories auto-approved, others pending
- TTL: proposals without TTL (ttlDays <= 0) are rejected
- Confidence threshold: proposals with confidence < 0.7 are pending
- Deduplication: duplicate proposals don't create duplicate entries
- Pruning: runs/artifacts older than retention period are deleted

#### Integration tests:
- End-to-end: low-confidence email draft → loop runs → proposals generated → approved ones in LeadMemoryEntry with status=APPROVED
- Pending proposals: unsafe category → status=PENDING in LeadMemoryEntry

#### Quality gates:
- `npm test` — all tests pass
- `npm run lint` — clean
- `npm run build` — succeeds

### 11. Documentation
Update the following:
- `CLAUDE.md` env vars section: add new env vars
  - `AUTO_SEND_REVISION_LOOP_TIMEOUT_MS` (default 60000)
  - `AUTO_SEND_REVISION_LOOP_MAX_OUTPUT_TOKENS` (default 20000)
  - `DRAFT_PIPELINE_RUN_RETENTION_DAYS` (default 30)
- Document workspace settings knobs:
  - `autoSendRevisionModel` (default "gpt-5.2")
  - `autoSendRevisionReasoningEffort` (default "high")
  - `autoSendRevisionMaxIterations` (default 3)
- Document the revision loop architecture in `lib/auto-send/README.md`

## Validation (RED TEAM)
- All unit and integration tests pass
- `npm run db:push` succeeds with LeadMemoryEntry status field
- Verify in Prisma Studio: LeadMemoryEntry rows have `status` field with default "APPROVED"
- Verify pruning: insert test runs older than 30 days, run cron, confirm deletion
- `npm test` + `npm run lint` + `npm run build` all pass
- Manual test: verify loop with memory proposals → check LeadMemoryEntry for approved/pending rows

## Expected Output
- Memory proposals exist and can be safely persisted only when approved, with TTL and provenance.
- Pending proposals are preserved for future human review UI.
- DraftPipelineRun pruning keeps the table bounded.
- Full suite passes (test/lint/build).
- Operational knobs are documented.

## Expected Handoff
If UI approval is required, open a follow-up phase to add an admin review surface for pending memory proposals (out of Phase 123 scope).
If SMS/LinkedIn revision loop is desired, open a follow-up phase to remove the channel gate.

## Output
Deferred. The user request for Phase 123 was satisfied by:
- Run-scoped, cross-agent context via `DraftPipelineRun` + `DraftPipelineArtifact` (Phase 123a/123b).
- A weighted revision context pack injected into the revision agent (Phase 123c).
- A bounded evaluator↔revision loop (max 3 iterations) that increases confidence (Phase 123d).

Long-term memory proposals (`LeadMemoryEntry` writes with approval workflow) and pruning/retention are valuable, but materially expand scope (new schema column `LeadMemoryEntry.status`, new prompt outputs, and an approval surface).

If/when we pursue this, it should be its own focused phase to avoid mixing “revision-loop correctness” with “memory-write governance”.

## Handoff
If we want this next, create a dedicated phase plan:
- Scope: add `LeadMemoryEntry.status`, add revision/overseer `memory_proposals` output schema, auto-approve allowlist + TTL enforcement, and implement pruning via cron.
- Success: fully tested + documented + (optionally) an admin UI to review pending proposals.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Marked Phase 123e as deferred; core Phase 123 objectives were completed in 123a–123d.
- Commands run:
  - None (planning-only updates)
- Blockers:
  - None
- Next concrete steps:
  - If desired, spin out Phase 127 for gated long-term memory proposals + retention/pruning.
