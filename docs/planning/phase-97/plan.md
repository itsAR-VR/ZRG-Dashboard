# Phase 97 — AI Auto-Send: Qualification-Friendly Evaluator + Configuration Visibility

## Purpose
Mitigate why AI is not auto-sending (or rarely auto-sending) by (1) making the auto-send evaluator **less conservative** about standard business qualification questions and (2) making configuration + outcomes **visible** in the dashboard so "is this configured?" vs "was it blocked?" is obvious.

## Context
Jam report: `https://jam.dev/c/678ee571-e8e8-458b-a9af-c815a1e37dfc`

Observed in Jam:
- A pending email draft exists, but auto-send did not occur.
- The draft was evaluated and marked `autoSendAction="needs_review"` with low confidence, and the recorded reason describes a standard qualification ask (revenue bracket) as "sensitive" and requiring review.

Repo reality (important nuance):
- Auto-send only runs when `EmailCampaign.responseMode === "AI_AUTO_SEND"`.
- If a campaign exists and is `SETTER_MANAGED`, the legacy per-lead auto-reply path **does not** run (draft-only behavior). See `lib/auto-send/README.md`.

Decisions locked from conversation:
- **Qualification policy:** Allow configured qualification questions (e.g., revenue/headcount) to be auto-sent when otherwise safe. Do not treat them as inherently "sensitive/personal data".
- **Campaign mitigation:** Warn-only when campaigns appear to be "AI" (e.g., name contains "AI Responses") but are still `SETTER_MANAGED`. No auto-enable or bulk updates.

## Concurrent Phases
Recent phases touched adjacent AI and dashboard surfaces; treat them as integration constraints.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 96 | Complete | `components/dashboard/action-station.tsx` (draft actions UX) | Avoid changing compose UX here; keep work in campaign panel + evaluator logic. |
| Phase 95 | Complete | Slack auto-send DM flows + draft regeneration | Ensure evaluator changes don't break Slack review gating semantics. |
| Phase 94 | Complete | AI prompt runner patterns, budgets/timeouts | Follow established prompt/runner conventions; keep evaluator output strict and bounded. |

---

## Repo Reality Check (RED TEAM)

### What Exists Today

| Component | File Path | Verified |
|-----------|-----------|----------|
| Evaluator system prompt | `lib/ai/prompt-registry.ts:104-120` (`AUTO_SEND_EVALUATOR_SYSTEM`) | ✓ |
| Evaluator runtime | `lib/auto-send-evaluator.ts:26-210` (`evaluateAutoSend`) | ✓ |
| Auto-send orchestrator | `lib/auto-send/orchestrator.ts` (`executeAutoSend`) | ✓ |
| Auto-send decision recorder | `lib/auto-send/record-auto-send-decision.ts` | ✓ |
| Campaign assignment UI | `components/dashboard/settings/ai-campaign-assignment.tsx:144-550` (`AiCampaignAssignmentPanel`) | ✓ |
| Analytics actions | `actions/analytics-actions.ts` (uses `requireAuthUser()`) | ✓ |
| Email campaign actions | `actions/email-campaign-actions.ts` | ✓ |
| Lead actions | `actions/lead-actions.ts` | ✓ |
| Orchestrator tests | `lib/auto-send/__tests__/orchestrator.test.ts` | ✓ |
| AIDraft model | `prisma/schema.prisma:937-957` (`autoSendAction`, `autoSendConfidence`, etc.) | ✓ |
| Message model | `prisma/schema.prisma:817` (`sentBy` = 'ai' | 'setter') | ✓ |
| EmailCampaign model | `prisma/schema.prisma:1078-1090` (`responseMode`, `autoSendConfidenceThreshold`) | ✓ |

### Current Evaluator Prompt (Line 104-120)

```
Hard blockers (always require human review, safe_to_send=false, confidence<=0.2):
- Any unsubscribe/opt-out/stop/remove language in the inbound reply or subject
- The inbound asks for specifics the draft cannot safely answer without missing context (pricing, exact details, attachments, etc.)
- The draft appears hallucinated, mismatched to the inbound, or references facts not in the transcript
- The draft asks for or reveals sensitive/personal data or credentials
```

**Gap identified:** "sensitive/personal data" is too broad—it includes standard business qualification questions like revenue/headcount which should be allowed.

### Current Output Interpretation (lib/auto-send-evaluator.ts:200-202)

```ts
const confidence = clamp01(Number(result.data.confidence));
const safeToSend = Boolean(result.data.safe_to_send) && confidence >= 0.01;
const requiresHumanReview = Boolean(result.data.requires_human_review) || !safeToSend;
```

**Gap identified:** This allows contradictory JSON (`safe_to_send=true` AND `requires_human_review=true`) to still result in `safeToSend=true`. The plan says to tighten this but current logic actually does handle it correctly since `requiresHumanReview` will be true if the model says so. However, the **upstream** consumer in orchestrator only checks `safeToSend` for the send decision—needs verification.

---

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-Risk Failure Modes

| Risk | Mitigation |
|------|------------|
| **Evaluator still blocks qualification questions after prompt update** | Add explicit positive examples in prompt: "Revenue/headcount/team size qualification questions are safe to auto-send when the draft does not ask for passwords/banking/government IDs." |
| **Contradictory JSON (`safe_to_send=true` + `requires_human_review=true`) slips through** | Tighten interpretation: `safeToSend = result.safe_to_send === true && result.requires_human_review === false && confidence >= 0.01`. Add validation in orchestrator test. |
| **UI warning for "AI Responses" campaign is too noisy** | Only show warning if campaign name contains "AI Responses" OR "Auto Send" (case-insensitive). Make warning dismissible per-session (CSS only, no DB). |
| **Stats query is slow for large workspaces** | Use indexed fields: `autoSendAction` (indexed at line 955), `autoSendEvaluatedAt` (indexed at line 956). Add `LIMIT` and aggregate in DB, not JS. |

### Missing or Ambiguous Requirements

| Gap | Resolution |
|-----|------------|
| **Phase 97c query: What time window for "Last N days"?** | Default 30 days (plan says so). Add optional `days` param. |
| **Phase 97c query: What counts as "AI sent"?** | `Message.direction='outbound' AND Message.sentBy='ai' AND Message.source='zrg' AND Message.aiDraftId IS NOT NULL`. Scoped to leads in `AI_AUTO_SEND` campaigns. |
| **Phase 97c query: What counts as "Scheduled"?** | `AIDraft.autoSendAction='send_delayed'`. Count distinct drafts in window. |
| **Phase 97c query: What counts as "Needs review"?** | `AIDraft.autoSendAction='needs_review'`. Count distinct drafts in window. |
| **Phase 97c query: What counts as "Skipped"?** | `AIDraft.autoSendAction='skip'`. Count distinct drafts in window. |
| **Phase 97b: Which exact campaign name patterns trigger warning?** | Use regex: `/ai\s*(responses?|auto[-\s]?send)/i`. |

### Repo Mismatches (Fix the Plan)

| Issue | Correction |
|-------|------------|
| Plan 97a says `evaluateAutoSend()` already has `safeToSend = safe_to_send === true && confidence >= 0.01` | ✓ Verified. But it does NOT check `requires_human_review === false` in the `safeToSend` assignment. **This must be added.** |
| Plan 97c references `actions/auto-send-analytics-actions.ts` (new file) | ✓ Correct—file does not exist, must be created. |
| Plan 97c says `AI Sent / AI Review` filters exist in `lead-actions.ts` | ✓ Verified: `getInboxLeads` has `attentionFilter` including `AI_SENT`, `AI_REVIEW`. |
| Plan 97d references `lib/auto-send/__tests__/orchestrator.test.ts` | ✓ Verified: file exists with existing tests for `determineAutoSendMode` and `executeAutoSend`. |

### Performance / Timeouts

| Risk | Mitigation |
|------|------------|
| Stats query on `AIDraft` could scan many rows | Use date-bounded query with index on `autoSendEvaluatedAt`. Aggregate counts in Prisma `groupBy`. |
| Stats query on `Message` for AI-sent count | Use compound index hint: filter by `direction`, `sentBy`, `source`, `aiDraftId`. |

### Security / Permissions

| Risk | Mitigation |
|------|------------|
| Stats action must enforce workspace access | Use `requireAuthUser()` + `accessibleClientWhere(user.id)` pattern from `analytics-actions.ts`. |
| Do not expose raw `autoSendReason` (could contain lead PII excerpts) | Return **counts only**, not reasons or message bodies. |

### Testing / Validation

| Gap | Mitigation |
|-----|------------|
| No test for contradictory JSON interpretation | Add unit test in Phase 97d: mock `safe_to_send=true, requires_human_review=true` → expect `safeToSend=false`. |
| No test for qualification question allowance | Add integration test or manual QA step: inbound asks about revenue, draft responds with qualification question, evaluator should return `safe_to_send=true` with high confidence. |
| UI warning visibility not tested | Manual QA: create campaign named "AI Responses Test" with `SETTER_MANAGED`, verify warning appears. |

### Multi-Agent Coordination

| Check | Status |
|-------|--------|
| Last 10 phases scanned for overlap | ✓ Phases 94-96 complete, no uncommitted changes that conflict. |
| Uncommitted changes in target files | ✓ `git status` shows only `docs/planning/phase-97/` untracked. |
| Schema changes | ✗ None required—all fields exist. |
| Coordination strategy | Phase 97 is isolated to evaluator prompt, evaluator interpretation, campaign panel UI, and new analytics action. No overlapping files with active phases. |

---

## Objectives
* [x] Update auto-send evaluator instructions so common qualification questions are not hard-blocked as "sensitive".
* [x] Tighten evaluator output interpretation to prevent accidental sends on contradictory JSON (e.g., `safe_to_send=true` but `requires_human_review=true`).
* [x] Add dashboard warnings when a campaign name implies AI but response mode is `SETTER_MANAGED`.
* [x] Add lightweight auto-send stats (counts only) so the "extent" is measurable from the UI.
* [x] Add targeted tests + a manual QA checklist.

## Constraints
- Do not weaken core safety:
  - Hard-block opt-outs/unsubscribe/stop/remove language.
  - Hard-block credentials and highly sensitive PII (passwords, tokens, banking/SSN, etc.).
  - Block hallucinations/mismatch or missing required context (pricing specifics, attachments, etc.).
- No bulk campaign edits; warnings only.
- Never commit secrets/tokens; do not log PII.
- Keep actions consistent with repo convention: return `{ success, data?, error? }`.

## Success Criteria
* [x] Auto-send evaluator no longer blocks solely because the draft asks a standard business qualification question (e.g., revenue/headcount) when the thread context supports it. *(Implemented; requires production observation to confirm behavior in-the-wild.)*
* [ ] For `AI_AUTO_SEND` campaigns, the ratio of `needs_review` driven by "qualification question is sensitive" decreases measurably. *(Requires deploy + monitoring window.)*
* [x] `components/dashboard/settings/ai-campaign-assignment.tsx` clearly warns when campaign naming implies AI but mode is setter-managed.
* [x] A dashboard stats block can answer:
  - "How many campaigns are AI auto-send vs setter-managed?"
  - "In the last N days: how many drafts were sent/scheduled/reviewed/skipped?"
* [x] `npm run test` passes; lint/build remain passing.

## Subphase Index
* a — Evaluator Prompt + Output Semantics
* b — Campaign Panel Warnings (Warn-only)
* c — Auto-Send Stats (Action + UI)
* d — Tests + QA Checklist

---

## Assumptions (Agent)

1. **Assumption:** Qualification questions (revenue/headcount/team size) are universally safe across all workspaces.
   - *Confidence:* ~95%
   - *Mitigation:* If a workspace requires blocking these, add a workspace-level setting in a future phase.

2. **Assumption:** The warning pattern `/ai\s*(responses?|auto[-\s]?send)/i` captures the naming conventions in use.
   - *Confidence:* ~90%
   - *Mitigation:* If users report false negatives, expand the pattern.

3. **Assumption:** 30-day window is appropriate default for stats.
   - *Confidence:* ~95%
   - *Mitigation:* Parameter is configurable; adjust default if feedback suggests otherwise.

4. **Assumption:** Contradictory JSON from evaluator (`safe_to_send=true` + `requires_human_review=true`) should always be treated as NOT safe.
   - *Confidence:* ~99%
   - *Mitigation:* This is a safety-first interpretation. No alternative needed.

---

## Open Questions (Need Human Input)

None—all requirements are sufficiently specified from the Jam report and conversation context.

---

## Phase Summary

### Status
✅ Implemented (manual production verification pending)

### What shipped
- Qualification-friendly auto-send evaluator prompt + confidence calibration. (`lib/ai/prompt-registry.ts`)
- Safety-first evaluator interpretation (no sends when `requires_human_review=true`, even if `safe_to_send=true`). (`lib/auto-send-evaluator.ts`)
- Warn-only UI for campaigns named “AI Responses” but still setter-managed. (`components/dashboard/settings/ai-campaign-assignment.tsx`)
- Counts-only auto-send stats surfaced in the campaign assignment panel. (`actions/auto-send-analytics-actions.ts`, `components/dashboard/settings/ai-campaign-assignment.tsx`)
- Unit tests for evaluator interpretation. (`lib/auto-send/__tests__/auto-send-evaluator.test.ts`)

### Verification
- `npm run test`: ✅ pass
- `npm run lint`: ✅ pass (warnings only)
- `npm run build`: ✅ pass

### Follow-ups
- Deploy and watch `AIDraft.autoSendAction` distribution and AI-sent outbound counts to confirm the `needs_review` ratio shifts as expected.
