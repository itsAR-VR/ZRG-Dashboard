import { spawn } from "node:child_process";

const COVERAGE_FILE = "lib/auto-send/orchestrator.ts";
const LINE_COVERAGE_THRESHOLD = 90;
const TEST_FILE = "lib/auto-send/__tests__/orchestrator.test.ts";

async function main(): Promise<void> {
  const args = ["--conditions=react-server", "--import", "tsx", "--test", "--experimental-test-coverage", TEST_FILE];

  const child = spawn(process.execPath, args, {
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...process.env,
      // `lib/ai/openai-client.ts` constructs the OpenAI client at import-time.
      // Unit tests mock the downstream callers, but we still need a non-empty key
      // to avoid the OpenAI SDK throwing during module initialization.
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || "test",
    },
  });

  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stdout += text;
    process.stdout.write(text);
  });

  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    process.exit(exitCode);
  }

  const coverageLine = stdout
    .split("\n")
    .find((line) => line.includes(COVERAGE_FILE) || line.includes(COVERAGE_FILE.replace(/\//g, "\\")));

  if (!coverageLine) {
    console.error(`[coverage] Could not find coverage row for ${COVERAGE_FILE}`);
    process.exit(1);
  }

  const parts = coverageLine.split("|").map((p) => p.trim());
  const linePercent = Number.parseFloat(parts[1] || "");
  if (!Number.isFinite(linePercent)) {
    console.error(`[coverage] Failed to parse line coverage percent from: ${coverageLine}`);
    process.exit(1);
  }

  if (linePercent < LINE_COVERAGE_THRESHOLD) {
    console.error(
      `[coverage] ${COVERAGE_FILE} line coverage ${linePercent.toFixed(2)}% is below ${LINE_COVERAGE_THRESHOLD}%`
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[coverage] Failed:", error);
  process.exit(1);
});
