/**
 * Backfill Missing AIDraft.triggerMessageId (AI Auto-Send) + Optional Evaluation Fields
 *
 * Context:
 * - Some historical AI_AUTO_SEND email drafts were created without `triggerMessageId`.
 * - This breaks idempotency and prevents downstream tooling from reliably tying a draft to the inbound trigger.
 *
 * What this script does:
 * 1) Finds pending email drafts for AI_AUTO_SEND campaigns where `triggerMessageId IS NULL`.
 * 2) Attempts to find the closest inbound email message for the same lead near the draft's `createdAt`.
 * 3) (Optional) Sets `triggerMessageId` if it would not violate the unique constraint.
 * 4) (Optional) Evaluates the draft (auto-send) and persists confidence/threshold/reason.
 *    - Only sets `autoSendAction="needs_review"` when needed (mirrors Phase 70 evaluation backfill behavior).
 *
 * Run:
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-ai-auto-send-missing-trigger-message.ts --dry-run
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-ai-auto-send-missing-trigger-message.ts --apply
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-ai-auto-send-missing-trigger-message.ts --apply --run-until-done --limit 200
 *
 * Flags:
 *   --dry-run              Default; no DB writes
 *   --apply                Perform DB writes
 *   --limit 200            Batch size (default 200)
 *   --window-minutes 30    Time window around draft.createdAt to search for inbound message (default 30)
 *   --run-until-done       Keep processing batches until no candidates remain (default: false)
 *   --skip-evaluation      Skip LLM evaluation step even if OPENAI_API_KEY is set (default: false)
 *
 * Env:
 *   DATABASE_URL           Required
 *   OPENAI_API_KEY         Optional; required only for evaluation step
 *
 * Note: Env vars are loaded by the preload script (server-only-mock.cjs)
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dns from "node:dns";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildSentimentTranscriptFromMessages } from "../lib/sentiment";
import { evaluateAutoSend } from "../lib/auto-send-evaluator";

dns.setDefaultResultOrder("ipv4first");

type Args = {
  dryRun: boolean;
  limit: number;
  windowMinutes: number;
  runUntilDone: boolean;
  skipEvaluation: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: true,
    limit: 200,
    windowMinutes: 30,
    runUntilDone: false,
    skipEvaluation: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--dryRun") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--limit") args.limit = Number(argv[++i] || "0") || args.limit;
    else if (a === "--window-minutes") args.windowMinutes = Number(argv[++i] || "0") || args.windowMinutes;
    else if (a === "--run-until-done") args.runUntilDone = true;
    else if (a === "--skip-evaluation") args.skipEvaluation = true;
  }

  args.limit = Math.max(1, Math.floor(args.limit));
  args.windowMinutes = Math.max(1, Math.floor(args.windowMinutes));
  return args;
}

function ensureLogFile(): { logPath: string; log: (line: string) => void; close: () => void } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = path.join("scripts", "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `backfill-ai-auto-send-missing-trigger-message-${timestamp}.log`);
  const stream = fs.createWriteStream(logPath, { flags: "a" });

  const log = (line: string) => {
    console.log(line);
    stream.write(`${line}\n`);
  };

  return { logPath, log, close: () => stream.end() };
}

function absMs(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime());
}

async function findBestInboundEmailTrigger(prisma: PrismaClient, leadId: string, draftCreatedAt: Date, windowMinutes: number) {
  const windowMs = windowMinutes * 60 * 1000;
  const from = new Date(draftCreatedAt.getTime() - windowMs);
  const to = new Date(draftCreatedAt.getTime() + windowMs);

  const candidates = await prisma.message.findMany({
    where: {
      leadId,
      direction: "inbound",
      channel: "email",
      sentAt: { gte: from, lte: to },
    },
    orderBy: { sentAt: "desc" },
    take: 6,
    select: { id: true, sentAt: true, subject: true, body: true },
  });

  if (candidates.length === 0) return null;
  return candidates.reduce((best, curr) => (absMs(curr.sentAt, draftCreatedAt) < absMs(best.sentAt, draftCreatedAt) ? curr : best));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const { logPath, log, close } = ensureLogFile();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL environment variable is required");

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  log("=".repeat(80));
  log("Backfill Missing triggerMessageId (AI Auto-Send)");
  log("=".repeat(80));
  log(`Started:        ${new Date().toISOString()}`);
  log(`Mode:           ${args.dryRun ? "DRY RUN (no writes)" : "APPLY"}`);
  log(`Limit:          ${args.limit}`);
  log(`Window minutes: ${args.windowMinutes}`);
  log(`Run until done: ${args.runUntilDone ? "yes" : "no"}`);
  log(`Skip eval:      ${args.skipEvaluation ? "yes" : "no"}`);
  log(`Log:            ${logPath}`);
  log("=".repeat(80));
  log("");

  const openaiConfigured = Boolean((process.env.OPENAI_API_KEY || "").trim());
  const shouldEvaluate = openaiConfigured && !args.skipEvaluation;
  if (!openaiConfigured) {
    log("[Eval] OPENAI_API_KEY not set; evaluation step will be skipped.");
  } else if (args.skipEvaluation) {
    log("[Eval] --skip-evaluation set; evaluation step will be skipped.");
  }

  const transcriptCache = new Map<string, string>();

  let batch = 0;
  let processed = 0;
  let updatedTrigger = 0;
  let evaluated = 0;
  let flaggedNeedsReview = 0;
  let skippedNoInbound = 0;
  let skippedDuplicateTrigger = 0;
  let errors = 0;

  for (;;) {
    batch += 1;
    const drafts = await prisma.aIDraft.findMany({
      where: {
        status: "pending",
        channel: "email",
        triggerMessageId: null,
        lead: {
          emailCampaign: { is: { responseMode: "AI_AUTO_SEND" } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: args.limit,
      select: {
        id: true,
        leadId: true,
        content: true,
        createdAt: true,
        lead: {
          select: {
            clientId: true,
            sentimentTag: true,
            emailCampaign: { select: { autoSendConfidenceThreshold: true } },
          },
        },
      },
    });

    if (drafts.length === 0) break;

    log("");
    log(`--- Batch ${batch} (${drafts.length} drafts) ---`);

    for (const draft of drafts) {
      processed += 1;
      try {
        const trigger = await findBestInboundEmailTrigger(prisma, draft.leadId, draft.createdAt, args.windowMinutes);
        if (!trigger) {
          skippedNoInbound += 1;
          log(`[Skip] draft ${draft.id} lead ${draft.leadId} - no inbound email found within window`);
          continue;
        }

        const existingForTrigger = await prisma.aIDraft.findFirst({
          where: { triggerMessageId: trigger.id, channel: "email" },
          select: { id: true, leadId: true, status: true },
        });

        const canSetTrigger = !existingForTrigger;
        if (!canSetTrigger) {
          skippedDuplicateTrigger += 1;
          log(
            `[Skip] draft ${draft.id} lead ${draft.leadId} - trigger ${trigger.id} already has draft ${existingForTrigger.id} (status=${existingForTrigger.status})`
          );
        }

        let evaluation: { confidence: number; safeToSend: boolean; reason: string } | null = null;
        let needsReview = false;
        const campaignThreshold = draft.lead.emailCampaign?.autoSendConfidenceThreshold ?? 0.9;

        if (shouldEvaluate) {
          let transcript = transcriptCache.get(draft.leadId);
          if (!transcript) {
            const messages = await prisma.message.findMany({
              where: { leadId: draft.leadId },
              orderBy: { sentAt: "asc" },
              take: 80,
              select: { sentAt: true, channel: true, direction: true, body: true, subject: true },
            });
            transcript = buildSentimentTranscriptFromMessages(messages);
            transcriptCache.set(draft.leadId, transcript);
          }

          const result = await evaluateAutoSend({
            clientId: draft.lead.clientId,
            leadId: draft.leadId,
            channel: "email",
            latestInbound: trigger.body || "",
            subject: trigger.subject ?? null,
            conversationHistory: transcript || trigger.body || "",
            categorization: draft.lead.sentimentTag ?? null,
            automatedReply: null,
            replyReceivedAt: trigger.sentAt,
            draft: draft.content,
          });

          evaluation = { confidence: result.confidence, safeToSend: result.safeToSend, reason: result.reason };
          needsReview = !result.safeToSend || result.confidence < campaignThreshold;
        }

        if (args.dryRun) {
          log(
            `[DRY RUN] draft ${draft.id} lead ${draft.leadId} ` +
              `trigger=${trigger.id} ${canSetTrigger ? "(set)" : "(dup)"} ` +
              (evaluation
                ? `confidence=${evaluation.confidence.toFixed(2)} threshold=${campaignThreshold.toFixed(2)} needs_review=${needsReview ? "yes" : "no"}`
                : "eval=skipped")
          );
          continue;
        }

        await prisma.aIDraft.update({
          where: { id: draft.id },
          data: {
            ...(canSetTrigger ? { triggerMessageId: trigger.id } : {}),
            ...(evaluation
              ? {
                  autoSendEvaluatedAt: new Date(),
                  autoSendConfidence: evaluation.confidence,
                  autoSendThreshold: campaignThreshold,
                  autoSendReason: evaluation.reason,
                  ...(needsReview ? { autoSendAction: "needs_review" as const } : {}),
                }
              : {}),
          },
        });

        if (canSetTrigger) updatedTrigger += 1;
        if (evaluation) evaluated += 1;
        if (evaluation && needsReview) flaggedNeedsReview += 1;

        log(
          `[OK] draft ${draft.id} lead ${draft.leadId} ` +
            `${canSetTrigger ? `trigger_set=${trigger.id}` : "trigger_set=skipped"} ` +
            (evaluation
              ? `confidence=${evaluation.confidence.toFixed(2)} threshold=${campaignThreshold.toFixed(2)} needs_review=${needsReview ? "yes" : "no"}`
              : "eval=skipped")
        );
      } catch (error) {
        errors += 1;
        log(`[ERROR] draft ${draft.id} - ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (args.dryRun || !args.runUntilDone) break;
  }

  log("");
  log("=".repeat(80));
  log("Done");
  log("=".repeat(80));
  log(`Processed:             ${processed}`);
  log(`Updated trigger IDs:   ${args.dryRun ? 0 : updatedTrigger}`);
  log(`Evaluated:             ${args.dryRun ? 0 : evaluated}`);
  log(`Flagged needs_review:  ${args.dryRun ? 0 : flaggedNeedsReview}`);
  log(`Skipped (no inbound):  ${skippedNoInbound}`);
  log(`Skipped (dup trigger): ${skippedDuplicateTrigger}`);
  log(`Errors:                ${errors}`);

  close();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[Backfill] Failed:", error);
  process.exit(1);
});

