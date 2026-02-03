# Phase 94d — Vercel + Docs Updates (Env Vars, Cron Schedules, CLI Workflow)

## Focus
Make the mitigations configurable in production and ensure repo documentation reflects how Vercel is actually used (cron schedules, logs, env workflows).

## Inputs
- Phase 94b code changes (new env vars + behavior).
- Cron schedules: `vercel.json`
- Repo docs:
  - `AGENTS.md`
  - `README.md` (env var table)

## Env Var Clarification (RED TEAM)
Draft generation uses two timeouts depending on call site:
- `OPENAI_DRAFT_TIMEOUT_MS` (default 120s) — general draft generation.
- `OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS` (default 30s) — tighter budgets in webhook/background-job contexts (e.g. inbound post-process).
Docs should reflect both and their defaults.

## Work
1) Vercel Environment Variables (Production)
   - Add/update these env vars in Vercel (Production; optionally Preview too):
     - `OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_CAP=45000`
     - `OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_MIN=8000`
     - `OPENAI_EMAIL_VERIFIER_TIMEOUT_SHARE=0.35`
     - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_CAP=10000`
     - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_MIN=3000`
     - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_SHARE=0.2`
     - Optional (lead scoring transient 500s):
       - `OPENAI_LEAD_SCORING_MAX_RETRIES=2`
   - Do not change secrets here (no API keys checked into git).

2) Update `AGENTS.md` (Vercel + cron correctness)
   - **Docs mismatch confirmed:** `AGENTS.md` says follow-ups run "every 10 minutes" but `vercel.json` schedules `* * * * *` (every minute).
   - Fix the Follow-Up Automation schedule note to match `vercel.json` reality.
   - Add a small “Vercel CLI Debugging” section with:
     - Find active prod deployment:
       - `vercel list --environment production --status READY --yes`
     - Stream logs (5-minute window):
       - `vercel logs <deployment-url>`
       - JSON filtering:
         - `vercel logs <deployment-url> --json | jq 'select(.level==\"error\")'`
     - Pull env vars:
       - `vercel env pull .env.local`
     - Manual cron invocation (sanity):
       - `curl -H \"Authorization: Bearer $CRON_SECRET\" \"$NEXT_PUBLIC_APP_URL/api/cron/background-jobs\"`
   - Mention that Vercel CLI `vercel logs` is time-windowed; for longer history use Vercel dashboard or log drains.

3) Update `README.md` env var table (optional but recommended)
   - Add rows documenting the new timeout env vars and defaults.

## Output
- `AGENTS.md` updated with:
  - Correct follow-ups cron schedule (every minute) and background-jobs note
  - A practical Vercel CLI debugging section (deployments, logs, env pull, manual cron calls)
- `README.md` updated:
  - Fixed `OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS` default (30s)
  - Documented Phase 94 timeout env vars + lead scoring retries env var
- Vercel Production env vars set (via `vercel env add ... production --force`):
  - `OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_CAP=45000`
  - `OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_MIN=8000`
  - `OPENAI_EMAIL_VERIFIER_TIMEOUT_SHARE=0.35`
  - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_CAP=10000`
  - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_MIN=3000`
  - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_SHARE=0.2`
  - `OPENAI_LEAD_SCORING_MAX_RETRIES=2`

## Handoff
Proceed to **Phase 94e** for end-to-end verification and rollout monitoring.
