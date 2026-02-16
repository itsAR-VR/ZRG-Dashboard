# Phase 159 — Review

## Summary
- Shipped a Knowledge Asset file-upload hotfix: raise Next.js Server Actions `bodySizeLimit`, add client-side max-size preflight, and show clear 413/payload-too-large errors.
- Documented `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` so the UI cap matches the server cap (`KNOWLEDGE_ASSET_MAX_BYTES`).
- Verified Phase 159 changes pass `typecheck/build/test` on a clean snapshot; production verification remains pending deploy + manual retest.

## What Shipped
- `next.config.mjs` — sets `experimental.serverActions.bodySizeLimit` derived from `KNOWLEDGE_ASSET_MAX_BYTES + 2MB`.
- `components/dashboard/settings-view.tsx` — Knowledge Assets file upload:
  - preflight max-size check (cap from `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES`, fallback 12MB)
  - `try/catch` around `uploadKnowledgeAssetFile()` with specific 413/payload-too-large toast
  - helper text shows the configured cap
- `README.md` — documents `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` (optional; set to match `KNOWLEDGE_ASSET_MAX_BYTES`)
- Jam comment posted on `854f22f3-d6e8-40af-af9e-1c1de6a197c1` (root cause + fix + retest checklist)

## Verification

### Commands
- `npm run lint` — pass (2026-02-16)
- `npm run build` — **fail in current working tree** (unrelated WIP TS error in `lib/auto-send-evaluator.ts`; Phase 159 intentionally does not fix)
- `agentic impact classification` — `nttan_not_required` (Phase 159 changes are config/UI/docs only; no AI drafting/prompt/message/follow-up/webhook/cron behavior)
- `npm run test:ai-drafts` — skip (not required)
- `npm run test:ai-replay -- --client-id <id> --dry-run --limit 20` — skip (not required)
- `npm run test:ai-replay -- --client-id <id> --limit 20 --concurrency 3` — skip (not required)
- `npm run db:push` — skip (no Prisma schema changes in Phase 159)

### Phase 159-only gates (clean snapshot)
Ran in `/tmp/zrg-phase159-verify` created via `git archive HEAD` with Phase 159 files overlaid:
- `npm run typecheck` — pass (2026-02-16)
- `npm run build` — pass (2026-02-16)
- `npm test` — pass (2026-02-16)

## Success Criteria → Evidence

1. Uploading a file-based Knowledge Asset >1MB succeeds in production (2–5MB PDF) without 413
   - Evidence: config + UI hotfix shipped; Jam showed default failure mode (`413 FUNCTION_PAYLOAD_TOO_LARGE`).
   - Status: **partial** (needs post-deploy manual retest on `zrg-dashboard.vercel.app`)

2. Uploading a file larger than `KNOWLEDGE_ASSET_MAX_BYTES` is blocked with a clear client-side error
   - Evidence: `components/dashboard/settings-view.tsx` preflight cap + toast messaging.
   - Status: **partial** (code complete; confirm in prod UX)

3. `next.config.mjs` defines deterministic `experimental.serverActions.bodySizeLimit` aligned to `KNOWLEDGE_ASSET_MAX_BYTES` (+ overhead)
   - Evidence: `next.config.mjs`.
   - Status: **met**

4. `zrg-dashboard-log-export-2026-02-16T16-16-06.json` is treated as out-of-scope and handed off to Phase 161
   - Evidence: `docs/planning/phase-159/plan.md`.
   - Status: **met**

5. Validation gates pass (`lint/typecheck/build/test`)
   - Evidence: `npm run lint` pass in repo; `typecheck/build/test` pass in clean snapshot.
   - Status: **partial** (combined working tree build currently blocked by unrelated WIP)

6. Jam has a status comment with root cause + fix + verification notes
   - Evidence: Jam comment (2026-02-16).
   - Status: **met**

## Plan Adherence
- Planned vs implemented deltas:
  - Added `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` env contract + README row to keep UI cap in sync (planned in updated Phase 159 docs).

## Risks / Rollback
- If 10–12MB uploads still fail in production due to platform limits → lower `KNOWLEDGE_ASSET_MAX_BYTES` (and `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES`) to the proven working max, or fast-track Phase 160 (direct-to-storage signed uploads).

## Follow-ups
- Deploy and retest in production:
  1) upload 2–5MB PDF
  2) upload 10–12MB PDF
- Ensure Vercel env sets `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` to match `KNOWLEDGE_ASSET_MAX_BYTES`.

