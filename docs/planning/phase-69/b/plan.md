# Phase 69b — Create Slack Test Script

## Focus

Create a script that sends 10 test Slack DMs to jon@zeroriskgrowth.com to verify the OAuth scopes are correctly configured.

## Inputs

- Fixed Slack OAuth scopes from Phase 69a
- `SLACK_BOT_TOKEN` environment variable
- Target email: `jon@zeroriskgrowth.com`
- Test message: "Please confirm you can see this message, if you can then take a screenshot and send it to me @AR"

## Work

### Create `scripts/test-slack-dm.ts`

```typescript
/**
 * Test Slack DM delivery
 *
 * Sends 10 test messages to jon@zeroriskgrowth.com to verify Slack integration.
 *
 * Run with:
 *   npx tsx scripts/test-slack-dm.ts
 */
```

**Script requirements:**
1. Load environment from `.env.local`
2. Use existing `sendSlackDmByEmail` from `lib/slack-dm.ts`
3. Send 10 messages with 1 second delay between each
4. Log success/failure for each message
5. Include message number in each message for verification

**Test message format:**
```
[Test {n}/10] Please confirm you can see this message, if you can then take a screenshot and send it to me @AR
```

### Run and Verify

```bash
npx tsx scripts/test-slack-dm.ts
```

Expected output:
```
Slack DM Test - Sending 10 messages to jon@zeroriskgrowth.com
[1/10] Sent successfully
[2/10] Sent successfully
...
[10/10] Sent successfully
All 10 messages sent. Ask Jon to confirm receipt with a screenshot.
```

## Output

- [x] `scripts/test-slack-dm.ts` created
- [ ] Script runs without errors
- [ ] Jon receives 10 test messages
- [ ] Screenshot confirmation received

**Output notes (2026-01-29):**
- Implemented `scripts/test-slack-dm.ts` with dotenv loading, per-message logging, and 1s pacing.
- Script not executed here (requires updated Slack scopes + valid `SLACK_BOT_TOKEN`).

## Handoff

After Slack scopes/token are updated, run the test script and capture Jon’s confirmation screenshot, then proceed to Phase 69c.
