# Phase 5c — Fix Inbound Email Sender Attribution (FROM-driven)

## Focus
Ensure inbound email replies are attributed to the actual sender (the `From:` address) rather than the original outbound recipient who may be CC’d.

## Inputs
- Email webhook ingestion code (`app/api/webhooks/email/route.ts` and related `lib/*` helpers).
- Existing lead matching logic and unique identifiers for message dedupe/threading.
- Example scenario: outbound to Jamie; inbound reply from Pete with Jamie CC’d.

## Work
1. Trace how inbound email webhooks choose/create a lead:
   - Confirm what fields are used today (`to`, `cc`, thread participants, etc.).
2. Adjust matching order for inbound email:
   - Prefer the inbound sender email address for lead identity.
   - Fall back to thread correlation only when sender is missing/unusable.
3. Ensure the system does not overwrite existing lead identity for the thread incorrectly.
4. Add safe diagnostics for edge cases (missing sender, multiple senders, malformed payload).

## Output
- Inbound messages are stored under the correct lead (sender).
- CC’d original recipients no longer hijack attribution.

## Handoff
Run regression checks and document verification steps (Phase 5d).

