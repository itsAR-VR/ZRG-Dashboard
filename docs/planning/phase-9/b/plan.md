# Phase 9b — Add Hyperlink Support for Responses and Sequences

## Focus
Enable inserting and rendering hyperlinks (e.g., calendar links) inside **saved responses** and **sequences**, in a way that is safe (no XSS) and works per channel (email vs SMS vs LinkedIn).

## Inputs
- UI editors for responses/sequences (likely under `app/` and `actions/`)
- Message rendering components (master inbox message display)
- Send/formatting logic in `lib/` (email HTML vs plain text outputs)

## Work
1. Confirm the data representation:
   - Option A: store message body as plain text with URLs (auto-linkify in UI).
   - Option B: store a structured “link token” (label + url) and render per channel.
   - Option C: allow limited Markdown (`[label](url)`) and render safely.
2. Implement UI affordance:
   - “Insert link” UI (label + URL) that writes the chosen representation.
3. Rendering:
   - Inbox UI: linkify + sanitize.
   - Email: produce HTML anchors when sending.
   - SMS/LinkedIn: include URL in plain text (or platform-friendly format).
4. Validation/security:
   - Only allow `http(s)` URLs; block `javascript:` and other unsafe schemes.
5. Verify end-to-end:
   - Create response/sequence with calendar link → send preview/send → confirm link is present and clickable.

## Output
### Implemented
- Safe link rendering for messages (prevents XSS + linkifies URLs): `components/dashboard/chat-message.tsx`
- Shared safe HTML/linkify utility for client/server usage: `lib/safe-html.ts`
- Email sending now linkifies URLs into `<a>` anchors: `lib/email-format.ts`

### UX
- “Insert calendar link” button in Action Station composer (responses): `components/dashboard/action-station.tsx`
- Sequence editor now documents `{calendarLink}` and provides a one-click insert: `components/dashboard/followup-sequence-manager.tsx`

### Server Actions
- Added lead-aware calendar link resolver (lead override → workspace default): `actions/settings-actions.ts`

## Handoff
Proceed to Phase 9c to add file uploads to Knowledge Assets (PDF/DOCX/etc) with extraction/OCR using `gpt-5-mini` (low reasoning).
 
