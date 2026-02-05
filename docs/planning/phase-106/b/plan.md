# Phase 106b — Bug: Website link not generated

## Focus
Find where the website link is supposed to be generated and determine why it’s missing, then define a fix and verification steps.

## Inputs
- Monday item: “Website link not generated”
- Likely areas: lead enrichment, AI draft generation, or outbound templates
- Candidate files: `lib/ai-drafts.ts`, `lib/ai/prompt-registry.ts`, integration clients in `lib/*`

## Work
1. Determine expected behavior (which message/flow should include the link).
2. Locate the code path that populates or formats the website link.
3. Verify upstream data availability (lead/company fields in Prisma models).
4. Identify failure mode: missing data, template omission, or gating logic.
5. Define fix and required tests (unit or integration via webhook/cron path).

## Output
- Written fix plan with confirmed source-of-truth field and code touchpoints.

## Handoff
After approval, implement the fix and add verification coverage.
