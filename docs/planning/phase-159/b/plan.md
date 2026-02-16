# Phase 159b — Fix: Configure `serverActions.bodySizeLimit` + UX Error Handling

## Focus
Remove the 413 upload blocker by configuring Server Actions’ body size limit, and ensure the UI reports failures clearly instead of silently.

## Inputs
- Phase 159a repro notes + chosen size limit
- `next.config.mjs`
- `components/dashboard/settings-view.tsx` (Knowledge Assets “Add Asset” dialog + `handleAddAsset`)
- `actions/settings-actions.ts:uploadKnowledgeAssetFile` (already validates `KNOWLEDGE_ASSET_MAX_BYTES`)
- Locked phase scope (159 = hotfix only; large-upload architecture deferred to Phase 160)

## Work
1. Update `next.config.mjs` to set `experimental.serverActions.bodySizeLimit` with deterministic sizing:
   - `maxBytes = parseInt(process.env.KNOWLEDGE_ASSET_MAX_BYTES ?? "12582912", 10)`
   - `limitMb = ceil((maxBytes + 2MB) / 1MB)`
   - `bodySizeLimit = "${limitMb}mb"`
   - Preserve existing `allowedOrigins` behavior.
   - Prefer a single `experimental.serverActions` object to avoid coordination conflicts with Phase 158.
2. Harden the client UX around failed uploads:
   - Wrap `uploadKnowledgeAssetFile(formData)` in `try/catch` and show a toast on thrown errors.
   - If the thrown error indicates `413`/payload too large, show a specific message pointing to the configured file cap.
   - Add client-side preflight check with a cap derived from `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` (fallback `12MB`) so UI stays in sync with server config.
   - Document the new client-exposed env contract:
     - add `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` to `README.md` (optional)
     - ensure Vercel env sets it (match `KNOWLEDGE_ASSET_MAX_BYTES`)
3. Confirm a successful upload path:
   - asset row is created
   - “File uploaded and processed” toast appears
   - user can open the viewer and see notes/raw (as available)
4. Ensure no large-upload architecture changes are introduced in this phase:
   - no signed-upload URL endpoints,
   - no browser-to-storage direct upload flow.

## Output
- Implemented Phase 159 hotfix (code):
  - `next.config.mjs` now sets `experimental.serverActions.bodySizeLimit` derived from `KNOWLEDGE_ASSET_MAX_BYTES + 2MB` overhead buffer.
  - `components/dashboard/settings-view.tsx` now:
    - blocks file uploads above the configured cap client-side with a clear toast (cap derived from `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES`, fallback 12MB),
    - wraps `uploadKnowledgeAssetFile(formData)` in `try/catch` and shows a specific “payload too large” message on 413-like failures.
    - clarifies the cap in the Knowledge Assets UI helper text using the same derived cap.
  - `README.md` documents `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` (optional; set to match `KNOWLEDGE_ASSET_MAX_BYTES`).
- No signed-upload/direct-to-storage architecture changes were introduced (Phase 160 remains the large-upload path).

## Handoff
Proceed to Phase 159c for validation gates, deploy/preview verification, and a closure comment on the Jam.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added deterministic Server Actions payload limit config (`bodySizeLimit`) to support the intended upload flow.
  - Added client-side preflight cap + exception handling so oversized uploads fail clearly (instead of silent/no-op or repeated 413s).
  - Updated preflight/helper-text cap to derive from `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` (fallback 12MB) and documented env var in README.
- Commands run:
  - None specific to 159b (see 159c for validation runs).
- Blockers:
  - None for implementation.
- Next concrete steps:
  - Run validation gates and add Jam closure comment (159c).
