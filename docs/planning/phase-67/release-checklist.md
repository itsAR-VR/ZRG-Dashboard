# Phase 67 — Release Checklist

## Pre-Deploy Gates

### 1. Code Quality ✅
- [x] `npm run lint` — 0 errors (18 pre-existing warnings acceptable)
- [x] `npm run build` — Passes successfully
- [x] Schema in sync — No pending `prisma/schema.prisma` changes

### 2. Changes Summary

| Subphase | Change | Files |
|----------|--------|-------|
| 67b | Supabase cookie pre-validation; analytics warn | `lib/supabase/middleware.ts`, `actions/analytics-actions.ts` |
| 67c | Auto-send kill-switch tests | `lib/auto-send/__tests__/orchestrator.test.ts` |
| 67a | Follow-up UI clarity updates | `components/dashboard/crm-drawer.tsx`, `components/dashboard/followup-sequence-manager.tsx`, `components/dashboard/settings-view.tsx` |

### 3. Pending (Uncommitted) Changes

| File | Purpose | Risk |
|------|---------|------|
| `components/dashboard/crm-drawer.tsx` | Follow-up instance display | Low — UI only |
| `components/dashboard/followup-sequence-manager.tsx` | Built-in trigger labels/tooltips | Low — UI only |
| `components/dashboard/settings-view.tsx` | Direct-book calendar sentinel | Low — UI only |
| `lib/supabase/middleware.ts` | Avoid refresh_token_not_found errors | Low — Auth guard only |
| `lib/auto-send/__tests__/orchestrator.test.ts` | Kill-switch test coverage | Low — tests only |
| `docs/planning/phase-67/*` | Phase documentation updates | None |

---

## Deploy Steps

### 1. Commit Changes
```bash
git add lib/availability-cache.ts lib/booking-target-selector.ts
git add actions/analytics-actions.ts lib/auto-send/orchestrator.ts lib/auto-send/index.ts
git add docs/planning/phase-67/
git commit -m "Phase 67: Error hardening + auto-send kill-switch"
```

### 2. Push to Main
```bash
git push origin main
```

### 3. Monitor Vercel Deployment
- [ ] Check Vercel dashboard for build status
- [ ] Verify deployment completes without errors

---

## Post-Deploy Verification

### 1. Smoke Tests
Follow `docs/planning/phase-67/c/smoke.md`:
- [ ] Kill-switch verification (if testing in staging)
- [ ] AI auto-send happy path
- [ ] Auto-booking scenarios

### 2. Error Log Check (24 hours post-deploy)
```bash
# Export logs from Vercel dashboard
# Run assertion script
npm run logs:check
```

**Expected Results:**
- `ai_max_output_tokens`: 0 hits
- `ghl_missing_phone_number`: 0 hits
- `ghl_invalid_country_calling_code`: 0 hits
- `ghl_sms_dnd`: 0 hits
- `max_call_stack`: 0 hits

**Expected:** `supabase_refresh_token_not_found` should drop to 0 after cookie pre-validation. If it persists, confirm whether it’s emitted by upstream library code.

---

## Rollback Triggers

### Immediate Rollback If:
1. Build fails on Vercel
2. Runtime errors spike (check Vercel > Functions > Errors)
3. Auto-send fires when it shouldn't (set `AUTO_SEND_DISABLED=1` as emergency lever)

### Rollback Steps
1. **Via Vercel**: Promote previous deployment to production
2. **Via Git**: `git revert HEAD && git push`

---

## Canary (Optional)

If deploying to a preview branch first:

```bash
git checkout -b phase-67-canary
git push origin phase-67-canary
```

1. Deploy preview to Vercel
2. Run smoke tests against preview URL
3. Check preview function logs
4. If clean, merge to main

---

## Sign-Off

| Gate | Status | Verified By |
|------|--------|-------------|
| Lint | ✅ | CI |
| Build | ✅ | CI |
| Smoke Tests | ☐ | |
| 24h Log Check | ☐ | |

**Release Approved By:** _________________
**Date:** _________________
