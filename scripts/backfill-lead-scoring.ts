/**
 * Backfill Lead Scoring for Existing Leads
 *
 * This script enqueues lead scoring background jobs for existing leads that have
 * at least one inbound message. It does not run AI scoring directly - the jobs
 * are processed by the cron job handler.
 *
 * Run with:
 *   npx tsx scripts/backfill-lead-scoring.ts --dry-run
 *   npx tsx scripts/backfill-lead-scoring.ts --apply --limit 100
 *   npx tsx scripts/backfill-lead-scoring.ts --apply --clientId <workspaceId> --limit 200
 *   npx tsx scripts/backfill-lead-scoring.ts --apply --rescore-all
 *   npx tsx scripts/backfill-lead-scoring.ts --apply --rescore-all --run-until-done
 *   npx tsx scripts/backfill-lead-scoring.ts --apply --rescore-all --run-until-done --resume
 *
 * Options:
 *   --dry-run         Show what would be enqueued without making changes (default)
 *   --apply           Actually enqueue the jobs
 *   --clientId <id>   Only process leads from a specific workspace
 *   --limit <n>       Page size (default: 500)
 *   --cursor <id>     Start processing from this lead ID (for pagination)
 *   --rescore-all     Re-score already scored leads (default: only unscored)
 *   --delay-ms <n>    Delay between runAt timestamps to spread load (default: 0)
 *   --run-until-done  Continue paging until there are no more leads
 *   --single-batch    Process exactly one page (even in --apply mode)
 *   --page-delay-ms   Sleep between pages (default: 0)
 *   --state-file      Path to checkpoint file (default: .backfill-lead-scoring.state.json)
 *   --resume          Resume from checkpoint file cursor (ignored if --cursor is provided)
 *
 * Env:
 *   DATABASE_URL      Required
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient, BackgroundJobType, BackgroundJobStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dns from "node:dns";
import * as fs from "node:fs";
import * as path from "node:path";

// Force IPv4 for DNS resolution (some environments have IPv6 issues)
dns.setDefaultResultOrder("ipv4first");

// Sentiment tags that indicate disqualification (score = 1 without AI)
const DISQUALIFIED_SENTIMENT_TAGS = new Set([
  "Blacklist",
  "Opt Out",
  "Opted Out",
  "Unsubscribe",
  "Unsubscribed",
  "Bounced",
  "Bounce",
]);

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

type Args = {
  clientId?: string;
  limit: number;
  cursor?: string;
  dryRun: boolean;
  rescoreAll: boolean;
  delayMs: number;
  runUntilDone: boolean;
  singleBatch: boolean;
  pageDelayMs: number;
  stateFile: string;
  resume: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 500,
    dryRun: true,
    rescoreAll: false,
    delayMs: 0,
    runUntilDone: false,
    singleBatch: false,
    pageDelayMs: 0,
    stateFile: ".backfill-lead-scoring.state.json",
    resume: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clientId") args.clientId = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i] || "0") || args.limit;
    else if (a === "--cursor") args.cursor = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--rescore-all") args.rescoreAll = true;
    else if (a === "--delay-ms") args.delayMs = Number(argv[++i] || "0") || args.delayMs;
    else if (a === "--run-until-done") args.runUntilDone = true;
    else if (a === "--single-batch") args.singleBatch = true;
    else if (a === "--page-delay-ms") args.pageDelayMs = Number(argv[++i] || "0") || args.pageDelayMs;
    else if (a === "--state-file") args.stateFile = argv[++i] || args.stateFile;
    else if (a === "--resume") args.resume = true;
  }

  return args;
}

type BackfillStateV1 = {
  version: 1;
  updatedAt: string;
  cursor: string | null;
  runAtIndex?: number;
  totals: {
    batches: number;
    leadsFetched: number;
    enqueued: number;
    disqualifiedUpdated: number;
    alreadyScoredSkipped: number;
    skippedNoMessage: number;
    errors: number;
  };
};

function loadState(filePath: string): BackfillStateV1 | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as BackfillStateV1;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch (error) {
    console.warn(`[Backfill] Failed to read state file (${filePath}):`, error);
    return null;
  }
}

function saveState(filePath: string, state: BackfillStateV1): void {
  const dir = path.dirname(filePath);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = parseArgs(process.argv);
  const savedState = loadState(args.stateFile);
  const isResuming = Boolean(args.resume && savedState && !args.cursor);
  const shouldRunUntilDone = args.runUntilDone || (!args.dryRun && !args.singleBatch);
  const initialCursorForDisplay =
    args.cursor ?? (args.resume ? savedState?.cursor ?? undefined : undefined) ?? "start";

  console.log("=".repeat(60));
  console.log("Lead Scoring Backfill");
  console.log("=".repeat(60));
  console.log(`Mode:        ${args.dryRun ? "DRY RUN (no changes)" : "APPLY"}`);
  console.log(`Page size:   ${args.limit}`);
  console.log(`Workspace:   ${args.clientId || "all"}`);
  console.log(`Cursor:      ${initialCursorForDisplay}`);
  console.log(`Rescore all: ${args.rescoreAll}`);
  console.log(`Delay (ms):  ${args.delayMs}`);
  console.log(`Run all:     ${shouldRunUntilDone ? "yes" : "no"}`);
  console.log(`Page delay:  ${args.pageDelayMs}`);
  console.log(`State file:  ${args.stateFile}`);
  if (args.resume) {
    if (args.cursor) {
      console.log("Resume:      ignored (--cursor provided)");
    } else {
      console.log(
        `Resume:      ${savedState?.cursor ? `yes (cursor=${savedState.cursor})` : "yes (no state file found)"}`
      );
    }
  }
  console.log("=".repeat(60));
  console.log("");

  // Initialize Prisma with pg adapter
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    // Stats
    const totals: BackfillStateV1["totals"] = isResuming ? savedState!.totals : {
      batches: 0,
      leadsFetched: 0,
      enqueued: 0,
      disqualifiedUpdated: 0,
      alreadyScoredSkipped: 0,
      skippedNoMessage: 0,
      errors: 0,
    };

    let runEnqueuedCount = 0;
    let runSkippedNoMessageCount = 0;
    let runDisqualifiedCount = 0;
    let runAlreadyScoredCount = 0;
    let runErrorCount = 0;
    let runBatchCount = 0;
    let cursor = args.cursor ?? (isResuming ? savedState!.cursor ?? undefined : undefined);

    const state: BackfillStateV1 = isResuming ? savedState! : {
      version: 1,
      updatedAt: new Date().toISOString(),
      cursor: cursor ?? null,
      runAtIndex: undefined,
      totals,
    };

    let globalRunAtIndex = state.runAtIndex ?? 0;

    while (true) {
      // Build where clause for leads
      const whereClause: Record<string, unknown> = {};

      if (args.clientId) {
        whereClause.clientId = args.clientId;
      }

      if (!args.rescoreAll) {
        // Only process leads that haven't been scored yet
        whereClause.overallScore = null;
      }

      if (cursor) {
        whereClause.id = { gt: cursor };
      }

      // Find leads that have at least one inbound message
      // This ensures we only score leads with conversation history
      const leadsWithInbound = await prisma.lead.findMany({
        where: {
          ...whereClause,
          messages: {
            some: {
              direction: "inbound",
            },
          },
        },
        select: {
          id: true,
          clientId: true,
          firstName: true,
          lastName: true,
          email: true,
          sentimentTag: true,
          overallScore: true,
          messages: {
            where: {
              direction: "inbound",
            },
            orderBy: {
              sentAt: "desc",
            },
            take: 1,
            select: {
              id: true,
            },
          },
        },
        orderBy: {
          id: "asc",
        },
        take: args.limit,
      });

      totals.leadsFetched += leadsWithInbound.length;

      const nextBatchNumber = runBatchCount + 1;

      if (leadsWithInbound.length === 0) {
        console.log(
          `[Batch ${nextBatchNumber}] Found 0 leads with inbound messages to process (cursor=${cursor || "start"})`
        );
        break;
      }

      runBatchCount = nextBatchNumber;
      totals.batches++;

      console.log(
        `[Batch ${runBatchCount}] Found ${leadsWithInbound.length} leads with inbound messages to process (cursor=${cursor || "start"})`
      );

      let batchEnqueued = 0;
      let batchDisqualifiedUpdated = 0;
      let batchAlreadyScoredSkipped = 0;
      let batchSkippedNoMessage = 0;
      let batchErrors = 0;
      let lastLeadId: string | null = null;

      for (let i = 0; i < leadsWithInbound.length; i++) {
        const lead = leadsWithInbound[i];
        lastLeadId = lead.id;

        // Get the most recent inbound message
        const latestInboundMessage = lead.messages[0];
        if (!latestInboundMessage) {
          runSkippedNoMessageCount++;
          totals.skippedNoMessage++;
          batchSkippedNoMessage++;
          continue;
        }

        // Check if lead is disqualified (Blacklist, Opt Out, etc.)
        const isDisqualified = lead.sentimentTag && DISQUALIFIED_SENTIMENT_TAGS.has(lead.sentimentTag);

        if (isDisqualified) {
          // For disqualified leads, we can either:
          // A) Set score to 1 directly (no AI call needed)
          // B) Enqueue a job that will detect the disqualification
          // We'll do A in apply mode to save job overhead
          if (!args.dryRun) {
            try {
              await prisma.lead.update({
                where: { id: lead.id },
                data: {
                  fitScore: 1,
                  intentScore: 1,
                  overallScore: 1,
                  scoreReasoning: `Automatically disqualified: ${lead.sentimentTag}`,
                  scoredAt: new Date(),
                },
              });
            } catch (err) {
              console.error(`Error updating disqualified lead ${lead.id}:`, err);
              runErrorCount++;
              totals.errors++;
              batchErrors++;
              continue;
            }
          }
          runDisqualifiedCount++;
          totals.disqualifiedUpdated++;
          batchDisqualifiedUpdated++;
          continue;
        }

        // Check if already scored (when not using --rescore-all)
        if (lead.overallScore !== null && !args.rescoreAll) {
          runAlreadyScoredCount++;
          totals.alreadyScoredSkipped++;
          batchAlreadyScoredSkipped++;
          continue;
        }

        // Generate dedupe key
        const dedupeKey = `lead_scoring_backfill:${lead.id}`;

        if (!args.dryRun) {
          try {
            // Upsert the job (allows re-running the script safely)
            const runAt = new Date(Date.now() + (globalRunAtIndex * args.delayMs));
            globalRunAtIndex++;

            await prisma.backgroundJob.upsert({
              where: { dedupeKey },
              update: {
                // Reset status if job failed previously
                status: BackgroundJobStatus.PENDING,
                attempts: 0,
                runAt,
                lockedAt: null,
                lockedBy: null,
                startedAt: null,
                finishedAt: null,
                lastError: null,
              },
              create: {
                type: BackgroundJobType.LEAD_SCORING_POST_PROCESS,
                clientId: lead.clientId,
                leadId: lead.id,
                messageId: latestInboundMessage.id,
                dedupeKey,
                maxAttempts: 3,
                runAt,
              },
            });
            runEnqueuedCount++;
            totals.enqueued++;
            batchEnqueued++;
          } catch (err) {
            console.error(`Error creating job for lead ${lead.id}:`, err);
            runErrorCount++;
            totals.errors++;
            batchErrors++;
            continue;
          }
        } else {
          runEnqueuedCount++;
          totals.enqueued++;
          batchEnqueued++;
        }
      }

      console.log(
        `[Batch ${runBatchCount}] Enqueued=${batchEnqueued} DisqualifiedUpdated=${batchDisqualifiedUpdated} AlreadyScoredSkipped=${batchAlreadyScoredSkipped} SkippedNoMessage=${batchSkippedNoMessage} Errors=${batchErrors}`
      );

      if (lastLeadId) {
        cursor = lastLeadId;
      }

      state.updatedAt = new Date().toISOString();
      state.cursor = cursor ?? null;
      state.runAtIndex = globalRunAtIndex;
      state.totals = totals;
      saveState(args.stateFile, state);

      if (!shouldRunUntilDone) break;
      if (leadsWithInbound.length < args.limit) break;
      if (args.pageDelayMs > 0) await sleep(args.pageDelayMs);
    }

    console.log("");
    console.log("=".repeat(60));
    console.log("Summary");
    console.log("=".repeat(60));
    console.log(`Run batches:            ${runBatchCount}`);
    console.log(`Run enqueued:           ${runEnqueuedCount}`);
    console.log(`Run disqualified updated: ${runDisqualifiedCount}`);
    console.log(`Run already scored skipped: ${runAlreadyScoredCount}`);
    console.log(`Run skipped (no message): ${runSkippedNoMessageCount}`);
    console.log(`Run errors:             ${runErrorCount}`);
    console.log("");
    console.log(`Total batches:          ${totals.batches}`);
    console.log(`Total leads fetched:    ${totals.leadsFetched}`);
    console.log(`Total enqueued:         ${totals.enqueued}`);
    console.log(`Total disqualified updated: ${totals.disqualifiedUpdated}`);
    console.log(`Total already scored skipped: ${totals.alreadyScoredSkipped}`);
    console.log(`Total skipped (no message): ${totals.skippedNoMessage}`);
    console.log(`Total errors:           ${totals.errors}`);
    console.log(`State file:             ${args.stateFile}`);
    console.log(`Cursor:                 ${cursor || "done"}`);
    console.log("=".repeat(60));

    if (args.dryRun) {
      console.log("");
      console.log("This was a DRY RUN. To apply changes, run with --apply");
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
