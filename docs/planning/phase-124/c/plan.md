# Phase 124c — Reactivation Workflow SMS Reliability (Prereqs + Hydration + Sequence Start)

## Focus
Ensure reactivation campaigns that start follow-up sequences do not silently omit SMS due to `Lead.phone` being missing in DB when the phone exists in GoHighLevel. Hydrate first, then start sequences when possible. If SMS ultimately can't send (missing phone), rely on Phase 124b's **skip-with-audit + UI warning** policy (no silent failures).

## Inputs
- `lib/reactivation-engine.ts`
  - `processReactivationSendsDue()` (sends bump email and optionally starts follow-up sequences)
- `lib/reactivation-sequence-prereqs.ts`
  - `getMissingReactivationPrereqs()` / `formatMissingReactivationPrereqs()`
- GHL utilities:
  - `lib/ghl-contacts.ts:resolveGhlContactIdForLead()`
- Follow-up engine behavior from Phase 124b (SMS prerequisite + block policy)

## Work
1. **Hydrate before prereq enforcement**
   - When a reactivation campaign’s follow-up sequence includes `sms`:
     - If lead phone is missing but GHL config exists, call `resolveGhlContactIdForLead(leadId)` before computing prereqs.
     - Re-read lead phone and re-run prereq calculation.
2. **Prereq policy (reactivation)**
   - If GHL config is missing for an SMS-containing sequence:
     - Keep current behavior: mark enrollment `needs_review` with an explicit “missing GHL configuration” reason.
   - If phone remains missing after hydration attempt:
     - Do **not** block enrollment solely due to missing phone.
     - Start the follow-up sequence (if configured) and rely on Phase 124b to skip the SMS step with an audit artifact + UI warning when it becomes due.
3. **Start sequence with correct scheduling**
   - When prereqs are satisfied, start the sequence instance:
     - ensure lead `autoFollowUpEnabled=true` (already done in `reactivation-engine.ts`)
     - compute `nextStepDue` from the first step timing; ensure it is anchored deterministically (typically to “now” for reactivation bump sends).
4. **Counting/visibility**
   - Ensure missing GHL config reasons remain actionable (`needs_review`) and consistent with UI blocked-reason copy.
   - Ensure missing-phone outcomes become visible via FollowUpTask + UI warning (Phase 124d).
5. **Tests**
   - Add unit tests for prereq hydration behavior:
     - missing phone in DB but present in GHL → prereqs pass after hydration
     - missing GHL config → enrollment needs_review
     - phone missing after hydration → enrollment proceeds (sequence can start), and SMS will be handled by follow-up engine policy

## Output
- Reactivation follow-up sequences with SMS start reliably when phone exists in GHL (even if DB phone was missing).
- When SMS ultimately can’t send due to missing phone, the system is explicit: SMS is skipped with a durable artifact and UI-visible warning (no silent email-only workflows).

## Handoff
Proceed to **Phase 124d** to surface blocked SMS states in the UI and complete end-to-end verification.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added a preflight hydration attempt in reactivation flows for SMS-containing sequences so we do not block on a missing DB phone if the contact exists in GHL. (file: `lib/reactivation-engine.ts`)
  - Changed reactivation prereq semantics to avoid `needs_review` for "missing phone" (phone still missing will skip-with-audit at send time instead). Missing GHL config remains a blocker. (file: `lib/reactivation-engine.ts`)
- Commands run:
  - `npm test` — pass (261 tests)
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - Manual QA needed to validate the hydration path against a real workspace where the phone is present in GHL but missing locally.
- Next concrete steps:
  - Run a staging/prod reactivation sample where DB phone is null but GHL contact has a phone; confirm SMS sends.
  - Continue with Phase 124d UI surfacing and end-to-end verification (implemented; see Phase 124d progress).
