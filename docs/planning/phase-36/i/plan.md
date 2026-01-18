# Phase 36i — SMS Multipart Addendum (≤160 per part)

## Focus

Make booking-process stages workable for SMS under a hard 160-character limit by supporting **multipart SMS**:

- AI may produce **1–3 SMS parts**, each **≤160 chars**
- We send parts sequentially (same wave / same “SMS channel send”)
- When splitting, prioritize **times + booking link** first, then questions/other items
- If lead has **no phone number**, SMS is **skipped** and the wave can advance
- If SMS is blocked by GHL DND, we **hold** the wave and retry until DND clears
- If stage includes qualifying questions, include **max 2 required** questions in SMS (rotate if more exist) and allow paraphrasing to fit

This addendum supersedes the SMS-specific guidance in `docs/planning/phase-36/h/plan.md`.

## Inputs (Repo Reality)

- SMS draft prompt: `lib/ai/prompt-registry.ts` (`draft.generate.sms.v1`, `DRAFT_SMS_SYSTEM_TEMPLATE`)
- Draft generation: `lib/ai-drafts.ts:generateResponseDraft` (SMS + LinkedIn paths)
- Sending + approval:
  - `actions/message-actions.ts:approveAndSendDraftSystem` (SMS path calls `sendSmsSystem`)
  - `lib/system-sender.ts:sendSmsSystem` (handles sms_dnd + missing phone enrichment)
- Schema constraints:
  - `prisma/schema.prisma` currently enforces `Message.aiDraftId` as `@unique` (1 draft → 1 outbound message)

## Work

### 1) Define the multipart SMS contract

For SMS drafts, the AI output is **either**:

- a single SMS string (≤160), or
- a JSON object containing `parts: string[]` with **1–3** entries, where each entry is **≤160**.

Rules:

- Each part must be a complete, sendable SMS (no “(cont.)” required, but allowed if natural).
- Total parts capped at **3**.
- Content must remain natural and non-robotic.
- If the booking process stage requires times and/or a link, those must appear by the end of the multipart sequence (preferably early).
- If the stage enables qualifying questions, include at most **2 required** questions in SMS (rotate/cycle if more exist); paraphrase is allowed but meaning must be preserved.

### 2) Update SMS prompt to enforce ≤160 and allow up to 3 parts

Update the existing `draft.generate.sms.v1` prompt (preferred) to:

- state **hard** requirements:
  - each part ≤160 characters
  - max 3 parts
  - output must be valid JSON if multipart
- encourage minimal tokens for time options (see Phase 36h re: short time labels)
- allow paraphrasing required questions for SMS brevity (meaning preserved)

Implementation note:

- Keep backward compatibility by accepting **either** a plain-text SMS string **or** the multipart JSON shape, since existing callers may expect a string.

Recommended output schema for `responses` API:

- Use `json_schema` output with:
  - `parts: string[]` (1–3)
  - optional `notes` for debugging (not sent)

### 3) Persist multipart drafts (schema + storage)

Current schema assumes 1 draft → 1 sent message (via `Message.aiDraftId @unique`).

To support multipart SMS cleanly, pick one approach:

**Option A (recommended): Make draft→messages one-to-many**

- Change `Message.aiDraftId` to non-unique + add `Message.aiDraftPartIndex Int?`
- Add `@@unique([aiDraftId, aiDraftPartIndex])` so each part is idempotent
- Change `AIDraft.sentMessage` to `sentMessages Message[]`

**Option B: Keep Message.aiDraftId unique; store sent part IDs on the draft**

- Add `AIDraft.sentMessageIdsJson String? @db.Text` storing `string[]`
- Only the first sent part uses `aiDraftId`; the rest are unlinked messages
- Adjust idempotency checks to consult the draft field rather than `Message.aiDraftId`

This phase should choose **Option A** unless there’s a strong reason to avoid schema changes.

### 4) Send flow changes (approval + idempotency)

Update `approveAndSendDraftSystem` to:

- Detect multipart SMS drafts (parsed parts or JSON schema output)
- Send `parts` sequentially using a new helper (e.g., `sendSmsSystemMultipart`)
  - each part is sent via existing `sendSmsSystem` logic, but with stable part index idempotency
- Mark the draft “approved” only when all parts are successfully sent (or when a clear policy says otherwise)

Idempotency rules:

- If part `i` is already sent, skip it.
- If send fails mid-sequence, do not re-send earlier parts on retry.

### 5) Wave progress + counters (booking-process integration)

When SMS is multipart:

- Increment SMS outbound count by the number of parts actually sent (each part is a `Message` row).
- Mark `waveSmsSent = true` only after all parts are sent (so wave completion logic doesn’t advance prematurely).

Channel unavailability:

- If lead has no phone number, skip SMS for that wave and allow wave completion (confirmed).
- If SMS send fails due to DND (`sendSmsSystem` returns `errorCode: "sms_dnd"` / `Lead.smsDndActive === true`):
  - Do **not** skip/advance.
  - Hold the wave and retry every **2 hours** until a send succeeds (which clears DND on the lead in `sendSmsSystem`).
  - If DND blocks for **>72 hours** in a row, stop holding and treat SMS as **skipped for that wave** so the wave can advance.

Required-question rotation (SMS):

- If there are more than 2 `required: true` questions in `WorkspaceSettings.qualificationQuestions`, select **2** for this lead/campaign (deterministically) so we can test which ones perform best.
- Recommended deterministic selection:
  - Sort required questions by `id` (stable order).
  - Compute `start = hash(leadId + emailCampaignId) % required.length`.
  - Pick `[required[start], required[(start + 1) % required.length]]`.
- Persist the chosen required-question IDs for analytics attribution (e.g., store on the booking progress row for the lead/campaign, and/or on the draft).

### 6) Builder-time validation for SMS feasibility

Because SMS is capped at **3 × 160 characters**, add UX guardrails in the booking process builder:

- If a stage applies to SMS and includes link/times/questions:
  - show a best-effort feasibility indicator
  - warn if likely to require 2–3 parts
  - hard-block only if clearly impossible even with 3 parts (e.g., workspace booking URL alone exceeds 160 chars)

### 7) Analytics implications

Multipart SMS increases outbound message count.

- “Avg replies to book” will increase for processes using multipart SMS (expected).
- Consider adding an additional metric later: “Avg waves to book” (stage count), to compare booking strategies independent of multipart splitting.

## Output

- A concrete multipart SMS contract (1–3 parts, ≤160 each) and corresponding implementation requirements.
- A clear schema plan for 1 draft → N outbound SMS messages with idempotency.
- Explicit wave-progress semantics for multipart SMS.

## Handoff

Implementation should follow this addendum when updating:

- schema (Phase 36a amendments)
- draft generation prompt + parsing (Phase 36e)
- sending/approval flows (actions + system sender)
- wave progress updates (Phase 36b replacement model from Phase 36h)
