# Phase 91c — Tests + Verification Runbook

## Focus
Add automated coverage for provisioning behavior and define a quick manual runbook for verifying the feature end-to-end.

## Inputs
- Phase 91a server action: `actions/workspace-member-provisioning-actions.ts`
- Phase 91a helpers: `lib/user-provisioning-helpers.ts`
- Existing test harness: `npm run test` (`scripts/test-orchestrator.ts`)

## Work

### Step 1: Create test file
Create `lib/__tests__/workspace-member-provisioning.test.ts` with unit tests for the provisioning core:
- New user path (create + email + membership)
- Existing user path (membership only, no email)
- Invalid role rejected
- Invalid email rejected
- Resend not configured rejected
- Duplicate membership handled (created=false)

### Step 2: Register test file (CRITICAL)
The `scripts/test-orchestrator.ts` uses **MANUAL file registration** via the `TEST_FILES` array (not auto-discovery). You MUST add the new test file:

```typescript
const TEST_FILES = [
  // ... existing entries ...
  "lib/__tests__/workspace-member-provisioning.test.ts",  // Phase 91
];
```

**Without this step, `npm run test` will NOT run the new tests (they will be silently skipped).**

### Step 3: Manual verification runbook

#### Scenario A: New user as SETTER
1. Go to Settings → Team
2. Enter a NEW email (not in Supabase Auth)
3. Select role: SETTER
4. Click "Add Team Member"
5. **Expected:** Toast "Team member added (login email sent)"
6. **Verify:** Check email inbox for login credentials
7. **Verify:** Go to Integrations → Assignments; new email appears in setter list
8. **Verify:** Round-robin sequence builder shows new setter as option

#### Scenario B: Existing user as INBOX_MANAGER
1. Go to Settings → Team
2. Enter an EXISTING email (already in Supabase Auth)
3. Select role: INBOX_MANAGER
4. Click "Add Team Member"
5. **Expected:** Toast "Team member added" (NO email sent)
6. **Verify:** Go to Integrations → Assignments; email appears in inbox manager list
7. **Verify:** NO new email received

#### Scenario C: Duplicate membership (idempotent)
1. Repeat Scenario A with the same email + role
2. **Expected:** Toast "Team member added" (graceful idempotency)

#### Scenario D: Invalid role (not via UI)
1. Call action directly with role "ADMIN"
2. **Expected:** Error "Invalid role"

### Step 4: Validation commands
```bash
npm run test
npm run lint
 # Turbopack build is blocked in the Codex sandbox; validate with webpack:
npx next build --webpack
```

## Validation (RED TEAM)

1. **Test registration verified:** ✅
   ```bash
   grep -n "workspace-member-provisioning.test.ts" scripts/test-orchestrator.ts
   # Must show the file in TEST_FILES array
   ```

2. **Tests run and pass:** ✅
   ```bash
   npm run test
   # Should include workspace-member-provisioning tests in output
   ```

3. **Manual scenarios completed:**
   - [ ] Scenario A: New user provisioned, email received, appears in Assignments
   - [ ] Scenario B: Existing user added, no email sent
   - [ ] Scenario C: Duplicate membership handled gracefully
   - [ ] Scenario D: Invalid role rejected

4. **Build validation:** ✅
   ```bash
   npm run lint

   # Turbopack build is blocked in the Codex sandbox; validate with webpack:
   npx next build --webpack
   ```

## Output
- `lib/__tests__/workspace-member-provisioning.test.ts` — unit tests for provisioning
- `scripts/test-orchestrator.ts` — updated with new test file registration
- This runbook serves as the verification checklist

## Validation Notes
- `npm run test` ✅ (108 tests passed, includes `provisionWorkspaceMemberCore`)
- `npm run lint` ⚠️ warnings only (pre-existing hooks/img warnings + baseline-browser-mapping notice)
- `npx next build --webpack` ✅ (warnings: middleware deprecation notice + baseline-browser-mapping notice)

## Handoff
Phase 91 is ready for implementation close-out. Manual UI scenarios still need confirmation in a live workspace.
