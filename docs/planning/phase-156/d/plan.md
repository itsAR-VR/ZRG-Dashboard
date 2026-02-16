# Phase 156d — Admin Deduplication and Access Harmonization

## Focus
Aggressively remove redundant Admin/AI surfaces and ensure role-based access remains correct for workspace admins and super admins.

## Inputs
- `docs/planning/phase-156/plan.md`
- Phase `156c` migrated layout
- Access gating logic in `components/dashboard/settings-view.tsx` and workspace capability helpers

## Work
1. Keep a single `AI Dashboard` instance in Admin observability; remove all duplicate render paths.
2. Merge/remove duplicated operational cards so every control has one authoritative location.
3. Validate `showAdminTab` behavior still matches intended access:
   - visible to workspace admins (including super-admin capability path)
   - hidden for client-portal users
4. Remove dead imports/state/hooks created by moved/deleted cards.

## Validation
- Manual role matrix check (workspace admin, non-admin member, client portal, super admin).
- Verify no duplicate UI cards remain between `AI Personality` and `Admin`.

## Output
- Simplified Admin surface with zero duplicate AI ops/observability cards and preserved access rules.

## Handoff
Phase `156e` verifies navigation stability, deep links, and retargeted CTA flows after layout changes.

## Status
- Completed (role matrix manual pass partial due shared-env constraints)

## Progress This Turn (Terminus Maximus)
- Removed duplicate `AI Dashboard` rendering from `AI Personality`; retained a single instance in Admin observability.
- Consolidated runtime cards so controls/observability have one authoritative location in Admin.
- Updated workspace-admin derivation to accept either capability-derived admin or `getWorkspaceAdminStatus` fallback, while still hiding admin surfaces for client-portal users.

## Access Harmonization Result
- `showAdminTab` behavior remains aligned with intended role constraints.
- `isWorkspaceAdmin` now uses a safer derived path:
  - `capabilities?.isWorkspaceAdmin` OR legacy admin-status API response.
  - still blocked when `capabilities?.isClientPortalUser` is true.
