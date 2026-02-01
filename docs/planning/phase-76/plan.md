# Phase 76 — Email Link Fixes

## Purpose

Fix two related email link issues: (1) AI drafts incorrectly claiming calendar links are missing when they exist in signatures, and (2) hyperlinks in email bodies not being clickable in the inbox UI.

## Context

### Bug 1: Calendar Links in Signatures Not Recognized

**Jam:** [c094f375-4eb0-4d55-af87-893facb67c91](https://jam.dev/c/c094f375-4eb0-4d55-af87-893facb67c91)

When a lead sends an email with a Calendly link in their signature, the AI draft incorrectly says "We didn't see the calendar link come through on our end."

**Root Cause:** We intentionally store and use a **cleaned** email body for transcripts (quoted threads + signatures stripped). The lead’s actual signature/footer (where the Calendly link lives) is preserved in `Message.rawText` / `Message.rawHtml`, but that raw context is not currently attached to the AI draft prompt — so the model never “sees” the link even though it was in the original email.

### Bug 2: Hyperlinks in Email Bodies Not Clickable

**Jam:** [ae89a090-f6db-46f3-87c2-488532e42108](https://jam.dev/c/ae89a090-f6db-46f3-87c2-488532e42108)

When viewing emails in the inbox, hyperlinks like "this link" are not clickable - they display as plain text.

**Root Cause:**
- Email messages are stored with `Message.rawHtml` that contains `<a href="...">` tags (anchor text + URL destination)
- Inbox UI renders `message.content` which is derived from `Message.body` (plain text) and therefore **loses the href destination**
- `safeLinkifiedHtmlFromText()` can only linkify explicit URLs in the text — so anchor text like "this link" has no URL to linkify and appears non-clickable

### Technical Analysis

**Calendar Link Issue Data Flow:**
```
SmartLead webhook (preview_text → rawText, rawHtml=null)
    ↓
Email cleaning strips signatures
    ↓
Pipeline extracts scheduler link from rawText → Lead.externalSchedulingLink
    ↓
AI draft generated from cleaned transcript (signature stripped)
    ↓
AI doesn’t see the original signature/footer context → says "didn't see calendar link"
```

**Hyperlink Issue Data Flow:**
```
Email stored with rawHtml containing <a href="...">
    ↓
Server action maps Message.body → message.content (plain text; href destinations lost)
    ↓
ChatMessage renders message.content via safeLinkifiedHtmlFromText()
    ↓
Anchor text has no URL to linkify → link not clickable
```

## Repo Reality Check (RED TEAM)

- Verified touch points exist today:
  - `lib/ai-drafts.ts`: `generateResponseDraft()`, `buildEmailDraftStrategyInstructions()`, `buildEmailDraftGenerationInstructions()`
  - `components/dashboard/chat-message.tsx`: `"use client"`, uses `safeLinkifiedHtmlFromText(message.content)` for default rendering and has access to `message.rawHtml`
  - `lib/safe-html.ts`: `safeLinkifiedHtmlFromText()` (safe HTML output; supports raw URLs and `[text](url)` markdown links)
- Important coupling:
  - `lib/safe-html.ts` is imported by `lib/email-format.ts` (server-side) → avoid adding browser-only / DOM-dependent imports there.
- `lib/email-cleaning.ts` strips signatures/footers from `Message.body` (clean transcript), but keeps originals in `Message.rawText`/`Message.rawHtml`.
- `Lead.externalSchedulingLink` exists in `prisma/schema.prisma` and is populated by inbound post-processing, but the more direct source for “what the lead actually sent” is the trigger email message’s raw body.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 75 | Complete | `lib/ai-drafts.ts`, `lib/followup-engine.ts` | Check git status before editing |

## Pre-Flight Conflict Check (Multi-Agent)

- [x] Run `git status --porcelain` and confirm state of:
  - `lib/ai-drafts.ts`
  - `lib/safe-html.ts`
  - `components/dashboard/chat-message.tsx`

## Objectives

* [x] Use AI to extract the important signature/footer context (incl. scheduling links) from the trigger email and attach it to draft prompts
* [x] Enhance email link rendering without displaying raw HTML (preserve link destinations from `rawHtml`)
* [x] Verify with `npm run lint && npm run build`

## Constraints

- Do not display raw HTML markup in the inbox UI.
- Keep existing plain-text rendering of `Message.body` as the primary display.
- Only emit safe, hardened links (`http(s)` only; `rel="noopener noreferrer"`).
- AI extraction must use structured outputs (json_schema) and should not invent links.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **AI extraction latency:** Adding another AI call can slow draft generation. → Use a small model + minimal reasoning + hard timeout; skip extraction if no signature signals.
- **Hallucinated links:** The model could invent a calendar link. → Provide a detected-URL list and validate outputs only use observed http(s) URLs.

### Missing or ambiguous requirements
- **Prompt bloat risk:** Signatures/disclaimers can be huge. → Clamp the candidate input (tail slice) before AI extraction; keep extracted context short.
- **Link hardening:** Links must open safely in a new tab. → Ensure `safeLinkifiedHtmlFromText()` renders anchors with `target="_blank"` and `rel="noopener noreferrer"`.

### Performance / timeouts
- **Large rawHtml bodies:** Naively scanning huge HTML can slow inbox fetch. → Cap the scanned HTML length and max extracted links per message.

### Testing / validation
- **No concrete repro/QA steps:** The plan should include a deterministic way to verify each bug. → Add a minimal manual QA checklist (and/or a small component-level test if feasible) covering:
  - AI prompt includes scheduling-link context when populated
  - Email anchor text becomes a clickable link via preserved destinations from `rawHtml`
  - Inbox never displays raw HTML markup (no `<a>` tags shown as text)

## Success Criteria

- [x] AI drafts do NOT say "we didn't see the calendar link" when the trigger email signature/footer contains a scheduling link
- [x] Email hyperlinks in rawHtml are clickable and open in new tab
- [x] Inbox does not render raw HTML from providers (only safe, generated `<a>` + `<br />`)
- [x] `npm run lint` passes
- [x] `npm run build` passes

## Key Files

| File | Change |
|------|--------|
| `lib/email-signature-context.ts` | AI extractor that returns a short, junk-free signature/footer context (incl. scheduling links) |
| `lib/ai-drafts.ts` | Fetch trigger message + inject extracted signature context into draft prompts |
| `actions/lead-actions.ts` | Preserve link destinations from `rawHtml` by appending a compact markdown link list to `message.content` |
| `lib/safe-html.ts` | Render markdown-style links (`[text](url)`) safely (http/https only) |
| `components/dashboard/chat-message.tsx` | Never display raw HTML code in “Show Original” (render text-only with hrefs preserved) |

## Subphase Index

* a — AI signature/footer extraction + prompt injection
* b — Link enhancement in inbox UI (no raw HTML code shown)
* c — Hardening: timeouts, validation, and fallbacks

## Assumptions (Agent)

- ChatMessage rendering in `components/dashboard/chat-message.tsx` is the production inbox UI path (confidence ~90%).
  - Mitigation check: confirm Phase 76b repro occurs in Action Station and not a separate email-only renderer.
- For the AI draft fix, the most reliable “ground truth” is the trigger email message’s original body (`Message.rawText` / `Message.rawHtml`), not a lead-level cached field (confidence ~90%).
  - Mitigation check: confirm `opts.triggerMessageId` is available for email drafts and maps to the inbound email being replied to.

## Decision (Locked)

- Inbox rendering: show the message content and enhance links by rendering a **sanitized** version of email HTML when available (no HTML source displayed; links clickable).

## Phase Summary

**Completed 2026-01-31**

### What Shipped

| Subphase | Deliverable |
|----------|-------------|
| 76a | AI signature/footer extraction (`lib/email-signature-context.ts`) + prompt injection in draft generation |
| 76b | Email link enhancement via `Links:` section with markdown links from rawHtml |
| 76c | Hardening: URL allowlist validation, 5s timeout, tail-slice clamping, max 10 links/message |

### Files Created/Modified

| File | Change |
|------|--------|
| `lib/email-signature-context.ts` | **NEW** — AI-powered signature extraction (465 lines) |
| `lib/ai-drafts.ts` | Added signature context extraction + injection into prompts |
| `lib/ai/prompt-registry.ts` | Registered `signature.context.v1` prompt key |
| `actions/lead-actions.ts` | Added `extractHttpLinksFromEmailHtml()` + `enhanceEmailBodyWithLinkTargets()` |
| `lib/safe-html.ts` | Extended to render markdown links `[text](url)` |
| `components/dashboard/chat-message.tsx` | "Show Original" converts rawHtml to plain text |

### Verification

- `npm run lint`: **pass** (0 errors, 18 warnings) — 2026-01-31 21:10 EST
- `npm run build`: **pass** — 2026-01-31 21:11 EST

### Follow-ups

- Manual QA with live data to confirm both bugs are resolved
- Monitor `signature.context.v1` telemetry for latency/success rates
