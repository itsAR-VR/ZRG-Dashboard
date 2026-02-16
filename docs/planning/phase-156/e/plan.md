# Phase 156e — Navigation/Deep-Link Compatibility and CTA Retargeting

## Focus
Preserve URL and tab-navigation compatibility while retargeting in-product buttons/links to new destinations after the IA refactor.

## Inputs
- `docs/planning/phase-156/plan.md`
- Phase `156d` deduplicated layout
- `components/dashboard/dashboard-shell.tsx`
- Settings CTA links in dashboard surfaces (for example `components/dashboard/inbox-view.tsx`)

## Work
1. Keep `settingsTab` enum parsing and coercion contract stable (`general|integrations|ai|booking|team|admin`).
2. Update cross-tab buttons that previously targeted moved AI operational cards (retarget to `admin` where needed).
3. Confirm existing integrations and general deep links remain unchanged.
4. Verify tab-change handlers and query-state synchronization still behave correctly across workspace switches.

## Output
- Backward-compatible settings navigation with accurate destinations for moved controls.

## Handoff
Phase `156f` executes full validation gates and final QA checklist before implementation sign-off.

## Status
- Completed (no additional CTA retarget required)

## Progress This Turn (Terminus Maximus)
- Kept the settings tab contract unchanged: `general|integrations|ai|booking|team|admin`.
- Verified no cross-surface CTA depended on removed AI operational cards for `settingsTab=ai`.
- Confirmed existing discovered settings deep links remain valid (`settingsTab=integrations` link in inbox remains unchanged).

## Verification Notes
- Search run: `rg -n "settingsTab=ai|settingsTab=admin|view=settings" components/dashboard app`
- Result: only integrations deep link found in `components/dashboard/inbox-view.tsx`; no required retarget for this phase.
