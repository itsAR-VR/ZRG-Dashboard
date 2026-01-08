# Phase 5a — Reproduce + Fix Outbound Line Break Formatting

## Focus
Ensure outbound emails sent through EmailBison preserve paragraph spacing (blank lines and line breaks) end-to-end.

## Inputs
- Screenshot showing line breaks collapsed in sent emails.
- Code paths that send outbound email (EmailBison client + message composer).
- Any existing message rendering components for the inbox.

## Work
1. Identify whether we send `text/plain`, `text/html`, or both to EmailBison.
2. Standardize outbound formatting:
   - If sending HTML: convert `\n` to `<br />` (and preserve blank lines).
   - If sending plain text: ensure `\r\n` is used where required and that the provider respects it.
3. Ensure the inbox UI renders multi-line message bodies with preserved newlines (e.g., CSS `white-space: pre-wrap` or equivalent).
4. Add a minimal unit-level helper for newline normalization to prevent regressions.

## Output
- Outbound email bodies preserve newlines in provider + recipient inbox.
- In-app message viewer preserves spacing for the same content.

## Handoff
Proceed to implement global lead search (Phase 5b) once formatting is verified locally.

