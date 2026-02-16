# Phase 153 — Fix Workspace Switch Inbox Layout + Stuck Loading (Messaging Window)

## Purpose
Fix the Master Inbox UI regression where switching workspaces can (1) break the left→right inbox layout into a top→bottom stack and (2) leave the message pane stuck on a loading spinner until a full refresh.

## Context
**Jam:** `58b1a311-85a0-4246-98af-3f378c148198` (recorded 2026-02-16)

**Observed behavior (from Jam):**
1. In Master Inbox, select a workspace with no conversations → empty state appears too high (not vertically centered).
2. Switch to another workspace with conversations → the conversation list renders, but the messaging window is blank with a loading spinner, and the layout stacks vertically (feed on top, messaging below).
3. Refresh → the selected workspace loads correctly and layout returns to normal.

**Primary hypotheses (grounded in current code):**
- `components/dashboard/inbox-view.tsx` renders `ConversationFeed` + `ActionStation` without a shared flex container (returns a fragment). This allows them to stack vertically and prevents empty/error states from vertically centering reliably.
- `InboxView.fetchActiveConversation()` uses a request id (`activeConversationRequestRef`) to ignore stale async results. Background refreshes can supersede an in-flight “foreground” load, preventing the foreground request from clearing `isLoadingMessages`, leaving the spinner stuck until refresh.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 152 | Recent/tracked | `components/dashboard/inbox-view.tsx` workspace-switch effects | Preserve Phase 152 render-loop protections; do not reintroduce unstable state updates on workspace switch. |
| Phase 149 | Recent/tracked | `components/dashboard/inbox-view.tsx`, `components/dashboard/dashboard-shell.tsx` | Preserve Phase 149 loop guards and transition/idempotency patterns. |
| Phase 144 | Recent/tracked | Dashboard surface performance work | Keep the fix minimal and avoid undoing performance wins (polling/refetch cadence and rerender guards). |

## Objectives
* [x] Restore stable side-by-side desktop layout for ConversationFeed + ActionStation across workspace switches.
* [x] Fix stuck message-spinner behavior after switching workspaces (no refresh required).
* [x] Vertically center empty/error/loading states in the inbox content area.
* [x] Persist manual workspace selection in the URL via `?clientId=...` so refresh/back/forward restores workspace.
* [ ] Validate with required quality gates and manual repro steps.

## Constraints
- Keep the fix minimal and localized to dashboard client surfaces.
- Do not regress Phase 149/152 render-loop hardening (avoid unnecessary state churn, prefer functional setter bail-outs).
- Do not touch backend ingestion, follow-up engine, or Prisma schema.
- Do not log or write any secrets/PII into the repo.

## Success Criteria
- Desktop layout remains left-to-right after workspace switch (no stacked feed/message panes).
- Switching from an empty workspace → populated workspace loads the first conversation and message pane successfully without refresh.
- Message pane never remains stuck in `isLoadingMessages=true` after a workspace switch.
- Empty/error/loading states are vertically centered in the available inbox area.
- Workspace selection persists in URL using `clientId` on manual workspace change.
- Required gates run and pass:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
- Required AI/message validation gates (NTTAN):
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
  - Recommendation: use `<clientId>` for the workspace used to reproduce Jam `58b1a311` (a workspace with inbox activity).

## Repo Reality Check (RED TEAM)
- What exists today:
  - `components/dashboard/inbox-view.tsx` now renders all paths inside a shared `relative flex h-full min-h-0 w-full overflow-hidden` wrapper.
  - `fetchActiveConversation()` now contains explicit foreground-vs-background request guards (`activeConversationRequestLeadRef`, `activeConversationIdRef`, `isLoadingMessagesRef`).
  - `components/dashboard/dashboard-shell.tsx` now updates URL query state on manual workspace changes using `router.replace`.
- What the plan assumed:
  - Missing shared flex wrapper caused stacked panes and poor empty-state centering.
  - Background fetches could supersede foreground message loads and wedge spinner state.
  - Manual workspace changes were not persisted into URL.
- Verified touch points:
  - `components/dashboard/inbox-view.tsx` (`InboxView`, `fetchActiveConversation`, `isLoadingMessages` handling).
  - `components/dashboard/dashboard-shell.tsx` (`handleWorkspaceChange`, `clientId` URL behavior).

## RED TEAM Findings (Gaps / Weak Spots)
### Highest-risk failure modes
- Manual browser repro is still required to close layout/spinner behavior under real interaction timing.
  - Mitigation: run the Jam-mirroring checklist in Phase 153d on deployed UI.

### Missing or ambiguous requirements
- Replay client selection for this UI bug is not explicitly tied to a known workspace ID in the repo.
  - Mitigation: current default uses known active client `779e97c3-e7bd-4c1a-9c46-fe54310ae71f`; adjust when Jam workspace ID is confirmed.
- A new `docs/planning/phase-154` directory appeared during this run with no files yet.
  - Mitigation: if `phase-154` adds dashboard files later, perform semantic merge check before shipping.

### Performance / timeouts
- AI replay is currently blocked at preflight due DB connectivity (`db.pzaptpgrcezknnsfytob.supabase.co` unreachable).
  - Mitigation: keep phase partially open for environment rerun; artifact evidence captured in `.artifacts/ai-replay`.

### Testing / validation
- `lint`, `typecheck`, `build`, `test`, and `test:ai-drafts` are passing.
- NTTAN replay commands executed but blocked by DB connectivity; failure details and artifacts are recorded.

## Assumptions (Agent)
- The root cause for stacked panes/centering is the missing shared `InboxView` layout container (confidence ~95%).
- Preventing silent/background refresh from superseding foreground loads removes the stuck spinner race (confidence ~90%).
- `clientId` is the canonical URL key for workspace persistence in dashboard deep-link flows (confidence ~95%).
- Current `phase-154` has no `plan.md` or subphase files, so no file overlap with Phase 153 is present right now (confidence ~95%).

## Open Questions (Need Human Input)
- [ ] Can you run the Jam `58b1a311` reproduction path on the deployed app to confirm the layout + spinner issue is fully resolved?
  - Why it matters: this is the final acceptance check for the user-visible regression.
  - Current assumption in this plan: code changes are sufficient, but runtime confirmation is still pending.

- [ ] Which workspace `clientId` should be used for rerunning replay once DB connectivity is restored?
  - Why it matters: NTTAN replay evidence should match the workspace used to reproduce this issue.
  - Current assumption in this plan: `779e97c3-e7bd-4c1a-9c46-fe54310ae71f` (known active client from existing phase docs).


## Subphase Index
* a — InboxView Layout Container + Empty-State Centering
* b — Fix InboxView Message-Load Concurrency (Spinner Stuck)
* c — Persist Workspace Selection in URL (`clientId`)
* d — Validation + Manual Jam Repro Checklist

## Phase Summary (running)
- 2026-02-16 04:05:47Z — Implemented subphases 153a/153b/153c: shared `InboxView` layout wrapper + centered early states, foreground-authoritative message-fetch guards, and workspace URL persistence via `clientId` (files: `components/dashboard/inbox-view.tsx`, `components/dashboard/dashboard-shell.tsx`).
- 2026-02-16 04:05:47Z — Ran validation gates: `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:ai-drafts` passed. Replay commands executed but blocked by DB preflight connectivity; artifacts captured at `.artifacts/ai-replay/run-2026-02-16T04-05-03-442Z.json` and `.artifacts/ai-replay/run-2026-02-16T04-05-08-072Z.json`.
