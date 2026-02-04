# Phase 99c — Docs + Validation

## Focus
Document the updated auth behavior and confirm validation steps.

## Inputs
- Updated route behavior from Phase 99b
- README section: "Follow-Up Template Backfill (Re-engagement)" (lines 384-407)

## Work

### Step 1: Update README auth section

**File:** `README.md`

**Location:** Lines 384-407 (search for "Follow-Up Template Backfill")

**Current text (line 388):**
```md
- **Auth:** `Authorization: Bearer ${WORKSPACE_PROVISIONING_SECRET}` (fallback to `ADMIN_ACTIONS_SECRET` or `CRON_SECRET`)
```

**Updated text:**
```md
- **Auth:** `Authorization: Bearer ${WORKSPACE_PROVISIONING_SECRET}` or `Authorization: Bearer ${ADMIN_ACTIONS_SECRET}` (header-only; `CRON_SECRET` and query-string auth are **not** accepted)
```

**Also update:**
- Line 387: Clarify that this endpoint uses stricter auth than other admin endpoints
- Remove any mention of `?secret=...` query param if present

### Step 2: Run validation commands

```bash
# Unit tests (includes new admin-actions-auth tests)
npm run test

# Lint
npm run lint

# Build (catches TypeScript errors)
npm run build
```

### Step 3: Manual verification (optional but recommended)

```bash
# Should return 401 (CRON_SECRET rejected)
curl -sS "http://localhost:3000/api/admin/followup-sequences/reengagement/backfill" \
  -H "x-cron-secret: $CRON_SECRET" | jq .

# Should return 401 (query-string rejected)
curl -sS "http://localhost:3000/api/admin/followup-sequences/reengagement/backfill?secret=$WORKSPACE_PROVISIONING_SECRET" | jq .

# Should return 200 (valid header auth)
curl -sS "http://localhost:3000/api/admin/followup-sequences/reengagement/backfill" \
  -H "Authorization: Bearer $WORKSPACE_PROVISIONING_SECRET" | jq .

# Should return 200 (valid x-admin-secret)
curl -sS "http://localhost:3000/api/admin/followup-sequences/reengagement/backfill" \
  -H "x-admin-secret: $ADMIN_ACTIONS_SECRET" | jq .
```

### Validations

- [ ] README no longer mentions `CRON_SECRET` for this endpoint
- [ ] README emphasizes header-only auth
- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes

## Output
- README updated to reflect hardened auth
- Validation results recorded in Phase Summary

## Handoff
End of Phase 99. Update root plan with Phase Summary.

