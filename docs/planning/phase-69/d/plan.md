# Phase 69d — Run Backfill and Verify

## Focus

Execute the backfill script and verify the AI auto-send pipeline is working correctly end-to-end.

## Inputs

- Backfill script from Phase 69c
- Verified Slack integration from Phase 69b
- AI_AUTO_SEND campaigns with pending inbound messages

## Work

### Step 1: Dry Run

```bash
npx tsx scripts/backfill-ai-auto-send.ts --dry-run
```

**Verify:**
- Script finds the expected number of messages
- No errors during query phase
- Preview shows correct campaigns and leads

### Step 2: Limited Apply Run

```bash
npx tsx scripts/backfill-ai-auto-send.ts --apply --limit 5
```

**Verify:**
- Drafts are created in the database
- Auto-send evaluation runs
- Slack DMs are sent for low-confidence drafts
- Jon confirms receipt of notifications

### Step 3: Full Apply Run

```bash
npx tsx scripts/backfill-ai-auto-send.ts --apply
```

**Monitor:**
- Watch console output for progress
- Check log file being written
- Verify Slack DMs are being sent

### Step 4: Post-Run Verification

1. **Check log file:**
   ```bash
   ls -la scripts/logs/
   cat scripts/logs/backfill-ai-auto-send-*.log | tail -100
   ```

2. **Query database for results:**
   ```sql
   -- Check new drafts
   SELECT COUNT(*) FROM "AIDraft"
   WHERE "createdAt" > NOW() - INTERVAL '1 hour';

   -- Check auto-send outcomes
   SELECT status, COUNT(*) FROM "AIDraft"
   WHERE "createdAt" > NOW() - INTERVAL '1 hour'
   GROUP BY status;
   ```

3. **Verify Slack notifications:**
   - Jon should have received notifications for all `needs_review` outcomes
   - Each notification should include lead info, confidence score, and dashboard link

### Step 5: Final Build Check

```bash
npm run lint
npm run build
```

## Output

- [ ] Dry run completes without errors
- [ ] Limited apply run processes 5 messages correctly
- [ ] Full apply run processes all pending messages
- [ ] Log file created with complete details
- [ ] Slack DMs received for low-confidence drafts
- [ ] Build passes

**Output notes (2026-01-29):**
- Backfill execution not run in this environment (requires live DATABASE_URL + Slack scopes/token).
- Use the commands above once Slack scopes are updated and env vars are available.

## Handoff

After running the dry-run/apply steps and verifying Slack delivery, proceed to Phase 69e to confirm safety alignment notes and close the phase.
