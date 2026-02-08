# Phase 118d — Security/Ops Audit (Cron + Webhooks) and Remaining Launch Blockers

## Focus
Close remaining “launch blocker” risks by auditing cron/webhook auth and explicitly resolving any known-accept security gaps.

## Inputs
- `vercel.json` (cron schedule)
- Cron routes: `app/api/cron/**`
- Webhooks: `app/api/webhooks/**`
- Phase 117d audit plan: `docs/planning/phase-117/d/plan.md`

## Work
1. Cron auth
   - Confirm every cron route checks `Authorization: Bearer <CRON_SECRET>` before doing work and returns 401 otherwise.
   - Confirm overlap prevention exists where needed (advisory-lock pattern).

2. Webhook auth + input hygiene
   - Confirm webhook routes validate secrets/signatures and are idempotent/dedupe-safe.
   - Confirm error logs do not include raw inbound content.

3. Calendly signing key risk (explicit decision required)
   - Current behavior: if signing key is missing, the endpoint can accept any POST (see Phase 117 plan RT-5).
     - File: `app/api/webhooks/calendly/[clientId]/route.ts`
   - Decision (user-confirmed): **enforce signing keys in production**.
   - Implementation notes:
     - In production, reject webhook requests if no signing key is configured for the workspace (or global fallback) OR if the signature is invalid.
     - Prefer failing closed with an explicit 5xx when the server is misconfigured (missing key), so misconfig is caught immediately.

## Output
- A short audit note listing what is verified vs what is intentionally accepted (with mitigations).

## Handoff
- Proceed to Phase 118e to finalize launch + rollback runbook and schedule Phase 116 canary.
