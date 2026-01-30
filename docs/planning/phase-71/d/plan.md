# Phase 71d — Migration Hardening + Verification Checklist

## Focus

Implement and run an idempotent migration that renames existing Meeting Requested sequences to `"ZRG Workflow V1"` **only** for ZRG workspaces (`WorkspaceSettings.brandName IS NULL`), while ensuring branded workspaces remain on the legacy name.

## Inputs

- Phase 71c complete (dual-name support landed so automation continues to work during/after migration)
- Database access via `DIRECT_URL` (preferred) or `DATABASE_URL`
- Workspace identification policy:
  - ZRG: `WorkspaceSettings.brandName IS NULL`
  - Branded: `WorkspaceSettings.brandName IS NOT NULL` (e.g., Founders Club)

## Work

### Step 1 — Implement migration script using repo conventions

- **File:** `scripts/phase-71-rename-workflow.ts` (new)
- Follow existing CLI-script patterns (see `scripts/migrate-followups-phase-66.ts`):
  - Load env:
    - `dotenv.config({ path: ".env.local" })`
    - `dotenv.config({ path: ".env" })`
  - Connect using Prisma adapter + direct connection string:
    - `DIRECT_URL` preferred, else `DATABASE_URL`
    - `PrismaPg` + `PrismaClient({ adapter })`
- CLI flags:
  - Default: **dry-run** (no writes)
  - `--apply`: perform writes
  - `--clientId <uuid>`: limit to a single workspace (canary)
- Use shared constants from `lib/followup-sequence-names.ts`.

### Step 2 — Select sequences to rename (ZRG only)

Target sequences:
- `FollowUpSequence.name === MEETING_REQUESTED_SEQUENCE_NAME_LEGACY`
- AND `client.settings.brandName IS NULL`
  - Prisma filter shape must use the optional 1:1 relation correctly, e.g.:
    - `client: { settings: { is: { brandName: null } } }`

Also collect (for logging/verification only):
- Legacy-named sequences where `client.settings.brandName IS NOT NULL` (these should be skipped)

### Step 3 — Apply changes safely (idempotent)

When `--apply` is set:

1. For each candidate workspace:
   - Check if that workspace already has a sequence named `ZRG_WORKFLOW_V1_SEQUENCE_NAME`.
   - If yes: **skip rename for that workspace** and log it (avoid creating duplicate names without human review).
2. Rename:
   - Update sequence `name` to `ZRG_WORKFLOW_V1_SEQUENCE_NAME`.
   - Do not modify steps/instances (instances reference `sequenceId`; renaming is display-only).

After apply:
- Re-run in dry-run mode; it should report **0 sequences to rename** (idempotency).

### Step 4 — Runbook: how to run + verify

Commands:

```bash
# Dry-run (default)
npx tsx scripts/phase-71-rename-workflow.ts

# Canary (single workspace)
npx tsx scripts/phase-71-rename-workflow.ts --clientId <uuid>

# Apply (all ZRG)
npx tsx scripts/phase-71-rename-workflow.ts --apply
```

Verification checklist:

1. **ZRG rename verification**
   - ZRG workspaces now have `"ZRG Workflow V1"` as the Meeting Requested sequence name.
2. **Branded unchanged**
   - Founders Club (and any `brandName != null`) still has `"Meeting Requested Day 1/2/5/7"`.
3. **Auto-start still works**
   - For a ZRG workspace, send a first setter email reply and verify an instance is created for the Meeting Requested workflow.
4. **Follow-ups UI**
   - Paused instances appear after refresh, and resume moves them to a time-based group.

### Step 5 — Final checks

- `npm run lint`
- `npm run build`

## Output

- `scripts/phase-71-rename-workflow.ts` exists, is dry-run by default, and is idempotent.
- ZRG workspaces use `"ZRG Workflow V1"` for Meeting Requested sequences.
- Branded workspaces remain on the legacy name.

## Handoff

Phase 71 complete. Deploy and smoke test:
- Follow-ups view pause/resume
- Sequence Manager trigger labels
- First setter email reply auto-start in both a ZRG workspace and Founders Club.

