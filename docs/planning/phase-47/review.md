# Phase 47 — Review

## Summary
- `npm run lint`, `npm run build`, and `npm run db:push` all pass (2026-01-21).
- Prompt editor modal ships (message overrides + snippet overrides) and is admin-gated server-side.
- AI auto-send delay ships (3–7 min default, minutes UI / seconds DB, 0–60 min clamp, delayed send via BackgroundJobs).
- Several **critical correctness gaps** remain: workspace prompt modal cache leaks across workspaces; booking stage template edits are not preserved when updating a booking process; prompt editor is not fully aligned with runtime prompt construction for drafts; snippet registry/UI defaults are incomplete.

## What Shipped
- Prompt message overrides:
  - Prisma: `PromptOverride` + relations (`prisma/schema.prisma`).
  - Runtime override resolution + base hash drift detection (`lib/ai/prompt-registry.ts`).
  - Server actions to save/reset/list overrides (`actions/ai-observability-actions.ts`).
  - UI editor in Settings → AI Dashboard → “Backend Prompts” (`components/dashboard/settings-view.tsx`).
- Snippet overrides (variables):
  - Prisma: `PromptSnippetOverride` (`prisma/schema.prisma`).
  - Canonical defaults + runtime helpers for forbidden terms, email length rules, archetype instructions (`lib/ai/prompt-snippets.ts`).
  - Server actions to save/reset/list snippet overrides + a UI registry (`actions/ai-observability-actions.ts`).
  - UI Variables tab + nested forbidden-terms editor (`components/dashboard/settings-view.tsx`).
- Booking stage templates (backend/runtime only):
  - Prisma: `BookingProcessStage.instructionTemplates Json?` (`prisma/schema.prisma`).
  - Default templates + safe-ish renderer (`lib/booking-stage-templates.ts`).
  - Runtime injection uses per-stage templates (`lib/booking-process-instructions.ts`).
  - Admin-gated stage template update actions exist (`actions/booking-process-actions.ts`).
- AI auto-send delay:
  - Prisma: `EmailCampaign.autoSendDelayMinSeconds/MaxSeconds`, `BackgroundJobType.AI_AUTO_SEND_DELAYED`, `BackgroundJob.draftId` relation (`prisma/schema.prisma`).
  - Campaign settings UI (minutes) + persistence (seconds, clamped) (`components/dashboard/settings/ai-campaign-assignment.tsx`, `actions/email-campaign-actions.ts`).
  - Scheduling + execution via BackgroundJobs (`lib/background-jobs/delayed-auto-send.ts`, `lib/background-jobs/ai-auto-send-delayed.ts`, `lib/background-jobs/runner.ts`).
  - Inbound post-processors schedule delayed sends when configured (`lib/background-jobs/*-inbound-post-process.ts`).

## Verification

### Commands
- `npm run lint` — pass (2026-01-21 16:22 +03); 0 errors, 17 warnings.
- `npm run build` — pass (2026-01-21 16:22 +03).
- `npm run db:push` — pass / already in sync (2026-01-21 16:23 +03).

### Notes
- Next build emits unrelated warnings:
  - Multiple lockfiles / inferred workspace root warning.
  - “middleware convention deprecated” warning.

## Success Criteria → Evidence

1. Workspace admins can view and edit prompt messages in the AI Dashboard modal
   - Evidence: `components/dashboard/settings-view.tsx` (prompt modal, edit/save/reset), `actions/ai-observability-actions.ts` (admin-gated CRUD).
   - Status: **partial**
   - Why partial: prompt modal caches data across workspaces and can show the wrong workspace’s prompts/overrides; see **Risks**.

2. Workspace admins can view/edit prompt composition snippets (ex: forbidden terms) in a nested UI
   - Evidence: nested `{forbiddenTerms}` editor (`components/dashboard/settings-view.tsx`), snippet override CRUD (`actions/ai-observability-actions.ts`), runtime consumption (`lib/ai-drafts.ts` + `lib/ai/prompt-snippets.ts`).
   - Status: **partial**
   - Why partial: UI “snippet registry” is incomplete (only 4 entries) and uses truncated defaults; nested editor defaults are placeholder-ish and doesn’t update the Variables tab state.

3. Workspace admins can edit master variables inside the prompt modal (persona tone/greeting/goals/signature/company context)
   - Evidence: Variables tab shows persona *preview* + link out (`components/dashboard/settings-view.tsx`).
   - Status: **not met** (no inline persona editing in modal).

4. Workspace admins can edit booking process instruction templates, email length templates/bounds, and email archetype instructions
   - Evidence:
     - Email length template + bounds: runtime helpers exist (`lib/ai/prompt-snippets.ts`), UI edits exist for min/max/template (`actions/ai-observability-actions.ts:getSnippetRegistry`, `components/dashboard/settings-view.tsx` Variables tab).
     - Archetype instructions: runtime supports overrides (`lib/ai/prompt-snippets.ts`, `lib/ai-drafts.ts`).
     - Booking stage templates: runtime supports per-stage templates (`lib/booking-process-instructions.ts`, `lib/booking-stage-templates.ts`).
   - Status: **partial**
   - Why partial:
     - Archetype instructions: no UI surface to edit per-archetype snippet keys.
     - Booking stage templates: no UI surface; plus persistence risk when editing booking processes; see **Risks**.

5. Workspace admins can choose which AI persona context they are editing/previewing (default persona vs campaign persona)
   - Evidence: persona selector exists for preview (`components/dashboard/settings-view.tsx`).
   - Status: **partial**
   - Why partial: there’s no campaign → persona context selector and no inline editing; only a preview dropdown of personas + link out.

6. AI_AUTO_SEND campaigns can configure delay; auto-sends occur after delay and are cancellable if conversation changes (incl. new inbounds across channels)
   - Evidence:
     - Persist + clamp: `actions/email-campaign-actions.ts` (`clampDelaySeconds`, `updateEmailCampaignConfig`).
     - UI minutes range: `components/dashboard/settings/ai-campaign-assignment.tsx`.
     - Schedule + cancel: `lib/background-jobs/delayed-auto-send.ts:validateDelayedAutoSend` checks newer inbound/outbound globally by `leadId`.
   - Status: **mostly met**
   - Known gap: if delay is configured as `0`, the immediate-send path does not apply the same “newer inbound/outbound” cancellation checks before sending.

7. Edits persist to database and are used in AI calls for that workspace
   - Evidence: PromptOverride/SnippetOverride models (`prisma/schema.prisma`), overrides applied in several call sites (`lib/sentiment.ts`, `lib/auto-reply-gate.ts`, `lib/auto-send-evaluator.ts`, etc.).
   - Status: **partial**
   - Why partial: many prompt templates shown in the editor are not the true source of runtime prompt text (notably draft generation); see **Plan Adherence** and **Risks**.

8. “Reset to Default” restores original content
   - Evidence: message-level reset (`actions/ai-observability-actions.ts:resetPromptOverride`, UI reset buttons), snippet reset (`resetPromptSnippetOverride`, UI reset).
   - Status: **met** (at message/snippet level; no “reset all overrides for prompt” UI).

9. Changes reflected immediately in new AI interactions
   - Evidence: overrides resolved at call time in several LLM call sites (e.g. `lib/auto-reply-gate.ts`, `lib/auto-send-evaluator.ts`, `lib/sentiment.ts`).
   - Status: **partial** (depends on whether that call site actually uses registry message text vs hardcoded builders).

10. `npm run lint` passes
   - Evidence: command output (2026-01-21 16:22 +03).
   - Status: **met**

11. `npm run build` passes
   - Evidence: command output (2026-01-21 16:22 +03).
   - Status: **met**

12. `npm run db:push` completes successfully
   - Evidence: command output (2026-01-21 16:23 +03).
   - Status: **met**

## Plan Adherence
- The phase plan intended “editor == runtime source of truth.” Current implementation is **mixed**:
  - Some call sites use `promptTemplate.messages[system]` (good; prompt overrides affect runtime).
  - Others append `overrideVersion` to telemetry but still build `instructions` in code (draft SMS/LinkedIn), meaning overrides appear “used” in telemetry but may not actually affect the prompt text.

## Risks / Rollback

### Critical — Workspace prompt editor cache leak
- Evidence: `components/dashboard/settings-view.tsx` prompt-load effect bails out permanently once `aiPromptTemplates` is set (`if (aiPromptTemplates) return;` at ~587) and never resets templates/overrides/snippets/registry on workspace change or modal close (close handler clears only editing state at ~3209–3217).
- Impact: switching workspaces can show stale prompts/snippets/personas from another workspace, increasing risk of accidental edits in the wrong workspace and cross-tenant data exposure in the UI.

### Critical — Booking stage templates are not preserved by booking process updates
- Evidence: `actions/booking-process-actions.ts:updateBookingProcess` deletes and recreates stages (around ~270–306) but does not carry `instructionTemplates`, so any stage template overrides are lost when the booking process is edited via the existing process editor.
- Impact: stage-scoped booking phrasing edits are fragile and can silently reset.

### High — Snippet registry/UI is not the canonical registry
- Evidence: `actions/ai-observability-actions.ts:getSnippetRegistry` hardcodes only 4 entries and uses truncated defaults (`"Tailored\nSurface\nActionable\nAccordingly\nAdditionally..."` etc.).
- Impact: admins cannot view/edit archetype instructions (despite runtime support) and cannot see the real default forbidden terms list in the dashboard.

### High — Draft prompt edits are not fully wired to runtime
- Evidence:
  - Registry includes `draft.generate.sms.v1` / `draft.generate.linkedin.v1` templates (`lib/ai/prompt-registry.ts` around ~696–725),
  - but runtime draft generation uses `buildSmsPrompt`/`buildLinkedInPrompt` strings instead of template content (`lib/ai-drafts.ts` around ~255 and ~1688–1775).
- Impact: prompt editor changes for those keys may not change runtime prompts; telemetry may still claim an override version was used.

## Follow-ups (Completed 2026-01-21)
- ✅ Fix prompt modal caching/reset across workspaces
  - Evidence: `components/dashboard/settings-view.tsx` (reset on `activeWorkspace` change + on modal close).
- ✅ Preserve `BookingProcessStage.instructionTemplates` across booking process updates
  - Evidence: `actions/booking-process-actions.ts` (update stages in-place; stage IDs carried from UI).
  - Evidence: `components/dashboard/settings/booking-process-manager.tsx` + `lib/booking-process-templates.ts` (stage `id` included in stage payload).
- ✅ Unify UI snippet registry with canonical defaults + include archetype editors
  - Evidence: `actions/ai-observability-actions.ts` (registry derived from `SNIPPET_DEFAULTS`).
  - Evidence: `components/dashboard/settings-view.tsx` (Variables tab renders full registry; nested forbidden terms editor uses registry defaults).
- ✅ Align draft generation to consume prompt registry templates (SMS/LinkedIn)
  - Evidence: `lib/ai-drafts.ts` (builds `instructions`/`input` from `getPromptWithOverrides(...)` template).
  - Evidence: `lib/ai/prompt-registry.ts` (SMS/LinkedIn system templates include `qualificationQuestions`; overrideVersion reflects applied overrides).
- ✅ Apply cancellation validation to immediate-send path when delay window is `0`
  - Evidence: `lib/background-jobs/*-inbound-post-process.ts` (AI_AUTO_SEND immediate-send calls `validateDelayedAutoSend(...)` before sending).
