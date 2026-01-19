# Phase 43b — Setter Account Creation + Round-Robin Enable

## Focus
Create 3 setter accounts for the Founders Club workspace and enable round-robin assignment for that workspace.

## Inputs
- Schema changes from Phase 43a (fields exist in database)
- Founders Club workspace ID: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
- Admin members API: `POST /api/admin/workspaces/members`

## Work

### 1. Generate secure passwords
Generate 3 unique passwords (at execution time, not logged here):
```bash
openssl rand -base64 16  # Run 3 times, one per setter
```

### 2. Create setter accounts via admin API

For each setter, call:
```bash
curl -X POST "https://zrg-dashboard.vercel.app/api/admin/workspaces/members" \
  -H "Authorization: Bearer $WORKSPACE_PROVISIONING_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "ef824aca-a3c9-4cde-b51f-2e421ebb6b6e",
    "memberEmail": "<EMAIL>",
    "memberPassword": "<GENERATED_PASSWORD>",
    "role": "SETTER",
    "upsert": true
  }'
```

Accounts to create:
| Email | Role |
|-------|------|
| vanessa@zeroriskgrowth.com | SETTER |
| david@zeroriskgrowth.com | SETTER |
| jon@zeroriskgrowth.com | SETTER |

### 3. Verify accounts in database

```sql
SELECT cm."userId", cm."email", cm."role", cm."createdAt"
FROM "ClientMember" cm
WHERE cm."clientId" = 'ef824aca-a3c9-4cde-b51f-2e421ebb6b6e'
  AND cm."role" = 'SETTER';
```
Expect 3 rows with the correct emails.

### 4. Enable round-robin for Founders Club

```sql
UPDATE "WorkspaceSettings"
SET "roundRobinEnabled" = true, "roundRobinLastSetterIndex" = -1
WHERE "clientId" = 'ef824aca-a3c9-4cde-b51f-2e421ebb6b6e';
```

Note: Setting `roundRobinLastSetterIndex` to `-1` means the first assignment will go to setter at index `0` (since `(-1 + 1) % 3 = 0`).

### 5. Verify round-robin enabled

```sql
SELECT "clientId", "roundRobinEnabled", "roundRobinLastSetterIndex"
FROM "WorkspaceSettings"
WHERE "clientId" = 'ef824aca-a3c9-4cde-b51f-2e421ebb6b6e';
```
Expect `roundRobinEnabled = true`, `roundRobinLastSetterIndex = -1`.

### 6. Test setter login
Manually verify one setter can log in at `https://zrg-dashboard.vercel.app` and sees the Founders Club workspace.

## Output
- 3 setter accounts created with SETTER role via admin API:
  - Vanessa (index 0): `cbe8769a-c50d-4e5d-806b-58aeefaf9615`
  - David (index 1): `29d8fbc1-8726-49d1-ad35-e3d1b3cf2702`
  - Jon (index 2): `92735763-dadd-4f48-961b-f7b56446928a`
- Round-robin enabled: `roundRobinEnabled = true`, `roundRobinLastSetterIndex = -1`
- Passwords generated and output to console for secure sharing (not stored in docs)
- Temporary setup script deleted after use

## Handoff
Accounts and configuration are ready. Proceed to Phase 43c to implement the round-robin assignment logic.
