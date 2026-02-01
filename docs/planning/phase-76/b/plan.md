# Phase 76b — Enhance Email Links (No Raw HTML Code Shown)

## Focus

Make email hyperlinks clickable in the inbox UI without rendering or displaying raw HTML markup. We keep the plain-text message display, but preserve link destinations from `rawHtml`.

## Inputs

- Jam report: `ae89a090-f6db-46f3-87c2-488532e42108`
- Root cause: anchor destinations (`href`) exist only in `Message.rawHtml`; `Message.body` is plain text and loses link targets
- Target files: `actions/lead-actions.ts`, `lib/safe-html.ts`, `components/dashboard/chat-message.tsx`

## Work

### Step 1: Preserve link destinations from rawHtml in server action mapping

**File:** `actions/lead-actions.ts`

- When building UI messages, if a message is email and has `rawHtml`:
  - extract `<a href="...">label</a>` links (http/https only)
  - append a small `Links:` section to `message.content` using markdown link syntax:
    - `- [label](https://example.com)`
  - only append links that are not already present in the plain text body (avoid duplicates)

### Step 2: Teach the safe renderer to render markdown links

**File:** `lib/safe-html.ts`

- Extend `safeLinkifiedHtmlFromText()` to recognize and safely render:
  - `[text](https://example.com)` → `<a href="...">text</a>`
- Maintain existing behavior for raw URLs, and keep strict http/https validation.

### Step 3: Never display raw HTML markup in the UI

**File:** `components/dashboard/chat-message.tsx`

- Update “Show Original” to:
  - prefer showing `rawText`
  - otherwise show a text-only conversion of `rawHtml` (preserving `href` as `label (url)`), never the HTML tags themselves

### Verification

1. Run `npm run lint` - should pass
2. Run `npm run build` - should pass
3. Test in browser:
   - View an email where the body contains anchor text like “this link”
   - Confirm the `Links:` section shows “this link” as a clickable link and opens in a new tab

## Output

- Emails show clickable links without rendering raw HTML markup.
- “Show Original” no longer displays HTML source.

## Handoff

Phase 76 complete. Both email link issues resolved:
1. AI knows about lead's calendar links (from Phase 76a)
2. Email hyperlinks are clickable (from Phase 76b)
