# Phase 63 — Runbook (Post-Deploy Verification)

## Preconditions
- Deploy the branch containing Phase 63 changes.
- Confirm env vars:
  - `CRON_SECRET` (unchanged)
  - Supabase envs (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) (unchanged)
  - Optional (phone AI assist):
    - `PHONE_E164_AI_ENABLED=true`
    - `PHONE_E164_AI_CONFIDENCE_THRESHOLD=0.9` (default is 0.9)
    - `PHONE_E164_AI_MODEL=gpt-5-mini` (default is `gpt-5-mini`)

## 1) Auth noise
1. Open the app in an incognito window (signed out).
2. Navigate to `/` and `/auth/login` a few times.
3. Verify:
   - No repeated `refresh_token_not_found` error logs in Vercel.
   - Auth routes remain accessible; protected routes redirect cleanly.

## 2) Analytics stability (large scopes)
1. Log in as a user with access to many workspaces.
2. Load the analytics page / dashboard home.
3. Verify:
   - No `DriverAdapterError: bind message has ...` errors.
   - No `Maximum call stack size exceeded` errors.

## 3) GHL SMS send edge cases
### DND
1. Pick a lead known to be in GHL SMS DND.
2. Trigger an SMS send (follow-up or manual).
3. Verify:
   - The workflow marks DND and does not spam `console.error` in logs for the expected 400.

### Missing phone / invalid country calling code
1. Pick a lead where GHL contact exists but has no phone.
2. Trigger an SMS send.
3. Verify:
   - The system attempts to normalize the lead phone to a valid E.164 before patching the contact.
   - No `Invalid country calling code` error logs are emitted for normal inputs.
   - If the phone is ambiguous/invalid, the system declines to patch and proceeds to the enrichment path.

## 4) Appointment reconcile cron
1. Trigger `/api/cron/appointment-reconcile` (with CRON auth) on a workspace known to have GHL appointments.
2. Verify:
   - No `Missing ghlAppointmentId for GHL appointment upsert` errors.

## 5) AI drafts
1. Trigger `/api/cron/background-jobs` and allow it to run for several cycles.
2. Verify:
   - SMS/LinkedIn draft generation no longer spams error logs for recoverable incomplete-output states.
   - Deterministic fallback still works when OpenAI is unavailable.

## 6) Local log regression scan (optional)
1. Export logs from Vercel to JSON (same schema as `logs_result copy.json`).
2. Run:
   - `npm run logs:check -- <exported.json>`
3. Verify the script exits successfully.

