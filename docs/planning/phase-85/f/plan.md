# Phase 85f — Verification: Tests + QA Checklist + Docs Updates

## Focus
Validate security boundaries and UX behavior, and document the operational steps for provisioning client portal users.

## Inputs
- Phase 85a–85d implementation outputs
- Existing test runner: `npm run test`

## Work
1. **Automated tests**
   - Unit tests for capabilities mapping (role → booleans).
   - Add at least one server-action-level test or lightweight assertion that a client portal user cannot mutate settings (as feasible within current test harness).
2. **Manual QA checklist**
   - Admin flow:
     - Create client portal user → email sent
     - Reset password → email sent
     - Remove access
   - Client flow:
     - Log in successfully
     - Inbox: view conversations; generate/approve drafts; send reply
     - CRM: view leads, update allowed fields (if any are still permitted)
     - Settings: visible but read-only; actions disabled; banner displayed
     - AI personality visible but not editable
     - Prompts/cost/observability not visible
     - Attempt to save settings via any UI path → rejected by server action
3. **Build/lint**
   - Run `npm run lint`, `npm run test`, `npm run build`.
4. **Docs**
   - Update `README.md` with:
     - how to configure Resend per workspace
     - how to add a client portal user
     - what client portal users can/cannot do

## Output
- **Tests:** `npm run test` passed (includes workspace-capabilities tests).
- **Lint:** `npm run lint` completed with existing warnings (hooks deps + `<img>` usage); no new errors introduced.
- **Build:** `npm run build` failed due to unrelated type error in `components/dashboard/analytics-crm-table.tsx` (`CrmSheetRow.rollingMeetingRequestRate` missing).
- **Docs:** `README.md` updated with client portal provisioning + permissions + Resend per-workspace setup.
- **QA checklist:** Added to this plan for rollout (see Work step 2).

## QA Checklist (Manual)
- Admin: create client portal user → email sent; reset password → email sent; remove access.
- Client: log in; Inbox drafts/approval visible; CRM view accessible.
- Client: Settings read-only banner visible; controls disabled; AI personality view-only.
- Client: AI prompts/observability/cost not visible; any settings mutations rejected server-side.

## Handoff
After Phase 85f, the feature is ready for controlled rollout to a single workspace, then broader enablement (pending build fix from analytics type mismatch).
