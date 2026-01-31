# Phase 73e — Test Harness Wiring + Full Verification + Manual QA

## Focus

Run the full quality gates and verify the “no placeholders + blocking” policy holds in practice.

## Inputs

- Phase 73a–73d implemented
- Access to staging/production environment (for real send flows)

## Work

### Step 1 — Wire new tests into `npm test`

**File:** `scripts/test-orchestrator.ts`

Add the new test file(s) (at minimum):
- `lib/__tests__/followup-template.test.ts`

### Step 2 — Run quality gates

Run:

```bash
npm test
npm run lint
npm run build
```

### Step 3 — Manual QA Checklist

Create `docs/planning/phase-73/qa-checklist.md`:

- [ ] Create a test follow-up step template that includes *every* supported variable + alias
- [ ] Create test lead with all fields populated
- [ ] Create test lead with minimal fields (missing lead fields like `firstName` and `companyName` for `{leadCompanyName}`)
- [ ] Ensure workspace settings are intentionally incomplete (missing `WorkspaceSettings.companyName` / `aiPersonaName`) to verify activation/sending blocks
- [ ] Verify email preview in UI shows correct replacements
- [ ] Verify SMS preview in UI shows correct replacements (when phone exists)
- [ ] Verify LinkedIn preview in UI shows correct replacements (when LinkedIn URL exists)
- [ ] Verify availability slots show correctly when configured, and sending is **blocked** when not configured/available (no placeholders)
- [ ] Verify calendar link shows correctly when configured, and sending is **blocked** when missing (no `[calendar link]`)
- [ ] Verify attempting to send with missing data is blocked, with:
  - toast
  - inline UI message explaining what to configure
- [ ] Verify paused instances show a meaningful blocked reason in Follow-ups view
- [ ] Verify Master Inbox conversation cards show a clear “Follow-ups blocked” label for leads with paused instances (missing lead data vs missing setup)

### Step 4 — Dry-run support (Optional)

**File:** `lib/followup-engine.ts` already supports `FOLLOWUPS_DRY_RUN=true`

Verify `FOLLOWUPS_DRY_RUN=true` works correctly:
- Generates messages but doesn't send
- Logs what would be sent
- Useful for production debugging

## Output

- `docs/planning/phase-73/qa-checklist.md` — Manual QA checklist
- `scripts/test-orchestrator.ts` already includes `lib/__tests__/followup-template.test.ts`
- Tests/lint/build not run in this workspace (run per checklist)

## Handoff

Phase 73 complete. Follow-up templates are validated, sends are blocked when variables are missing, and placeholders/default fallbacks never ship.

### Deployment Notes

After merging:
1. No database migration required (code-only change)
2. No environment variable changes required
3. Changes take effect immediately on deploy
4. Monitor Slack/email for any edge cases
