# Phase 112e — Rollout Guardrails (Feature Flag, Rollback, Monitoring)

## Focus
Ship the shared LeadContextBundle safely by adding explicit rollout controls, a rollback path, and monitoring signals so we can detect confidence drift and truncation regressions before they cause unsafe auto-sends or booking mistakes.

## Inputs
- Shared context builder from Phase 112b/112c
- Existing persisted signals we can monitor without schema changes:
  - Auto-send decisions on `AIDraft` (confidence/threshold/action/reason): `lib/auto-send/record-auto-send-decision.ts`
  - Meeting overseer decisions (extract/gate payload + confidence): `MeetingOverseerDecision` in `prisma/schema.prisma`
  - Proposed-times parsing prompt key: `followup.parse_proposed_times.v1` in `lib/followup-engine.ts`
- Existing telemetry plumbing:
  - `lib/ai/openai-telemetry.ts` (AIInteraction metadata capture)
  - prompt runner (`lib/ai/prompt-runner/*`)

## Work
1. Pre-flight conflict check
   - `git status --porcelain`
   - Re-read current versions of:
     - `lib/ai-drafts.ts`
     - `lib/meeting-overseer.ts`
     - `lib/auto-send-evaluator-input.ts`
     - `lib/knowledge-asset-context.ts`
     - `lib/lead-memory-context.ts`

2. Define rollout controls (explicit and reversible)
   - Add an env-driven gate for the shared bundle, default OFF.
   - Add a per-client allowlist mode (comma-separated clientIds) to turn it on for one workspace at a time.
   - Document the kill-switch behavior and the expected rollback time (no redeploy if env var change is enough).

3. Define “safe fallback” behavior
   - If shared bundle build fails (DB read error, unexpected nulls, budget math), fall back to the current per-pipeline context assembly.
   - Fallback must be best-effort and must not block draft creation (align with Phase 109 non-fatal behavior).

4. Add monitoring signals (stats-only, no PII)
   - Emit per-call stats for:
     - included/truncated knowledge assets
     - lead memory included entries + truncation count
     - total tokens estimated per section
   - Ensure these are available in a debuggable place (AIInteraction metadata and/or structured logs), without message bodies.

5. Define rollout success metrics + guardrails
   - Auto-send:
     - monitor distribution of `AIDraft.autoSendConfidence` (pre vs post)
     - monitor needs-review rate and how often needs-review later becomes `APPROVED` vs `EDITED`
   - Overseer:
     - monitor gate decision rates (approve vs revise) and confidence buckets
   - Proposed-times:
     - monitor booking attempts triggered by parse and match rates (if observable), and ensure we don’t increase “wrong bookings”

6. Manual smoke checklist (before expanding allowlist)
   - Pick 1-2 internal workspaces and:
     - generate a draft for a scheduling-related inbound and confirm overseer still gates (non-fatal)
     - run auto-send evaluator on a pricing-related thread and confirm “verified context” is present and truncation stats make sense
     - confirm no raw lead memory text is logged

## Output
- A documented rollout/rollback playbook:
  - env var names + example values
  - how to enable for one clientId
  - how to disable globally
  - what to monitor (fields/queries) to detect regressions

## Handoff
Phase 112b/112c implementation should consume these rollout controls (gated execution + fallback) and should not ship an always-on behavior change without the kill-switch.

