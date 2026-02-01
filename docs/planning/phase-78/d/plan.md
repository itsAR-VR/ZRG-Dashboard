# Phase 78d — Adopt Prisma migrations (baseline + drift fix) + rollout docs

## Focus

Make schema updates reliable across prod and preview by introducing Prisma migrations and a repeatable deploy sequence.

## Inputs

- Current `prisma/schema.prisma`
- Existing runtime env assumptions (Supabase Postgres; `DIRECT_URL` available for migrations)

## Work

- Create `prisma/migrations/` and add:
  - `0001_baseline` migration generated from schema (from-empty)
  - `0002_drift_fix` migration (from current DB → schema) when DB access is available
- Document rollout:
  - Apply baseline via `prisma migrate resolve --applied`
  - Deploy drift-fix via `prisma migrate deploy`
  - Repeat for prod + preview
- Optional automation:
  - Add CI workflow to run `prisma migrate deploy` on `main` merges with serialized concurrency

## Output

- A migrations-based workflow exists in repo, reducing schema drift windows and preventing P2022 regressions.

## Handoff

Phase 78e validates end-to-end behavior and provides a monitoring checklist for rollout completion.

