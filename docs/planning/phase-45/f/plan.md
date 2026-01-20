# Phase 45f — Implement + Harden (All-Eligible Mode, Retries, Length Bounds)

## Focus

Implement the Phase 45 fixes/features in the codebase and incorporate the requested hardening:

- Bulk regeneration supports both:
  - **Pending drafts only** (safe default)
  - **All eligible leads** (creates/regenerates drafts broadly)
- Draft generation retries on `incomplete_details.reason === "max_output_tokens"` (don’t save partial output)
- Email drafts enforce a strict length range (min/max characters) to avoid overly long or overly short replies and reduce truncation risk

## Inputs

- Root plan: `docs/planning/phase-45/plan.md`
- Booking link prompt gap: `lib/booking-process-instructions.ts` (`stage.includeBookingLink` + `getBookingLink(...)`)
- Draft generation pipeline: `lib/ai-drafts.ts` (`generateResponseDraft`, `incomplete_details.reason`, `max_output_tokens`)
- Existing per-lead regen: `actions/message-actions.ts:regenerateDraft(leadId, channel)`
- Settings surface + admin gate: `components/dashboard/settings-view.tsx` (`TabsContent value="ai"`, `isWorkspaceAdmin`)
- Docs references:
  - OpenAI Responses API: detect incomplete responses when `status === "incomplete"` and `incomplete_details.reason === "max_output_tokens"` and retry instead of accepting partial output.

## Work

### 1) Booking link null instruction

- Update `lib/booking-process-instructions.ts` so that when `stage.includeBookingLink` is true but `getBookingLink(...)` returns null/empty, we add an explicit instruction to:
  - never include placeholder tokens like `{insert booking link}`
  - ask for availability / offer times instead
  - log a warning for visibility

### 2) Draft generation hardening

- Update `lib/ai-drafts.ts`:
  - Add placeholder + truncated-URL detection helpers
  - When the model response is incomplete due to `max_output_tokens`, retry with a higher `max_output_tokens` budget (bounded by a cap)
  - For email drafts:
    - add a strict length range (min/max chars) inside the prompt
    - validate output length; if out of bounds, rewrite/retry within budgeted attempts
  - Keep a last-resort sanitization step for placeholders/truncated URLs, but prefer retry/regenerate so we don’t persist broken links.

### 3) Bulk regeneration server action (with modes)

- Add `regenerateAllDrafts(...)` to `actions/message-actions.ts`:
  - Requires `requireClientAdminAccess(clientId)`
  - Supports `mode: "pending_only" | "all_eligible"`
  - Cursor-based continuation (index cursor like `syncAllConversations`)
  - Concurrency via `REGENERATE_ALL_DRAFTS_CONCURRENCY` (default 1)
  - Avoid per-lead `revalidatePath("/")` overhead (revalidate once per run)

### 4) Settings UI (AI Personality tab)

- Add an admin-only card under Settings → AI Personality:
  - Channel selector (sms/email/linkedin)
  - Mode selector (pending-only vs all-eligible) + explicit warning/confirmation for all-eligible
  - Progress + continuation (cursor)

### 5) Documentation

- Update `README.md` env var table:
  - `REGENERATE_ALL_DRAFTS_CONCURRENCY`
  - `OPENAI_EMAIL_DRAFT_MIN_CHARS` / `OPENAI_EMAIL_DRAFT_MAX_CHARS`
  - Align any defaults that differ between README and code (e.g., `OPENAI_DRAFT_MAX_OUTPUT_TOKENS_CAP`)

## Output

- Implemented booking link null-case hardening:
  - `lib/booking-process-instructions.ts`: when `includeBookingLink` is true but `getBookingLink(...)` returns null/empty, we now add an explicit “no placeholders” instruction + `console.warn(...)`.
- Implemented draft hardening + retries:
  - `lib/ai-drafts.ts`:
    - Added placeholder + truncated-URL detection and `sanitizeDraftContent(...)` safety net.
    - Treats `response.status === "incomplete"` + `incomplete_details.reason === "max_output_tokens"` as a hard failure (don’t persist partial output).
    - Email generation now retries with increasing `max_output_tokens` (bounded by `OPENAI_DRAFT_MAX_OUTPUT_TOKENS_CAP`) and enforces strict length bounds via prompt + post-check.
    - SMS/LinkedIn now retries on `max_output_tokens` even when partial output exists, and reduces reasoning effort on retry to avoid spending output tokens on hidden reasoning.
    - Added strict email length clamp as a last resort before persisting.
- Implemented bulk regeneration server action + modes:
  - `actions/message-actions.ts`: added `regenerateAllDrafts(clientId, channel, { mode, cursor })` with:
    - `mode: "pending_only" | "all_eligible"`
    - index cursor continuation + time budget
    - concurrency via `REGENERATE_ALL_DRAFTS_CONCURRENCY`
    - per-lead system helper to avoid per-lead `revalidatePath("/")`
- Implemented Settings UI:
  - `components/dashboard/settings/bulk-draft-regeneration.tsx`: new admin-only UI with channel selector, mode selector, warning+ack for all-eligible, progress, continuation + reset.
  - `components/dashboard/settings-view.tsx`: renders the new card under Settings → AI Personality for admins.
- Docs:
  - `README.md`: documented new env vars (`REGENERATE_ALL_DRAFTS_CONCURRENCY`, email draft char bounds, email generation retry knobs) and aligned `OPENAI_DRAFT_MAX_OUTPUT_TOKENS_CAP` default to code.

### Notes (Docs/Best Practices Pulled Into Fixes)

- OpenAI Responses API guidance: treat incomplete responses (`status === "incomplete"`, `incomplete_details.reason === "max_output_tokens"`) as truncated and retry instead of trusting partial output.
- Common truncation failure mode: “ran out of tokens during reasoning” can result in empty/partial `output_text`; retry logic now accounts for this and reduces reasoning effort on retries for short-channel drafts.

## Handoff

Proceed to Phase 45g to run lint/build and do a quick smoke test for:
- booking link placeholder fix
- truncation retry behavior
- bulk regeneration card (both modes)
