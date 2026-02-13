# Phase 151b — LinkedIn Extraction Precedence Hardening (EmailBison + GHL) + Repair Semantics

## Focus
Stop selecting the wrong LinkedIn URL when both profile + company data exists by making extraction value-driven and enforcing profile/company split semantics consistently across ingestion and enrichment.

## Inputs
- `docs/planning/phase-151/a/plan.md` (prod columns exist)
- Existing helpers:
  - `lib/linkedin-utils.ts` (`classifyLinkedInUrl`, `mergeLinkedInUrl`, `mergeLinkedInCompanyUrl`)
- Ingestion/enrichment callsites:
  - `app/api/webhooks/ghl/sms/route.ts`
  - `app/api/webhooks/email/route.ts`
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `actions/enrichment-actions.ts`
  - `lib/lead-matching.ts`

## Work
1. **Define the precedence contract**
   - When multiple LinkedIn URLs are present across payload/custom vars:
     - Prefer `/in/...` for `Lead.linkedinUrl`.
     - Preserve `/company/...` into `Lead.linkedinCompanyUrl`.
   - Repair rule (locked):
     - If `Lead.linkedinUrl` is a company URL (invalid for the profile field) and a profile URL is found later, replace `linkedinUrl` with the profile and store company in `linkedinCompanyUrl` (fill-only for company field).

2. **GHL SMS webhook: remove key-order pitfalls**
   - Replace any “first matching key wins” selection that can stop early on a non-URL value (e.g., a `"Company"` field).
   - Extract by scanning all candidate values in `customData`/`triggerData`:
     - Collect strings containing `linkedin.com/` and classify them.
     - Choose first valid profile URL (if any) and first valid company URL (if any).
   - Write both fields using merge/repair semantics.

3. **EmailBison custom variables: value-scan extraction**
   - Stop depending on exact keys like `"linkedin url"` only.
   - Iterate all custom-variable values and classify any LinkedIn URLs found.
   - Ensure company URLs do not block capturing the profile URL.

4. **Email ingestion + post-process: consistent merge behavior**
   - Ensure message-body extraction routes company URLs to `linkedinCompanyUrl` instead of discarding them.
   - Ensure lead matching remains profile-only (company URLs never used as identifiers).

5. **Regression tests**
   - Mixed payload: profile + company both present -> profile goes to `linkedinUrl`, company goes to `linkedinCompanyUrl`.
   - Repair: existing `linkedinUrl` contains `/company/…` and new profile appears -> `linkedinUrl` becomes profile, company preserved.
   - No false positives: `Company` (name) field should not prevent capturing a later profile URL.

## Output
- Deterministic LinkedIn extraction precedence across EmailBison + GHL paths.
- Lead matching and merges respect profile-only semantics and self-heal incorrect company-in-profile rows when a profile is discovered.

## Handoff
Proceed to 151c to backfill existing bad rows (Tim then global) and verify runtime behavior under the repaired data model.
