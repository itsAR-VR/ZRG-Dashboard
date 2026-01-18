# Phase 28d — Cron + Resumable Backfill Runner

## Focus
Create a bounded, production-safe cron job (plus a CLI backfill runner) to reconcile meeting booking state across all leads in a workspace, using the GHL and Calendly reconciliation logic.

## Inputs
- Root context: `docs/planning/phase-28/plan.md`
- Provider logic:
  - `docs/planning/phase-28/b/plan.md` (GHL)
  - `docs/planning/phase-28/c/plan.md` (Calendly)
- Existing cron patterns:
  - `vercel.json` cron list
  - `app/api/cron/*/route.ts` (auth via `CRON_SECRET`)
- Backfill patterns:
  - Resumable scripts (e.g., `scripts/backfill-ghl-lead-hydration.ts`)

## Work
1. Choose the execution surfaces:
   - **Cron endpoint**: incremental reconciliation in small batches (serverless-safe).
   - **CLI backfill script**: large historical backfill (can run for hours, resumable).
2. Cron design (bounded + fair):
   - Cadence target: every minute (keep per-run batch small enough to avoid timeouts).
   - Process up to N workspaces per run and M leads per workspace (env-configurable).
   - Prefer a deterministic cursor strategy (`Lead.id` or `Lead.appointmentLastCheckedAt`) to avoid reprocessing the same leads.
    - Track counters: checked, booked_found, canceled_found, rescheduled_found, tasks_created, skipped_no_creds, errors.
   - Track cancellation/reschedule tasks created (so we can monitor noise vs signal).
3. Lead eligibility heuristic (tunable):
   - Prioritize leads where state is ambiguous or stale:
     - missing provider IDs but sentiment indicates meeting requested/booked
     - leads with inbound replies (`lastInboundAt` not null) but no recorded appointment evidence
     - `appointmentBookedAt` present but missing timing/status
     - upcoming/past meetings that need completion updates
     - `appointmentLastCheckedAt` older than a cutoff
   - Decision: reconcile only leads that have inbound replies (response exists), not the entire lead table.
4. CLI backfill runner shape (resumable + safe):
   - Flags:
     - `--clientId <id>` (optional; default all)
     - `--dry-run` / `--apply`
     - `--resume` + `--state-file <path>`
     - `--lead-concurrency <n>` and provider-specific throttles
     - `--max-leads <n>` safety cap
   - Persist a cursor per client to support restart without rescanning.
5. Ensure side effects are idempotent:
   - Only trigger “booking verified” side effects on the transition from unbooked → booked.
   - Never spam follow-up sequences on repeated cron runs.

## Output

### Files Created/Modified

1. **`lib/appointment-reconcile-runner.ts`** - **New file** with shared reconciliation runner logic:
   - `runAppointmentReconciliation(opts)` - Main entry point for batch reconciliation
   - `reconcileSingleLead(leadId, opts)` - On-demand reconciliation for a specific lead
   - `getEligibleWorkspaces(opts)` - Finds workspaces with provider credentials
   - `getEligibleLeads(clientId, provider, opts)` - Finds leads needing reconciliation

2. **`app/api/cron/appointment-reconcile/route.ts`** - **New cron endpoint**:
   - GET/POST `/api/cron/appointment-reconcile`
   - Supports query params: `workspaceLimit`, `leadsPerWorkspace`, `staleDays`, `clientId`, `dryRun`
   - Environment variables: `RECONCILE_WORKSPACE_LIMIT`, `RECONCILE_LEADS_PER_WORKSPACE`, `RECONCILE_STALE_DAYS`

3. **`vercel.json`** - Added cron schedule for appointment reconciliation (every 10 minutes)

### Lead Eligibility Criteria

Leads are eligible for reconciliation if:
1. Has at least one inbound reply (`lastInboundAt` is not null)
2. AND one of:
   - Never checked before (`appointmentLastCheckedAt` is null)
   - Stale (checked more than N days ago, default 7)
   - Has booking evidence but missing `appointmentStatus`

### Runner Configuration

```typescript
interface ReconcileRunnerOptions {
  workspaceLimit?: number;      // Default: 10
  leadsPerWorkspace?: number;   // Default: 50
  staleDays?: number;           // Default: 7
  source?: AppointmentSource;   // Default: "reconcile_cron"
  dryRun?: boolean;
  skipSideEffects?: boolean;
  clientId?: string;            // Filter to specific workspace
}
```

### Result Structure

```typescript
interface ReconcileRunnerResult {
  workspacesProcessed: number;
  leadsChecked: number;
  bookedFound: number;
  canceledFound: number;
  noChange: number;
  skipped: number;
  errors: number;
  byProvider: {
    ghl: { checked: number; booked: number; canceled: number; errors: number };
    calendly: { checked: number; booked: number; canceled: number; errors: number };
  };
}
```

### Cron Schedule

- **Path**: `/api/cron/appointment-reconcile`
- **Schedule**: Every minute (`* * * * *`) - updated from `*/10 * * * *`
- **Default batch size**: 10 workspaces × 50 leads = 500 leads max per run

### CLI Backfill Runner

A resumable CLI backfill script has been implemented at `scripts/backfill-appointments.ts`:

```bash
# Dry run (preview changes)
npx tsx scripts/backfill-appointments.ts --dry-run

# Apply changes
npx tsx scripts/backfill-appointments.ts --apply

# Target specific workspace
npx tsx scripts/backfill-appointments.ts --apply --clientId <workspaceId>

# Resume from previous state
npx tsx scripts/backfill-appointments.ts --apply --resume --state-file ./.backfill-appointments.json
```

Features:
- Resumable state persistence (cursor per client)
- Configurable concurrency (`--lead-concurrency`, `--client-concurrency`)
- Safety caps (`--max-leads`)
- Stale days configuration (`--stale-days`)

## Handoff

Proceed to Phase 28e to implement:
- Cancellation detection follow-up gating (stop sequences when canceled)
- Sentiment/provider mismatch reporting for operator review
- Meeting completion tracking (deferred per Phase 28a decision)

## Review Notes

- Evidence:
  - Runner: `lib/appointment-reconcile-runner.ts`
  - Cron route: `app/api/cron/appointment-reconcile/route.ts`
  - Schedule: `vercel.json` (`* * * * *`)
  - CLI backfill: `scripts/backfill-appointments.ts`
- Updates (2026-01-17):
  - Cron cadence updated from `*/10 * * * *` to `* * * * *` (every minute).
  - Resumable CLI backfill script implemented.
