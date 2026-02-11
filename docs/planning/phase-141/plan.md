# Phase 141 — AI Pipeline Route Switches (Per-Workspace UI Toggles)

## Purpose

Add on/off switches in the workspace Settings UI for three AI pipeline routes: draft generation, draft verification (Step 3), and the Meeting Overseer scheduling gate. Allows workspace admins to disable AI routes that are causing more harm than good without code changes or redeployment.

## Context

Recent production issues (Phases 135, 140, 119) show the AI draft verification step actively worsening drafts — stripping valid pricing, aggressively rewriting content. The Meeting Overseer has separate scheduling coherence issues. Rather than refactoring the pipeline, simple per-workspace toggles let admins disable specific routes immediately while root-cause fixes land in parallel phases.

The deterministic post-processing layer (booking link enforcement, forbidden terms, pricing safety, em-dash normalization, length clamping) always runs regardless of these toggles — it is the hard safety net.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 137 | Active (uncommitted) | `settings-view.tsx`, `prisma/schema.prisma` | UI changes in different sections; re-read files before editing. |
| Phase 138 | Active (uncommitted) | `lib/ai-drafts.ts` | Auto-booking logic, different code section; no conflict. |
| Phase 139 | Active (uncommitted) | `lib/ai-drafts.ts` | Timezone logic, different code section; no conflict. |
| Phase 140 | Active (uncommitted) | `lib/ai-drafts.ts`, pricing logic | Pricing validation untouched; Step 3 toggle wraps existing code. |

## Objectives

* [ ] Add 3 boolean fields to WorkspaceSettings schema (`draftGenerationEnabled`, `draftVerificationStep3Enabled`, `meetingOverseerEnabled`)
* [ ] Wire fields through server action (load + save)
* [ ] Add 3 Switch components in Settings UI
* [ ] Add runtime checks in `lib/ai-drafts.ts` with `?? true` fallbacks
* [ ] Verify lint, build, and all three toggle states

## Constraints

- All toggles default to `true` (no behavior change until explicitly turned off)
- Every runtime check uses `settings?.field ?? true` fallback for null safety
- No pipeline refactoring — toggles wrap existing code blocks with `if` checks
- Follow existing Switch pattern in settings-view.tsx (ARIA labels, admin-gated)
- `npm run lint` and `npm run build` must pass
- `npm run db:push` after schema change

## Success Criteria

- All 3 switches visible in Settings UI under Email Draft Generation section
- Toggle off "AI Draft Generation" → no AIDraft records created for new inbound messages
- Toggle off "Draft Verification" → no `draft.verify.email.step3` AIInteraction records
- Toggle off "Meeting Overseer" → no meeting overseer AIInteraction records
- All toggles ON → behavior identical to before this change
- Lint and build pass

## Subphase Index

* a — Schema + Server Action (database + persistence layer)
* b — Settings UI Switches (frontend layer)
* c — Runtime Checks in ai-drafts.ts (logic layer)
