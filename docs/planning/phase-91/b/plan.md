# Phase 91b — Team Tab UI: Provisioner Card + Wiring

## Focus
Expose an admin-only UI in Settings → Team to provision workspace members (SETTER/INBOX_MANAGER) via the Phase 91a server action.

## Inputs
- Team tab container: `components/dashboard/settings-view.tsx:5982-5989` (`<TabsContent value="team">`)
- Existing Team tooling: `components/dashboard/settings/client-portal-users-manager.tsx` (Pattern reference)
- Phase 91a action: `provisionWorkspaceMember()`

## Work

### Step 1: Create the provisioner component
Create `components/dashboard/settings/workspace-members-manager.tsx`:

```typescript
interface WorkspaceMembersManagerProps {
  activeWorkspace: string | null;
  isWorkspaceAdmin: boolean;
}
```

### Step 2: UI implementation
- **Visibility:** Only render form when `isWorkspaceAdmin === true`
- **Inputs:**
  - Email input (required)
  - Role select dropdown: `SETTER` | `INBOX_MANAGER` (default: SETTER)
- **CTA:** "Add Team Member" button (disabled while submitting)
- **Feedback:**
  - Toast on success: "Team member added" + "(login email sent)" if new user
  - Toast on error: show `error` from response
  - Clear form on success
- **Info text:** "For new users, login credentials will be sent by email. Existing users will be added without a new email."

### Step 3: Wire into settings-view.tsx
Insert `<WorkspaceMembersManager>` inside Team tab, ABOVE the existing `<ClientPortalUsersManager>`:

```tsx
<TabsContent value="team" className="space-y-6">
  <fieldset disabled={isClientPortalUser} className="space-y-6">
    {!isClientPortalUser ? (
      <>
        <WorkspaceMembersManager
          activeWorkspace={activeWorkspace ?? null}
          isWorkspaceAdmin={isWorkspaceAdmin}
        />
        <ClientPortalUsersManager
          activeWorkspace={activeWorkspace ?? null}
          isWorkspaceAdmin={isWorkspaceAdmin}
        />
      </>
    ) : null}
  </fieldset>
</TabsContent>
```

### Step 4: Import the component
Add import at top of `settings-view.tsx`:
```typescript
import { WorkspaceMembersManager } from "./settings/workspace-members-manager"
```

## Validation (RED TEAM)

1. **Verify component renders:**
   - Navigate to Settings → Team as workspace admin
   - See "Add Team Member" card above "Client Portal Users" card

2. **Verify role selection:**
   - Dropdown shows SETTER and INBOX_MANAGER options
   - Default is SETTER

3. **Verify submission flow:**
   - New user: Toast shows "Team member added (login email sent)"
   - Existing user: Toast shows "Team member added"
   - Error: Toast shows error message

4. **Verify visibility gating:**
   - Non-admin users do not see the provisioning form

## Output
- `components/dashboard/settings/workspace-members-manager.tsx` — new admin-only UI component for provisioning SETTER/INBOX_MANAGER logins.
- `components/dashboard/settings-view.tsx` — Team tab now renders `WorkspaceMembersManager` above `ClientPortalUsersManager`.

## Coordination Notes
No conflicts detected; Team tab structure preserved and new component is wrapped in the existing `isClientPortalUser` guard.

## Handoff
Proceed to Phase 91c to add tests and a verification runbook.
