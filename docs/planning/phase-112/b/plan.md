# Phase 112b — Build Shared Bundle + Wire Drafting + Meeting Overseer Gate

## Focus
Implement `lib/lead-context-bundle.ts` (per the 112a contract) and wire it into:
- Draft generation (`lib/ai-drafts.ts`) to eliminate ad-hoc knowledge/memory assembly
- Meeting overseer gate (`runMeetingOverseerGate`) to source memory consistently

This subphase is the first end-to-end change that reduces “split brain.”

## Inputs
- Bundle spec: `docs/planning/phase-112/a/plan.md`
- Core code:
  - `lib/ai-drafts.ts`
  - `lib/meeting-overseer.ts`
  - `lib/knowledge-asset-context.ts`
  - `lib/lead-memory-context.ts`
- Telemetry plumbing (needed to attach bundle stats):
  - `lib/ai/prompt-runner/runner.ts`
  - `lib/ai/openai-telemetry.ts`
  - `prisma/schema.prisma` (`AIInteraction`)

## Work
1. Pre-flight conflict check
   - `git status --porcelain`
   - Re-read current versions of `lib/ai-drafts.ts` and `lib/meeting-overseer.ts` (recent phases touched them).

2. Implement shared builder module
   - Create `lib/lead-context-bundle.ts`.
   - Must support `LeadContextProfile` and profile-based budgets (defaults from 112a).
   - Must use existing primitives:
     - `buildKnowledgeContextFromAssets(...)` (token/byte budgeted)
     - `getLeadMemoryContext({ redact })` (token/byte budgeted)
       - `draft` profile: `redact: false` (matches current drafting behavior at `ai-drafts.ts:1362`)
       - all other profiles: `redact: true`
   - Must exclude `Primary: Website URL` from generic `knowledgeContext` and derive `primaryWebsiteUrl` separately.
   - **Latency budget**: bundle build must complete within 500ms; on timeout, fall back to pre-existing context assembly.

3. Rollout gating + safe fallback
   - Only use the bundle when:
     - `WorkspaceSettings.leadContextBundleEnabled === true` AND
     - env kill-switch is NOT enabled (defined in 112e)
   - On any builder failure (DB read, unexpected nulls, timeout > 500ms, etc.):
     - **Log failure at WARN level** (preserve Phase 109 non-fatal observability pattern)
     - Fall back to the pre-existing context assembly and continue (best-effort; never block draft creation).

4. Wire drafting to use the shared bundle
   - Replace the ad-hoc `slice(0, 1000)` asset snippet logic in `lib/ai-drafts.ts:1351-1358` with the bundle output.
   - **Token budget safety**: the current `slice(0, 1000)` is ~250 tokens per asset. The bundle default is `maxAssetTokens=1200` (~300 tokens). Add a `maxTotalTokens` safety cap at the injection point so the combined prompt (transcript + knowledge + memory + system prompt) doesn't exceed the model's context window. Recommended: cap the bundle's `knowledgeContext` contribution to drafting at `maxTokens=4000` (matching 112a profile default).
   - Preserve existing prompt template var mapping:
     - Keep `serviceDescription`, `aiGoals`, and `primaryWebsiteUrl` passed as separate vars.
     - Set `knowledgeContext = bundle.knowledgeContext (+ optional appended "LEAD MEMORY")` per 112a.
   - Preserve non-fatal behavior around meeting overseer (Phase 109 try/catch pattern).

5. Wire meeting overseer gate to use the shared bundle
   - Build bundle with profile `meeting_overseer_gate`.
   - Pass `memoryContext = bundle.leadMemoryContext ?? "None."` into `runMeetingOverseerGate`.
   - Explicit non-goal: do NOT inject bundle into `runMeetingOverseerExtraction`.

6. Telemetry metadata attachment (stats-only)
   - Attach `leadContextBundle` stats into `AIInteraction.metadata` for the AI calls that used the bundle.
   - **Prerequisite**: 112d-schema (telemetry plumbing) lands before this subphase per the reordered execution plan.
   - Threading path: pass `metadata` from bundle builder → prompt runner opts → `trackAiCall` → `recordInteraction` → Prisma create.

7. Tests
   - Add unit tests for `lib/lead-context-bundle.ts`:
     - budgeting/truncation behavior
     - primary website asset exclusion from `knowledgeContext`
     - redaction behavior: `draft` profile returns unredacted memory; other profiles return redacted (emails/phones masked)
   - Add regression tests:
     - drafting still includes lead memory when present
     - meeting overseer gate receives memory when enabled
     - **bundle builder failure is logged at WARN level but draft is still created** (Phase 109 non-fatal regression)
     - **stale-sending recovery path** (`lib/ai-drafts/stale-sending-recovery.ts`) still works with bundle enabled (Phase 111 regression)

## Validation (RED TEAM)
- `npm run build` succeeds (TypeScript catches shape drift).
- `npm test` passes all new + existing tests.
- Manual smoke: generate a draft with bundle enabled → verify `AIInteraction.metadata` has `leadContextBundle` stats (no raw text).
- Manual smoke: disable bundle → drafting falls back to pre-existing `slice(0, 1000)` path without error.

## Output
- `lib/lead-context-bundle.ts` exists and is used by `lib/ai-drafts.ts`.
- Meeting overseer gate consumes `bundle.leadMemoryContext`.
- Bundle stats are recorded (stats-only) in AIInteraction metadata for relevant calls.
- Tests updated/added.

## Handoff
112c wires the same bundle into the auto-send evaluator input path (include redacted memory, preserve payload keys).
