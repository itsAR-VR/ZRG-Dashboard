# Phase 148b — Ingestion Hardening

## Focus
Ensure all inbound/enrichment ingestion paths treat LinkedIn profile URLs and company URLs correctly: profile → `Lead.linkedinUrl`, company → `Lead.linkedinCompanyUrl`, never allow company URLs in `linkedinUrl`.

## Inputs
- New schema + utilities from Phase 148a (`classifyLinkedInUrl`, `linkedinCompanyUrl` field)
- Existing ingestion entrypoints (all have uncommitted changes to absorb and correct):
  - Inboxxia email webhook: `app/api/webhooks/email/route.ts`
  - Email inbound post-process: `lib/background-jobs/email-inbound-post-process.ts`
  - GHL SMS webhook: `app/api/webhooks/ghl/sms/route.ts`
  - Unipile LinkedIn webhook: `app/api/webhooks/linkedin/route.ts`
  - Clay webhook: `app/api/webhooks/clay/route.ts`

## Work

### Pattern for All Paths
Every ingestion path must follow this pattern:
```typescript
const classified = classifyLinkedInUrl(rawUrl);
// Pass to findOrCreateLead:
{ linkedinUrl: classified.profileUrl, linkedinCompanyUrl: classified.companyUrl }
```
Or when using `mergeLinkedInUrl` for existing leads:
```typescript
const classified = classifyLinkedInUrl(incomingUrl);
const mergedProfile = mergeLinkedInUrl(existingLead.linkedinUrl, classified.profileUrl);
// Fill-only for company:
const mergedCompany = existingLead.linkedinCompanyUrl || classified.companyUrl;
```

### 1. Inboxxia Email Webhook (`app/api/webhooks/email/route.ts`)
- When extracting LinkedIn from message content via `extractContactFromMessageContent()`, classify the result.
- When extracting from EmailBison custom variables, scan all relevant keys, classify each URL found.
- When extracting from signature via `extractContactFromSignature()`, classify the result.
- Route profile → `linkedinUrl`, company → `linkedinCompanyUrl`.
- No direct assignment of raw LinkedIn strings to `Lead.linkedinUrl`.

### 2. Email Inbound Post-Process (`lib/background-jobs/email-inbound-post-process.ts`)
- Same extraction sources as email webhook (message content, custom vars, signature).
- Classify all URLs before merge. Route to correct fields.

### 3. GHL SMS Webhook (`app/api/webhooks/ghl/sms/route.ts`) (F3 variant)
- The `getCustomDataValue` helper scans keys like `"company"`, `"company linkedin"` alongside `"linkedin"`, `"linkedin profile"`.
- **Key-name-based routing is insufficient** — a field named "linkedin" could contain a company URL and vice versa. Always classify by URL content, not field name.
- Pass classified URLs to `findOrCreateLead` via the updated `ExternalIds`.

### 4. Unipile LinkedIn Webhook (`app/api/webhooks/linkedin/route.ts`) (F3 CRITICAL)
- **New lead creation (line ~150):** Current uncommitted code: `{ linkedinUrl: incomingLinkedInUrl || incomingProfileUrl }`. When `incomingLinkedInUrl` is a company URL and `incomingProfileUrl` is null, new lead gets `linkedinUrl = companyUrl`.
- **Fix:** Classify the sender URL. If only company URL exists, set `linkedinCompanyUrl` and leave `linkedinUrl` null.
- **Existing lead update:** Use `mergeLinkedInUrl` for profile field. Fill-only for company field.
- **Connection accepted handler:** Same classify+route pattern for `connection.linkedin_url`.

### 5. Clay Webhook (`app/api/webhooks/clay/route.ts`)
- Clay enrichment is expected to return profile URLs, but classify anyway as defense-in-depth.
- Route classified URLs to correct fields.

## Output
- All 5 ingestion paths enforce profile-only for `Lead.linkedinUrl`.
- Company URLs are stored in `Lead.linkedinCompanyUrl` (fill-only, no overwrite).
- Deterministic classification by URL content, not field/key name.
- Tests cover key-order edge cases and company-URL-only ingestion scenarios.

## Handoff
Proceed to Phase 148c to ensure runtime follow-up execution and sender behavior cannot starve on company-only data.

## Progress This Turn (Terminus Maximus)
- Work done:
  - `app/api/webhooks/ghl/sms/route.ts`: classified custom LinkedIn URLs and routed them to `linkedinUrl` (profile) and `linkedinCompanyUrl` (company).
  - `app/api/webhooks/linkedin/route.ts`: replaced any-URL lookup with profile-only lookup keys; new-lead and update paths now store company URLs only in `linkedinCompanyUrl`.
  - `app/api/webhooks/clay/route.ts`: classified Clay LinkedIn payload values and routed company URLs to `linkedinCompanyUrl` (defense in depth).
  - `lib/background-jobs/email-inbound-post-process.ts`: added shared classify+merge helper, split routing for message/custom-vars/signature extraction, and profile-only enrichment trigger inputs.
  - `actions/enrichment-actions.ts`: updated manual enrichment paths to treat LinkedIn prerequisites as profile-only and persist company URLs separately.
  - `lib/__tests__/signature-extractor.test.ts`: updated expectation to preserve company URL extraction for split-field routing.
- Commands run:
  - `DATABASE_URL='postgresql://test:test@localhost:5432/test?schema=public' DIRECT_URL='postgresql://test:test@localhost:5432/test?schema=public' OPENAI_API_KEY=test node --conditions=react-server --import tsx --test lib/__tests__/signature-extractor.test.ts` — pass.
- Blockers:
  - None at code level for ingestion path edits.
  - Full end-to-end DB-backed ingestion validation remains blocked by DB connectivity in this environment.
- Next concrete steps:
  - Execute live webhook sanity checks against a reachable environment (Tim workspace + one control workspace).
  - Proceed with global backfill only after DB access is available.
