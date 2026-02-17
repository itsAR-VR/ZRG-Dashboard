# Phase 159 — Fix Knowledge Asset “Add Asset” File Upload (HTTP 413)

## Purpose
Restore “Add Asset” **file uploads** in Settings → Knowledge Assets by removing the 413 payload limit and improving the user-visible error when uploads exceed limits.

## Context
- **Jam:** https://jam.dev/c/854f22f3-d6e8-40af-af9e-1c1de6a197c1 (video, 2026-02-13, Jon Ferolin)
- Jam transcript indicates the UI shows the selected document, but clicking **Add Asset** fails.
- Jam network summary shows **3x POST** returning **HTTP `413`** from `zrg-dashboard.vercel.app` with `content-type: text/plain; charset=utf-8`.
- Additional log export (2026-02-16) provided by user:
  - `zrg-dashboard-log-export-2026-02-16T16-16-06.json` (120 entries)
  - Observed **116x HTTP `503`** on `GET /api/inbox/conversations` with empty `message` fields.
  - This is a separate production incident from the Knowledge Asset 413 path and requires its own phase-level triage.
- The Knowledge Asset file flow is implemented as a **Next.js Server Action**:
  - Client: `components/dashboard/settings-view.tsx` → `uploadKnowledgeAssetFile(formData)`
  - Server: `actions/settings-actions.ts:uploadKnowledgeAssetFile` reads the file and validates against `KNOWLEDGE_ASSET_MAX_BYTES` (default **12MB**).
- Next.js defaults Server Actions body size limit to **1MB** unless `experimental.serverActions.bodySizeLimit` is set.
- Before this phase, `next.config.mjs` configured `experimental.serverActions.allowedOrigins` but **did not set `bodySizeLimit`**, so uploads > ~1MB could be rejected *before* our server action ran.

## Locked Decisions
- Phase 159 scope is a **hotfix** for the current Server Action upload flow (restore reliable uploads up to current limits).
- Large-file support (`100MB+`, target up to `500MB`) is **deferred to Phase 160** via direct-to-storage signed uploads.
- `/api/inbox/conversations` `503` spike from `zrg-dashboard-log-export-2026-02-16T16-16-06.json` is **out of scope for Phase 159** and tracked in **Phase 161**.
- Do **not** fix unrelated repo-wide `typecheck`/`build` failures in this phase; instead, run gates on a branch/worktree containing only Phase 159 changes.
- `serverActions.bodySizeLimit` implementation in this phase:
  - derive from `KNOWLEDGE_ASSET_MAX_BYTES` + multipart overhead buffer (`+ 2MB`), then round up to whole MB string.
- UI behavior in this phase:
  - client preflight cap derived from `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` (fallback `12MB`) so UI matches the configured server limit,
  - specific error UX for 413/payload-too-large transport failures,
  - generic fallback error for other upload failures.
- Env contract for the UI cap:
  - Add `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` (optional) and set it to the same value as `KNOWLEDGE_ASSET_MAX_BYTES` in Vercel.
  - If `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` is unset, UI falls back to `12MB`.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 156 | Active | `components/dashboard/settings-view.tsx` (Settings IA) | Keep fix scoped to the Knowledge Assets flow; rebase/merge with any Settings IA refactor before shipping. |
| Phase 158 | Active | Potential overlap in `next.config.mjs` (server action behavior) | Coordinate `experimental.serverActions` edits to avoid stomping config changes. |
| Phase 160 | Planned | Knowledge Assets architecture and upload path | Do not introduce signed-upload architecture in 159; hand off large-upload requirements to 160 only. |
| Phase 161 | Planned | `/api/inbox/conversations` production 503 incident | Reference 161 in Context/validation notes; do not expand 159 scope to inbox incident handling. |
| Phase 157 | Active | None expected (analytics) | No analytics file edits in this phase. |
| Uncommitted working tree | Active | Analytics/response-timing files currently modified | Keep Phase 159 edits isolated to avoid merge noise. |

## Repo Reality Check (RED TEAM)

- What exists today:
  - Knowledge Asset **file uploads** are implemented as a **Next.js Server Action** call (`POST /` with `next-action`) from `components/dashboard/settings-view.tsx` to `actions/settings-actions.ts:uploadKnowledgeAssetFile`.
  - Server-side max file size is enforced in the action via `KNOWLEDGE_ASSET_MAX_BYTES` (default `12MB`).
  - Jam evidence shows `413` with `x-vercel-error: FUNCTION_PAYLOAD_TOO_LARGE` for a ~26MB payload (oversized file), which fails before the server action can return a structured error.
  - Next.js Server Actions default body size limit is `1MB` unless `experimental.serverActions.bodySizeLimit` is set.
- What the plan assumes:
  - Setting `experimental.serverActions.bodySizeLimit` to `KNOWLEDGE_ASSET_MAX_BYTES + 2MB` overhead will allow intended ≤12MB uploads on `zrg-dashboard.vercel.app`.
  - UI can read the configured cap via `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES` (fallback 12MB if unset) without introducing new backend endpoints in Phase 159.
- Verified touch points:
  - `next.config.mjs` (Server Actions config)
  - `components/dashboard/settings-view.tsx` (`handleAddAsset`)
  - `actions/settings-actions.ts` (`uploadKnowledgeAssetFile`, `KNOWLEDGE_ASSET_MAX_BYTES`)

## Objectives
* [ ] Reproduce and confirm the 413 failure mode for Knowledge Asset file uploads (size threshold, request path, error surface).
* [ ] Set an explicit Server Actions body size limit for the current 12MB Knowledge Asset flow (derived from `KNOWLEDGE_ASSET_MAX_BYTES` with overhead).
* [ ] Improve UX: show a clear toast/error for 413 transport failures and for file-size rejections.
* [ ] Validate locally and verify on deployed environment, then annotate the Jam with fix/evidence.
* [ ] Document and hand off out-of-scope incidents/work:
  - large-upload architecture to Phase 160,
  - inbox conversation 503 incident to Phase 161.

## Constraints
- Do not commit secrets or uploaded files to the repo.
- Keep changes minimal: prefer config + error handling over an upload architecture rewrite.
- Preserve existing `SERVER_ACTIONS_ALLOWED_ORIGINS` behavior and origin safety checks.
- Respect current Knowledge Asset max upload semantics (`KNOWLEDGE_ASSET_MAX_BYTES`, default 12MB).
- Avoid conflicts with Settings IA (Phase 156) and server-action drift work (Phase 158).
- Do not add direct-to-storage signed upload flows in Phase 159.
- Do not include `/api/inbox/conversations` 503 remediation work in Phase 159 implementation.

## Non-Goals
- 100MB+ / 500MB uploads in the Knowledge Assets flow (Phase 160 scope).
- Root-causing `/api/inbox/conversations` 503 spike from `zrg-dashboard-log-export-2026-02-16T16-16-06.json` (Phase 161 scope).

## Success Criteria
- Uploading a **file-based Knowledge Asset** from Settings succeeds on production for files larger than 1MB (e.g., 2–5MB PDF) without HTTP 413.
- Uploading a file larger than `KNOWLEDGE_ASSET_MAX_BYTES` is blocked with a clear client-side error (no silent failure).
- `next.config.mjs` defines a deterministic `experimental.serverActions.bodySizeLimit` value aligned to `KNOWLEDGE_ASSET_MAX_BYTES` with multipart overhead buffer.
- `zrg-dashboard-log-export-2026-02-16T16-16-06.json` is referenced in phase output as an out-of-scope incident with handoff to Phase 161.
- Validation gates pass:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `npm test`
  - Jam `854f22f3-d6e8-40af-af9e-1c1de6a197c1` has a short status comment (root cause + fix + verification notes).

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Vercel function payload limits may still reject “near-12MB” uploads even after raising Next’s Server Actions body size limit → Mitigation: if a 10–12MB upload still fails in prod, lower `KNOWLEDGE_ASSET_MAX_BYTES` to the proven platform max or fast-track Phase 160 (direct-to-storage signed uploads).

### Missing or ambiguous requirements
- Whether the 12MB cap should be authoritative long-term (vs being adjusted to match Vercel limits) is not yet verified in production → Plan fix: treat the deployed retest (2–5MB and ~10–12MB) as the deciding evidence.

### Testing / validation
- Repo-wide `typecheck`/`build` can be blocked by unrelated working-tree changes → Plan fix: rerun gates either after fixing the unrelated TS error or on a clean branch containing only Phase 159 changes.

## Open Questions (Need Human Input)

- [ ] After deploying, do uploads in the 10–12MB range succeed on `zrg-dashboard.vercel.app`? (confidence <90%)
  - Why it matters: if they fail, we should either lower `KNOWLEDGE_ASSET_MAX_BYTES` or move Phase 160 up in priority.
  - Current assumption in this plan: ≤12MB uploads are viable after the `bodySizeLimit` change.

## Subphase Index
* a — Jam Repro + Root Cause Confirmation (413 via Server Actions body limit)
* b — Fix: Configure `serverActions.bodySizeLimit` + UX Error Handling
* c — Validation + Deploy Verification + Jam Closure Comment

## Phase Summary (running)
- 2026-02-16 16:59:16Z — Implemented Server Actions `bodySizeLimit` + Knowledge Asset upload preflight/413 UX (files: `next.config.mjs`, `components/dashboard/settings-view.tsx`, `docs/planning/phase-159/*`)
- 2026-02-16 17:58:44Z — Switched UI cap to env-derived + documented `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES`; verified Phase-159-only `typecheck/build/test` pass via clean `/tmp` snapshot (files: `components/dashboard/settings-view.tsx`, `README.md`, `docs/planning/phase-159/b/plan.md`, `docs/planning/phase-159/c/plan.md`)

## Phase Summary

- Shipped:
  - Server Actions `bodySizeLimit` set to support intended Knowledge Asset uploads.
  - UI preflight cap + clear 413/payload-too-large error handling for file uploads.
  - Env var docs for `NEXT_PUBLIC_KNOWLEDGE_ASSET_MAX_BYTES`.
- Verified:
  - `npm run lint`: pass
  - Phase 159-only: `npm run typecheck`, `npm run build`, `npm test`: pass (clean snapshot)
- Notes:
  - Production verification still required (upload 2–5MB and 10–12MB files on `zrg-dashboard.vercel.app` after deploy).

- 2026-02-17 — Terminus Maximus retroactive validation completed for Phase 159: global gates passed (lint/typecheck/build/test), review artifact present (docs/planning/phase-159/review.md), and subphase Output/Handoff integrity verified.
