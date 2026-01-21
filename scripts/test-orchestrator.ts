import { spawn } from "node:child_process";

const TEST_FILE = "lib/auto-send/__tests__/orchestrator.test.ts";

async function main(): Promise<void> {
  const args = ["--conditions=react-server", "--import", "tsx", "--test", TEST_FILE];

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

