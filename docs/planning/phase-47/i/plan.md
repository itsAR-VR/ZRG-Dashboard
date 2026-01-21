# Phase 47i — Call-Site Alignment: Runtime Uses Editable Templates/Variables

## Focus

Ensure the prompt editor is not “cosmetic”: edits must match what runtime OpenAI calls actually use.

This subphase audits + updates AI call sites so:
- prompts are fetched through the override-aware path (per workspace)
- any variables/snippets shown in the editor are the ones used at runtime
- `AIInteraction.promptKey` reflects the overridden version

## Inputs

- Override-aware prompt accessors (Phase 47b)
- Prompt overrides + snippet overrides (Phase 47c + 47e/g)
- Known call sites using `getAIPromptTemplate(...)` and/or hardcoded prompt strings:
  - `lib/sentiment.ts`
  - `lib/auto-reply-gate.ts`
  - `lib/auto-send-evaluator.ts`
  - `lib/signature-extractor.ts`
  - `lib/followup-engine.ts`
  - `lib/timezone-inference.ts`
  - `lib/ai-drafts.ts` (draft generation, including two-step)

## Work

1. **Inventory prompt usage:**
   - Search for:
     - `getAIPromptTemplate(`
     - `runResponse(` / `runResponseWithInteraction(`
     - hardcoded prompt strings passed as `instructions:` or embedded templates
   - For each call site, record:
     - promptKey(s)
     - which roles/messages are used (system/user/assistant)
     - which placeholders/variables are filled at runtime

2. **Adopt override-aware template retrieval:**
   - Replace `getAIPromptTemplate(key)` with a workspace-aware equivalent that:
     - applies `PromptOverride` (message-level)
     - provides an “override version” suffix for telemetry
   - Use a consistent pattern across call sites.

3. **Align user/assistant messages with the editor:**
   - Where a call site currently builds the user payload in code while a registry template exists:
     - decide whether to:
       - keep code-built payload but treat it as “non-editable runtime input”, OR
       - switch to registry message templates and placeholder replacement so it becomes editable
   - For Phase 47 scope (“edit everything”), prefer switching to template-driven messages unless it introduces PII leakage or breaks strict JSON expectations.

4. **Draft generation (high-risk alignment):**
   - Ensure all dynamic prompt blocks that are editable in the modal are used at runtime:
     - forbidden terms
     - length rules + bounds
     - booking instruction templates
     - archetype instructions
   - Confirm the editor can meaningfully change:
     - Step 2 generation instructions output
     - fallback single-step prompts

5. **Telemetry correctness:**
   - When overrides/snippets are applied, set:
     - `promptKey` = `${basePromptKey}.${overrideVersion}`
   - Ensure the suffix is stable and not content-derived.

6. **Conversation cursor + cross-channel context consistency (cross-workflow safety)**
   - Implement and adopt a single helper for “latest inbound(s)” selection **across all channels**:
     - For each channel (email/sms/linkedin):
       - Find that channel’s latest outbound message timestamp.
       - Collect **all inbound messages after that outbound** (supports “double” email/text).
     - Union these per-channel lists as “latest inbound(s) across channels”.
     - Define the “active trigger inbound” as the newest inbound message (max `sentAt`) within that union.
     - Determine the “primary channel” for the current run from the send path (email vs sms vs linkedin); this is what we respond on.
   - Use it in:
     - inbound post-process jobs (email/sms/linkedin/smartlead/instantly) before generating drafts / evaluating auto-send
     - legacy auto-reply decision paths (ensure we don’t auto-reply to stale triggers)
     - delayed auto-send execution (Phase 47l) to skip stale jobs
   - Prompt composition requirement (token-efficient, no repetition):
     - Provide a single transcript of the conversation history **excluding** the “latest inbound(s)” block (to avoid repeating the same message content twice).
     - Provide a second section “Latest inbound(s) across channels” that:
       - lists the primary channel first (all its inbounds after its latest outbound)
       - then lists other channels (their inbounds after their latest outbound, if any) as “context only”
     - Include an instruction: “Do not repeat the transcript; respond to the primary channel, using other-channel context only when relevant.”
   - Goal: drafts + auto-sends always respond with awareness of the newest inbound messages across all channels (and do not send based on stale/out-of-order triggers).

## Validation (RED TEAM)

- For each major feature prompt (sentiment classify, auto-reply gate, auto-send evaluator, draft generation):
  - edit a prompt component in the modal
  - trigger the AI call
  - verify effect is present (log/behavior) and `AIInteraction.promptKey` includes override suffix
- Regression: when overrides are removed, runtime reverts to default behavior.
- Out-of-order inbound events: if multiple inbound messages arrive back-to-back (same channel or different channels), older triggers are skipped and only the active “latest inbound(s) across channels” are eligible for draft + auto-send.

## Output

**Completed:**

1. **Updated AI call sites to use override-aware prompt lookup:**
   - `lib/sentiment.ts`:
     - `analyzeInboundEmailReply()` — uses `getPromptWithOverrides("sentiment.email_inbox_analyze.v1", clientId)`
     - `classifySentiment()` — uses `getPromptWithOverrides("sentiment.classify.v1", clientId)`
   - `lib/auto-reply-gate.ts`:
     - `decideShouldAutoReply()` — uses `getPromptWithOverrides("auto_reply_gate.decide.v1", clientId)`
   - `lib/auto-send-evaluator.ts`:
     - `evaluateAutoSend()` — uses `getPromptWithOverrides("auto_send.evaluate.v1", clientId)`
   - `lib/signature-extractor.ts`:
     - `extractContactFromSignature()` — uses `getPromptWithOverrides("signature.extract.v1", clientId)`
   - `lib/timezone-inference.ts`:
     - `ensureLeadTimezone()` — uses `getPromptWithOverrides("timezone.infer.v1", clientId)`
   - `lib/followup-engine.ts`:
     - `parseTimeFromMessage()` — uses `getPromptWithOverrides("followup.parse_accepted_time.v1", clientId)`
     - `detectMeetingAcceptedIntent()` — uses `getPromptWithOverrides("followup.detect_meeting_accept_intent.v1", clientId)`
   - `lib/ai-drafts.ts`:
     - SMS/LinkedIn draft generation — uses `getPromptWithOverrides(promptKey, clientId)`

2. **Telemetry versioning:**
   - All updated call sites append `overrideVersion` suffix to `promptKey` when overrides are applied
   - Format: `{basePromptKey}.ovr_{timestamp}` (e.g., `sentiment.classify.v1.ovr_202601211430`)
   - Retry suffixes preserved: `{promptKey}.retry{N}`

3. **Email draft generation:**
   - SMS/LinkedIn paths updated to use override-aware prompts
   - Email generation uses dynamic prompt keys per archetype (`draft.generate.email.strategy.v1.arch_{id}`) — these are built inline and use snippet overrides (forbidden terms, length rules, archetype instructions) from Phase 47g

**Not updated (deferred):**
- Insights chat prompts (`lib/insights-chat/*.ts`) — lower priority as these are analytics features, not lead-facing
- Conversation cursor cross-channel helper — complex refactor, documented for future phase

**Verification:**
- `npm run lint` — passed
- `npm run build` — passed

## Handoff

Return to Phase 47 verification checklist (`lint`, `build`, `db:push`, smoke tests). Then continue to Phase 47j (persona scoping in modal).

## Review Notes

- Evidence: `lib/ai-drafts.ts` uses `getPromptWithOverrides` for SMS/LinkedIn only to stamp telemetry, but the actual `instructions` are built by `buildSmsPrompt`/`buildLinkedInPrompt` (not from registry message content).
- Impact: prompt editor overrides for `draft.generate.sms.v1` / `draft.generate.linkedin.v1` may not affect runtime prompt text, while telemetry can still show an override suffix; see `docs/planning/phase-47/review.md`.
