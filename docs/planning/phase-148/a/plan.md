# Phase 148a — Schema + Utilities + Contracts

## Focus
Introduce the data-model and utility primitives needed to treat LinkedIn profile URLs and company URLs as distinct concepts, then update core contracts (matching + sender) to rely only on profile URLs for outbound and eligibility.

## Inputs
- Phase 148 root context and success criteria (`docs/planning/phase-148/plan.md`)
- Existing URL utilities and precedence rules (`lib/linkedin-utils.ts`) — **uncommitted work absorbed as starting baseline**
- Current matching and update semantics (`lib/lead-matching.ts`) — **uncommitted, needs correction**
- Current LinkedIn send path expectations (`lib/system-sender.ts`, `lib/unipile-api.ts`)

## Work

### 1. Prisma Schema
- Add `Lead.linkedinCompanyUrl String?` with comment: `/// LinkedIn company page URL (normalized /company/slug). Not used for outbound or matching.`
- Add `@@index([linkedinCompanyUrl])` — required for backfill verification (148d) and admin diagnostics. **(F6)**
- Run `npm run db:push` and verify column exists.

### 2. Utilities (correct uncommitted code in-place)
- **Export the classifier (F10):** Create public `classifyLinkedInUrl(url): { profileUrl: string | null, companyUrl: string | null }` — wraps the existing private `normalizeLinkedInUrlWithKind`. Ingestion paths will use this to route URLs to the correct field.
- **Update `mergeLinkedInUrl` signature or add split-merge helper:** Current `mergeLinkedInUrl` returns a single URL for `linkedinUrl`. Either:
  - (A) Keep it as-is for profile precedence, and add a separate `mergeLinkedInCompanyUrl(current, incoming)` for company field fill-only semantics.
  - (B) Create `mergeLinkedInUrls(currentProfile, currentCompany, incomingUrl): { linkedinUrl, linkedinCompanyUrl }` that handles both fields.
  - Recommendation: option (A) is simpler and avoids changing existing callers unnecessarily.
- Preserve existing `normalizeLinkedInUrl` (profile-only) and `normalizeLinkedInUrlAny` behavior.

### 3. Contracts

#### Matching — `lib/lead-matching.ts` (F1 CRITICAL)
- **Change `lead-matching.ts:87` from `normalizeLinkedInUrlAny` back to `normalizeLinkedInUrl` (profile-only).** Company URLs must NOT be used as identity resolution keys. A company page is shared by many people and causes false-positive matching.
- Update the `findOrCreateLead` function to:
  - Accept `linkedinCompanyUrl` in `ExternalIds` type.
  - On create: set `linkedinCompanyUrl` if classified as company.
  - On update: fill `linkedinCompanyUrl` (fill-only, don't overwrite existing) alongside the existing `mergeLinkedInUrl` call for profile.

#### Sender validation — `lib/system-sender.ts`
- Note: Full sender validation is in Phase 148c. But 148a should update the `ExternalIds` type contract so downstream callers can pass classified URLs.

### 4. Tests (F9)
- **Fix `lib/__tests__/lead-matching.test.ts:37`:** The test "matches by incoming company URL when existing lead has profile URL" currently asserts company URL matching WORKS. Invert it to assert company URLs do NOT match leads.
- Add new tests:
  - `classifyLinkedInUrl` returns correct split for profile, company, invalid, and mixed inputs.
  - `mergeLinkedInUrl` profile-beats-company precedence.
  - `findOrCreateLead` does not match by company URL; stores company URL in `linkedinCompanyUrl`.
  - Negative: incoming company URL does not match an existing lead by `linkedinUrl`.

## Output
- Prisma schema updated with `linkedinCompanyUrl` + index.
- `classifyLinkedInUrl` exported and ready for ingestion paths.
- Matching uses profile-only normalization.
- `findOrCreateLead` accepts and persists `linkedinCompanyUrl` separately.
- Tests cover split/merge rules and matching constraints (company URL rejection).

## Handoff
Proceed to Phase 148b to update every ingestion write-path to use the new split+classify utilities.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `Lead.linkedinCompanyUrl` field index in `prisma/schema.prisma`.
  - Implemented `classifyLinkedInUrl` and `mergeLinkedInCompanyUrl` in `lib/linkedin-utils.ts`.
  - Switched `lib/lead-matching.ts` to profile-only LinkedIn matching and added split-field persistence (`linkedinUrl` + `linkedinCompanyUrl`).
  - Updated `getAvailableChannels()` to require a valid profile URL for LinkedIn eligibility.
  - Rewrote `lib/__tests__/lead-matching.test.ts` to assert company URLs do not match by identity and are stored separately.
  - Expanded `lib/__tests__/linkedin-utils.test.ts` coverage for classification + split merge behavior.
- Commands run:
  - `npx prisma generate` — pass.
  - `node --import tsx --test lib/__tests__/linkedin-utils.test.ts` — pass.
  - `DATABASE_URL='postgres://...' DIRECT_URL='postgres://...' OPENAI_API_KEY=test node --conditions=react-server --import tsx --test lib/__tests__/lead-matching.test.ts` — fail (`P1001` / DB unreachable in current environment).
- Blockers:
  - Database connectivity is unavailable from this execution environment, so DB-backed lead-matching tests cannot run.
  - `npm run db:push` cannot complete (`P1001`), so schema application is blocked pending DB access.
- Next concrete steps:
  - Complete Phase 148d backfill once DB connectivity is available.
  - Re-run `lib/__tests__/lead-matching.test.ts` after DB access is restored.
