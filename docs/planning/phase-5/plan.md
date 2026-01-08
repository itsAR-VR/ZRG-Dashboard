# Phase 5 — Email Formatting, Global Search, and Correct Sender Attribution

## Purpose
Fix three inbox workflow issues: outbound email line breaks collapsing, lead search not finding results beyond the first page, and inbound replies being attributed to the wrong contact when someone else at the company responds.

## Context
- The master inbox aggregates email (Inboxxia/EmailBison), SMS (GHL), and LinkedIn (Unipile).
- The current lead list UI intentionally limits visible results (e.g. 50) for performance, but search must still query the full dataset.
- Email threading/lead matching must treat the inbound sender address as the source-of-truth for “who replied”, even when the original outbound target is CC’d.

## Objectives
* [x] Preserve multi-line spacing in outbound EmailBison messages (and in-app rendering).
* [x] Make lead search query the full lead set while still returning only 50 results for UI speed.
* [x] Correct inbound email attribution so replies from a different person map to that person (not the original outbound recipient).

## Constraints
- Webhooks are untrusted input: validate/sanitize and avoid logging PII (email bodies, addresses) beyond what’s strictly needed.
- Keep the “only show 50 results” behavior for list performance.
- Prefer existing utilities under `lib/` and existing data model in `prisma/schema.prisma`.
- Ensure changes don’t break existing message threading/dedupe behavior.

## Success Criteria
* [x] Outbound emails sent via EmailBison preserve blank lines and paragraph breaks in the recipient’s inbox.
* [x] Searching by lead name or email returns matches even if they’re not in the first 50 unfiltered leads; UI still renders at most 50 results.
* [x] When an inbound reply comes from a different sender (e.g., Pete replies and CCs Jamie), the system attributes the new inbound message to Pete (or creates/matches the correct lead) instead of Jamie.

## Subphase Index
* a — Reproduce + fix outbound line break formatting
* b — Implement server-side global lead search (limit 50)
* c — Fix inbound email sender attribution (FROM-driven)
* d — Regression checks + verification plan

## Phase Summary
- Standardized outbound EmailBison HTML formatting so newlines/blank lines are preserved (`lib/email-format.ts`, used by `actions/email-actions.ts` and `lib/reactivation-engine.ts`).
- Wired inbox conversation search to server-side pagination search (still `limit: 50`) via `components/dashboard/conversation-feed.tsx`, `components/dashboard/inbox-view.tsx`, and `actions/lead-actions.ts`.
- Hardened inbound email lead attribution so replies from a different sender won’t be mis-attributed via `emailBisonLeadId`/campaign lead data (`app/api/webhooks/email/route.ts`).
- Validation: `npm run lint` (warnings only) + `npm run build` succeeded.
