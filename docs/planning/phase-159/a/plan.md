# Phase 159a — Jam Repro + Root Cause Confirmation (413 via Server Actions body limit)

## Focus
Confirm the failure mode behind “Add Asset not working” and lock a minimal fix approach grounded in evidence (Jam + local repro).

## Inputs
- Jam: https://jam.dev/c/854f22f3-d6e8-40af-af9e-1c1de6a197c1
- `zrg-dashboard-log-export-2026-02-16T16-16-06.json` (user-provided additional production log export)
- Client upload entrypoint: `components/dashboard/settings-view.tsx` (`handleAddAsset` → `uploadKnowledgeAssetFile(FormData)`)
- Server action: `actions/settings-actions.ts:uploadKnowledgeAssetFile`
- Next config: `next.config.mjs` (current `experimental.serverActions.allowedOrigins` only)
- Env: `KNOWLEDGE_ASSET_MAX_BYTES` (default 12MB)

## Work
1. Reproduce upload locally (or in a preview deployment) with:
   - a file < 1MB (control)
   - a file ~2–5MB (expected fail today)
2. Confirm the server response is `413` and happens before server action logic executes (no server-side logs from `uploadKnowledgeAssetFile`).
3. Confirm Next’s Server Actions default body size limit is ~1MB and requires `experimental.serverActions.bodySizeLimit` to increase.
4. Decide the target body-size limit:
   - Must be **≥ `KNOWLEDGE_ASSET_MAX_BYTES`** to avoid a “config rejects before app validation” mismatch.
   - If Vercel/platform request limits are lower than intended, document that constraint and pick the best achievable limit (and note whether a direct-to-storage upload is needed later).
5. Analyze the additional export (`zrg-dashboard-log-export-2026-02-16T16-16-06.json`) and explicitly classify findings:
   - if entries map to Knowledge Asset upload 413, include them in this phase;
   - if entries are unrelated (e.g. `/api/inbox/conversations` 503), mark out of scope and hand off to a separate phase (Phase 161).

## Output
- Jam evidence confirms the failure is a **413** from Vercel during the Server Action POST:
  - `POST https://zrg-dashboard.vercel.app/` (Server Action request) → `413` with `x-vercel-error: FUNCTION_PAYLOAD_TOO_LARGE`
  - Observed request body size: `~27,574,947` bytes (≈ 26.3MB) → larger than the intended `KNOWLEDGE_ASSET_MAX_BYTES` default (12MB)
- Next.js docs confirm Server Actions have a **default 1MB body size limit** and support `experimental.serverActions.bodySizeLimit` for raising it (string like `2mb`).
- `zrg-dashboard-log-export-2026-02-16T16-16-06.json` is **out of scope** for Phase 159:
  - It is a JSON array of `120` entries and is dominated by `GET /api/inbox/conversations` returning `503`.
  - Tracked separately in Phase 161 per root plan locked decisions.
- Fix strategy chosen (Phase 159 hotfix scope):
  - Set `experimental.serverActions.bodySizeLimit` derived from `KNOWLEDGE_ASSET_MAX_BYTES + 2MB` overhead, rounded up to whole MB string.
  - Add a conservative client preflight cap at `12MB` + specific 413/payload-too-large UX.

## Handoff
Proceed to Phase 159b to implement the config change + user-facing error handling in the Knowledge Asset upload flow.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Pulled Jam network evidence for the failing upload (`413` + `FUNCTION_PAYLOAD_TOO_LARGE`, ~26MB payload).
  - Confirmed Next.js Server Actions default body limit (`1MB`) and the supported `experimental.serverActions.bodySizeLimit` config via docs.
  - Classified the additional log export as unrelated to Knowledge Assets (handed off to Phase 161).
- Commands run:
  - `wc -c zrg-dashboard-log-export-2026-02-16T16-16-06.json` — pass (≈117KB)
  - `python -c ...json.load(...)` — pass (`list 120`)
- Blockers:
  - None for Phase 159a.
- Next concrete steps:
  - Implement the `bodySizeLimit` config + upload error UX in Phase 159b.
