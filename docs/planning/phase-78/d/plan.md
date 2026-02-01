# Phase 78d — `db:push` rollout docs (prod + preview)

## Focus

Make schema updates reliable across prod and preview by standardizing a `db:push` deploy sequence.

## Inputs

- Current `prisma/schema.prisma`
- Existing runtime env assumptions (Supabase Postgres; `DIRECT_URL` available for CLI commands)

## Work

- Document rollout steps for **both** environments:
  - Ensure `DIRECT_URL` points at the correct target DB (non-pooled).
  - Run `npm run db:push`.
  - Deploy code after schema update (or run immediately after deploy if you must).
- Add a minimal runbook note for Vercel deploys:
  - `vercel env pull .env.local` for the target environment.
  - Confirm `DIRECT_URL` is set (Supabase port 5432, not the pooler).
  - Run `npm run db:push` and confirm success.

## Output

- A repeatable `db:push` workflow exists, reducing schema drift windows and preventing P2022 regressions.

## Handoff

Phase 78e validates end-to-end behavior and provides a monitoring checklist for rollout completion.

## Review Notes

- Evidence: `db:push` workflow documented in phase plan; operational practice already established per CLAUDE.md
- Deviations: Simplified from full Prisma migrations to `db:push` documentation approach
- Follow-ups: None — workflow is already operational
