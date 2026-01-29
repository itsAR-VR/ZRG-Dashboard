/**
 * AI Auto-Send Backfill
 *
 * Regenerates drafts for all AI auto-send campaign responses and processes auto-send.
 *
 * Run:
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-ai-auto-send.ts --dry-run
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-ai-auto-send.ts --apply
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-ai-auto-send.ts --apply --limit 10
 *
 * Env:
 *   DATABASE_URL         Required
 *   OPENAI_API_KEY       Required for auto-send gating
 *   SLACK_BOT_TOKEN      Required for Slack DMs
 *
 * Note: Env vars are loaded by the preload script (server-only-mock.cjs)
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dns from "node:dns";
import * as fs from "node:fs";
import * as path from "node:path";

import { generateResponseDraft, shouldGenerateDraft } from "../lib/ai-drafts";
import { buildSentimentTranscriptFromMessages, detectBounce, isOptOutText } from "../lib/sentiment";
import { approveAndSendDraftSystem } from "../actions/message-actions";
import { decideShouldAutoReply } from "../lib/auto-reply-gate";
import { evaluateAutoSend } from "../lib/auto-send-evaluator";
import { getPublicAppUrl } from "../lib/app-url";
import { sendSlackDmByEmail } from "../lib/slack-dm";
import { createAutoSendExecutor } from "../lib/auto-send/orchestrator";
import { scheduleDelayedAutoSend, validateDelayedAutoSend } from "../lib/background-jobs/delayed-auto-send";

// Force IPv4 for DNS resolution (some environments have IPv6 issues)
dns.setDefaultResultOrder("ipv4first");

type Args = {
  dryRun: boolean;
  limit: number;
  cursor?: string;
  runUntilDone: boolean;
  singleBatch: boolean;
  campaignId?: string;
  skipDraftGen: boolean;
  skipAutoSend: boolean;
  missingOnly: boolean;
  draftBatchSize: number;
  sleepMs: number;
  resume: boolean;
  stateFile: string;
  includeDraftPreviewInSlack: boolean;
  forceAutoSend: boolean;
};

type BackfillStateV1 = {
  version: 1;
  updatedAt: string;
  cursor: string | null;
  totals: {
    batches: number;
    messagesFetched: number;
    candidates: number;
    draftsGenerated: number;
    autoSendAttempted: number;
    autoSendImmediate: number;
    autoSendDelayed: number;
    autoSendNeedsReview: number;
    autoSendSkip: number;
    autoSendError: number;
    skippedNoDraft: number;
    skippedOptOut: number;
    skippedBounce: number;
    skippedSentiment: number;
    skippedBooked: number;
    skippedMissingDraft: number;
    errors: number;
  };
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: true,
    limit: 50,
    cursor: undefined,
    runUntilDone: false,
    singleBatch: false,
    campaignId: undefined,
    skipDraftGen: false,
    skipAutoSend: false,
    missingOnly: false,
    draftBatchSize: 5,
    sleepMs: 0,
    resume: false,
    stateFile: ".backfill-ai-auto-send.state.json",
    includeDraftPreviewInSlack: true,
    forceAutoSend: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--dryRun") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--limit") args.limit = Number(argv[++i] || "0") || args.limit;
    else if (a === "--cursor") args.cursor = argv[++i];
    else if (a === "--run-until-done") args.runUntilDone = true;
    else if (a === "--single-batch") args.singleBatch = true;
    else if (a === "--campaign-id" || a === "--campaignId") args.campaignId = argv[++i];
    else if (a === "--skip-draft-gen") args.skipDraftGen = true;
    else if (a === "--skip-auto-send") args.skipAutoSend = true;
    else if (a === "--missing-only") args.missingOnly = true;
    else if (a === "--draft-batch-size") args.draftBatchSize = Number(argv[++i] || "0") || args.draftBatchSize;
    else if (a === "--sleep-ms") args.sleepMs = Number(argv[++i] || "0") || args.sleepMs;
    else if (a === "--resume") args.resume = true;
    else if (a === "--state-file") args.stateFile = argv[++i] || args.stateFile;
    else if (a === "--no-draft-preview") args.includeDraftPreviewInSlack = false;
    else if (a === "--force-auto-send") args.forceAutoSend = true;
  }

  args.limit = Math.max(1, Math.floor(args.limit));
  args.draftBatchSize = Math.max(1, Math.floor(args.draftBatchSize));
  args.sleepMs = Math.max(0, Math.floor(args.sleepMs));
  return args;
}

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

function formatLeadName(firstName?: string | null, lastName?: string | null): string {
  const parts = [firstName, lastName].filter(Boolean) as string[];
  return parts.join(" ").trim() || "Unknown";
}

function shouldSkipForBooking(lead: {
  appointmentBookedAt?: Date | null;
  appointmentStatus?: string | null;
  ghlAppointmentId?: string | null;
  calendlyInviteeUri?: string | null;
  calendlyScheduledEventUri?: string | null;
}): boolean {
  return Boolean(
    lead.appointmentBookedAt ||
      lead.appointmentStatus === "confirmed" ||
      lead.ghlAppointmentId ||
      lead.calendlyInviteeUri ||
      lead.calendlyScheduledEventUri
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const savedState = loadState(args.stateFile);
  const isResuming = Boolean(args.resume && savedState && !args.cursor);
  const shouldRunUntilDone = args.runUntilDone || (!args.dryRun && !args.singleBatch);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL environment variable is required");

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = path.join("scripts", "logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `backfill-ai-auto-send-${timestamp}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  const log = (line: string) => {
    console.log(line);
    logStream.write(`${line}\n`);
  };

  const autoSendDisabled = process.env.AUTO_SEND_DISABLED === "1";
  if (autoSendDisabled && args.forceAutoSend) {
    process.env.AUTO_SEND_DISABLED = "0";
  } else if (autoSendDisabled && !args.skipAutoSend) {
    log("[Backfill] AUTO_SEND_DISABLED=1 detected; auto-send will be skipped unless --force-auto-send is used.");
    args.skipAutoSend = true;
  }

  const campaigns = await prisma.emailCampaign.findMany({
    where: {
      responseMode: "AI_AUTO_SEND",
      ...(args.campaignId ? { id: args.campaignId } : {}),
    },
    select: { id: true, name: true, bisonCampaignId: true },
  });

  log("=".repeat(80));
  log("AI Auto-Send Backfill");
  log("=".repeat(80));
  log(`Started:   ${new Date().toISOString()}`);
  log(`Mode:      ${args.dryRun ? "DRY RUN (no changes)" : "APPLY"}`);
  log(`Campaigns: ${campaigns.length}${args.campaignId ? ` (filter: ${args.campaignId})` : " (AI_AUTO_SEND)"}`);
  log(`Limit:     ${args.limit}`);
  log(`Drafts:    ${args.skipDraftGen ? "skip" : args.missingOnly ? "missing-only" : "regenerate-all"}`);
  log(`AutoSend:  ${args.skipAutoSend ? "skip" : "immediate (no delays)"}`);
  log(`Batch:     ${args.draftBatchSize} concurrent`);
  log(`Sleep:     ${args.sleepMs}ms`);
  log(`Resume:    ${args.resume ? "yes" : "no"}`);
  log(`Log file:  ${logPath}`);
  log("=".repeat(80));
  log("");

  const totals: BackfillStateV1["totals"] = isResuming
    ? savedState!.totals
    : {
        batches: 0,
        messagesFetched: 0,
        candidates: 0,
        draftsGenerated: 0,
        autoSendAttempted: 0,
        autoSendImmediate: 0,
        autoSendDelayed: 0,
        autoSendNeedsReview: 0,
        autoSendSkip: 0,
        autoSendError: 0,
        skippedNoDraft: 0,
        skippedOptOut: 0,
        skippedBounce: 0,
        skippedSentiment: 0,
        skippedBooked: 0,
        skippedMissingDraft: 0,
        errors: 0,
      };

  const transcriptCache = new Map<string, string>();

  const { executeAutoSend } = createAutoSendExecutor({
    approveAndSendDraftSystem,
    decideShouldAutoReply,
    evaluateAutoSend,
    getPublicAppUrl,
    getCampaignDelayConfig: async () => ({ delayMinSeconds: 0, delayMaxSeconds: 0 }),
    scheduleDelayedAutoSend,
    validateDelayedAutoSend,
    sendSlackDmByEmail,
  });

  let cursor = args.cursor ?? (args.resume ? savedState?.cursor ?? undefined : undefined);
  let batchIndex = 0;

  while (true) {
    const messages = await prisma.message.findMany({
      where: {
        direction: "inbound",
        channel: "email",
        lead: {
          emailCampaign: {
            responseMode: "AI_AUTO_SEND",
            ...(args.campaignId ? { id: args.campaignId } : {}),
          },
        },
      },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      take: args.limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        body: true,
        subject: true,
        sentAt: true,
        leadId: true,
        lead: {
          select: {
            id: true,
            clientId: true,
            firstName: true,
            lastName: true,
            email: true,
            sentimentTag: true,
            autoReplyEnabled: true,
            appointmentBookedAt: true,
            appointmentStatus: true,
            ghlAppointmentId: true,
            calendlyInviteeUri: true,
            calendlyScheduledEventUri: true,
            emailCampaign: {
              select: {
                id: true,
                name: true,
                bisonCampaignId: true,
                responseMode: true,
                autoSendConfidenceThreshold: true,
              },
            },
          },
        },
      },
    });

    if (messages.length === 0) break;

    totals.batches += 1;
    totals.messagesFetched += messages.length;
    batchIndex += 1;

    log("");
    log(`--- Batch ${batchIndex} (${messages.length} messages) ---`);

    const messageIds = messages.map((m) => m.id);
    const existingDrafts = await prisma.aIDraft.findMany({
      where: { triggerMessageId: { in: messageIds }, channel: "email" },
      select: { id: true, triggerMessageId: true, status: true },
    });
    const existingByMessage = new Map(existingDrafts.map((d) => [d.triggerMessageId!, d]));

    const candidates: Array<{
      messageId: string;
      leadId: string;
      clientId: string;
      leadName: string;
      leadFirstName: string | null;
      leadLastName: string | null;
      leadEmail: string | null;
      autoReplyEnabled: boolean;
      sentimentTag: string;
      inboundText: string;
      subject: string | null;
      sentAt: Date;
      campaign: NonNullable<NonNullable<typeof messages[number]["lead"]>["emailCampaign"]>;
      existingDraft?: { id: string; status: string } | null;
    }> = [];

    for (const message of messages) {
      const lead = message.lead;
      const campaign = lead?.emailCampaign;
      if (!lead || !campaign) {
        totals.errors += 1;
        log(`[Skip] Message ${message.id}: missing lead or campaign`);
        continue;
      }

      const leadName = formatLeadName(lead.firstName, lead.lastName);
      const leadEmail = lead.email || null;
      const sentimentTag = lead.sentimentTag || "Neutral";
      const existingDraft = existingByMessage.get(message.id) || null;

      if (args.missingOnly && existingDraft) {
        totals.skippedMissingDraft += 1;
        log(`[Skip] ${leadName} (${leadEmail || "no email"}) - existing draft ${existingDraft.id}`);
        continue;
      }

      if (!shouldGenerateDraft(sentimentTag, leadEmail)) {
        totals.skippedSentiment += 1;
        log(`[Skip] ${leadName} (${leadEmail || "no email"}) - sentiment ${sentimentTag} not eligible`);
        continue;
      }

      const combined = `Subject: ${message.subject ?? ""} | ${message.body}`;
      if (isOptOutText(combined)) {
        totals.skippedOptOut += 1;
        log(`[Skip] ${leadName} (${leadEmail || "no email"}) - opt-out detected`);
        continue;
      }

      if (detectBounce([{ body: combined, direction: "inbound", channel: "email" }])) {
        totals.skippedBounce += 1;
        log(`[Skip] ${leadName} (${leadEmail || "no email"}) - bounce detected`);
        continue;
      }

      if (shouldSkipForBooking(lead)) {
        totals.skippedBooked += 1;
        log(`[Skip] ${leadName} (${leadEmail || "no email"}) - already booked`);
        continue;
      }

      candidates.push({
        messageId: message.id,
        leadId: lead.id,
        clientId: lead.clientId,
        leadName,
        leadFirstName: lead.firstName ?? null,
        leadLastName: lead.lastName ?? null,
        leadEmail,
        autoReplyEnabled: Boolean(lead.autoReplyEnabled),
        sentimentTag,
        inboundText: message.body,
        subject: message.subject ?? null,
        sentAt: message.sentAt ?? new Date(),
        campaign,
        existingDraft: existingDraft ? { id: existingDraft.id, status: existingDraft.status } : null,
      });
    }

    totals.candidates += candidates.length;

    const drafted: Array<{
      candidate: (typeof candidates)[number];
      draftId: string;
      draftContent: string;
    }> = [];

    if (args.skipDraftGen) {
      for (const candidate of candidates) {
        const campaignLabel = candidate.campaign
          ? `${candidate.campaign.name} (${candidate.campaign.bisonCampaignId || "no-id"})`
          : "Unknown campaign";
        const existing = candidate.existingDraft;
        if (!existing) {
          totals.skippedNoDraft += 1;
          log(`[Skip] ${candidate.leadName} (${candidate.leadEmail || "no email"}) - no existing draft`);
          continue;
        }

        log(`[Draft] Lead: ${candidate.leadName} (${candidate.leadEmail || "no email"})`);
        log(`        Message: ${candidate.messageId}`);
        log(`        Campaign: ${campaignLabel}`);
        log(`        Existing draft: ${existing.id} (${existing.status})`);

        const draft = await prisma.aIDraft.findUnique({
          where: { id: existing.id },
          select: { id: true, content: true },
        });

        if (!draft || !draft.content) {
          totals.skippedNoDraft += 1;
          log(`[Skip] ${candidate.leadName} (${candidate.leadEmail || "no email"}) - draft missing content`);
          continue;
        }

        drafted.push({ candidate, draftId: draft.id, draftContent: draft.content });
      }
    } else {
      for (let i = 0; i < candidates.length; i += args.draftBatchSize) {
        const batch = candidates.slice(i, i + args.draftBatchSize);

        const results = await Promise.allSettled(
          batch.map(async (candidate) => {
            const campaignLabel = candidate.campaign
              ? `${candidate.campaign.name} (${candidate.campaign.bisonCampaignId || "no-id"})`
              : "Unknown campaign";
            const cacheKey = candidate.leadId;
            let transcript = transcriptCache.get(cacheKey);
            if (!transcript) {
              const recentMessages = await prisma.message.findMany({
                where: { leadId: candidate.leadId },
                orderBy: { sentAt: "asc" },
                take: 80,
                select: {
                  sentAt: true,
                  channel: true,
                  direction: true,
                  body: true,
                  subject: true,
                },
              });
              transcript = buildSentimentTranscriptFromMessages(recentMessages);
              transcriptCache.set(cacheKey, transcript);
            }

            if (args.dryRun) {
              log(`[Draft][DRY RUN] Lead: ${candidate.leadName} (${candidate.leadEmail || "no email"})`);
              log(`        Message: ${candidate.messageId}`);
              log(`        Campaign: ${campaignLabel}`);
              log(`        Existing draft: ${candidate.existingDraft?.id || "NONE"}`);
              log(`        Generating draft... SKIPPED (dry-run)`);
              return null;
            }

            log(`[Draft] Lead: ${candidate.leadName} (${candidate.leadEmail || "no email"})`);
            log(`        Message: ${candidate.messageId}`);
            log(`        Campaign: ${campaignLabel}`);
            log(`        Existing draft: ${candidate.existingDraft?.id || "NONE"}`);
            log(`        Generating draft...`);

            const draftResult = await generateResponseDraft(
              candidate.leadId,
              transcript || candidate.inboundText,
              candidate.sentimentTag,
              "email",
              args.missingOnly ? { triggerMessageId: candidate.messageId } : {}
            );

            if (!draftResult.success || !draftResult.draftId || !draftResult.content) {
              throw new Error(draftResult.error || "Draft generation failed");
            }

            log(`        Draft ID: ${draftResult.draftId}`);
            return { draftId: draftResult.draftId, draftContent: draftResult.content };
          })
        );

        for (let j = 0; j < results.length; j++) {
          const candidate = batch[j]!;
          const result = results[j];

          if (result.status === "fulfilled") {
            if (result.value) {
              drafted.push({ candidate, draftId: result.value.draftId, draftContent: result.value.draftContent });
              totals.draftsGenerated += 1;
              log(`[Draft] ${candidate.leadName} (${candidate.leadEmail || "no email"}) - SUCCESS`);
            }
          } else {
            totals.errors += 1;
            log(
              `[Draft][ERROR] ${candidate.leadName} (${candidate.leadEmail || "no email"}) - ${result.reason instanceof Error ? result.reason.message : "unknown error"}`
            );
          }
        }
      }
    }

    if (!args.skipAutoSend) {
      for (const item of drafted) {
        const { candidate } = item;

        if (args.dryRun) {
          log(
            `[AutoSend][DRY RUN] ${candidate.leadName} (${candidate.leadEmail || "no email"}) - would execute auto-send`
          );
          continue;
        }

        totals.autoSendAttempted += 1;

        const autoSendResult = await executeAutoSend({
          clientId: candidate.clientId,
          leadId: candidate.leadId,
          triggerMessageId: candidate.messageId,
          draftId: item.draftId,
          draftContent: item.draftContent,
          channel: "email",
          latestInbound: candidate.inboundText,
          subject: candidate.subject,
          conversationHistory: transcriptCache.get(candidate.leadId) || candidate.inboundText,
          sentimentTag: candidate.sentimentTag,
          messageSentAt: candidate.sentAt,
          automatedReply: null,
          leadFirstName: candidate.leadFirstName,
          leadLastName: candidate.leadLastName,
          leadEmail: candidate.leadEmail,
          emailCampaign: candidate.campaign,
          autoReplyEnabled: candidate.autoReplyEnabled,
          validateImmediateSend: true,
          includeDraftPreviewInSlack: args.includeDraftPreviewInSlack,
        });

        switch (autoSendResult.outcome.action) {
          case "send_immediate":
            totals.autoSendImmediate += 1;
            log(
              `[AutoSend] ${candidate.leadName} (${candidate.leadEmail || "no email"}) - sent immediate` +
                (typeof autoSendResult.telemetry.confidence === "number" && typeof autoSendResult.telemetry.threshold === "number"
                  ? ` (${autoSendResult.telemetry.confidence.toFixed(2)} >= ${autoSendResult.telemetry.threshold.toFixed(2)})`
                  : "")
            );
            break;
          case "send_delayed":
            totals.autoSendDelayed += 1;
            log(
              `[AutoSend] ${candidate.leadName} (${candidate.leadEmail || "no email"}) - delayed until ${autoSendResult.outcome.runAt.toISOString()}`
            );
            break;
          case "needs_review":
            totals.autoSendNeedsReview += 1;
            log(
              `[AutoSend] ${candidate.leadName} (${candidate.leadEmail || "no email"}) - needs review (${autoSendResult.outcome.confidence.toFixed(
                2
              )} < ${autoSendResult.outcome.threshold.toFixed(2)}) Slack: ${autoSendResult.outcome.slackDm.sent ? "SENT" : "FAILED"}`
            );
            if (!autoSendResult.outcome.slackDm.sent) {
              log(`         Slack error: ${autoSendResult.outcome.slackDm.error || "unknown error"}`);
            }
            break;
          case "skip":
            totals.autoSendSkip += 1;
            log(`[AutoSend] ${candidate.leadName} (${candidate.leadEmail || "no email"}) - skip (${autoSendResult.outcome.reason})`);
            break;
          case "error":
            totals.autoSendError += 1;
            log(
              `[AutoSend][ERROR] ${candidate.leadName} (${candidate.leadEmail || "no email"}) - ${autoSendResult.outcome.error}`
            );
            break;
          default:
            break;
        }

        if (args.sleepMs > 0) {
          await sleep(args.sleepMs);
        }
      }
    }

    cursor = messages[messages.length - 1]?.id;

    const state: BackfillStateV1 = {
      version: 1,
      updatedAt: new Date().toISOString(),
      cursor: cursor ?? null,
      totals,
    };
    saveState(args.stateFile, state);

    if (!shouldRunUntilDone) break;
  }

  log("");
  log("=".repeat(80));
  log("Summary");
  log("=".repeat(80));
  log(`Batches:             ${totals.batches}`);
  log(`Messages fetched:    ${totals.messagesFetched}`);
  log(`Candidates:          ${totals.candidates}`);
  log(`Drafts generated:    ${totals.draftsGenerated}`);
  log(`Auto-send attempted: ${totals.autoSendAttempted}`);
  log(`  - send_immediate:  ${totals.autoSendImmediate}`);
  log(`  - send_delayed:    ${totals.autoSendDelayed}`);
  log(`  - needs_review:    ${totals.autoSendNeedsReview}`);
  log(`  - skip:            ${totals.autoSendSkip}`);
  log(`  - error:           ${totals.autoSendError}`);
  log(`Skipped (no draft):  ${totals.skippedNoDraft}`);
  log(`Skipped (missing):   ${totals.skippedMissingDraft}`);
  log(`Skipped (opt-out):   ${totals.skippedOptOut}`);
  log(`Skipped (bounce):    ${totals.skippedBounce}`);
  log(`Skipped (sentiment): ${totals.skippedSentiment}`);
  log(`Skipped (booked):    ${totals.skippedBooked}`);
  log(`Errors:              ${totals.errors}`);
  log("=".repeat(80));

  logStream.end();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[Backfill] Failed:", error);
  process.exit(1);
});
