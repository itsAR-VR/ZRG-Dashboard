# Phase 3d — Verification + Runbook (End-to-End)

## Focus
Verify Clay send/callback works in production and provide a repeatable checklist for operators to debug quickly next time.

## Inputs
- Updated code from Phase 3b (and any trigger/backfill changes from Phase 3c)
- Clay table configs (LinkedIn + phone) and callback config

## Work
- Update Clay HTTP API header config:
  - Ensure header key is `Content-Type` (no trailing colon)
- Validate with curl against the deployed endpoint:
  - Success callback for LinkedIn
  - Success callback for phone
  - Not-found callback (no result fields)
  - Signature failures (expect 401)
- Confirm:
  - Lead fields updated in DB (Prisma Studio / SQL)
  - Follow-up instances waiting on phone enrichment resume when phone is set
  - Vercel logs show a single clear processing line per callback

## Output
- A short operator runbook: “If Clay isn’t updating leads, check X/Y/Z” with exact payload examples and expected responses.

## Handoff
After verification, decide whether to enable any optional backfill/retry automation permanently (or keep it manual-only).

