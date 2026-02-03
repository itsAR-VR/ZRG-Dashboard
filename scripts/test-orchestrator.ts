import { spawn } from "node:child_process";

const TEST_FILES = [
  "lib/auto-send/__tests__/orchestrator.test.ts",
  "lib/__tests__/calendly-invitee-questions.test.ts",
  "lib/__tests__/booking-target-selector.test.ts",
  "lib/__tests__/ghl-appointment-response.test.ts",
  "lib/__tests__/phone-normalization.test.ts",
  "lib/__tests__/followup-template.test.ts",
  "lib/__tests__/followups-cron-overlap-lock.test.ts",
  "lib/__tests__/insights-thread-extractor-schema.test.ts",
  "lib/__tests__/email-participants.test.ts",
  "lib/__tests__/emailbison-stop-future-emails.test.ts",
  "lib/__tests__/workspace-capabilities.test.ts",
  "lib/__tests__/lead-assignment.test.ts",
  "lib/__tests__/crm-sheet.test.ts",
  "lib/__tests__/workspace-member-provisioning.test.ts",
  "lib/__tests__/availability-refresh-ai.test.ts",
  "lib/__tests__/availability-refresh-candidates.test.ts",
  "lib/__tests__/offered-slots-refresh.test.ts",
];

async function main(): Promise<void> {
  const args = ["--conditions=react-server", "--import", "tsx", "--test", ...TEST_FILES];

  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      // `lib/ai/openai-client.ts` constructs the OpenAI client at import-time.
      // Unit tests mock the downstream callers, but we still need a non-empty key
      // to avoid the OpenAI SDK throwing during module initialization.
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "test",
    },
  });

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", resolve);
  });

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[test] Failed:", error);
  process.exit(1);
});
