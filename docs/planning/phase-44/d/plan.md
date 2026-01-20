# Phase 44d — RED TEAM Addendum (Safe SQL + Coordination + Rollback)

## Focus

Harden Phase 44 execution so fixes are safe, idempotent, and debuggable (avoid accidental misassignment of EmailBison base hosts; ensure we can rollback; document coordination with recent EmailBison phases).

## Inputs

- Phase 44 root plan + evidence logs
- Known workspace ID: Founders Club `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
- Recent related work:
  - Phase 42: EmailBison auth + base host feature
  - Phase 41: EmailBison client changes

## Work

### Step 0 — Pre-flight conflict check (multi-agent)

- Run `git status --porcelain` and confirm no unexpected modifications in EmailBison/Calendly files (this phase should be data fix + small Calendly action change).
- Confirm Phase 42 schema/code is deployed to the target environment:
  - `EmailBisonBaseHost` table exists
  - `Client.emailBisonBaseHostId` column exists

### Step 1 — Inventory current EmailBison base host assignments (before)

Use SQL to understand current state and scope:

```sql
select
  c.id,
  c.name,
  (c."emailBisonApiKey" is not null and c."emailBisonApiKey" != '') as has_api_key,
  ebh.host as base_host
from "Client" c
left join "EmailBisonBaseHost" ebh on ebh.id = c."emailBisonBaseHostId"
where c."emailBisonApiKey" is not null and c."emailBisonApiKey" != ''
order by c.name asc;
```

Capture a snapshot of:
- how many rows have `base_host is null`
- any rows that already have a non-null `base_host` (do **not** overwrite without explicit intent)

### Step 2 — Ensure required EmailBison base hosts exist

If either host is missing from `"EmailBisonBaseHost"`, insert it (idempotent):

```sql
insert into "EmailBisonBaseHost" ("host", "label", "createdAt", "updatedAt")
values
  ('send.meetinboxxia.com', 'Inboxxia (default)', now(), now()),
  ('send.foundersclubsend.com', 'Founders Club Send', now(), now())
on conflict ("host") do update
set
  "label" = excluded."label",
  "updatedAt" = now();
```

### Step 3 — Backfill Founders Club base host (idempotent)

Prefer workspace ID (not name):

```sql
update "Client"
set "emailBisonBaseHostId" = (
  select id from "EmailBisonBaseHost" where host = 'send.foundersclubsend.com'
)
where id = 'ef824aca-a3c9-4cde-b51f-2e421ebb6b6e'
  and "emailBisonApiKey" is not null and "emailBisonApiKey" != ''
  and "emailBisonBaseHostId" is null;
```

### Step 4 — Backfill default host for all other EmailBison workspaces (idempotent)

```sql
update "Client"
set "emailBisonBaseHostId" = (
  select id from "EmailBisonBaseHost" where host = 'send.meetinboxxia.com'
)
where id != 'ef824aca-a3c9-4cde-b51f-2e421ebb6b6e'
  and "emailBisonApiKey" is not null and "emailBisonApiKey" != ''
  and "emailBisonBaseHostId" is null;
```

### Step 5 — Verify + detect exceptions (after)

```sql
select
  count(*) filter (where c."emailBisonBaseHostId" is null)::int as missing_base_host,
  count(*)::int as with_api_key
from "Client" c
where c."emailBisonApiKey" is not null and c."emailBisonApiKey" != '';
```

If `missing_base_host > 0`, list those client IDs/names and stop to decide the correct host mapping (do not guess).

### Step 6 — Rollback strategy (if needed)

If an incorrect mass update is applied, rollback by resetting only the rows updated in Phase 44 (requires you to capture a list of impacted `Client.id` values before applying updates).

Minimum rollback plan:
- Before Step 3/4, export the result set from Step 1 (IDs + prior base_host) as a CSV from your SQL console.
- Rollback: update those IDs back to the prior `emailBisonBaseHostId` (or null).

## Output

**Status:** Not executed in this environment.

- This addendum remains a safe runbook for an idempotent EmailBison base host SQL backfill if you choose to apply it in production.
- No SQL was executed as part of Phase 44 work in this repo.

## Handoff

If you decide to run a production SQL backfill, follow this addendum to keep updates idempotent and rollback-friendly. Otherwise, proceed with the UI-based per-workspace base host setting and Phase 44c verification steps.
