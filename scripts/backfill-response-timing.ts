/**
 * Backfill Response Timing Events (Phase 132)
 *
 * Populates `ResponseTimingEvent` rows for historical inbound anchors and
 * fills setter + AI response timing fields.
 *
 * Run:
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-response-timing.ts --dry-run
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-response-timing.ts --apply --lookback-days 180
 *
 * Env:
 *   DIRECT_URL  Preferred (non-pooled connection recommended for bulk backfills)
 *   DATABASE_URL Optional fallback (requires --allow-pooler)
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dns from "node:dns";

import { processResponseTimingEvents } from "../lib/response-timing/processor";

dns.setDefaultResultOrder("ipv4first");

type Args = {
  dryRun: boolean;
  lookbackDays: number;
  batchSize: number;
  maxMs: number;
  allowPooler: boolean;
  preferPooler: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: true,
    lookbackDays: 365,
    batchSize: 500,
    maxMs: 30_000,
    allowPooler: false,
    preferPooler: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--dryRun") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--allow-pooler") args.allowPooler = true;
    else if (a === "--prefer-pooler") args.preferPooler = true;
    else if (a === "--lookback-days" || a === "--lookbackDays") {
      const parsed = Number(argv[i + 1] || "0");
      if (Number.isFinite(parsed) && parsed > 0) args.lookbackDays = Math.floor(parsed);
      i += 1;
    } else if (a === "--batch-size" || a === "--batchSize") {
      const parsed = Number(argv[i + 1] || "0");
      if (Number.isFinite(parsed) && parsed > 0) args.batchSize = Math.floor(parsed);
      i += 1;
    } else if (a === "--max-ms" || a === "--maxMs") {
      const parsed = Number(argv[i + 1] || "0");
      if (Number.isFinite(parsed) && parsed > 0) args.maxMs = Math.floor(parsed);
      i += 1;
    }
  }

  args.lookbackDays = Math.max(1, Math.min(3650, args.lookbackDays));
  args.batchSize = Math.max(1, Math.min(5000, args.batchSize));
  args.maxMs = Math.max(250, Math.min(120_000, args.maxMs));
  return args;
}

function isPrismaP1001(error: unknown): boolean {
  const maybe = error as { errorCode?: unknown; code?: unknown };
  return maybe?.errorCode === "P1001" || maybe?.code === "P1001";
}

function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const directUrl = process.env.DIRECT_URL;
  const pooledUrl = process.env.DATABASE_URL;

  let connectionString: string | undefined;
  let connectionMode: "direct" | "pooler" = "direct";

  if (args.preferPooler) {
    if (!pooledUrl) throw new Error("DATABASE_URL environment variable is required for --prefer-pooler");
    connectionString = pooledUrl;
    connectionMode = "pooler";
  } else if (directUrl) {
    connectionString = directUrl;
    connectionMode = "direct";
  } else if (pooledUrl && args.allowPooler) {
    connectionString = pooledUrl;
    connectionMode = "pooler";
  } else {
    throw new Error("DIRECT_URL environment variable is required (or set DATABASE_URL with --allow-pooler)");
  }

  let prisma = createPrismaClient(connectionString);
  try {
    await prisma.$connect();
    await prisma.$queryRaw`select 1`;
  } catch (error) {
    await prisma.$disconnect().catch(() => {});
    const canFallback = connectionMode === "direct" && Boolean(pooledUrl) && args.allowPooler;
    if (canFallback && isPrismaP1001(error)) {
      console.warn("[Backfill Response Timing] DIRECT_URL connection failed (P1001). Falling back to DATABASE_URL.");
      prisma = createPrismaClient(pooledUrl!);
      connectionString = pooledUrl!;
      connectionMode = "pooler";
      await prisma.$connect();
      await prisma.$queryRaw`select 1`;
    } else {
      throw error;
    }
  }

  console.log("=".repeat(80));
  console.log("Backfill Response Timing Events");
  console.log("=".repeat(80));
  console.log(`Started:      ${new Date().toISOString()}`);
  console.log(`Mode:         ${args.dryRun ? "DRY RUN (no writes)" : "APPLY"}`);
  console.log(`Connection:   ${connectionMode}${connectionMode === "pooler" ? " (DATABASE_URL)" : " (DIRECT_URL)"}`);
  console.log(`LookbackDays: ${args.lookbackDays}`);
  console.log(`BatchSize:    ${args.batchSize}`);
  console.log(`MaxMs:        ${args.maxMs}`);
  console.log("=".repeat(80));

  let batch = 0;
  let totalInserted = 0;
  let totalUpdatedSetter = 0;
  let totalUpdatedAi = 0;
  const overallStartMs = Date.now();

  for (;;) {
    batch += 1;
    const result = await processResponseTimingEvents({
      lookbackDays: args.lookbackDays,
      batchSize: args.batchSize,
      maxMs: args.maxMs,
      prisma,
      dryRun: args.dryRun,
    });

    const elapsedSec = Math.floor((Date.now() - overallStartMs) / 1000);
    console.log(
      `[Batch ${batch}] inserted=${result.inserted} setterUpdated=${result.updatedSetter} aiUpdated=${result.updatedAi} ` +
        `exhausted=${result.exhausted} durationMs=${result.durationMs} ` +
        `window=${result.scanFromIso}..${result.scanToIso} elapsed=${elapsedSec}s`
    );

    if (args.dryRun) break;

    totalInserted += result.inserted;
    totalUpdatedSetter += result.updatedSetter;
    totalUpdatedAi += result.updatedAi;

    const didWork = result.inserted > 0 || result.updatedSetter > 0 || result.updatedAi > 0;
    if (!didWork && !result.exhausted) break;
  }

  console.log("");
  if (!args.dryRun) {
    console.log(`[Done] inserted=${totalInserted} setterUpdated=${totalUpdatedSetter} aiUpdated=${totalUpdatedAi}`);
  } else {
    console.log("[Done] dry-run complete (no writes)");
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[Backfill Response Timing] Failed:", error);
  process.exit(1);
});
