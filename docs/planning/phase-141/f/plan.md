# Phase 141f — Manual Step 2 Telemetry Parity + NTTAN Gate + Phase Review Prep

## Focus

Implement and validate manual-flow parity for Step 2 skip telemetry, aligned to locked product decisions:
- telemetry emitted in all manual flows,
- per-lead event granularity,
- forward-only metrics (no backfill),
- Step 1 bridge draft path remains unchanged for Step 2 OFF.

## Inputs

- Root phase plan: `docs/planning/phase-141/plan.md`
- Existing manual flows + notices:
  - `actions/message-actions.ts`
- Existing Step 2 runtime and route skip telemetry:
  - `lib/ai-drafts.ts`
  - `lib/ai/route-skip-observability.ts`
  - `actions/ai-observability-actions.ts`
- Prior subphase implementation context:
  - `docs/planning/phase-141/e/plan.md`

## Work

1. Re-read `actions/message-actions.ts` and identify manual flows that bypass `generateResponseDraft`.
2. Add Step 2 route-skip telemetry emission for manual paths that skip Step 2 and do not already emit per-lead events.
3. Keep telemetry channel-aware (email-only for Step 2 semantics).
4. Keep Step 2 notice behavior consistent with telemetry behavior in manual flows.
5. Run quality gates (`lint`, `build`) and full NTTAN gate for AI drafting impact:
   - `npm run test:ai-drafts`
   - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
   - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
6. Capture command outcomes and blockers, then prepare root plan for phase review completion path.

## Validation (RED TEAM)

- `rg -n "fastRegenerateDraft|regenerateDraft|regenerateAllDrafts|recordAiRouteSkip|draft_generation_step2" actions/message-actions.ts lib/ai-drafts.ts`
- `npm run lint`
- `npm run build`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
- `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## Output

- Confirmed manual-flow routing for Step 2 telemetry:
  - `regenerateDraft` and `regenerateAllDrafts` both call `generateResponseDraft()`, which already emits per-lead Step 2 skip telemetry when the route is disabled.
  - `fastRegenerateDraft` is the only manual path that bypasses `generateResponseDraft()` and now emits its own Step 2 skip telemetry via `recordAiRouteSkip(...)`.
- Implemented parity patch in `actions/message-actions.ts`:
  - Added `recordAiRouteSkip` import.
  - Added email-only Step 2 skip event emit in `fastRegenerateDraft` when `draftGenerationStep2Enabled === false`.
  - Event fields: `clientId`, `leadId`, `channel`, `route = draft_generation_step2`, `reason = disabled_by_workspace_settings`, `source = action:message.fast_regenerate_draft`.
- NTTAN gate results (this turn):
  - `rg -n "fastRegenerateDraft|regenerateDraft|regenerateAllDrafts|recordAiRouteSkip|draft_generation_step2" actions/message-actions.ts lib/ai-drafts.ts` — pass.
  - `npm run lint` — pass (warnings only, no errors).
  - `npm run build` — pass.
  - `npm run test:ai-drafts` — pass.
  - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --dry-run --limit 20` — fail (`P1001`, DB unreachable at `db.pzaptpgrcezknnsfytob.supabase.co`).
  - `npm run test:ai-replay -- --client-id 00000000-0000-0000-0000-000000000000 --limit 20 --concurrency 3` — fail (`P1001`, same root cause).
  - Supabase MCP real-client verification:
    - Pulled candidate client IDs from `Client` table via MCP (`29156db4-e9bf-4e26-9cb8-2a75ae3d9384`, `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`, `a9dcc367-a113-4d0e-b236-3196ea498b18`, `fa0af98c-40e6-45ac-a6f7-9bdc28851d2e`, `5cfafbb4-7618-43d0-8cbb-321ff2593219`).
    - Re-ran replay with real client ID `29156db4-e9bf-4e26-9cb8-2a75ae3d9384`; failed with the same Prisma `P1001` DB-not-reachable error.
- Notice parity check:
  - Verified Step 2 notice logic is email-channel scoped in `getDisabledRouteNotices(...)` and is returned from manual `regenerateDraft`, `fastRegenerateDraft`, and `regenerateAllDrafts` response payloads.
- Multi-agent coordination risk notes:
  - `actions/settings-actions.ts` + `components/dashboard/settings-view.tsx` are active in phases 141/142/144.
  - `lib/ai-drafts.ts` is active in phases 141/143 and explicitly excluded by phase 144 (hotspot file).
  - No additional code edits were made outside `actions/message-actions.ts` in this subphase.

## Handoff

- Subphase status: implementation complete, validation partial due external DB connectivity blocker.
- To clear remaining NTTAN replay gate:
  1. Restore hostname/network resolution to Supabase from this environment (`nc -zvw3 db.pzaptpgrcezknnsfytob.supabase.co 5432` currently returns `getaddrinfo` failure).
  2. Confirm DB credentials and runtime env are loaded (`DATABASE_URL`/`DIRECT_URL`) from a network-capable shell.
  3. Resolve a real client ID from DB (`node --import tsx -e "import { prisma } from './lib/prisma'; prisma.client.findFirst({select:{id:true}}).then(console.log)"`).
  4. Re-run:
     - `npm run test:ai-replay -- --client-id <realClientId> --dry-run --limit 20`
     - `npm run test:ai-replay -- --client-id <realClientId> --limit 20 --concurrency 3`
  5. Attach replay artifact paths from `.artifacts/ai-replay/` to phase review evidence (`.artifacts/ai-replay` not present yet because replay fails before artifact creation).

## Progress This Turn (Terminus Maximus)

- Re-ran mandatory NTTAN gate for AI drafting impact:
  - `npm run test:ai-drafts` — pass.
  - Both `npm run test:ai-replay ...` commands — blocked by DB reachability (`P1001`).
- Used Supabase MCP to remove client-id ambiguity:
  - fetched real `Client.id` values and re-tested replay with a valid client ID;
  - failure mode remained identical (`P1001`), confirming environment DNS/network connectivity is the blocker.
- Re-verified manual flow topology with grep and code inspection:
  - only `fastRegenerateDraft` needed explicit Step 2 skip telemetry patch.
- Captured coordination overlap scan for last 10 phases and logged active collision domains in Output.

## Progress Update — 2026-02-12 03:27 UTC

- Implemented replay runner robustness + realism upgrades:
  - auto-selection default now uses `--channel any` with widening fallbacks (channel/window -> all channels/window -> full history);
  - replay now exits non-zero on empty selection unless `--allow-empty` is explicitly set;
  - judge input now includes historical outbound examples + observed next real outbound reply for comparison.
- Re-validated gates:
  - `npm run lint` — pass (warnings only).
  - `npm run build` — pass.
  - `npm run test:ai-drafts` — pass.
  - `node --import tsx --test lib/ai-replay/__tests__/cli.test.ts lib/ai-replay/__tests__/select-cases.test.ts` — pass.
- Replay run outcomes after robustness patch:
  - `npm run test:ai-replay -- --client-id 29156db4-e9bf-4e26-9cb8-2a75ae3d9384 --dry-run --limit 20` — expected fail-fast (`No replay cases selected`) with explicit no-data warnings.
  - `npm run test:ai-replay -- --client-id 29156db4-e9bf-4e26-9cb8-2a75ae3d9384 --dry-run --limit 20 --allow-empty` — pass (selection-only artifact, 0 cases).
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20` — pass (20 cases selected).
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 2 --concurrency 1` — fail (OpenAI 401 invalid API key during replay judge call).
- Current blocker is no longer DB connectivity; it is OpenAI key validity for true live generation + judge execution in this shell.
