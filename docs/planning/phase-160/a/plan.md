# Phase 160a — Architecture Contract + Limits + Security Model

## Focus
Define the decision-complete contract for large-file uploads before code changes, including limits, auth, and lifecycle states.

## Inputs
- `docs/planning/phase-159/plan.md` (scope split and constraints)
- `actions/settings-actions.ts` (existing knowledge asset CRUD/upload helpers)
- `lib/supabase/client.ts`, `lib/supabase/admin.ts`
- `prisma/schema.prisma` (`KnowledgeAsset` model fields and constraints)

## Work
1. Lock upload limits:
   - `KNOWLEDGE_ASSET_MAX_UPLOAD_BYTES` (new, default target `524288000` for 500MB).
   - extraction threshold remains `KNOWLEDGE_ASSET_MAX_BYTES` (existing, default 12MB).
2. Define signed upload lifecycle:
   - **Create session (server):** authorize user + workspace, create storage path, return signed upload token/metadata.
   - **Upload (client):** browser uploads bytes directly to Supabase via signed token.
   - **Finalize (server):** verify object exists/size and create KnowledgeAsset row; conditionally run extraction.
3. Define security/ownership rules:
   - storage object path is namespaced by workspace id + random uuid.
   - finalize requires same workspace auth as create-session.
   - no client write access without signed token.
4. Define large-file behavior:
   - if file size exceeds extraction threshold, skip extraction and persist asset as store-only with manual notes prompt.

## Output
- Locked interface spec for create-session/finalize calls and env limits.
- Explicit security model and accepted file-size policies.

## Handoff
Proceed to Phase 160b to implement backend session/finalize endpoints or server actions using the finalized contract.

## Validation (RED TEAM)
- Confirm all referenced files/symbols exist:
  - `actions/settings-actions.ts` upload helpers and auth gating
  - `lib/supabase/client.ts`, `lib/supabase/admin.ts`
  - `prisma/schema.prisma` (`KnowledgeAsset`)
- Verify contract includes both limits:
  - extraction cap (`KNOWLEDGE_ASSET_MAX_BYTES`)
  - upload cap (`KNOWLEDGE_ASSET_MAX_UPLOAD_BYTES`)
- Verify security model explicitly requires workspace write access for create-session and finalize.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Locked the dual-limit contract: `KNOWLEDGE_ASSET_MAX_BYTES` (extraction) and `KNOWLEDGE_ASSET_MAX_UPLOAD_BYTES` (direct upload cap, default 500MB).
  - Confirmed signed upload lifecycle shape against repo reality (`createSignedUploadUrl` + `uploadToSignedUrl` + `info` metadata verify).
  - Locked security rule that finalize accepts only workspace-namespaced storage paths and re-checks workspace write access.
- Commands run:
  - `rg -n "uploadKnowledgeAssetFile|ensureSupabaseStorageBucketExists|KNOWLEDGE_ASSET_MAX_BYTES" actions/settings-actions.ts` — pass.
  - `rg -n "handleAddAsset|uploadKnowledgeAssetFile" components/dashboard/settings-view.tsx` — pass.
  - `rg -n "createSignedUploadUrl|uploadToSignedUrl|info\\(path" node_modules/@supabase/storage-js -g '*.d.ts'` — pass.
- Blockers:
  - None for architecture contract.
- Next concrete steps:
  - Land backend create-session/finalize actions with deterministic extraction cutoff handling.
