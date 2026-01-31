/**
 * Backfill AI Auto-Send Evaluation Fields (Phase 70)
 *
 * Goals:
 * - Populate `AIDraft.autoSendAction` for historical AI auto-sent messages so the "AI Sent" filter works.
 * - Evaluate pending AI auto-send drafts and persist confidence/reason so ActionStation can show "needs review" details.
 *
 * Run:
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-ai-auto-send-evaluation-fields.ts --dry-run
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-ai-auto-send-evaluation-fields.ts --apply
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-ai-auto-send-evaluation-fields.ts --apply --limit 200
 *
 * Env:
 *   DATABASE_URL         Required
 *   OPENAI_API_KEY       Optional (if missing, pending-draft evaluation is skipped)
 *
 * Note: Env vars are loaded by the preload script (server-only-mock.cjs)
 */
import { PrismaClient, type BackgroundJobType } from "@prisma/client";
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
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: true, limit: 200 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--dryRun") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--limit") args.limit = Number(argv[++i] || "0") || args.limit;
  }

  args.limit = Math.max(1, Math.floor(args.limit));
  return args;
}

function ensureLogFile(): { logPath: string; log: (line: string) => void; close: () => void } {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = path.join("scripts", "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `backfill-ai-auto-send-evaluation-fields-${timestamp}.log`);
  const stream = fs.createWriteStream(logPath, { flags: "a" });

  const log = (line: string) => {
    console.log(line);
    stream.write(`${line}\n`);
  };

  return { logPath, log, close: () => stream.end() };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const { logPath, log, close } = ensureLogFile();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL environment variable is required");

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  log("=".repeat(80));
  log("AI Auto-Send Evaluation Backfill (Phase 70)");
  log("=".repeat(80));
  log(`Started: ${new Date().toISOString()}`);
  log(`Mode:    ${args.dryRun ? "DRY RUN (no writes)" : "APPLY"}`);
  log(`Limit:   ${args.limit}`);
  log(`Log:     ${logPath}`);
  log("=".repeat(80));
  log("");

  const openaiConfigured = Boolean((process.env.OPENAI_API_KEY || "").trim());
  if (!openaiConfigured) {
    log("[Backfill] OPENAI_API_KEY not set; pending draft evaluation step will be skipped.");
  }

  // ---------------------------------------------------------------------------
  // Step 1: Backfill autoSendAction for drafts that were actually sent by AI.
  // ---------------------------------------------------------------------------
  log("[Step 1] Backfilling autoSendAction for drafts with AI-sent messages...");

  let sentCandidates = 0;
  let sentUpdated = 0;
  for (;;) {
    const sentDrafts = await prisma.aIDraft.findMany({
      where: {
        autoSendAction: null,
        sentMessages: {
          some: {
            direction: "outbound",
            source: "zrg",
            sentBy: "ai",
          },
        },
        lead: {
          emailCampaign: {
            is: { responseMode: "AI_AUTO_SEND" },
          },
        },
      },
      take: args.limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        leadId: true,
        backgroundJobs: {
          where: { type: "AI_AUTO_SEND_DELAYED" as BackgroundJobType },
          select: { id: true },
        },
      },
    });

    if (sentDrafts.length === 0) break;
    sentCandidates += sentDrafts.length;

    for (const draft of sentDrafts) {
      const action = draft.backgroundJobs.length > 0 ? "send_delayed" : "send_immediate";
      if (args.dryRun) {
        log(`[Sent][DRY RUN] draft ${draft.id} lead ${draft.leadId} -> ${action}`);
        continue;
      }

      await prisma.aIDraft.update({
        where: { id: draft.id },
        data: { autoSendAction: action },
      });
      sentUpdated += 1;
      log(`[Sent] draft ${draft.id} lead ${draft.leadId} -> ${action}`);
    }

    if (args.dryRun) break;
  }

  log(`[Step 1] Done. Candidates: ${sentCandidates}. Updated: ${args.dryRun ? 0 : sentUpdated}.`);
  log("");

  // ---------------------------------------------------------------------------
  // Step 2: Evaluate pending drafts and persist confidence/reason for review.
  // ---------------------------------------------------------------------------
  if (!openaiConfigured) {
    log("[Step 2] Skipped (OPENAI_API_KEY not configured).");
  } else {
    log("[Step 2] Evaluating pending drafts (persist confidence/reason + needs_review action)...");

    const transcriptCache = new Map<string, string>();
    let pendingCandidates = 0;
    let evaluated = 0;
    let flagged = 0;

    for (;;) {
      const pendingDrafts = await prisma.aIDraft.findMany({
        where: {
          status: "pending",
          triggerMessageId: { not: null },
          autoSendEvaluatedAt: null,
          lead: {
            emailCampaign: {
              is: { responseMode: "AI_AUTO_SEND" },
            },
          },
        },
        take: args.limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          leadId: true,
          channel: true,
          content: true,
          triggerMessageId: true,
          lead: {
            select: {
              clientId: true,
              sentimentTag: true,
              emailCampaign: {
                select: {
                  autoSendConfidenceThreshold: true,
                },
              },
            },
          },
        },
      });

      if (pendingDrafts.length === 0) break;
      pendingCandidates += pendingDrafts.length;

      for (const draft of pendingDrafts) {
        try {
          const campaignThreshold = draft.lead.emailCampaign?.autoSendConfidenceThreshold ?? 0.9;

          const triggerMessage = await prisma.message.findUnique({
            where: { id: draft.triggerMessageId! },
            select: { sentAt: true, subject: true, body: true },
          });

          if (!triggerMessage) {
            log(`[Pending][Skip] draft ${draft.id} - trigger message not found (${draft.triggerMessageId})`);
            continue;
          }

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

          const evaluation = await evaluateAutoSend({
            clientId: draft.lead.clientId,
            leadId: draft.leadId,
            channel: (draft.channel as "email" | "sms" | "linkedin") || "email",
            latestInbound: triggerMessage.body || "",
            subject: triggerMessage.subject ?? null,
            conversationHistory: transcript || triggerMessage.body || "",
            categorization: draft.lead.sentimentTag ?? null,
            automatedReply: null,
            replyReceivedAt: triggerMessage.sentAt,
            draft: draft.content,
          });

          const needsReview = !evaluation.safeToSend || evaluation.confidence < campaignThreshold;

          if (args.dryRun) {
            log(
              `[Pending][DRY RUN] draft ${draft.id} lead ${draft.leadId} ` +
                `confidence=${evaluation.confidence.toFixed(2)} threshold=${campaignThreshold.toFixed(2)} ` +
                `needs_review=${needsReview ? "yes" : "no"}`
            );
            continue;
          }

          await prisma.aIDraft.update({
            where: { id: draft.id },
            data: {
              autoSendEvaluatedAt: new Date(),
              autoSendConfidence: evaluation.confidence,
              autoSendThreshold: campaignThreshold,
              autoSendReason: evaluation.reason,
              ...(needsReview ? { autoSendAction: "needs_review" as const } : {}),
            },
          });

          evaluated += 1;
          if (needsReview) flagged += 1;

          log(
            `[Pending] draft ${draft.id} lead ${draft.leadId} ` +
              `confidence=${evaluation.confidence.toFixed(2)} threshold=${campaignThreshold.toFixed(2)} ` +
              `needs_review=${needsReview ? "yes" : "no"}`
          );
        } catch (error) {
          log(`[Pending][ERROR] draft ${draft.id} - ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (args.dryRun) break;
    }

    log(`[Step 2] Done. Candidates: ${pendingCandidates}. Updated: ${args.dryRun ? 0 : evaluated}. Flagged: ${args.dryRun ? 0 : flagged}.`);
  }

  log("");
  log("=".repeat(80));
  log("Done");
  log("=".repeat(80));

  close();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[Backfill] Failed:", error);
  process.exit(1);
});
