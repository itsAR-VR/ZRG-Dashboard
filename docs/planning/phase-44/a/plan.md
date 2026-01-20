# Phase 44a — Email Bison Base Host Data Fix

## Focus

Assign the correct Email Bison base hosts to all workspaces via SQL. This is a data-only fix that requires no code deployment and will immediately unblock all email sends.

## Inputs

- Database state showing all workspaces have `emailBisonBaseHostId: null`
- Available base hosts: `send.foundersclubsend.com` (Founders Club), `send.meetinboxxia.com` (Inboxxia default)
- User confirmation: Founders Club uses `foundersclubsend.com`, all others use `meetinboxxia.com`

## Work

### Step 1: Verify base hosts exist

```sql
SELECT id, host, label FROM "EmailBisonBaseHost" ORDER BY host;
```

Expected:
- `send.foundersclubsend.com` (Founders Club)
- `send.meetinboxxia.com` (Inboxxia default)

### Step 2: Assign Founders Club to its base host

```sql
UPDATE "Client"
SET "emailBisonBaseHostId" = (
  SELECT id FROM "EmailBisonBaseHost" WHERE host = 'send.foundersclubsend.com'
)
WHERE name = 'Founders Club';
```

### Step 3: Assign all other workspaces with API keys to default host

```sql
UPDATE "Client"
SET "emailBisonBaseHostId" = (
  SELECT id FROM "EmailBisonBaseHost" WHERE host = 'send.meetinboxxia.com'
)
WHERE name != 'Founders Club'
  AND "emailBisonApiKey" IS NOT NULL;
```

### Step 4: Verify assignments

```sql
SELECT c.name,
       c."emailBisonApiKey" IS NOT NULL as has_api_key,
       ebh.host as base_host
FROM "Client" c
LEFT JOIN "EmailBisonBaseHost" ebh ON c."emailBisonBaseHostId" = ebh.id
WHERE c."emailBisonApiKey" IS NOT NULL
ORDER BY c.name;
```

Expected: All rows show correct `base_host` (Founders Club → `send.foundersclubsend.com`, others → `send.meetinboxxia.com`)

## Output

**Status:** Not executed in this environment.

- No production SQL was executed as part of Phase 44 work in this repo.
- The dashboard now includes a per-workspace EmailBison base host setting (Settings → Integrations) so the correct host can be selected without manual SQL (see `docs/planning/phase-44/review.md`).
- The SQL above remains an optional operational runbook if you still want to backfill existing workspaces directly in the database.

## Handoff

Phase 44a SQL backfill deferred (optional). Proceed to Phase 44b (Calendly fix) and deploy the UI changes, then set base hosts per workspace via Settings → Integrations.
