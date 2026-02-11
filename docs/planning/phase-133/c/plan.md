# Phase 133c — UI: Add “Open in EmailBison” Buttons

## Focus
Expose EmailBison quick-access buttons in the lead drawers, placed directly under the existing GHL deep link, with loading state and friendly errors.

## Inputs
- Server action from Phase 133b: `resolveEmailBisonReplyUrlForLead(leadId)`
- Existing placement of GHL link buttons:
  - `components/dashboard/crm-drawer.tsx` “Actions” section
  - `components/dashboard/crm-view.tsx` lead detail sheet buttons area

## Work
1. `components/dashboard/crm-drawer.tsx`
   - Import `resolveEmailBisonReplyUrlForLead`
   - Add local state: `isOpeningEmailBison`
   - Render button directly under “Open in Go High-Level”:
     - Only render if `lead.emailBisonLeadId` is truthy
     - On click:
       - call server action with `lead.id`
       - on success: `window.open(url, "_blank", "noopener,noreferrer")`
       - on failure: toast error using `sonner`
     - Disable + show spinner while resolving
2. `components/dashboard/crm-view.tsx`
   - Do the same in `LeadDetailSheet`:
     - Place directly under the existing “Open in Go High-Level” button (and above “Open in Master Inbox”)
     - Only render when `lead.emailBisonLeadId` is truthy
3. Styling decision (locked):
   - Use `variant="outline"` for the EmailBison button so the existing GHL button remains the primary action.

## Planned Output
- EmailBison quick-access button visible in both lead drawers for EmailBison leads.

## Planned Handoff
- Phase 133d adds unit tests for the selection helper and runs lint/typecheck/tests to ensure the feature is safe to ship.

## Output
- Added “Open in EmailBison” button under the existing GHL button in:
  - `components/dashboard/crm-drawer.tsx`
  - `components/dashboard/crm-view.tsx`
- Button is only shown when `lead.emailBisonLeadId` is present, shows a loading spinner while resolving, and displays a toast on failure.

## Handoff
- Proceed to Phase 133d to add unit tests for UUID selection and run lint/typecheck/tests.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Wired the EmailBison deep-link resolver into both lead drawers with a secondary (outline) action button placed under the existing GHL link.
  - Opened a blank tab synchronously to reduce popup-blocker issues, then navigated once the server action returned the final URL.
- Commands run:
  - `npm run lint` — pass (warnings only)
- Blockers:
  - None
- Next concrete steps:
  - Add unit tests + run full quality gates (Phase 133d).
