import { spawn } from "node:child_process";

const DEFAULT_TEST_FILES = [
  "lib/__tests__/ai-drafts-pricing-placeholders.test.ts",
  "lib/__tests__/ai-drafts-pricing-scheduling-guard.test.ts",
  "lib/ai-drafts/__tests__/step3-verifier.test.ts",
  "lib/ai-drafts/__tests__/step3-guardrail.test.ts",
  "lib/ai-drafts/__tests__/response-disposition.test.ts",
  "lib/ai-drafts/__tests__/pricing-safety-fixtures.test.ts",
  "lib/__tests__/auto-send-evaluator-input.test.ts",
  "lib/__tests__/prompt-runner-temperature-reasoning.test.ts",
  "lib/__tests__/prompt-runner-attempt-expansion.test.ts",
];

async function main(): Promise<void> {
  const requestedFiles = process.argv.slice(2);
  const testFiles = requestedFiles.length > 0 ? requestedFiles : DEFAULT_TEST_FILES;

  const args = ["--conditions=react-server", "--import", "tsx", "--test", ...testFiles];

  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      // Keep module-load-time Prisma checks from failing in isolated tests.
      DATABASE_URL:
        process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test?schema=public",
      DIRECT_URL: process.env.DIRECT_URL || "postgresql://test:test@localhost:5432/test?schema=public",
      // Some modules build an OpenAI client at import time.
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "test",
    },
  });

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", resolve);
  });

  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[test:ai-drafts] Failed:", error);
  process.exit(1);
});
