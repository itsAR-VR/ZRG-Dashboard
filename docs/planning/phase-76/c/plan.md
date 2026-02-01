# Phase 76c — Hardening: AI Extraction + Safe Link Rendering

## Focus

Close the highest-risk gaps from the RED TEAM review:

1) Ensure signature/footer extraction is reliable, fast, and cannot hallucinate links.
2) Ensure inbox link enhancement is safe (http/https only) and never displays raw HTML markup.

## Inputs

- Phase 76 root plan: `docs/planning/phase-76/plan.md`
- Phase 76a output target: `lib/ai-drafts.ts` (email draft prompt builders)
- Phase 76b output target: `components/dashboard/chat-message.tsx` (email rendering)
- Repo coupling:
  - `lib/safe-html.ts` is imported by `lib/email-format.ts` (server-side)
  - `ChatMessage` is a `"use client"` component but can still SSR
- Trigger message fields (source-of-truth for “what the lead sent”):
  - `Message.rawText`
  - `Message.rawHtml`

## Work

### 1) Harden AI signature/footer extraction (latency + safety)

**Files:** `lib/email-signature-context.ts`, `lib/ai-drafts.ts`

- Skip the AI call unless the signature candidate has “signature signals” (URLs/phones/LinkedIn/etc).
- Clamp the candidate input (tail slice) so large footers/disclaimers don’t blow token budgets.
- Provide a detected URL list to the model and validate that outputs use only observed `http(s)` URLs (no invented links).
- Hard timeout (few seconds max) and soft-fail: if extraction fails, draft generation proceeds without it.

**RED TEAM validation**
- If the extracted context includes a scheduling link → drafts must not claim it was missing.
- If the extracted context includes no scheduling link → drafts must not invent one.

### 2) Harden inbox link enhancement (no raw HTML shown)

**Files:** `actions/lead-actions.ts`, `lib/safe-html.ts`, `components/dashboard/chat-message.tsx`

- Limit raw HTML scanning size and max extracted links.
- Only emit markdown links with `http(s)` destinations.
- Ensure `safeLinkifiedHtmlFromText()` renders markdown links safely and does not linkify URLs inside markdown link tokens twice.
- Ensure “Show Original” never prints HTML markup (prefer `rawText`; otherwise text-only conversion of `rawHtml`).

## Validation (RED TEAM)

- `npm run lint`
- `npm run build`
- Manual UI checks (Action Station):
  - Open an email message where the body has anchor text (“this link”) and `rawHtml` contains `<a href>` → the `Links:` section contains a clickable “this link” item.
  - Verify `Show Original` does not show HTML tags.
- AI draft check:
  - Use a lead with an inbound email where the scheduling link only exists in the signature/footer → draft must not claim “we didn’t receive the link”.

## Output

- Email drafts get a junk-free signature/footer context block without hallucinated links.
- Inbox shows clickable links without ever displaying raw HTML source.

## Handoff

Phase 76 is complete once Phase 76a/76b behavior meets Success Criteria and Phase 76c hardening validations pass.
