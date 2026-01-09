# Phase 8c — Global Backfill Across All Clients/Leads (Resumable + Fast)

## Focus
Run a one-time (or resumable) backfill across **every client** and **all leads** (including non-responders) to resolve missing `ghlContactId` when discoverable and hydrate missing lead fields from GHL, as fast as possible while respecting GHL limits.

## Inputs
- DB: `Lead` + `Client` tables (`ghlLocationId`, `ghlPrivateKey`, `Lead.email`, `Lead.ghlContactId`, `Lead.phone`)
- Resolver/hydration:
  - `lib/ghl-api.ts` (`searchGHLContactsAdvanced`, `getGHLContact`)
  - `lib/ghl-contacts.ts` (`ensureGhlContactIdForLead`) if creation/upsert is allowed by policy
  - `lib/phone-utils.ts` (`toStoredPhone`)
- Rate limiter from Phase 8b (centralized in `lib/ghl-api.ts`)

## Work
1. Implement a backfill runner as a script and/or cron endpoint:
   - Preferred for very large datasets: a CLI script in `scripts/` that can run for hours without serverless timeouts.
   - Optional: a cron endpoint that processes a capped batch per run with a cursor.
2. Eligibility (include non-responders):
   - Leads missing **any** of: `phone`, `email`, `firstName`, `lastName`, `companyName`, or missing `ghlContactId` while having an email.
   - Do not restrict to “responders” or positive sentiment (scan the whole table).
3. Per-lead backfill logic:
   - If `ghlContactId` exists → `GET /contacts/{id}` → fill missing lead fields (normalize phone).
   - Else if `email` exists → `POST /contacts/search` by email → if found, save `ghlContactId` then `GET /contacts/{id}` and hydrate.
   - If not found, record “not found” (no PII) and continue.
   - If business rules allow create/upsert for some leads, gate that explicitly (do not accidentally create for every lead unless intended).
4. Make it resumable and observable:
   - Use cursor pagination over leads (by `id` or `updatedAt`).
   - Persist progress to allow restart:
     - CLI script option: write a local JSON state file (e.g., `./.backfill-state.json`) keyed by `clientId` with `lastLeadId`.
     - Cron option: store cursor/progress in the DB (preferred if it must run in production unattended).
   - Log only counts + lead/client IDs; never log phone/email.
5. Maximize throughput safely:
   - Run high concurrency across leads while relying on per-location throttling from Phase 8b.
   - Consider parallelism across clients/locations (limits are per location).
    - Minimize calls:
      - Hydrate from `POST /contacts/search` response directly when it contains the needed fields.
      - Only call `GET /contacts/{id}` when required (missing data not present in search payload, or when verifying a stored `ghlContactId`).

## Suggested Script Shape (Concrete)
- File: `scripts/backfill-ghl-lead-hydration.ts`
- CLI flags:
  - `--client-id <id>` (optional; default all clients)
  - `--dry-run` (no DB writes)
  - `--concurrency <n>` (global)
  - `--per-location-rps <n>` or `--per-location-burst-per-10s <n>`
  - `--resume` (reads state file) / `--state-file <path>`
  - `--max-leads <n>` (safety cap)

## Output
- A backfill that can repair existing leads at scale (all clients/leads, including non-responders) and can be resumed until complete.

## Handoff
Run end-to-end verification and finalize rollout/monitoring notes in Phase 8d.

### Completed Changes
- Implemented CLI backfill runner (search/link/hydrate only; NO contact creation):
  - `scripts/backfill-ghl-lead-hydration.ts`
  - Scans all clients with GHL configured and processes all leads eligible for hydration:
    - Missing any of: `phone`, `email`, `firstName`, `lastName`, `companyName`
    - Or missing `ghlContactId` while having an email
  - Per-lead behavior:
    - If `Lead.ghlContactId` exists → `GET /contacts/{id}` → fill missing fields
    - Else if `Lead.email` exists → `POST /contacts/search` (email eq) → link + hydrate from found contact
    - Never creates/upserts a contact
- Resumability + throughput:
  - Supports `--resume` + `--state-file <path>` (writes per-client `lastLeadId` cursor).
  - Supports `--lead-concurrency` and `--client-concurrency` (safe under centralized GHL rate limiter).
  - Respects centralized throttling in `lib/ghl-api.ts` via `GHL_REQUESTS_PER_10S` and `GHL_MAX_429_RETRIES`.

### Runbook (Examples)
- Dry run: `npx tsx scripts/backfill-ghl-lead-hydration.ts --dry-run`
- Apply all clients: `npx tsx scripts/backfill-ghl-lead-hydration.ts --apply --resume`
- Apply one workspace: `npx tsx scripts/backfill-ghl-lead-hydration.ts --apply --clientId <workspaceId> --resume`
