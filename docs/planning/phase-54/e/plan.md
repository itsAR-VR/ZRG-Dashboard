# Phase 54e — Verification Runbook + Rollout Checklist

## Focus
Define how to validate Phase 54 changes safely in staging/production and how to monitor for regressions (duplicate sends, bad threading, provider errors, rate-limit issues).

## Inputs
- Phase 54d implementation details
- Existing operational patterns from Phase 53 (timeouts, burst hardening)

## Work
- Write a manual verification checklist:
  - Pick 3–5 leads representing the failure-mode matrix from 54a.
  - Run/trigger reactivation resolution and send; confirm expected status transitions and message creation.
  - Confirm “same thread vs new thread” behavior matches the spec.
- Define logging/telemetry expectations:
  - What to log on failures (without leaking PII), and what to treat as expected control-flow.
- Rollout strategy:
  - If introducing a new provider endpoint for new-thread sends, gate behind an env flag for safe rollout.
  - Provide rollback steps (disable flag; revert to `needs_review` for new-thread-only cases).

## Output
- A short runbook and rollout checklist (added to Phase 54 directory or referenced from the root plan).

## Handoff
After rollout validation, consider backfilling/storing any newly discoverable IDs on `Lead` to reduce provider lookups in the future.

## Validation (RED TEAM)

- [ ] Verify cron job configuration in `vercel.json` for reactivation processing
- [ ] Confirm `CRON_SECRET` is set in Vercel environment
- [ ] Pre-deploy: identify 3-5 test leads matching each failure-mode scenario

## Rollout Checklist (RED TEAM)

### Pre-deploy
- [ ] All Phase 51-53 uncommitted changes committed or stashed
- [ ] `npm run lint && npm run build && npm run test` pass
- [ ] Identify test workspace with reactivation campaigns enabled
- [ ] Document current `needs_review` count for baseline comparison

### Deploy (staged)
- [ ] Deploy to preview environment first
- [ ] Trigger reactivation cron manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://preview.../api/cron/reactivation`
- [ ] Check logs for:
  - Resolution path distribution (DB-first vs EmailBison lookup vs GHL fallback)
  - Anchor type distribution (sent-folder vs inbox)
  - `needs_review` reasons (should see fewer "no anchor" reasons)
- [ ] Verify no duplicate sends (check `ReactivationSendLog` for same enrollmentId)

### Post-deploy monitoring
- [ ] Dashboard: `needs_review` count should decrease (more enrollments resolvable)
- [ ] Dashboard: `sent` count should increase (more enrollments can send)
- [ ] Logs: no timeout errors during resolution
- [ ] Logs: GHL fallback rate (if >30%, investigate EmailBison lookup issues)

### Rollback plan
- [ ] Rollback trigger: >10% of resolutions hitting timeout, or duplicate sends detected
- [ ] Rollback action: Revert commit, redeploy
- [ ] Rollback verification: Confirm reactivation cron uses old logic

## Backfill Consideration (RED TEAM)

After stable rollout, consider running a backfill script to:
- [ ] Populate `Lead.emailBisonLeadId` for leads discovered via GHL fallback
- [ ] Populate `Lead.ghlContactId` for leads found in GHL during resolution
- [ ] Clear stale `needs_review` enrollments that now have resolvable anchors

This reduces future provider API calls and improves resolution speed.

## Output (Filled)

### Manual verification runbook (staging/preview → prod)

**Preflight**
- Confirm Vercel cron path exists: `vercel.json` schedules `/api/cron/reactivations` every 10 minutes.
- Confirm env vars:
  - `CRON_SECRET`
  - per-workspace EmailBison keys/hosts (Settings → Integrations)
  - optional: workspace GHL config (for GHL-assisted fallback)

**Pick 4 test enrollments (same workspace)**
1) **Tier 1 (ideal)**: lead has a sent-folder EmailBison reply whose `campaign_id` matches the ReactivationCampaign’s configured `emailCampaign.bisonCampaignId`.
2) **Tier 2 (relaxed sent)**: lead has sent-folder replies but no matching `campaign_id` (mismatch or missing).
3) **Tier 3 (any-folder fallback)**: lead has replies but none classified as sent-folder (inbox-only thread).
4) **True blocker**: lead has no EmailBison replies/thread (CSV-imported lead with no email history).

**Trigger**
```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<env-host>/api/cron/reactivations" | jq .
```

**Expected outcomes**
- (1) and (2) should move `pending_resolution → ready → sent` in a single cron run (unless sender daily limit blocks).
- (3) should also send, but may use a non-sent anchor (still in-thread).
- (4) should land in `needs_review` with reason:
  - “No EmailBison thread/replies exist for this lead; cannot send reactivation via reply API…”

**DB spot checks**
- Enrollment fields:
  - `emailBisonLeadId` populated when discovered via provider lookups
  - `anchorReplyId` populated even when “sent anchor” wasn’t available (tier 2/3)
  - `selectedSenderEmailId` populated; `status="sent"` after send
- Idempotency:
  - `ReactivationSendLog` has a single row for `(enrollmentId, stepKey="bump_1")`

### Monitoring expectations

- `needs_review` reasons should shift away from “no sent anchor found…” and toward true blockers (missing lead_id, no thread, no sendable sender).
- Watch for cron runtime growth:
  - GHL fallback is best-effort and only runs when EmailBison lead lookup fails; if it becomes common, investigate EmailBison lead lookup reliability/base-host mismatches.

### Rollout + rollback

- Rollout: deploy normally (no new env flags introduced in Phase 54).
- Rollback:
  - revert the Phase 54 changeset and redeploy
  - confirm `/api/cron/reactivations` returns to prior behavior (expect more `needs_review` for missing anchors)

## Handoff (Filled)

- Phase 54 is ready for wrap-up in the root plan: mark success criteria, add a Phase Summary, and note follow-ups (optional backfill of `Lead.emailBisonLeadId` / `Lead.ghlContactId`).
