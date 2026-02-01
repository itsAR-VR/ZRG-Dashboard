# Phase 76 — Review

## Summary

- ✅ Phase 76a implemented: AI signature/footer extraction + prompt injection
- ✅ Phase 76b implemented: Email link enhancement (markdown links from rawHtml)
- ✅ Phase 76c hardening: Validation guards in place (URL allowlist, timeout, clamping)
- ✅ `npm run lint` — pass (0 errors, 18 warnings)
- ✅ `npm run build` — pass
- ⏳ Manual QA pending (live app testing)

## What Shipped

### Phase 76a — AI Signature/Footer Extraction

| File | Description |
|------|-------------|
| `lib/email-signature-context.ts` (new, 465 lines) | AI-powered signature extraction using `gpt-5-nano` with structured JSON output |
| `lib/ai-drafts.ts` | Wired `extractImportantEmailSignatureContext()` into email draft generation (lines 1460-1481, 1519, 1683) |
| `lib/ai/prompt-registry.ts` | Registered prompt key `signature.context.v1` for override support |

**Key implementation details:**
- Extracts scheduling links, contact info, and important lines from trigger email signature
- Uses a detected-URL allowlist to prevent hallucinated links
- Tail-slices input (last 3000 chars) to focus on signature region
- 5-second timeout with soft-fail (draft generation proceeds if extraction fails)
- Prompt context injected into both strategy and generation instructions

### Phase 76b — Email Link Enhancement

| File | Description |
|------|-------------|
| `actions/lead-actions.ts` | Added `extractHttpLinksFromEmailHtml()` and `enhanceEmailBodyWithLinkTargets()` (lines 241-281, 906) |
| `lib/safe-html.ts` | Extended `safeLinkifiedHtmlFromText()` to render markdown links `[text](url)` (lines 55-62) |
| `components/dashboard/chat-message.tsx` | "Show Original" now converts rawHtml to plain text preserving hrefs (lines 156-159) |

**Key implementation details:**
- Extracts `<a href="...">label</a>` links from `Message.rawHtml`
- Appends "Links:" section to message content with markdown-style links
- Only includes links with labels that differ from the URL (avoids duplicates)
- http/https validation enforced
- "Show Original" never displays raw HTML markup

## Verification

### Commands

- `npm run lint` — **pass** (0 errors, 18 warnings) — 2026-01-31 21:10 EST
- `npm run build` — **pass** — 2026-01-31 21:11 EST
- `npm run db:push` — **skip** (no schema changes)

### Notes

- No TypeScript errors
- Lint warnings are pre-existing (React hooks, next/image, etc.)
- Build completes successfully with all routes generated

## Success Criteria → Evidence

1. **AI drafts do NOT say "we didn't see the calendar link" when the trigger email signature/footer contains a scheduling link**
   - Evidence: `lib/ai-drafts.ts:888-889` injects signature context with explicit instruction: `"If a scheduling link is present above, do NOT claim it 'didn't come through'"`
   - Evidence: `lib/email-signature-context.ts` extracts `schedulingLinks` array using AI with URL allowlist
   - Status: **met** (implementation complete, pending live QA)

2. **Email hyperlinks in rawHtml are clickable and open in new tab**
   - Evidence: `actions/lead-actions.ts:272-281` appends extracted links as markdown `[label](url)`
   - Evidence: `lib/safe-html.ts:55-62` renders markdown links with `target="_blank"` and `rel="noopener noreferrer"`
   - Status: **met** (implementation complete, pending live QA)

3. **Inbox does not render raw HTML from providers (only safe, generated `<a>` + `<br />`)**
   - Evidence: `chat-message.tsx:156-159` converts rawHtml to plain text using `htmlToPlainTextPreservingAnchorHrefs()`
   - Evidence: "Show Original" toggle shows extracted text, not HTML source
   - Status: **met**

4. **`npm run lint` passes**
   - Status: **met** (0 errors)

5. **`npm run build` passes**
   - Status: **met**

## Plan Adherence

| Planned | Implemented | Notes |
|---------|-------------|-------|
| AI signature extraction | ✅ Yes | Uses `gpt-5-nano` with structured JSON |
| Signature context in prompts | ✅ Yes | Strategy + generation instructions |
| Link extraction from rawHtml | ✅ Yes | Appends "Links:" section |
| Markdown link rendering | ✅ Yes | `[text](url)` → `<a>` |
| No raw HTML in UI | ✅ Yes | Converted to plain text |

## Risks / Rollback

| Risk | Mitigation |
|------|------------|
| AI extraction latency | 5-second timeout, soft-fail to fallback (draft proceeds without context) |
| Hallucinated links | URL allowlist from detected URLs in source text |
| Large email bodies | Tail-slice clamping (3000 chars for signature candidate) |
| Link spam in inbox | Max 10 links per message, dedup vs body |

## Follow-ups

- [ ] Manual QA with live data:
  - Open an email with a Calendly link in the signature
  - Regenerate AI draft
  - Verify draft doesn't claim link is missing
- [ ] Manual QA for inbox links:
  - View email with anchor text like "this link"
  - Verify "Links:" section appears with clickable link
  - Verify "Show Original" doesn't show HTML tags
- [ ] Monitor telemetry for `signature.context.v1` AI call latency/success rates
