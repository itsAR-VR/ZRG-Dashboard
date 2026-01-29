# Phase 69c — Create AI Auto-Send Backfill Script

## Focus

Create a comprehensive backfill script that regenerates drafts and processes auto-send for all historical responses in AI_AUTO_SEND campaigns.

## Inputs

- Verified Slack integration from Phase 69b
- Existing backfill patterns from `scripts/backfill-lead-scoring.ts`
- AI draft generation via `lib/ai-drafts.ts`
- Auto-send orchestration via `lib/auto-send/orchestrator.ts`

## Work

### Create `scripts/backfill-ai-auto-send.ts`

**Requirements:**

1. **Query Phase:**
   - Find all EmailCampaigns with `responseMode = 'AI_AUTO_SEND'`
   - Find all inbound messages to leads in these campaigns
   - Default behavior: regenerate drafts for **all** matching responses (not just missing drafts)

2. **Phase 1 - Draft Generation:**
   - Generate drafts in parallel batches (batch size: 5)
   - Use existing `generateResponseDraft` function
   - Availability staggering handled by existing system
   - Log each draft generation result

3. **Phase 2 - Auto-Send Processing:**
   - Process drafts sequentially (one by one) for observability
   - Use existing `executeAutoSend` function
   - Bypass campaign delay settings (send immediately)
   - Log confidence scores, thresholds, decisions, and Slack DM status

4. **Logging:**
   - Write complete logs to `scripts/logs/backfill-ai-auto-send-{timestamp}.log`
   - Also output to console for real-time monitoring
   - Include full details for each message processed (lead name + email)

### CLI Options

```bash
npx tsx scripts/backfill-ai-auto-send.ts --dry-run           # Preview only
npx tsx scripts/backfill-ai-auto-send.ts --apply             # Execute backfill
npx tsx scripts/backfill-ai-auto-send.ts --apply --limit 10  # Limit to 10 messages
npx tsx scripts/backfill-ai-auto-send.ts --apply --campaign-id <id>  # Single campaign
npx tsx scripts/backfill-ai-auto-send.ts --apply --skip-draft-gen    # Only process existing drafts
npx tsx scripts/backfill-ai-auto-send.ts --apply --skip-auto-send    # Only generate drafts
npx tsx scripts/backfill-ai-auto-send.ts --apply --missing-only      # Only generate drafts when missing
npx tsx scripts/backfill-ai-auto-send.ts --apply --force-auto-send   # Override AUTO_SEND_DISABLED
```

### Log Directory Setup

Update `.gitignore`:
```
scripts/logs/*.log
```

### Expected Log Format

```
================================================================================
AI Auto-Send Backfill
================================================================================
Started:   2026-01-29T19:00:00.000Z
Mode:      APPLY
Campaigns: 10 (AI_AUTO_SEND mode)
================================================================================

--- Phase 1: Draft Generation ---

[1/67] Lead: Jorge Alonso (jorgealonso@tasvlc.com)
       Message: ad8fc159-770e-4ee9-b0cb-394818aed44a
       Campaign: Chris Key City (Outlook ScaledMail) - AI Responses
       Threshold: 0.90
       Existing draft: NONE
       Generating draft... SUCCESS
       Draft ID: abc12345-6789-...

--- Phase 2: Auto-Send Processing ---

[1/65] Draft: abc12345-6789-...
       Lead: Jorge Alonso (jorgealonso@tasvlc.com)

       Confidence evaluation:
         Score: 0.82
         Safe to send: true
         Reason: "Response seems interested but contains scheduling ambiguity"

       Decision: NEEDS_REVIEW (0.82 < 0.90)
       Slack DM: SENT to jon@zeroriskgrowth.com

================================================================================
Summary
================================================================================
Total messages:       67
Drafts generated:     58
Auto-send results:
  - send_immediate:   12
  - send_delayed:     8
  - needs_review:     40 (Slack DMs sent)
  - skip:             3
  - error:            2
================================================================================
```

## Output

- [x] `scripts/backfill-ai-auto-send.ts` created
- [ ] `scripts/logs/.gitkeep` created (not required; folder already exists)
- [x] `.gitignore` updated to exclude log files + state file
- [ ] `npm run lint` passes
- [ ] `npm run build` passes

**Output notes (2026-01-29):**
- Backfill script regenerates drafts for all AI auto-send inbound messages, batches draft generation, and auto-sends immediately (delays bypassed).
- Script logs include lead names + emails and write to `scripts/logs/backfill-ai-auto-send-*.log`.

## Handoff

Proceed to Phase 69d to run the backfill and verify results.
