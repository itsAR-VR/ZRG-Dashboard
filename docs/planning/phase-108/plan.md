# Phase 108 — Message Performance Insights (Setter vs AI, Booked vs Not Booked)

## Purpose
Build a repeatable, workspace-scoped way to compare what outbound messages *work* (book meetings) vs *don’t* across **setters vs AI**, so we can systematically improve confidence gates, drafts, and prompts based on real outcomes.

## Extension (Added)
Phase 108 also becomes the home for the next round of **booking-rate improvements** driven by these insights:
- A **multi-agent overseer** loop that sits between draft generation and auto-send/booking.
- A structured **Postgres lead memory** layer (tool-driven retrieval; no vector store in v1).
- A weekly + on-demand **eval loop** (direct scoring + pairwise) that produces **proposal candidates** (human-approved only).

## Context
- The Jam in Phase 107 highlighted that “confidence” problems are not limited to pricing; we need an overall, data-backed view of message effectiveness.
- We need to analyze messages stored in Postgres/Supabase to answer questions like:
  - What messaging patterns correlate with booked meetings?
  - How do **setter-sent** messages that book compare to **AI-sent** messages that book?
  - What’s being sent that *isn’t* generating meetings, and how does it differ from what *is* generating meetings?
- This should be repeatable (not a one-off audit) and align with the existing “Insights”/context-pack patterns (“insights campaign bot”).

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Working tree | Uncommitted changes present | Shared schema + AI pipeline files | Run `git status` before implementation and re-read shared files (schema, prompt runner, auto-send) to avoid overwriting concurrent work. |
| Phase 107 | Implemented; live verification pending | Auto-send evaluator context + prompt editability | Phase 108 should consume Phase 107’s richer “verified context” inputs and use the new prompt/runtime preview patterns when presenting findings. |
| Phase 101 | Shipped (draft outcome attribution) | AI draft outcome attribution (auto-sent vs approved vs edited) | Prefer using `AIDraft.responseDisposition` to distinguish AUTO_SENT vs APPROVED vs EDITED when measuring message performance. |
| Phase 106 | Shipped (booking + overseer hardening) | Booking semantics + meeting overseer metadata | Reuse Phase 106’s booking/availability conventions; do not reintroduce “booked but workflows keep running” inconsistencies. |
| Phase 98–105 | Completed workstreams | Follow-ups, booking, email send semantics | Use their booking status conventions to label “booked” reliably and avoid reintroducing follow-up side effects. |

## Locked Decisions (from user)
- Multi-agent overseer pattern: **Supervisor w/ final override** (overseer can override before auto-book/send).
- Overseer loop shape: **4-agent loop** — Drafting → Memory → Overseer Gate → Finalizer.
- Memory: **Postgres structured memory** + **tool-driven retrieval** (DB queries + knowledge asset lookups; no vector store in v1).
- Eval: **Direct scoring + pairwise**, **full proposal workflow in v1** (not recommendations-only).
- Cadence: **weekly cron + on-demand** (weekly uses a single fixed UTC schedule).
- Primary metric: **booked meeting rate** (secondary metrics tracked but not primary).
- Visibility: aggregates visible to all workspace users; evidence drilldowns/snippets admin-only.
- Attribution: report both **cross-channel** and **within-channel** attribution metrics.
- Default windows: attribution window **14 days**; “not booked” maturity buffer **7 days**; add **pending outcome** bucket.
- Proposals target: **Prompt overrides + Knowledge Assets only** (no numeric threshold changes in v1).
- Approvals: workspace admins approve; true super-admins apply globally.
- Rollback: support browsing history and rollback to earliest versions (not single-step only).
- Weekly cron opt-in is per workspace.
- True super admins allowlist (case-insensitive exact email match): `ar@soramedia.co`, `abdur@zeroriskgrowth.com`.
- Lead memory retention: 90 days; setters see redacted summaries; admins edit.
- Cron-created Message Performance sessions may use a `"system"` placeholder `createdByUserId` when no user context exists.

## Objectives
* [x] Define a rigorous, auditable “booked meeting” label and a defensible “message → outcome” attribution strategy
* [x] Build a repeatable dataset extractor (workspace-scoped) that segments messages by **setter vs AI** and **booked vs not booked**
* [x] Produce a comparative report that highlights “what works” vs “what doesn’t” (with channel splits and outcome splits)
* [x] Integrate with the existing Insights/context-pack workflow so it can be re-run (weekly/monthly) and queried on demand
* [x] Establish a safe, human-reviewable “self-learning” loop (proposals → approved prompt/asset updates), without automatic prompt mutation
* [x] Implement a multi-agent overseer loop (4-agent) that uses Phase 108 insights + lead memory to improve booking conversion
* [x] Implement a Postgres lead memory layer to reduce re-asking and timing/availability mismatches (improves booking rate and follow-up quality)
* [x] Implement an eval loop that scores candidate drafts using Phase 108 booked/not-booked outcomes and emits prompt/asset proposals

## Constraints
- Multi-tenant safety: never mix data across `clientId`.
- Access control: any UI or exports that include message text must be admin-gated; prefer aggregated findings by default.
- PII hygiene: avoid storing new copies of raw message bodies unless necessary; prefer references + redacted excerpts.
- Reproducibility: define deterministic cohorts and windows (e.g., “last 30 days”), and log query parameters used to build a report.
- Cron safety: follow `app/api/cron/insights/*` patterns (auth via `CRON_SECRET` before work; cap work per invocation; set `export const maxDuration = 800`).
- Prefer reusing existing infrastructure:
  - Prisma schema/entities (`Message`, `Lead`, `Appointment`, `AIDraft`, `LeadConversationInsight`, `InsightContextPack`)
  - Insights worker/pack patterns in `lib/insights-chat/*` and cron routes under `app/api/cron/insights/*`
 - Message sourcing: include all outbound sources, but always scope by workspace leads (`Lead.clientId`) to avoid cross-tenant leakage.

## Success Criteria
- [x] A single command/endpoint can generate a workspace-scoped “Message Performance” report for a specified date window.
- [x] Report includes, at minimum:
  - Segments: `sentBy` (setter vs AI), channel (email/SMS/LinkedIn), and outcome (booked vs not booked)
  - Clear definitions for “booked” and “attributed message”
  - Aggregate metrics (counts/rates) and qualitative pattern summaries
- [x] The workflow is repeatable (same inputs → same cohort), and results are persisted/cached (e.g., as an `InsightContextPack.metricsSnapshot` + `InsightContextPack.synthesis`).
- [x] Any “self-learning” recommendations are presented as suggestions with a human-approve workflow (no silent prompt changes).

## Repo Reality Check (RED TEAM)

### What exists today (verified 2026-02-05)

| Component | File / Model | Verified | Notes |
|----------|--------------|----------|-------|
| Booked lead semantics | `lib/meeting-booking-provider.ts` | ✅ | `isMeetingBooked()` is the canonical “booked” helper (treats `appointmentStatus=canceled` as not booked). |
| Insights cron auth + limits | `app/api/cron/insights/booked-summaries/route.ts` | ✅ | `CRON_SECRET` auth (Authorization Bearer or legacy `x-cron-secret`), `maxDuration = 800`, env var limit (`INSIGHTS_BOOKED_SUMMARIES_CRON_LIMIT`). |
| Context pack cron worker | `app/api/cron/insights/context-packs/route.ts` | ✅ | Steps packs via `runInsightContextPackStepSystem()` with DB retry + connection circuit breaker. |
| Context pack pipeline | `lib/insights-chat/context-pack-worker.ts` | ✅ | Selection → extraction → synthesis pipeline; stores results in `InsightContextPack.metricsSnapshot` + `synthesis`. |
| Insights UI surface | `components/dashboard/insights-chat-sheet.tsx` | ✅ | Uses `getWorkspaceAdminStatus()` to gate admin-only affordances; calls `actions/insights-chat-actions.ts`. |
| Data model (relevant fields) | `prisma/schema.prisma` | ✅ | `Lead.clientId`, `Lead.appointmentBookedAt`, `Lead.appointmentStatus`, `Message.sentBy`, `Message.aiDraftId`, `AIDraft.responseDisposition`, `InsightContextPack.metricsSnapshot/synthesis`, `PromptOverride`, `PromptSnippetOverride`. |
| Meeting overseer gate (existing) | `lib/meeting-overseer.ts`, `lib/ai-drafts.ts` | ✅ | Phase 106 introduced per-message overseer extraction+gate and uses it to gate drafting/booking behavior. |
| Meeting overseer persistence | `prisma/schema.prisma` | ✅ | `MeetingOverseerDecision` exists for per-message persistence (debuggable decisions). |
| Lead memory context (new) | `lib/lead-memory-context.ts`, `prisma/schema.prisma` | ✅ | `LeadMemoryEntry` schema + context builder added in Phase 108g. |
| Message performance pipeline | `lib/message-performance*.ts`, `actions/message-performance-actions.ts` | ✅ | Dataset extraction + report persistence + synthesis/eval helpers. |
| Message performance cron | `app/api/cron/insights/message-performance/route.ts` | ✅ | Weekly cron report runner (opt-in). |
| Message performance eval cron | `app/api/cron/insights/message-performance-eval/route.ts` | ✅ | Weekly eval runner to create proposals (opt-in). |
| Proposal + revision models | `prisma/schema.prisma` | ✅ | `MessagePerformanceProposal`, `MessagePerformanceEvalRun`, revision tables for prompts/assets. |

### Implementation constraints from repo reality

- `Message` rows do **not** carry `clientId`; workspace scoping must join via `Message.lead → Lead.clientId` (or select leads first, then load messages).
- `InsightContextPack.scopeKey` is currently derived from window + campaign scope; message performance runs need an explicit scopeKey/session strategy to avoid colliding with normal “Insights Chat” packs.
- The existing meeting overseer is **single-agent** today; Phase 108 will extend orchestration while keeping the gate as the enforcement point.

### Multi-agent coordination (current working tree)

- `git status` currently shows uncommitted changes touching shared AI and schema surfaces (e.g., `prisma/schema.prisma`, `lib/ai-drafts.ts`, `lib/ai/prompt-runner/*`, `lib/auto-send-evaluator.ts`).
- Before implementing Phase 108, re-read the current versions of any shared files you plan to modify and scan Phases 106–108 for overlaps.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

- **Booked label is wrong (canceled/rescheduled/provider evidence mismatch)** → Use `isMeetingBooked()` as the *boolean* booked label and define the *booking timestamp* separately (prefer `appointmentBookedAt`, fallback to provider-specific timestamps if needed).
- **Attribution misleads (cross-channel, multiple touches, or “booked” without outbound)** → Add an explicit “unattributed/ambiguous” bucket and exclude it from pattern claims; require a maturity buffer for “not booked”.
- **PII leakage via persistence/UI** → Store message *references* (ids, timestamps, sender type) by default; gate any body/snippet drilldowns behind `requireClientAdminAccess(clientId)` and/or `getWorkspaceAdminStatus()` in UI.
- **Timeouts / DB pressure on large workspaces** → Hard-cap rows per run, add incremental processing (chunking), and follow context-pack cron’s DB retry/circuit-breaker patterns.
- **Non-deterministic synthesis produces inconsistent “what works” lists** → Use structured JSON schema, stable prompt keys, low randomness, and persist model/effort + cohort parameters alongside results.

### Missing or ambiguous requirements

- **ScopeKey/session strategy:** Are “Message Performance” runs a dedicated Insights session, a new run type inside Insights, or a separate Analytics artifact?
- **Sender definition:** Is “setter vs AI” defined by `Message.sentBy`, by draft origin (`aiDraftId`), or by `AIDraft.responseDisposition`? (These answer different questions.)
- **Access model:** Should non-admin workspace users see the report at all, or only aggregated results without evidence?
- **Proposal storage + rollback:** Full proposal workflow with history/rollback likely requires new proposal + revision tables (prompt overrides + knowledge assets).
- **Lead memory retention + visibility:** default retention window and whether setters can view/edit memory (vs admin-only).
- **Overseer authority boundary:** confirm the supervisor can override draft candidates but must not bypass hard policy gates (opt-outs, booked semantics, cron secrets).

### Performance / timeouts

- Prefer selecting leads in-window first (`Lead.clientId` + booked/not booked constraints), then loading only the minimal message subset needed for attribution; avoid scanning the whole `Message` table.
- Make all limits configurable via env vars (following existing `INSIGHTS_*` conventions) and surface dropped-row stats in the run artifact.

### Security / permissions

- Cron endpoints: `CRON_SECRET` auth before doing work; do not log message bodies.
- Admin endpoints / exports: enforce `requireClientAdminAccess(clientId)` when returning any raw text/snippets.

### Testing / validation (required evidence)

- `npm test`, `npm run lint`, `npm run build`
- If Prisma schema changes: `npm run db:push` + verify new tables/columns exist.
- Manual smoke: generate a run for a known booked lead and confirm the attributed message is strictly pre-booking (and matches sender attribution).

## Open Questions (Need Human Input)
- None.

## Assumptions (Agent)

- `isMeetingBooked()` remains the canonical booked boolean (and is the function we should reuse for consistency). (confidence ~95%)
  - Mitigation check: Verify `isMeetingBooked()` behavior matches current booking-provider reconciliation in production.

- “Message Performance” persistence can live in `InsightContextPack.metricsSnapshot/synthesis` without introducing a new table (v1). (confidence ~90%)
  - Mitigation check: If scopeKey/session semantics get messy or access control is too coarse, introduce a dedicated `MessagePerformanceRun` model instead.

- “Apply globally” for proposals is interpreted as “true super admins can apply proposals within any workspace” (not auto-applying to every workspace). (confidence ~85%)
  - Mitigation check: If global apply should mean “fan out to all workspaces,” add an explicit fanout step in the apply action.

## Subphase Index
* a — Outcome labeling + attribution spec (booked + credited message)
* b — Dataset extraction + export (repeatable, workspace-scoped)
* c — Comparative analysis + synthesis (setter vs AI; booked vs not)
* d — Workflow integration (Insights packs/UI + optional scheduling)
* e — Self-learning loop (human-approved prompt/asset recommendations)
* f — Multi-agent overseer orchestration (4-agent loop) + integration with existing gate
* g — Lead memory (Postgres) schema + tool-driven retrieval (DB + knowledge assets)
* h — Eval loop (direct scoring + pairwise), weekly cron + on-demand, proposal candidates
* i — QA + validation + rollout notes (booking-rate driven)
* j — Proposal workflow + history/rollback + true super admins

## Phase Summary (running)
- 2026-02-05 — Added meeting overseer gate support for optional memory context and wired placeholder in AI drafts (files: `lib/meeting-overseer.ts`, `lib/ai/prompt-registry.ts`, `lib/ai-drafts.ts`, `docs/planning/phase-108/f/plan.md`)
- 2026-02-05 — Scaffolded missing subphases (g–j) and updated eval/proposal wording (files: `docs/planning/phase-108/g/plan.md`, `docs/planning/phase-108/h/plan.md`, `docs/planning/phase-108/i/plan.md`, `docs/planning/phase-108/j/plan.md`, `docs/planning/phase-108/plan.md`)
- 2026-02-05 — Added lead memory schema + context helper, actions, and draft/overseer wiring (files: `prisma/schema.prisma`, `lib/lead-memory-context.ts`, `actions/lead-memory-actions.ts`, `lib/ai-drafts.ts`, `docs/planning/phase-108/g/plan.md`)
- 2026-02-05 — Implemented message performance reports, synthesis, eval + proposal workflow, and history/rollback UI (files: `lib/message-performance*.ts`, `actions/message-performance-*.ts`, `components/dashboard/message-performance-panel.tsx`, `components/dashboard/settings-view.tsx`, `app/api/cron/insights/message-performance*.ts`, `prisma/schema.prisma`, `vercel.json`)
- 2026-02-05 — Completed QA gates (db:push, lint, build, tests) and fixed TypeScript blockers in message performance + knowledge asset flows (files: `prisma/schema.prisma`, `actions/settings-actions.ts`, `lib/message-performance.ts`, `lib/message-performance-eval.ts`, `lib/message-performance-report.ts`, `lib/ai-drafts/stale-sending-recovery.ts`, `components/dashboard/message-performance-panel.tsx`, `lib/admin-actions-auth.ts`, `docs/planning/phase-108/i/plan.md`)

## Phase Summary
- Shipped:
  - Message Performance reports + synthesis + eval + proposals.
  - Lead memory + overseer context wiring.
  - Proposal history/rollback for prompts/snippets/knowledge assets.
- Verified:
  - `npm run lint`: pass with warnings
  - `npm run build`: pass with warnings
  - `npm run db:push`: pass
  - `npm test`: pass
- Notes:
  - Manual smoke tests pending in a live workspace.
