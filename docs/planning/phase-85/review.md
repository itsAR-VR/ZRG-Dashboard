# Phase 85 — Review

## Summary
- **Status:** Substantially complete; blocked by unrelated build error
- Phase 85 (Client Portal Users) shipped RBAC, provisioning, read-only settings enforcement, and UI gating
- Lint and tests pass; build fails due to unrelated type error in `analytics-crm-table.tsx` (Phase 83/90)
- All success criteria met except final build gate

## What Shipped

### 85a — RBAC + Capabilities Helper
- `CLIENT_PORTAL` added to `ClientMemberRole` enum in `prisma/schema.prisma`
- `lib/workspace-capabilities.ts` — `getCapabilitiesForRole()`, `requireWorkspaceCapabilities()`
- `actions/access-actions.ts` — `getWorkspaceCapabilities()` server action
- `lib/__tests__/workspace-capabilities.test.ts` — unit tests (registered in orchestrator)
- Role union updates in `lib/mock-data.ts`, `components/dashboard/crm-drawer.tsx`

### 85b — Provisioning
- `actions/client-portal-user-actions.ts` — create/reset/remove flows with Supabase admin + Resend email
- `components/dashboard/settings/client-portal-users-manager.tsx` — admin UI in Settings → Team
- Wired into `components/dashboard/settings-view.tsx`

### 85c — Backend Enforcement
- `actions/settings-actions.ts` — `requireSettingsWriteAccess()` applied to 17+ mutation endpoints
- Client portal users receive `{ success: false, error: "Unauthorized" }` on any settings write

### 85d — UI Gating
- `components/dashboard/settings-view.tsx` — read-only banner, disabled fieldsets, hidden AI observability
- Client portal users see "Settings are read-only. Request changes from ZRG." toast/banner

### 85e — Onboarding Architecture (Planning)
- Self-serve flow contract documented: Stripe → workspace + membership → onboarding collection
- Data separation principle: onboarding inputs never write directly to `WorkspaceSettings`

### 85f — Verification
- Tests pass (93/93); lint clean (warnings only)
- QA checklist defined; README updated with provisioning instructions

## Verification

### Commands
| Command | Result | Timestamp |
|---------|--------|-----------|
| `npm run lint` | Pass (0 errors, 23 warnings) | 2026-02-02 |
| `npm run test` | Pass (93/93) | 2026-02-02 |
| `npm run build` | **Fail** (unrelated type error) | 2026-02-02 |
| `npm run db:push` | Not run (pending merge) | — |

### Build Failure Details
```
./components/dashboard/analytics-crm-table.tsx:317:37
Type error: Property 'rollingMeetingRequestRate' does not exist on type 'CrmSheetRow'.
```
This is Phase 83/90 work (CRM analytics), not Phase 85. Resolve in owning phase before deployment.

## Success Criteria → Evidence

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Admin can create client portal user + email sent | **Met** | `actions/client-portal-user-actions.ts:createClientPortalUser()` + Resend integration |
| Client portal user logs in and sees Inbox/CRM | **Met** | Standard auth flow; no special gating on Inbox/CRM views |
| Settings visible but read-only; mutations rejected | **Met** | `requireSettingsWriteAccess()` in 17+ actions; `fieldset disabled` in UI |
| AI personality disabled/hidden | **Met** | `isClientPortalUser` checks in settings-view.tsx suppress persona editing |
| Prompt/cost views hidden + admin-only | **Met** | `canViewAiObservability` false for CLIENT_PORTAL; AI obs not rendered |
| `npm run lint/test/build` pass | **Partial** | Lint/test pass; build blocked by unrelated error |

## Plan Adherence
- Planned vs implemented deltas: None significant
- All subphases completed with Output/Handoff sections filled

## Multi-Agent Coordination

### Files Touched by Phase 85
- `prisma/schema.prisma` — added `CLIENT_PORTAL` enum value
- `lib/workspace-access.ts` — role precedence
- `lib/workspace-capabilities.ts` — new file
- `actions/access-actions.ts` — new action
- `actions/settings-actions.ts` — write gating
- `actions/client-portal-user-actions.ts` — new file
- `components/dashboard/settings-view.tsx` — UI gating + banner
- `components/dashboard/settings/client-portal-users-manager.tsx` — new file
- `components/dashboard/crm-drawer.tsx` — role union
- `lib/mock-data.ts` — role union
- `scripts/test-orchestrator.ts` — test registration
- `README.md` — docs

### Concurrent Phases
| Phase | Overlap | Status |
|-------|---------|--------|
| Phase 83 | `prisma/schema.prisma`, analytics components | Uncommitted; contains build-blocking type error |
| Phase 89 | `prisma/schema.prisma`, `lib/lead-assignment.ts` | Uncommitted; no direct conflicts with Phase 85 |
| Phase 86 | `vercel.json`, calendar health | Uncommitted; no conflicts |

## Risks / Rollback
- **Build blocker:** Resolve `analytics-crm-table.tsx` type error before deployment
- **Schema migration:** `npm run db:push` required before production use of `CLIENT_PORTAL` role
- **Rollback:** Remove `CLIENT_PORTAL` from enum; revert UI checks; no data migration needed

## Follow-ups
1. [ ] Fix `CrmSheetRow.rollingMeetingRequestRate` type error in Phase 83/90
2. [ ] Run `npm run db:push` to apply schema changes
3. [ ] Manual QA: Admin create/reset/remove flows + client login experience
4. [ ] Deploy to staging and verify end-to-end
5. [ ] Stripe onboarding implementation (future phase per 85e)
