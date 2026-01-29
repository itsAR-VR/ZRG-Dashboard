/**
 * Test Slack DM delivery
 *
 * Sends 10 test messages to jon@zeroriskgrowth.com to verify Slack integration.
 *
 * Run with:
 *   npx tsx scripts/test-slack-dm.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { sendSlackDmByEmail } from "../lib/slack-dm";

const TARGET_EMAIL = "jon@zeroriskgrowth.com";
const TOTAL_MESSAGES = 10;
const DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log(`Slack DM Test - Sending ${TOTAL_MESSAGES} messages to ${TARGET_EMAIL}`);

  let failures = 0;

  for (let i = 1; i <= TOTAL_MESSAGES; i++) {
    const text = `[Test ${i}/${TOTAL_MESSAGES}] Please confirm you can see this message, if you can then take a screenshot and send it to me @AR`;

    const result = await sendSlackDmByEmail({
      email: TARGET_EMAIL,
      text,
    });

    if (result.success) {
      console.log(`[${i}/${TOTAL_MESSAGES}] Sent successfully${result.skipped ? " (skipped by dedupe)" : ""}`);
    } else {
      failures++;
      console.log(`[${i}/${TOTAL_MESSAGES}] Failed: ${result.error || "unknown error"}`);
    }

    if (i < TOTAL_MESSAGES) {
      await sleep(DELAY_MS);
    }
  }

  if (failures === 0) {
    console.log("All 10 messages sent. Ask Jon to confirm receipt with a screenshot.");
  } else {
    console.log(`Completed with ${failures} failures. Check SLACK_BOT_TOKEN/scopes and retry.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[Slack DM Test] Failed:", error);
  process.exit(1);
});
