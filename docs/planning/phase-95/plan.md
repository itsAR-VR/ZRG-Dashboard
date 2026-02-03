# Phase 95 — Fast Regenerate (Slack + Dashboard)

## Purpose
Add a **token-efficient, fast AI regeneration path** that rewrites the **latest draft** using the **10 email archetypes** (for email) with minimal context, exposed in both:
- Slack auto-send review DMs (as a `Regenerate` button)
- The dashboard compose UI (as a `Fast Regen` button alongside the existing full regen)

## Context
Today, draft regeneration uses the same heavy path as initial generation (`actions/message-actions.ts:regenerateDraft` → `lib/ai-drafts.ts:generateResponseDraft`) which:
- Rebuilds an 80-message transcript
- Runs the full email pipeline (strategy + generation + verifier)
- Is slower and more token-expensive

We already have:
- Slack auto-send review DMs with interactive actions (`lib/auto-send/orchestrator.ts`) and a Slack interactions webhook (`app/api/webhooks/slack/interactions/route.ts`) handling `Approve & Send`.
- A UI regenerate button in the dashboard compose panel (`components/dashboard/action-station.tsx`) calling `regenerateDraft`.
- Email structural archetypes defined in `lib/ai-drafts/config.ts` (`EMAIL_DRAFT_STRUCTURE_ARCHETYPES` = 10 archetypes).

This phase adds a new **fast regeneration** mode:
- Uses the **previous draft** as the primary context
- Uses only a **small snippet** of the most recent inbound message (not full transcript)
- Cycles through archetypes across clicks (email), so repeated regenerations change structure
- Keeps the critical safety and formatting constraints (canonical booking link enforcement, forbidden terms, opt-out guardrails, no “meeting booked” claims)

Decisions locked from conversation:
- Slack scope: **Auto-Send Review DMs only**
- Slack regenerate behavior: **create a new draft** (reject prior pending)
- Archetype mode (email): **cycle to a different archetype each click**
- Dashboard: expose fast regenerate for **Email + SMS + LinkedIn**
- Dashboard UX: show **both** controls as **labeled buttons** (`Fast Regen`, `Full Regen`)
- Fast regen behavior: **reject + create new draft** (same as Slack)

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 94 | Uncommitted working tree | `lib/ai-drafts.ts`, AI timeouts/token budgets, cron hardening | Must re-read latest file state before implementing fast regen; avoid reintroducing timeout cliffs; merge semantics carefully. |
| Phase 96 | Uncommitted working tree | `components/dashboard/action-station.tsx` button cluster | Both phases modify action-station.tsx. Execute Phase 95 first (adds new buttons), then Phase 96 can work around them. |
| Phase 87 | Complete/landed plan | `components/dashboard/action-station.tsx` action button cluster | Ensure new buttons integrate with existing compose actions (refresh availability, approve/send) and don't regress layout/behavior. |
| Phase 86 | (Older) availability + cron patterns | Indirect | No direct overlap; only reuse patterns if needed. |

## Objectives
* [x] Implement a shared fast-regeneration core that rewrites the previous draft with minimal context. ✅ (95a complete)
* [x] Add Slack `Regenerate` button to the Auto-Send Review DM and implement the Slack interaction handler. ✅ (95b complete)
* [x] Add dashboard `Fast Regen` button and server action; keep existing full regen available. ✅ (95c complete)
* [x] Add unit tests for archetype cycling and Slack block rendering; run lint/build. ✅ (95d complete)

## Constraints
- Never commit secrets/tokens; Slack verification must remain strict (`SLACK_SIGNING_SECRET`).
- Fast regen must be **faster and more token-efficient** than full regen:
  - No 80-message transcript building
  - No knowledge-asset dumps (only include minimal workspace context needed)
  - Prefer a single rewrite call (no Step 3 verifier — use deterministic post-pass only)
- Email archetype cycling must not depend on new schema columns.
- Do not break existing auto-send review flow (`Approve & Send` must still work).
- Draft safety requirements remain:
  - Honor lead-provided scheduling link override
  - Enforce canonical booking link
  - Never imply a meeting is booked unless explicitly confirmed
  - If opt-out/bounce detected, output empty draft

### Technical Specifications (RED TEAM)
- **Model**: `gpt-5-mini` (configurable via `OPENAI_FAST_REGEN_MODEL`), `reasoningEffort: "minimal"` (fast rewrite)
- **SMS max chars**: 320
- **LinkedIn max chars**: 800
- **Email max chars**: Dynamic via `buildEffectiveEmailLengthRules(clientId)` bounds from `lib/ai/prompt-snippets.ts`
- **Signature handling**: Preserve from previous draft only (no re-injection)
- **Timeout**: Default `timeoutMs: 20_000`, target < 8s end-to-end
- **Error recovery (Slack)**: If regen succeeds but Slack update fails, keep draft in DB, log error — user recovers via dashboard

## Success Criteria
- [x] Slack auto-send review DM includes `Regenerate` and clicking it updates the message with:
  - New draft preview
  - Updated `Approve & Send` pointing at the new draft
  - Updated dashboard link pointing at the new draft
- [x] Dashboard compose UI shows `Fast Regen` and `Full Regen` and both work:
  - `Fast Regen` produces a new pending draft quickly
  - `Full Regen` preserves current behavior
- [x] Email `Fast Regen` cycles through different archetype structures across clicks.
- [x] `npm run lint` and `npm run build` pass.

## Subphase Index
* a — Fast Regen Core (email archetype cycling + SMS/LinkedIn rewrite) ✅ **COMPLETE**
* b — Slack Integration (button + interactions handler + message update) ✅ **COMPLETE**
* c — Dashboard Integration (server action + UI buttons) ✅ **COMPLETE**
* d — Tests + Verification (unit tests, lint/build, manual QA checklist) ✅ **COMPLETE**

## Phase Progress

| Subphase | Status | Key Artifacts |
|----------|--------|---------------|
| 95a | ✅ Complete | `lib/ai-drafts/fast-regenerate.ts` — `fastRegenerateDraftContent()`, `pickCycledEmailArchetypeId()` |
| 95b | ✅ Complete | `lib/auto-send/orchestrator.ts` — Regenerate button; `app/api/webhooks/slack/interactions/route.ts` — handler |
| 95c | ✅ Complete | `actions/message-actions.ts` — `fastRegenerateDraft()`; `components/dashboard/action-station.tsx` — `Fast Regen`/`Full Regen` buttons |
| 95d | ✅ Complete | `lib/ai-drafts/__tests__/fast-regenerate.test.ts`; `npm test`/`npm run lint`/`npm run build` ✅ |

---

## Repo Reality Check (RED TEAM)

### Verified Touch Points

| Plan Reference | Actual Location | Status |
|----------------|-----------------|--------|
| `EMAIL_DRAFT_STRUCTURE_ARCHETYPES` | `lib/ai-drafts/config.ts:72` | ✅ Verified (10 archetypes) |
| `getEffectiveArchetypeInstructions` | `lib/ai/prompt-snippets.ts:357` | ✅ Verified |
| `getEffectiveForbiddenTerms` | `lib/ai/prompt-snippets.ts:242` | ✅ Verified |
| `getEffectiveEmailLengthBounds` | `lib/ai/prompt-snippets.ts:281` | ✅ Verified |
| `enforceCanonicalBookingLink` | `lib/ai-drafts/step3-verifier.ts:23` | ✅ Verified |
| `replaceEmDashesWithCommaSpace` | `lib/ai-drafts/step3-verifier.ts:1` | ✅ Verified |
| `sanitizeDraftContent` | `lib/ai-drafts.ts:167` | ✅ Verified |
| `runTextPrompt` | `lib/ai/prompt-runner/index.ts` | ✅ Verified |
| `withAiTelemetrySourceIfUnset` | `lib/ai/telemetry-context.ts:22` | ✅ Verified |
| Slack interactions webhook | `app/api/webhooks/slack/interactions/route.ts` | ✅ Verified |
| Slack DM blocks | `lib/auto-send/orchestrator.ts:108-163` | ✅ Verified |
| `updateSlackMessageWithToken` | `lib/slack-dm.ts` | ✅ Verified |
| Action Station component | `components/dashboard/action-station.tsx` | ✅ Verified |
| `regenerateDraft` action | `actions/message-actions.ts` | ✅ Verified |

### Path Corrections Applied

| Original Plan | Correction |
|---------------|------------|
| Email length bounds | Use `buildEffectiveEmailLengthRules(clientId)` to obtain both bounds + workspace-specific rules text (then clamp to max chars as last-pass). |

---

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-Risk Failure Modes

| Risk | Mitigation |
|------|------------|
| Slack regenerate creates orphaned drafts if Slack update fails | Keep draft in DB, log error — user recovers via dashboard (confirmed decision) |
| Archetype cycling resets on page refresh/new Slack thread | Acceptable — cycling is ephemeral by design |
| Fast regen could timeout | Explicit `timeoutMs: 20_000` with retry on timeout/rate_limit once |
| No rate limiting on fast regen | Debounce via `isRegeneratingFast` disabled state in UI |

### Missing Requirements (Addressed)

| Gap | Resolution |
|-----|------------|
| SMS/LinkedIn channel max chars not defined | Added constants: SMS = 320, LinkedIn = 800 |
| Signature handling ambiguous | Preserve from previous draft only (confirmed decision) |
| Booking link resolution for canonical enforcement | Resolve via `Lead.workspaceCalendarLink` or existing calendar link resolution |
| Model choice unspecified | Use `gpt-5-mini` for all channels (confirmed decision) |
| Error state block template for Slack | Add `buildRegenErrorBlocks` helper in 95b |

### Telemetry Standards

| Item | Value |
|------|-------|
| Feature IDs | `draft.fast_regen.email`, `draft.fast_regen.sms`, `draft.fast_regen.linkedin` |
| Prompt keys | `draft.fast_regen.{channel}.v1.{archetypeId}` (email), `draft.fast_regen.{channel}.v1` (SMS/LinkedIn) |
| Source | `lib:draft.fast_regen` via `withAiTelemetrySourceIfUnset` |

---

## Assumptions (Agent)

1. **Fast regen creates a NEW pending draft and rejects the old one** (not in-place update) — matches existing full-regen behavior
2. **Email archetype cycling is acceptable to reset on page refresh** — ephemeral by design
3. **No database column needed for regen count** — ephemeral cycling is sufficient
4. **Fast regen does NOT run the full email verifier (Step 3)** — deterministic post-pass (booking link, em-dash cleanup) is sufficient for speed

---

## Phase Summary

### Status: ✅ COMPLETE (Reviewed 2026-02-03)

### What Shipped
- **Fast regen core**: `lib/ai-drafts/fast-regenerate.ts`
  - `fastRegenerateDraftContent()` — content-only rewrite
  - `pickCycledEmailArchetypeId()` — deterministic archetype cycling
- **Slack integration**:
  - `lib/auto-send/orchestrator.ts` — `Regenerate` button
  - `app/api/webhooks/slack/interactions/route.ts` — handler
- **Dashboard integration**:
  - `actions/message-actions.ts` — `fastRegenerateDraft()` server action
  - `components/dashboard/action-station.tsx` — `Fast Regen`/`Full Regen` buttons
- **Tests**:
  - `lib/ai-drafts/__tests__/fast-regenerate.test.ts`
  - `lib/auto-send/__tests__/orchestrator.test.ts`

### Verification
- `npm run lint`: ✅ Pass (0 errors)
- `npm run build`: ✅ Pass
- `npm run db:push`: ⏭️ Skipped (no schema changes)

### Review Artifact
See `docs/planning/phase-95/review.md` for detailed evidence mapping.
