import assert from "node:assert/strict";
import test from "node:test";

import { parseReplayCliArgs } from "@/lib/ai-replay/cli";

const NOW = new Date("2026-02-12T10:00:00.000Z");

test("parseReplayCliArgs accepts client-based run", () => {
  const parsed = parseReplayCliArgs(
    [
      "node",
      "scripts/live-ai-replay.ts",
      "--client-id",
      "client-123",
      "--limit",
      "15",
      "--concurrency",
      "2",
      "--from",
      "2026-01-01T00:00:00.000Z",
      "--to",
      "2026-02-01T00:00:00.000Z",
    ],
    NOW
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.args.clientId, "client-123");
  assert.equal(parsed.args.judgeClientId, null);
  assert.equal(parsed.args.limit, 15);
  assert.equal(parsed.args.concurrency, 2);
  assert.equal(parsed.args.channel, "any");
  assert.equal(parsed.args.threadIdsFile, null);
  assert.deepEqual(parsed.args.abModes, []);
  assert.equal(parsed.args.overseerDecisionMode, "fresh");
  assert.equal(parsed.args.judgeProfile, "balanced");
  assert.equal(parsed.args.judgeThreshold, 62);
  assert.deepEqual(parsed.args.adjudicationBand, { min: 40, max: 80 });
  assert.equal(parsed.args.adjudicateBorderline, true);
});

test("parseReplayCliArgs accepts explicit thread IDs without client ID", () => {
  const parsed = parseReplayCliArgs(
    ["node", "scripts/live-ai-replay.ts", "--thread-ids", "m1,m2,m3", "--dry-run"],
    NOW
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.args.threadIds, ["m1", "m2", "m3"]);
  assert.equal(parsed.args.clientId, null);
  assert.equal(parsed.args.dryRun, true);
  assert.equal(parsed.args.threadIdsFile, null);
});

test("parseReplayCliArgs accepts thread-ids-file without client ID", () => {
  const parsed = parseReplayCliArgs(
    ["node", "scripts/live-ai-replay.ts", "--thread-ids-file", "docs/planning/phase-145/replay-case-manifest.json"],
    NOW
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.args.clientId, null);
  assert.equal(parsed.args.threadIdsFile, "docs/planning/phase-145/replay-case-manifest.json");
});

test("parseReplayCliArgs rejects invalid channel", () => {
  const parsed = parseReplayCliArgs(
    ["node", "scripts/live-ai-replay.ts", "--client-id", "client-123", "--channel", "voice"],
    NOW
  );

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /Invalid --channel/);
});

test("parseReplayCliArgs accepts channel any and allow-empty", () => {
  const parsed = parseReplayCliArgs(
    [
      "node",
      "scripts/live-ai-replay.ts",
      "--client-id",
      "client-123",
      "--channel",
      "any",
      "--allow-empty",
      "--revision-loop",
      "force",
    ],
    NOW
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.args.channel, "any");
  assert.equal(parsed.args.allowEmpty, true);
  assert.equal(parsed.args.revisionLoopMode, "force");
});

test("parseReplayCliArgs accepts judge-client-id override", () => {
  const parsed = parseReplayCliArgs(
    [
      "node",
      "scripts/live-ai-replay.ts",
      "--thread-ids",
      "m1",
      "--judge-client-id",
      "fc-client-id",
    ],
    NOW
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.args.clientId, null);
  assert.equal(parsed.args.judgeClientId, "fc-client-id");
});

test("parseReplayCliArgs rejects invalid revision-loop value", () => {
  const parsed = parseReplayCliArgs(
    ["node", "scripts/live-ai-replay.ts", "--client-id", "client-123", "--revision-loop", "always_on"],
    NOW
  );

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /Invalid --revision-loop/);
});

test("parseReplayCliArgs accepts explicit overseer mode", () => {
  const parsed = parseReplayCliArgs(
    [
      "node",
      "scripts/live-ai-replay.ts",
      "--client-id",
      "client-123",
      "--overseer-mode",
      "persisted",
    ],
    NOW
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.args.overseerDecisionMode, "persisted");
});

test("parseReplayCliArgs accepts hybrid judge controls", () => {
  const parsed = parseReplayCliArgs(
    [
      "node",
      "scripts/live-ai-replay.ts",
      "--client-id",
      "client-123",
      "--judge-profile",
      "strict",
      "--judge-threshold",
      "78",
      "--adjudication-band",
      "35,85",
      "--no-adjudicate-borderline",
    ],
    NOW
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.args.judgeProfile, "strict");
  assert.equal(parsed.args.judgeThreshold, 78);
  assert.deepEqual(parsed.args.adjudicationBand, { min: 35, max: 85 });
  assert.equal(parsed.args.adjudicateBorderline, false);
});

test("parseReplayCliArgs adjusts default threshold when judge profile changes", () => {
  const parsed = parseReplayCliArgs(
    ["node", "scripts/live-ai-replay.ts", "--client-id", "client-123", "--judge-profile", "lenient"],
    NOW
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.args.judgeProfile, "lenient");
  assert.equal(parsed.args.judgeThreshold, 52);
});

test("parseReplayCliArgs rejects invalid judge profile", () => {
  const parsed = parseReplayCliArgs(
    ["node", "scripts/live-ai-replay.ts", "--client-id", "client-123", "--judge-profile", "normal"],
    NOW
  );

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /Invalid --judge-profile/);
});

test("parseReplayCliArgs rejects invalid adjudication band", () => {
  const parsed = parseReplayCliArgs(
    ["node", "scripts/live-ai-replay.ts", "--client-id", "client-123", "--adjudication-band", "80,40"],
    NOW
  );

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /Invalid --adjudication-band/);
});

test("parseReplayCliArgs rejects invalid overseer mode", () => {
  const parsed = parseReplayCliArgs(
    [
      "node",
      "scripts/live-ai-replay.ts",
      "--client-id",
      "client-123",
      "--overseer-mode",
      "legacy",
    ],
    NOW
  );

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /Invalid --overseer-mode/);
});

test("parseReplayCliArgs accepts repeatable/csv ab-mode values", () => {
  const parsed = parseReplayCliArgs(
    [
      "node",
      "scripts/live-ai-replay.ts",
      "--client-id",
      "client-123",
      "--ab-mode",
      "off,platform",
      "--ab-mode",
      "force",
    ],
    NOW
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.args.abModes, ["off", "platform", "force"]);
});

test("parseReplayCliArgs rejects invalid ab-mode value", () => {
  const parsed = parseReplayCliArgs(
    [
      "node",
      "scripts/live-ai-replay.ts",
      "--client-id",
      "client-123",
      "--ab-mode",
      "legacy",
    ],
    NOW
  );

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /Invalid --ab-mode value/);
});
