# Phase 160 — Large Knowledge Asset Uploads (100MB+ via Signed Upload + Store-Only Notes)

## Purpose
Support large Knowledge Asset file uploads (target up to ~500MB) by moving file transfer off Next.js Server Actions and onto direct-to-storage signed uploads, while preserving safe AI-context behavior.

## Context
- Phase 159 restores the current Server Action-based flow for normal file sizes and keeps extraction capped at current defaults (`KNOWLEDGE_ASSET_MAX_BYTES`, default 12MB).
- User requirement: support large uploads (`100MB+`, with intent up to `500MB`) without routing file bytes through Server Actions.
- Current flow couples upload + extraction in `actions/settings-actions.ts:uploadKnowledgeAssetFile`, which:
  - reads full file into memory,
  - can base64-encode PDFs/images for extraction,
  - is not suitable for very large files.
- Repo capabilities already available:
  - browser Supabase client factory: `lib/supabase/client.ts`
  - server/admin Supabase client: `lib/supabase/admin.ts`
  - storage helpers in `actions/settings-actions.ts` (`ensureSupabaseStorageBucketExists`, object path conventions)
  - Supabase storage SDK supports signed upload workflow (`createSignedUploadUrl`, `uploadToSignedUrl`).
- Locked product behavior for large files:
  - upload should still succeed when file is too large for extraction,
  - extracted notes are not auto-generated for oversize files,
  - user can add manual notes afterward for AI context.

## Repo Reality Check (RED TEAM)

- What exists today:
  - `actions/settings-actions.ts:uploadKnowledgeAssetFile` handles file upload + extraction in one Server Action and still enforces `KNOWLEDGE_ASSET_MAX_BYTES` (default 12MB).
  - `components/dashboard/settings-view.tsx:handleAddAsset` currently calls `uploadKnowledgeAssetFile(formData)` for file uploads.
  - `lib/supabase/client.ts` (browser client) and `lib/supabase/admin.ts` (service-role server client) are available for split client/server upload flow.
  - Supabase Storage client in this repo version exposes signed upload lifecycle methods (`createSignedUploadUrl`, `uploadToSignedUrl`) and object metadata lookup (`info`).
- What this phase assumes:
  - Large payload transfer moves to browser → Supabase signed upload, with server-side finalize creating the `KnowledgeAsset` row.
  - Existing small-file extraction semantics remain intact for files at or below `KNOWLEDGE_ASSET_MAX_BYTES`.
  - Oversize files are stored successfully and flagged for manual notes.
- Verified touch points:
  - `actions/settings-actions.ts`
  - `components/dashboard/settings-view.tsx`
  - `lib/supabase/client.ts`
  - `lib/supabase/admin.ts`
  - `README.md` env var table

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 159 | Active | `components/dashboard/settings-view.tsx`, `actions/settings-actions.ts`, `next.config.mjs` | Land 159 hotfix first; do not regress existing file upload behavior while introducing large-upload path. |
| Phase 156 | Active | `components/dashboard/settings-view.tsx` | Keep UI changes scoped to Knowledge Assets upload panel/dialog only; avoid IA refactors. |
| Phase 158 | Active | Read API / analytics reliability | Independent domain; avoid edits outside Knowledge Assets upload pipeline. |
| Phase 161 | Planned | Production incident triage (`/api/inbox/conversations` 503) | Independent; no inbox read-path edits in 160. |
| Uncommitted working tree | Active | Multiple AI/analytics files modified by other agents | Restrict implementation to explicit 160 files; do not revert unrelated changes. |

## Objectives
* [x] Introduce a direct-to-storage upload architecture for Knowledge Asset files up to configured large-file limits.
* [x] Add secure upload session issuance and finalize semantics with workspace/admin authorization.
* [x] Preserve extraction behavior for small files; use store-only + manual notes workflow for oversize files.
* [x] Provide clear user UX for upload progress, success, and “notes needed” follow-up.
* [ ] Validate end-to-end behavior for 100MB+ uploads and ensure no regression to existing asset management flows.

## Constraints
- No secrets in client code; service-role operations remain server-side only.
- Do not route large file bytes through Server Actions.
- Preserve existing `KnowledgeAsset` schema unless new fields are strictly required.
- Keep existing permissions (`requireSettingsWriteAccess`, workspace-admin gating) intact.
- Maintain backward compatibility with existing assets and list/view/edit/delete flows.
- Use existing storage bucket defaults (`SUPABASE_KNOWLEDGE_ASSETS_BUCKET`, fallback `knowledge-assets`) and object path safety.

## Non-Goals
- Fixing `/api/inbox/conversations` 503 incident (Phase 161 scope).
- Replacing existing small-file extraction prompts or redesigning AI note quality policy.
- Broad Settings IA changes outside Knowledge Assets upload interaction.

## Success Criteria
- A `100MB` file upload succeeds end-to-end from Settings → Knowledge Assets without HTTP 413.
- A large file near configured cap (target `500MB`) uploads successfully when within max upload limit.
- For files above extraction threshold (`KNOWLEDGE_ASSET_MAX_BYTES`), asset is created with storage reference and explicit “notes needed” behavior (no silent failure).
- Existing small-file flow still works (asset created with extracted text/notes where applicable).
- Validation gates pass:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Signed upload succeeds but finalize fails, leaving orphaned objects in storage → Mitigation: finalize must verify object metadata and return actionable retry/cleanup guidance.
- Client uploads to a path outside workspace namespace → Mitigation: finalize hard-validates `path` prefix against `clientId`.
- Oversize uploads accidentally trigger extraction/download on server → Mitigation: enforce extraction cutoff before any blob download and return explicit notes-needed warning.

### Missing or ambiguous requirements
- Large-upload cap source was not explicit in the original plan → Mitigation: introduce `KNOWLEDGE_ASSET_MAX_UPLOAD_BYTES` (default `500MB`) and enforce in create-session + finalize.
- UX for long-running large uploads lacked explicit progress states → Mitigation: include uploading/finalizing states and token-expired retry messaging.

### Performance / timeouts
- Long browser uploads can outlive signed-token validity window → Mitigation: handle token-expiry failures with clear re-try path (`create session` again).

### Security / permissions
- Signed token issuance/finalize permissions were described but not codified with concrete checks → Mitigation: require `requireSettingsWriteAccess(clientId)` on both operations and validate storage path ownership.

### Testing / validation
- Manual matrix was defined but backend invariants were underspecified → Mitigation: add subphase-level validation checks for object metadata verification, extraction cutover behavior, and fallback path.

## Assumptions (Agent)

- Direct-to-storage flow is introduced for files above extraction cap while preserving existing Server Action path for <= `KNOWLEDGE_ASSET_MAX_BYTES` (confidence ~95%).
  - Mitigation check: if product wants a single upload path for all file sizes, switch `handleAddAsset` to always use signed upload in follow-up.
- `KnowledgeAsset` schema can remain unchanged by using runtime warning metadata instead of a new DB column (confidence ~93%).
  - Mitigation check: if reporting needs persistent “notes-needed” state, add a dedicated schema field in a follow-up phase.

## Open Questions (Need Human Input)

- [x] Should Phase 160 route **all** file uploads through signed uploads, or only files above the 12MB extraction threshold? (resolved)
  - Decision (2026-02-16): use signed uploads **only for files above 12MB**.
  - Why it matters: all-file migration simplifies architecture but increases immediate UI/backend churn and regression surface.
  - Applied behavior in this phase: signed upload path is required for large files first; small files remain on the existing flow for minimal-risk rollout.
- [ ] What is the preferred unblock path for live canary validation? (confidence <90%)
  - Why it matters: Phase 160 success criteria still require 100MB+ end-to-end upload evidence from the deployed Settings UI.
  - Current assumption in this plan: manual canary will be run by a workspace user (or Playwright after local browser-lock issue is cleared) and results will be added to Phase 160d.

## Subphase Index
* a — Architecture Contract + Limits + Security Model
* b — Backend Upload Session + Finalize Pipeline
* c — Frontend Direct Upload Flow + Notes-Needed UX
* d — Validation + Rollout + Safety Guardrails

## Phase Summary (running)
- 2026-02-16 18:22:52Z — Implemented signed-upload backend + frontend for large Knowledge Asset files; added upload limit env contract and full automated validation evidence (files: `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`, `README.md`, `docs/planning/phase-160/*`)
- 2026-02-16 18:40:29Z — User confirmed rollout policy: signed uploads stay scoped to files above 12MB extraction threshold; Phase 160 plan question resolved (files: `docs/planning/phase-160/plan.md`)
- 2026-02-16 18:40:29Z — Attempted Phase 160d live canary automation; blocked by Playwright Chrome launch/profile lock, leaving manual upload matrix pending (files: `docs/planning/phase-160/d/plan.md`, `docs/planning/phase-160/plan.md`)
- 2026-02-16 18:52:15Z — Re-ran RED TEAM/phase-gaps reality checks; blocker remains only live canary execution path (Playwright launch lock vs user-run matrix) (files: `docs/planning/phase-160/plan.md`, `docs/planning/phase-160/d/plan.md`)

- 2026-02-17 — Terminus Maximus retroactive validation completed for Phase 160: global gates passed (lint/typecheck/build/test), review artifact present (docs/planning/phase-160/review.md), and subphase Output/Handoff integrity verified.
