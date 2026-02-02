# Phase 89c — Admin Actions + Settings UI Wiring

## Focus
Enable workspace admins to configure weighted round-robin (sequence + email-only gate) via the Inboxxia Dashboard UI, without manual SQL.

## Inputs
- Phase 89a schema fields
- Phase 89b assignment semantics
- Existing assignment actions/UI:
  - `actions/client-membership-actions.ts` (`getClientAssignments`, `setClientAssignments`)
  - `components/dashboard/settings/integrations-manager.tsx` (“Assignments” section)

## Work
1. Extend server actions (`actions/client-membership-actions.ts`):
   - `getClientAssignments(clientId)` returns:
     - current SETTER emails
     - current INBOX_MANAGER emails
     - `roundRobinEnabled`
     - `roundRobinEmailOnly`
     - `roundRobinSetterSequence` (as emails, duplicates preserved)
   - **Implementation note:** Query both `ClientMember` (for roles) AND `WorkspaceSettings` (for round-robin fields) in the same action.
   - **Convert userIds → emails for display:** Map `roundRobinSetterSequence` (stored as userIds) back to emails using `getSupabaseUserEmailById()`. Preserve order and duplicates.
   - `setClientAssignments(clientId, input)` accepts:
     - `setterEmailsRaw`, `inboxManagerEmailsRaw`
     - `roundRobinEnabled` (boolean)
     - `roundRobinEmailOnly` (boolean)
     - `roundRobinSetterSequenceRaw` (emails; duplicates allowed; order preserved)
   - **Sequence parsing:** Create `parseSequenceEmailList(raw: string)` that preserves duplicates (unlike `parseEmailList` which dedupes):
     ```typescript
     function parseSequenceEmailList(raw: string): string[] {
       return raw
         .split(/[\n,;]+/g)
         .map((s) => s.trim().toLowerCase())
         .filter(Boolean);
       // NOTE: No Set() — duplicates preserved for weighting
     }
     ```
   - Validation rules:
     - All emails must resolve to Supabase Auth user IDs (call `resolveSupabaseUserIdByEmail()` for each).
     - Sequence emails must be a subset of the setter user IDs (omission is how Jon is excluded).
     - **On invalid sequence email:** Reject with error listing invalid emails (e.g., "Sequence email(s) not in setter list: foo@example.com").
     - **On unresolvable email:** Reject with "User(s) not found: ..." (existing pattern).
     - If the stored sequence changes, reset `roundRobinLastSetterIndex = -1`.
   - **Pointer reset logic (RED TEAM):**
     ```typescript
     // Compare new sequence to old; reset pointer if changed
     const oldSequence = existingSettings.roundRobinSetterSequence || [];
     const newSequence = resolvedSequenceUserIds;
     const sequenceChanged = JSON.stringify(oldSequence) !== JSON.stringify(newSequence);

     await tx.workspaceSettings.update({
       where: { clientId },
       data: {
         roundRobinEnabled: input.roundRobinEnabled,
         roundRobinEmailOnly: input.roundRobinEmailOnly,
         roundRobinSetterSequence: newSequence,
         // Reset pointer when sequence changes so rotation starts fresh
         ...(sequenceChanged ? { roundRobinLastSetterIndex: -1 } : {}),
       },
     });
     ```
2. Update UI (`components/dashboard/settings/integrations-manager.tsx`):
   - Add controls under "Assignments" per workspace:
     - Toggle: "Round robin enabled"
     - Toggle: "Assign email leads only"
     - **Sequence builder (selectable setter list):** Display current setters as clickable chips/buttons. Admin clicks a setter to add them to the sequence (clicking same setter multiple times adds duplicates for weighting). Show built sequence as reorderable list with remove buttons.
   - **UX pattern:** Similar to tag/chip input but allows duplicates. Example display: `[Vee ×] [JD ×] [Vee ×] [JD ×] [Emar ×]`
   - No freeform email typing needed — selecting from existing setters eliminates validation issues entirely.
   - **Alternative (simpler v1):** Comma-separated email input with example `Vee, JD, Vee, JD, Emar` — can upgrade to selectable UI in future iteration.
3. Founders Club configuration steps (runbook artifact, referenced in 89d):
   - Set setters to include Vee, JD, Jon, Emar (unique).
   - Set sequence to `Vee, JD, Vee, JD, Emar` (omit Jon).
   - Enable round robin and enable email-only.

## Output
- Extended `actions/client-membership-actions.ts`:
  - `getClientAssignments()` now returns `{ setters, inboxManagers, roundRobinEnabled, roundRobinEmailOnly, roundRobinSequence }` where `roundRobinSequence` is an email array (duplicates preserved).
  - `setClientAssignments()` now accepts `{ setterEmailsRaw, inboxManagerEmailsRaw, roundRobinEnabled, roundRobinEmailOnly, roundRobinSequenceRaw }`, validates sequence ⊆ setter list, resolves emails → userIds, updates `ClientMember` roles, and upserts `WorkspaceSettings` round-robin fields (resetting `roundRobinLastSetterIndex` to `-1` when sequence changes).
- Updated `components/dashboard/settings/integrations-manager.tsx` "Assignments" UI:
  - Added toggles for round-robin enable + email-only gating
  - Added selectable setter list UI for building the round-robin sequence (supports duplicates for weighting; see "Users" tab for all available setters)
  - Save calls now persist both role assignments and round-robin configuration.

## Validation (RED TEAM)

1. **Action return shape:**
   - `getClientAssignments` returns: `{ setters, inboxManagers, roundRobinEnabled, roundRobinEmailOnly, roundRobinSequence }`
   - `roundRobinSequence` is email array (not userId array) with duplicates preserved

2. **Validation error cases:**
   - Sequence email not found in Supabase → "User(s) not found: ..."
   - Sequence email not in setter list → "Sequence email(s) not in setter list: ..."

3. **UI state form:**
   - `assignmentsForm` includes: `roundRobinEnabled`, `roundRobinEmailOnly`, `roundRobinSequenceRaw`
   - UI correctly shows loaded values and sends updated values on save

4. **Pointer reset:**
   - When sequence changes: `roundRobinLastSetterIndex` is set to `-1`
   - When sequence unchanged: `roundRobinLastSetterIndex` is NOT modified

## Handoff
Proceed to Phase 89d to add tests and define verification steps for Founders Club.
