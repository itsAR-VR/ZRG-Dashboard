# Phase 54 — Review

## Summary
- ✅ Relaxed EmailBison anchor selection implemented (sent-folder preferred → any folder fallback)
- ✅ GHL-assisted discovery integrated and persists `Lead.ghlContactId`
- ✅ On-demand resolution in `processReactivationSendsDue()` for missing anchors
- ✅ Unit tests for tiered selection logic pass
- ✅ All quality gates pass (`npm run lint`, `npm run build`)
- ⏭️ EmailBison "new-thread" sends descoped (provider limitation confirmed)

## What Shipped

### New files
- `lib/reactivation-anchor.ts` — Pure tiered anchor selection helper:
  - `isEmailBisonSentFolder()` — Recognizes sent/outbox/outgoing folders
  - `pickReactivationAnchorFromReplies()` — Tiered selection (sent+campaign → sent → any folder)
- `lib/__tests__/reactivation-anchor.test.ts` — Unit tests for anchor selection

### Modified files
- `lib/reactivation-engine.ts`:
  - `resolveReactivationEnrollmentsDue()` — Uses relaxed anchor selection, DB-first check, GHL-assisted fallback
  - `processReactivationSendsDue()` — On-demand resolution when `anchorReplyId` is missing

## Verification

### Commands
- `npm run lint` — ✅ pass (0 errors, 17 warnings pre-existing) (2026-01-24)
- `npm run build` — ✅ pass (2026-01-24)
- `node --import tsx --test lib/__tests__/reactivation-anchor.test.ts` — ✅ 4 tests pass (2026-01-24)
- `npm run db:push` — ⏭️ skip (no Prisma schema changes in Phase 54)

### Notes
- Lint warnings are pre-existing React hooks warnings, not Phase 54 related
- Build succeeds with all routes generated correctly

## Success Criteria → Evidence

1. **Define the "anchor" contract and the decision rules for anchor selection**
   - Evidence: `lib/reactivation-anchor.ts:22-76` — `pickReactivationAnchorFromReplies()` implements tiered selection
   - Status: ✅ met

2. **Implement deterministic anchor discovery using lead email across DB → EmailBison → GHL-assisted fallbacks**
   - Evidence: `lib/reactivation-engine.ts:420-454` and `:882-910` — GHL-assisted fallback with `searchGHLContactsAdvanced()`
   - Evidence: `lib/reactivation-engine.ts:438-441` and `:896-898` — Persists `Lead.ghlContactId` when discovered
   - Status: ✅ met

3. **~~Implement an anchor creation path when no suitable provider thread exists~~**
   - Evidence: EmailBison API verified to NOT support new-thread sends (only `POST /api/replies/:id/reply`)
   - Status: ⏭️ descoped (documented in plan.md)

4. **Update reactivation sending to re-resolve anchors on-demand with relaxed selection**
   - Evidence: `lib/reactivation-engine.ts:800-970` — On-demand resolution in `processReactivationSendsDue()` when `anchorReplyId` is null
   - Status: ✅ met

5. **Add regression coverage + a verification runbook**
   - Evidence: `lib/__tests__/reactivation-anchor.test.ts` — 4 tests covering tiered selection
   - Evidence: `docs/planning/phase-54/e/plan.md` — Rollout checklist with verification steps
   - Status: ✅ met

## Plan Adherence
- Planned vs implemented deltas:
  - **New-thread sends descoped** → No impact (provider limitation, graceful `needs_review` fallback)
  - **Anchor selection implemented as separate pure helper** → Better testability than inline implementation

## Risks / Rollback
- **Risk**: `sendEmailBisonReply()` with non-sent-folder reply_id may behave unexpectedly
  - **Mitigation**: Unit tests verify selection logic; telemetry will track anchor tier usage in production
- **Risk**: GHL-assisted discovery adds latency
  - **Mitigation**: Bounded to 1 GHL search per enrollment, 5s timeout

## Multi-agent Coordination

### Concurrent phases on working tree
- Phase 51 (prompt runner) — No direct overlap with reactivation engine
- Phase 52 (booking automation) — Shares `lib/followup-engine.ts`; reactivation calls `startFollowUpSequenceInstance()` which remains unchanged
- Phase 53 (webhook stability) — Shares `lib/emailbison-api.ts` timeout patterns; Phase 54 reuses same patterns

### Build verification
- Build/lint verified against combined working tree state (all concurrent phase changes present)
- No merge conflicts or integration issues

## Follow-ups
- [ ] Monitor anchor tier distribution in production (sent_campaign_match vs sent_any vs any_folder)
- [ ] Monitor GHL-assisted recovery rate (how often does GHL fallback succeed)
- [ ] Consider backfill script to pre-populate `Lead.emailBisonLeadId` for leads discovered via GHL
- [ ] Verify `sendEmailBisonReply()` works correctly with non-sent-folder reply_ids in production
