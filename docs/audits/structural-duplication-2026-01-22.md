# Structural Duplication Audit Report

Date: 2026-01-22
Scope: ZRG Dashboard (core inbox + AI + booking + auto-send)

## Summary

- Duplication groups found:
  - **Group A — Inbound post-processing pipelines**: `lib/background-jobs/*-inbound-post-process.ts` share the same orchestration spine (fetch → classify → state updates → booking/snooze → draft → auto-send → scoring).
  - **Group B — Email reply send pipelines**: `actions/email-actions.ts:sendEmailReply` (draft approval) and `actions/email-actions.ts:sendEmailReplyForLead` (manual send) are parallel implementations of the same provider-send + persistence pipeline.
  - **Group C — “Prompt override + JSON schema call + parse + telemetry”**: repeated across `lib/auto-send-evaluator.ts`, `lib/auto-reply-gate.ts`, `lib/followup-engine.ts`, `lib/timezone-inference.ts`, and other AI features.
- Highest-risk drift points:
  - **Inbound pipelines (A)**: subtle changes (snooze gating, auto-book gating, transcript windows, draft eligibility) can diverge per channel/provider and cause inconsistent automation behavior.
  - **Email send pipelines (B)**: correctness/security issues (CC behavior, opt-out/guard checks, idempotency) can be fixed in one path and missed in the other.
  - **LLM call wrappers (C)**: inconsistent timeouts/budgets/retry policies lead to partial outputs, parse failures, and telemetry gaps that are hard to debug and easy to regress.
- Recommended kernel extraction targets:
  - `lib/inbound-post-process/` (new): shared inbound orchestration + adapters per channel/provider.
  - `actions/email-actions.ts` (internal kernel): a single shared “send email reply” implementation used by both draft and manual send facades.
  - `lib/ai/prompt-runner.ts` (new): a shared helper for “promptKey + overrides + JSON schema response parsing + categorized errors”.

## Candidate inventory

- Location: `lib/background-jobs/email-inbound-post-process.ts`
  - Purpose (1 sentence): Post-process inbound email messages (Inboxxia/EmailBison) with enrichment, booking/snooze handling, drafts, and auto-send.
  - Pipeline skeleton (stages in order):
    - Load message+lead+client(+campaign)
    - (Optional) AI sentiment classification + lead status update
    - Round-robin assignment (if enabled)
    - Snooze detection + follow-up pause-until
    - Auto-booking check
    - Enrichment (message extraction, EmailBison, signature, Clay)
    - Draft generation (email) + auto-send orchestration
    - Enqueue lead scoring
  - Distribution model: one BackgroundJob per inbound `Message`, cron-run job runner.
  - Notes: calls `executeAutoSend` (Phase 48) and reuses `processMessageForAutoBooking`.

- Location: `lib/background-jobs/sms-inbound-post-process.ts`
  - Purpose (1 sentence): Post-process inbound SMS messages with timezone/snooze, sentiment, drafts, and auto-send.
  - Pipeline skeleton (stages in order):
    - Load message+lead+client(+campaign)
    - Timezone inference
    - Snooze detection + follow-up pause-until
    - Sentiment classification (with optional SMS history sync)
    - Round-robin assignment (if enabled)
    - Pause follow-ups on reply
    - Auto-booking check
    - Draft generation (sms) + auto-send orchestration
    - Bump rollups + enqueue lead scoring
  - Distribution model: one BackgroundJob per inbound `Message`.
  - Notes: transcript window differs from email; channel-only transcript.

- Location: `lib/background-jobs/smartlead-inbound-post-process.ts`
  - Purpose (1 sentence): Post-process inbound SmartLead emails with sentiment mapping, snooze, booking, drafts, and auto-send.
  - Pipeline skeleton (stages in order):
    - Load message+lead+client(+campaign)
    - Build transcript (cross-channel)
    - Sentiment classification (Inbox classification → sentiment fallback)
    - Update lead status + assignment + follow-up policy
    - Pause follow-ups on reply
    - Snooze detection + auto-booking
    - Reject drafts on blacklist/automated
    - GHL sync (positive) + resume enrichment
    - Draft generation (email) + auto-send orchestration
    - Bump rollups + enqueue lead scoring
  - Distribution model: one BackgroundJob per inbound `Message`.
  - Notes: near-duplicate of Instantly.

- Location: `lib/background-jobs/instantly-inbound-post-process.ts`
  - Purpose (1 sentence): Post-process inbound Instantly emails with sentiment mapping, snooze, booking, drafts, and auto-send.
  - Pipeline skeleton: structurally equivalent to SmartLead with provider-specific thread context.
  - Distribution model: one BackgroundJob per inbound `Message`.
  - Notes: strong candidate for shared kernel + provider adapter seam.

- Location: `actions/email-actions.ts` (`sendEmailReply`, `sendEmailReplyForLead`)
  - Purpose (1 sentence): Send outbound email replies (AI draft approval vs manual) across EmailBison/SmartLead/Instantly, then persist outbound Message + sync.
  - Pipeline skeleton (stages in order):
    - Resolve lead + provider configuration
    - Find latest inbound thread handle (provider-specific)
    - EmailGuard validation + opt-out/blacklist backstops
    - Provider send call (EmailBison/SmartLead/Instantly)
    - Persist outbound `Message` row (+ rollups, follow-ups, optional conversation sync)
    - (Draft path only) mark draft approved
  - Distribution model: synchronous server action; optionally triggers background sync job.
  - Notes: duplication increases drift risk on CC, safety checks, and provider-specific edge cases.

- Location: “LLM JSON schema call” sites (examples: `lib/auto-send-evaluator.ts`, `lib/auto-reply-gate.ts`, `lib/followup-engine.ts`)
  - Purpose (1 sentence): Repeated pattern for “override-aware prompt → call Responses API → parse JSON → categorize errors”.
  - Pipeline skeleton (stages in order):
    - `getPromptWithOverrides(promptKey, clientId)` + fallback to registry template
    - Build system prompt / input messages (template var substitution in some paths)
    - `computeAdaptiveMaxOutputTokens` sizing
    - `runResponse`/`runResponseWithInteraction` call
    - Parse JSON (often via `extractJsonObjectFromText` / `extractFirstCompleteJsonObjectFromText`)
    - Categorize/record errors (`markAiInteractionError`) + safe fallback behavior
  - Distribution model: synchronous within background jobs / actions.
  - Notes: high-leverage kernel candidate to standardize timeouts, retries, and telemetry.

## Structural duplication map

### Group A: Inbound post-processing pipelines

- Members:
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `lib/background-jobs/sms-inbound-post-process.ts`
  - `lib/background-jobs/smartlead-inbound-post-process.ts`
  - `lib/background-jobs/instantly-inbound-post-process.ts`
  - (partial overlap) `lib/background-jobs/linkedin-inbound-post-process.ts`
- Shared spine stages:
  - Load message + lead + client (+ campaign)
  - Build transcript (varies by channel/provider)
  - Sentiment classification + lead status updates
  - Round-robin assignment (Phase 43)
  - Pause follow-ups on inbound
  - Snooze detection
  - Auto-booking check
  - Draft generation + `executeAutoSend(...)` (Phase 48)
  - Enqueue lead scoring
- Divergent stages (operator differences):
  - EmailBison enrichment + sync (email only)
  - SMS history sync (sms only)
  - SmartLead/Instantly classification mapping + “autoFollowUpsOnReply” policy
  - LinkedIn has enrichment + no snooze/auto-book
- Drift risk notes:
  - **Transcript windows** differ (channel-only vs cross-channel), which can cause different “latest inbound” context depending on channel.
  - **Snooze detection** is repeated verbatim; small edits in one file can silently diverge behavior.
  - **Auto-book side effects** (follow-up task creation, sentiment adjustments) are shared but are called from multiple places.

### Group B: Email reply send pipelines

- Members:
  - `actions/email-actions.ts:sendEmailReply` (AI draft approval send)
  - `actions/email-actions.ts:sendEmailReplyForLead` (manual send)
- Shared spine stages:
  - Load lead + client + resolve email provider
  - Find thread handle (provider-specific `emailBisonReplyId` prefix rules)
  - EmailGuard validation and opt-out safety
  - Send via provider API
  - Persist outbound Message + rollups + follow-up triggers
- Divergent stages (operator differences):
  - Draft path marks `AIDraft.status = approved` and provides draft-id idempotency
  - Manual path has UI access gating in caller (not in function)
- Drift risk notes:
  - **CC behavior and validation** is especially drift-prone because it touches UI, provider payloads, and DB persistence.

### Group C: Prompt override + JSON schema call pipeline

- Members (examples):
  - `lib/auto-send-evaluator.ts:evaluateAutoSend`
  - `lib/auto-reply-gate.ts:decideShouldAutoReply`
  - `lib/followup-engine.ts:detectMeetingAcceptedIntent`, `parseAcceptedTimeFromMessage`
- Shared spine stages:
  - Resolve template + overrides
  - Adaptive token budget
  - Responses API call (often json_schema strict)
  - Parse + validate output
  - Telemetry + categorized failures + safe fallback
- Divergent stages (operator differences):
  - Different timeout env vars and retry loops
  - Different parsing helpers and truncation handling
- Drift risk notes:
  - Inconsistent handling of `status="incomplete"` / `max_output_tokens` can produce partial/unsafe outputs (e.g., truncated links).

## Proposed unification (preserving semantic boundaries)

### Group A

- Domain boundaries to preserve:
  - Keep per-job entrypoints (`runSmsInboundPostProcessJob`, `runSmartLeadInboundPostProcessJob`, etc.) and their job payload contracts.
  - Keep provider-specific enrichment and classification logic separate.
- Kernel candidate module:
  - `lib/inbound-post-process/pipeline.ts` (new)
- Minimal abstraction seam:
  - `InboundAdapter` providing:
    - `buildTranscript(leadId, messageId) -> { transcript, latestInboundText, subject? }`
    - `classifySentiment(...)`
    - `runEnrichment(...)` (optional)
    - `getChannel(): "sms"|"email"|"linkedin"`
    - `shouldDraft(sentimentTag, lead)`
    - `postDraft(...)` hooks (optional)
- Expected call shape (pseudocode-level, not full code):
  - `await runInboundPostProcess(params, smsAdapter)`

### Group B

- Domain boundaries to preserve:
  - Keep exported server actions `sendEmailReply(...)` and `sendEmailReplyForLead(...)` intact for callers/UI.
- Kernel candidate module:
  - Private internal helper in `actions/email-actions.ts` (e.g., `sendEmailReplyInternal(...)`).
- Minimal abstraction seam:
  - Input bundle containing:
    - `leadId`, `messageContent`, `provider`, `replyKey`, `ccOverride?`, `{ sentBy, sentByUserId }`, optional `aiDraftId`.
- Expected call shape (pseudocode-level, not full code):
  - `await sendEmailReplyInternal({ leadId, content, ccOverride, aiDraftId })`

### Group C

- Domain boundaries to preserve:
  - Keep feature-facing functions and their business semantics (auto-reply gate, auto-send evaluation, booking parse).
- Kernel candidate module:
  - `lib/ai/prompt-runner.ts` (new) or `lib/ai/run-json-schema.ts` (new)
- Minimal abstraction seam:
  - `runPromptJsonSchema({ clientId, leadId?, promptKey, templateVars?, model, timeoutMs, budget, schema, parse/validate })`

## Subtle abstraction assessment

- Is subtle abstraction required? **Yes**
- Why:
  - Group A and C require a shared kernel + strategy seam without erasing domain boundaries, and any unification must preserve nuanced behavior (timeouts, idempotency, per-provider parsing).

## Staged plan (safe refactor path)

## Stage 0 — Guardrails

- Add/identify tests that assert output equivalence for each pipeline.
- Add fixtures/snapshots for representative inputs.
- Confirm performance/memory expectations (if relevant).

## Stage 1 — Extract shared pure helpers

- Extract “snooze keyword hit” gating into a single helper (shared by email/sms/smartlead/instantly).
- Extract “auto-book invocation wrapper” that accepts an explicit channel hint.
- Extract email CC normalization/validation into a single helper (already done in this pass).

## Stage 2 — Introduce seam interface

- Define a minimal `InboundAdapter` interface for inbound pipelines (Group A).
- Define a minimal `runPromptJsonSchema(...)` interface for repeated LLM-call skeletons (Group C).

## Stage 3 — Extract pipeline spine into kernel

- Create `runInboundPostProcess(...)` and migrate one job first (recommend: SmartLead + Instantly as they are near-identical).
- Migrate email/sms once adapter shape stabilizes.

## Stage 4 — Cleanup and consolidate

- Remove duplicated local helpers (e.g., duplicated auto-follow-up policy and classification mapping blocks).
- Ensure no circular imports; keep adapters thin.

## Stage 5 — Optional: Performance polish (only if needed)

- Harmonize transcript windows (channel-only vs cross-channel) behind adapter config.
- Standardize time budgets and retry policies across all JSON-schema AI calls.

## Risks and non-goals

- What we are NOT changing:
  - Campaign precedence contract for auto-send vs legacy auto-reply.
  - Booking process semantics (wave/stage rules).
  - Provider integrations behavior beyond safety/validation.
- Potential pitfalls:
  - Kernel extraction in Group A can accidentally change sequencing (ordering of snooze vs auto-book vs draft).
  - Over-abstraction in Group C can hide important per-feature constraints (e.g., “accept slot ONLY if unambiguous”).
- Follow-ups (optional):
  - Consider aligning SMS transcript building to include cross-channel context when multi-channel leads are active (Phase 47 intent).
  - Add an end-to-end regression harness for “offered slots → accept → auto-book” across email + sms.

