# Phase 150b — LinkedIn Ingestion Precedence Hardening (Profile Wins, Company Preserved)

## Focus
Fix LinkedIn write-path selection so profile URLs always populate actionable fields when available, while company URLs are retained without blocking outbound/follow-up behavior.

## Inputs
- `docs/planning/phase-150/a/plan.md` diagnostics matrix
- Existing LinkedIn helpers and ingestion callsites:
  - `lib/linkedin-utils.ts`
  - `lib/lead-matching.ts`
  - `app/api/webhooks/email/route.ts`
  - `app/api/webhooks/ghl/sms/route.ts`
  - `lib/background-jobs/email-inbound-post-process.ts`

## Work
1. Encode an explicit LinkedIn source-precedence contract from 150a findings:
   - Profile URL takes priority for `Lead.linkedinUrl`
   - Company URL routes to `Lead.linkedinCompanyUrl`
   - Fill-only merge rules remain intact
2. Remove/replace permissive callsites that can still blur profile/company intent.
3. Align extraction helpers so all ingestion paths share the same classification and merge behavior.
4. Add regression tests for mixed payload scenarios:
   - profile only
   - company only
   - both profile + company in same payload
   - noisy/invalid values
5. Confirm no cross-client regression in lead matching semantics.

## Output
- Hardened LinkedIn ingestion + matching implementation with test coverage proving profile/company correctness under real payload patterns.

## Handoff
Pass normalized LinkedIn field behavior and known skip reasons to 150c so SMS/LinkedIn runtime logic can rely on deterministic lead prerequisites.
