# Phase 160b — Backend Upload Session + Finalize Pipeline

## Focus
Implement server-side primitives for signed upload sessions and asset finalization without large file bytes passing through Server Actions.

## Inputs
- Phase 160a contract
- `actions/settings-actions.ts` knowledge asset helpers and auth functions
- Supabase admin helpers in `lib/supabase/admin.ts`

## Work
1. Add create-session server entrypoint (action or API route):
   - validates `clientId`, `name`, and optional metadata,
   - enforces settings write access,
   - ensures target storage bucket exists,
   - generates object path and signed upload token,
   - returns upload session payload (bucket, path, token, size caps, expiry).
2. Add finalize server entrypoint:
   - validates workspace access and input metadata (clientId, path, name, mimeType, originalFileName),
   - confirms uploaded object exists and size is within `KNOWLEDGE_ASSET_MAX_UPLOAD_BYTES`,
   - creates `KnowledgeAsset` row + revision entry,
   - applies extraction policy:
     - small file (<= extraction threshold): existing extraction + summarization pipeline,
     - oversize file: skip extraction and return warning metadata indicating manual notes required.
3. Add server-side telemetry/logging:
   - structured logs for session create, finalize success/failure, size policy decisions.
4. Preserve backwards compatibility:
   - keep existing `uploadKnowledgeAssetFile` path working during rollout/canary.

## Output
- Implemented backend signed-upload primitives in `actions/settings-actions.ts`:
  - `createKnowledgeAssetUploadSession(...)`
  - `finalizeKnowledgeAssetUpload(...)`
  - shared helpers for upload/extraction limits and storage-path ownership checks.
- Added deterministic extraction-vs-store-only branching:
  - <= extraction cap: download + extract + summarize
  - > extraction cap: persist file-backed asset with notes-needed warning metadata.
- Preserved backward compatibility:
  - existing `uploadKnowledgeAssetFile(formData)` path remains active and now reuses shared extraction helper.

## Handoff
Proceed to Phase 160c to wire client upload flow and user-facing “notes needed” UX.

## Validation (RED TEAM)
- Create-session checks:
  - unauthorized workspace write attempt is rejected.
  - returned path is namespaced under `<clientId>/`.
  - file size > `KNOWLEDGE_ASSET_MAX_UPLOAD_BYTES` is rejected before upload.
- Finalize checks:
  - missing/non-existent object path returns a clear error.
  - object metadata size is verified server-side.
  - files over extraction cap skip extraction and return notes-needed warning metadata.
- Backward compatibility:
  - existing `uploadKnowledgeAssetFile` remains callable and unchanged for rollout fallback.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `KNOWLEDGE_ASSET_MAX_UPLOAD_BYTES` server limit handling (default 500MB, bounded to never be below extraction cap).
  - Implemented signed upload session issuance with workspace auth checks and storage bucket ensure/retry behavior.
  - Implemented finalize path with storage `info()` verification, path ownership validation, revision recording, and warning metadata when extraction is skipped/failed.
  - Added structured `console.info`/`console.warn`/`console.error` traces for session creation/finalize decisions.
- Commands run:
  - `npx eslint actions/settings-actions.ts components/dashboard/settings-view.tsx` — pass (warnings only in settings file).
  - `npm run typecheck` — pass.
- Blockers:
  - None for backend implementation.
- Next concrete steps:
  - Wire frontend file upload flow to call signed-session + browser upload + finalize.
