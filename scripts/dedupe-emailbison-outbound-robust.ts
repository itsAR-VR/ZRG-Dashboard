/**
 * Robust EmailBison outbound dedupe/merge for legacy “double messages”.
 *
 * Targets the historical pattern:
 * - One outbound Message row created at send time (emailBisonReplyId = NULL)
 * - One outbound Message row imported by sync (emailBisonReplyId != NULL)
 *
 * Default is dry-run. Use --apply to write changes.
 *
 * Run (dry-run):
 *   npx tsx scripts/dedupe-emailbison-outbound-robust.ts --clientId <workspaceId>
 *
 * Run (apply):
 *   npx tsx scripts/dedupe-emailbison-outbound-robust.ts --clientId <workspaceId> --apply
 *
 * Options:
 *   --clientId <uuid>        (required unless --all-clients)
 *   --all-clients            (dangerous; requires --apply to do anything)
 *   --sinceDays <n>          (default: 365)
 *   --windowSeconds <n>      (default: 120)
 *   --batchSize <n>          (default: 500)
 *   --maxBatches <n>         (default: 200)
 *   --skip-rollups           (default: recompute rollups on apply)
 *   --verbose                (print per-pair IDs + action)
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { dedupeEmailBisonOutboundMessages, type EmailBisonOutboundDedupeOptions } from "../lib/maintenance/dedupe-emailbison-outbound";

function parseArgs(argv: string[]) {
  const args = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i++;
    }
  }
  return args;
}

function parsePositiveInt(raw: unknown, fallback: number): number {
  const n = Number.parseInt(typeof raw === "string" ? raw : "", 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const apply = args.has("apply");
  const verbose = args.has("verbose");
  const allClients = args.has("all-clients") || args.has("allClients");

  const clientIdRaw = (args.get("clientId") ?? args.get("client-id")) as string | true | undefined;
  const clientId = typeof clientIdRaw === "string" ? clientIdRaw : undefined;

  if (!clientId && !allClients) {
    console.error("[emailbison-dedupe] Missing --clientId (or pass --all-clients for a global run)");
    process.exit(1);
  }

  if (allClients && !apply) {
    console.log("[emailbison-dedupe] --all-clients selected; running dry-run preview only (no changes).");
  }

  const sinceDays = parsePositiveInt(args.get("sinceDays") ?? args.get("since-days"), 365);
  const windowSeconds = parsePositiveInt(args.get("windowSeconds") ?? args.get("window-seconds"), 120);
  const batchSize = parsePositiveInt(args.get("batchSize") ?? args.get("batch-size"), 500);
  const maxBatches = parsePositiveInt(args.get("maxBatches") ?? args.get("max-batches"), 200);
  const recomputeRollups = !args.has("skip-rollups") && !args.has("skipRollups");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[emailbison-dedupe] DATABASE_URL is required");
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const opts: EmailBisonOutboundDedupeOptions = {
    clientId: allClients ? undefined : clientId,
    sinceDays,
    windowSeconds,
    batchSize,
    maxBatches,
    apply: Boolean(apply && (clientId || allClients)),
    verbose,
    recomputeRollups,
  };

  try {
    const result = await dedupeEmailBisonOutboundMessages(prisma, opts);

    const mode = result.apply ? "apply" : "dry-run";
    const scope = allClients ? "all-clients" : `clientId=${clientId}`;

    console.log(
      `[emailbison-dedupe] mode=${mode} scope=${scope} sinceDays=${sinceDays} windowSeconds=${windowSeconds} ` +
        `batchSize=${batchSize} maxBatches=${maxBatches}`
    );

    const mergeLabel = result.apply ? "merged" : "wouldMerge";
    const deleteLabel = result.apply ? "deleted" : "wouldDelete";

    console.log(
      `[emailbison-dedupe] batches=${result.batchesRun} pairsConsidered=${result.pairsConsidered} ` +
        `${mergeLabel}=${result.pairsMerged} skipped=${result.pairsSkipped} ` +
        `${deleteLabel}=${result.messagesDeleted} bgJobsMoved=${result.backgroundJobsReassigned} ` +
        `leadsTouched=${result.leadsTouched} rollups=${result.rollupsRecomputed}`
    );

    if (result.remainingPairsEstimate === 0) {
      console.log("[emailbison-dedupe] remainingPairs=0");
    } else if (result.remainingPairsEstimate === null) {
      console.log("[emailbison-dedupe] remainingPairs=some (run again if you hit maxBatches)");
    } else {
      console.log(`[emailbison-dedupe] remainingPairs≈${result.remainingPairsEstimate}`);
    }

    if (verbose && result.samples.length > 0) {
      for (const s of result.samples) {
        const suffix = s.reason ? ` reason=${s.reason}` : "";
        console.log(
          `[emailbison-dedupe] action=${s.action} clientId=${s.clientId} leadId=${s.leadId} ` +
            `replyId=${s.emailBisonReplyId} with=${s.withReplyMessageId} without=${s.withoutReplyMessageId} ` +
            `Δ=${s.deltaSeconds}s${suffix}`
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[emailbison-dedupe] Fatal:", err);
  process.exitCode = 1;
});

