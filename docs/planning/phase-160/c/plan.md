# Phase 160c — Frontend Direct Upload Flow + Notes-Needed UX

## Focus
Switch the Knowledge Asset file upload UI to use signed uploads for large files and provide clear user feedback for store-only assets.

## Inputs
- Phase 160b backend interfaces
- `components/dashboard/settings-view.tsx` (Knowledge Assets dialog and asset list)
- Existing toasts/loading patterns in Settings UI

## Work
1. Implement direct upload client flow:
   - request upload session from server,
   - upload selected file via browser Supabase client and signed token,
   - call finalize endpoint/action,
   - update in-memory `knowledgeAssets` list with returned asset.
2. UX and error states:
   - show progress/loading states for upload + finalize steps,
   - map common failures (expired token, size exceeded, network errors) to actionable toasts,
   - keep existing success behavior for normal file uploads.
3. Notes-needed state:
   - when finalize indicates extraction skipped, show explicit toast/banner in asset list (e.g., “Upload complete. Add notes for AI context.”),
   - ensure user can open/edit asset to add manual notes.
4. Preserve existing interactions:
   - view/edit/delete/history remain functional for both extracted and store-only assets.

## Output
- Updated `components/dashboard/settings-view.tsx` file upload UX:
  - files above `KNOWLEDGE_ASSET_MAX_BYTES` now use signed upload flow (`create session` → browser `uploadToSignedUrl` → `finalize`),
  - files at/under extraction cap keep existing `uploadKnowledgeAssetFile` path for low-risk rollout.
- Added explicit in-flight UX (`Uploading...` button state) and actionable token-expiry/upload error messages.
- Added notes-needed messaging for store-only uploads (`Upload complete` + `Add notes for AI context` toast).

## Handoff
Proceed to Phase 160d for validation, canary rollout, and rollback readiness.

## Validation (RED TEAM)
- UI flow:
  - request signed upload session → upload via browser client → finalize server call.
  - Add Asset button shows in-flight state and prevents duplicate submits.
- Error handling:
  - token expiry/upload failure maps to actionable retry toast.
  - finalize failures show explicit next step (retry upload vs reduce file size).
- Notes-needed UX:
  - oversize file finalize response surfaces “upload complete, add notes for AI context.”

## Progress This Turn (Terminus Maximus)
- Work done:
  - Imported new backend actions (`createKnowledgeAssetUploadSession`, `finalizeKnowledgeAssetUpload`) and Supabase browser client.
  - Reworked `handleAddAsset` file branch to route large files through direct-to-storage signed uploads.
  - Added UI disabling/spinner state to prevent duplicate submits during upload/finalize.
  - Updated helper copy to explain extraction cap vs large-file manual-notes behavior.
  - Confirmed product decision: keep signed-upload path scoped to files above 12MB; preserve existing path for smaller files.
- Commands run:
  - `npm run build` — pass.
  - `npm test` — pass.
- Blockers:
  - None for frontend integration.
- Next concrete steps:
  - Complete Phase 160d manual validation matrix in live environment (10MB / 25MB / 100MB / over-cap cases).
