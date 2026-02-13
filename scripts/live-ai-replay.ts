/**
 * Live AI replay runner:
 * - selects historical inbound messages,
 * - runs real end-to-end draft generation,
 * - scores outputs with an LLM judge,
 * - writes a JSON artifact for regression tracking.
 *
 * Run with env preloading:
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/live-ai-replay.ts --client-id <uuid>
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { coerceEmailDraftVerificationModel } from "@/lib/ai-drafts/config";
import { buildBaselineDiff, readReplayArtifact, writeReplayArtifact } from "@/lib/ai-replay/artifact";
import { defaultArtifactPath, formatReplayUsage, parseReplayCliArgs } from "@/lib/ai-replay/cli";
import { REPLAY_JUDGE_PROMPT_KEY, resolveReplayJudgeSystemPrompt } from "@/lib/ai-replay/judge";
import { runReplayCase } from "@/lib/ai-replay/run-case";
import { selectReplayCases } from "@/lib/ai-replay/select-cases";
import type {
  ReplayCaseResult,
  ReplayFailureTypeKey,
  ReplayInvariantCode,
  ReplayRevisionLoopMode,
  ReplayRunArtifact,
} from "@/lib/ai-replay/types";
import { prisma } from "@/lib/prisma";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithConcurrency<TInput, TResult>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}

async function runCaseWithRetries(opts: {
  retries: number;
  runner: () => Promise<ReplayCaseResult>;
}): Promise<ReplayCaseResult> {
  const maxAttempts = Math.max(1, opts.retries + 1);
  let last: ReplayCaseResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await opts.runner();
    last = { ...result, attempts: attempt };

    if (result.status === "evaluated" || result.status === "skipped" || result.status === "selected_only") {
      return last;
    }
    if (attempt < maxAttempts) {
      await sleep(400 * Math.pow(2, attempt - 1));
    }
  }

  return last!;
}

function normalizeAbModes(input: string[]): ReplayRevisionLoopMode[] {
  const set = new Set<ReplayRevisionLoopMode>();
  for (const value of input) {
    const token = value.trim().toLowerCase();
    if (!token) continue;
    if (token === "all") {
      set.add("off");
      set.add("platform");
      set.add("overseer");
      set.add("force");
      continue;
    }
    if (token === "off" || token === "platform" || token === "force" || token === "overseer") {
      set.add(token);
    }
  }
  return Array.from(set);
}

function parseCaseOrMessageId(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  const separatorIndex = trimmed.indexOf(":");
  return separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : trimmed;
}

async function loadThreadIdsFromFile(filePath: string): Promise<string[]> {
  const fileRaw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(fileRaw);

  const candidates: string[] = [];
  const pushMany = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item !== "string") continue;
      const id = parseCaseOrMessageId(item);
      if (id) candidates.push(id);
    }
  };

  if (Array.isArray(parsed)) {
    pushMany(parsed);
  } else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    pushMany(record.threadIds);
    pushMany(record.caseIds);
    pushMany(record.criticalCore3);
    pushMany(record.criticalTop10);
  }

  return Array.from(new Set(candidates));
}

async function runReplayPreflight(opts: { dryRun: boolean }): Promise<string[]> {
  const issues: string[] = [];

  try {
    await prisma.$queryRawUnsafe("select 1");
  } catch (error) {
    issues.push(`db_connectivity_failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!opts.dryRun && !process.env.OPENAI_API_KEY) {
    issues.push("missing_openai_api_key: OPENAI_API_KEY is required for live generation/judging.");
  }

  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'WorkspaceSettings'
          and column_name = 'aiRouteBookingProcessEnabled'
      ) as "exists";`
    );
    const exists = Array.isArray(rows) && rows.length > 0 ? rows[0]?.exists === true : false;
    if (!exists) {
      issues.push(
        "schema_drift_detected: WorkspaceSettings.aiRouteBookingProcessEnabled missing in runtime DB (likely causes Prisma P2022)."
      );
    }
  } catch (error) {
    issues.push(`schema_preflight_failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return issues;
}

const REPLAY_FAILURE_TYPE_KEYS: ReplayFailureTypeKey[] = [
  "decision_error",
  "draft_generation_error",
  "draft_quality_error",
  "judge_error",
  "infra_error",
  "selection_error",
  "execution_error",
];

const REPLAY_INVARIANT_KEYS: ReplayInvariantCode[] = [
  "slot_mismatch",
  "date_mismatch",
  "fabricated_link",
  "empty_draft",
  "non_logistics_reply",
];

function emptyFailureTypeCounts(): ReplayRunArtifact["summary"]["failureTypeCounts"] {
  return REPLAY_FAILURE_TYPE_KEYS.reduce(
    (acc, key) => {
      acc[key] = 0;
      return acc;
    },
    {} as ReplayRunArtifact["summary"]["failureTypeCounts"]
  );
}

function emptyInvariantCounts(): ReplayRunArtifact["summary"]["criticalInvariantCounts"] {
  return REPLAY_INVARIANT_KEYS.reduce(
    (acc, key) => {
      acc[key] = 0;
      return acc;
    },
    {} as ReplayRunArtifact["summary"]["criticalInvariantCounts"]
  );
}

function summarizeCases(
  cases: ReplayCaseResult[],
  opts?: { selectionErrors?: number; infraErrors?: number }
): ReplayRunArtifact["summary"] {
  const evaluated = cases.filter((entry) => entry.status === "evaluated");
  const scored = evaluated.map((entry) => entry.judge?.overallScore).filter((value): value is number => Number.isFinite(value));
  const failureTypeCounts = emptyFailureTypeCounts();
  const criticalInvariantCounts = emptyInvariantCounts();

  for (const entry of cases) {
    if (!entry.failureType) continue;
    failureTypeCounts[entry.failureType] += 1;
  }
  if ((opts?.selectionErrors || 0) > 0) {
    failureTypeCounts.selection_error += opts?.selectionErrors || 0;
  }
  if ((opts?.infraErrors || 0) > 0) {
    failureTypeCounts.infra_error += opts?.infraErrors || 0;
  }

  for (const entry of cases) {
    for (const failure of entry.invariants || []) {
      if (failure.severity !== "critical") continue;
      criticalInvariantCounts[failure.code] += 1;
    }
  }
  const criticalMisses = Object.values(criticalInvariantCounts).reduce((sum, value) => sum + value, 0);

  return {
    selectedOnly: cases.filter((entry) => entry.status === "selected_only").length,
    skipped: cases.filter((entry) => entry.status === "skipped").length,
    evaluated: evaluated.length,
    failed: cases.filter((entry) => entry.status === "failed").length,
    passed: evaluated.filter((entry) => entry.judge?.pass === true).length,
    failedJudge: evaluated.filter((entry) => entry.judge?.pass === false).length,
    averageScore: scored.length > 0 ? Number((scored.reduce((sum, value) => sum + value, 0) / scored.length).toFixed(2)) : null,
    failureTypeCounts,
    criticalMisses,
    criticalInvariantCounts,
  };
}

function formatFailureTypeCounts(counts: ReplayRunArtifact["summary"]["failureTypeCounts"]): string {
  return REPLAY_FAILURE_TYPE_KEYS.map((key) => `${key}=${counts[key]}`).join(", ");
}

function formatInvariantCounts(counts: ReplayRunArtifact["summary"]["criticalInvariantCounts"]): string {
  return REPLAY_INVARIANT_KEYS.map((key) => `${key}=${counts[key]}`).join(", ");
}

function buildAbComparison(
  modeResults: Partial<Record<ReplayRevisionLoopMode, ReplayCaseResult[]>>
): ReplayRunArtifact["abComparison"] {
  type ReplayAbComparison = NonNullable<ReplayRunArtifact["abComparison"]>;
  const modes: ReplayRevisionLoopMode[] = ["off", "platform", "overseer", "force"];
  const modeSummaries = modes.reduce(
    (acc, mode) => {
      const cases = modeResults[mode] || [];
      acc[mode] = {
        summary: summarizeCases(cases),
        casesEvaluated: cases.filter((entry) => entry.status === "evaluated").length,
      };
      return acc;
    },
    {} as ReplayAbComparison["modes"]
  );

  const allCaseIds = new Set<string>();
  for (const mode of modes) {
    for (const entry of modeResults[mode] || []) {
      allCaseIds.add(entry.caseId);
    }
  }

  const caseDeltas = Array.from(allCaseIds).map((caseId) => {
    const byMode = modes.reduce(
      (acc, mode) => {
        const entry = (modeResults[mode] || []).find((value) => value.caseId === caseId) || null;
        acc[mode] = {
          pass: entry?.judge?.pass ?? null,
          score: entry?.judge?.overallScore ?? null,
          criticalInvariantCodes: (entry?.invariants || []).map((value) => value.code),
          failureType: entry?.failureType ?? null,
        };
        return acc;
      },
      {} as ReplayAbComparison["caseDeltas"][number]["byMode"]
    );
    return { caseId, byMode };
  });

  return {
    modes: modeSummaries,
    caseDeltas,
  };
}

async function main(): Promise<void> {
  const parsed = parseReplayCliArgs(process.argv);
  if (!parsed.ok) {
    if (parsed.error !== "help") {
      console.error(`[AI Replay] ${parsed.error}`);
      console.error("");
    }
    console.error(formatReplayUsage());
    process.exit(parsed.error === "help" ? 0 : 1);
  }

  const args = parsed.args;
  const requestedAbModes = normalizeAbModes(args.abModes);
  const resolvedAbModes =
    requestedAbModes.length > 0
      ? requestedAbModes
      : args.threadIdsFile && !args.dryRun
        ? (["off", "platform", "overseer", "force"] as ReplayRevisionLoopMode[])
        : [];
  const runId = `ai_replay_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
  const artifactPath = path.resolve(args.out || defaultArtifactPath(new Date()));
  const source = "script:live_ai_replay";
  let judgeModel = args.judgeModel || "gpt-5-mini";
  const judgeClientIdForConfig = (args.judgeClientId || args.clientId || "").trim() || null;
  if (judgeClientIdForConfig) {
    try {
      const workspaceJudgeModel = (
        await prisma.workspaceSettings.findUnique({
          where: { clientId: judgeClientIdForConfig },
          select: { emailDraftVerificationModel: true },
        })
      )?.emailDraftVerificationModel;
      judgeModel = coerceEmailDraftVerificationModel(workspaceJudgeModel || judgeModel);
    } catch {
      // ignore and use provided/default model for config metadata
    }
  }
  const cliThreadIds = args.threadIds.map((id) => parseCaseOrMessageId(id)).filter(Boolean);
  const fileThreadIds = args.threadIdsFile ? await loadThreadIdsFromFile(path.resolve(args.threadIdsFile)) : [];
  const threadIds = Array.from(new Set([...cliThreadIds, ...fileThreadIds]));

  console.log("[AI Replay] Starting run");
  console.log(`- runId: ${runId}`);
  console.log(`- clientId: ${args.clientId || "(from explicit thread IDs)"}`);
  console.log(`- judgeClientId: ${args.judgeClientId || "(case client)"}`);
  console.log(`- threadIds: ${threadIds.length}`);
  if (args.threadIdsFile) {
    console.log(`- threadIdsFile: ${args.threadIdsFile}`);
  }
  console.log(`- channel: ${args.channel}`);
  console.log(`- limit: ${args.limit}`);
  console.log(`- concurrency: ${args.concurrency}`);
  console.log(`- retries: ${args.retries}`);
  console.log(`- dryRun: ${args.dryRun ? "yes" : "no"}`);
  console.log(`- revisionLoop: ${args.revisionLoopMode}`);
  console.log(`- overseerMode: ${args.overseerDecisionMode}`);
  console.log(`- judgeProfile: ${args.judgeProfile}`);
  console.log(`- judgeThreshold: ${args.judgeThreshold}`);
  console.log(`- adjudicationBand: ${args.adjudicationBand.min},${args.adjudicationBand.max}`);
  console.log(`- adjudicateBorderline: ${args.adjudicateBorderline ? "yes" : "no"}`);
  console.log(`- abModes: ${resolvedAbModes.length > 0 ? resolvedAbModes.join(",") : "(none)"}`);
  console.log(`- cleanupDrafts: ${args.cleanupDrafts ? "yes" : "no"}`);
  console.log(`- allowEmpty: ${args.allowEmpty ? "yes" : "no"}`);
  console.log(`- out: ${artifactPath}`);

  const judgeSystemPrompt = args.judgeClientId || args.clientId
    ? await resolveReplayJudgeSystemPrompt(args.judgeClientId || args.clientId)
    : "PER_CASE_CLIENT_PROMPT";

  const preflightIssues = await runReplayPreflight({ dryRun: args.dryRun });
  if (preflightIssues.length > 0) {
    for (const issue of preflightIssues) {
      console.warn(`[AI Replay][Preflight] ${issue}`);
    }
    const blockingIssues = args.dryRun
      ? preflightIssues.filter((issue) => issue.startsWith("db_connectivity_failed"))
      : preflightIssues;
    if (blockingIssues.length > 0) {
      const preflightArtifact: ReplayRunArtifact = {
        runId,
        createdAt: new Date().toISOString(),
        config: {
          clientId: args.clientId,
          judgeClientId: args.judgeClientId,
          threadIds,
          threadIdsFile: args.threadIdsFile,
          channel: args.channel,
          from: args.from,
          to: args.to,
          limit: args.limit,
          concurrency: args.concurrency,
          retries: args.retries,
          dryRun: args.dryRun,
          cleanupDrafts: args.cleanupDrafts,
          allowEmpty: args.allowEmpty,
          revisionLoopMode: args.revisionLoopMode,
          overseerDecisionMode: args.overseerDecisionMode,
          abModes: resolvedAbModes,
          judgeModel,
          judgeProfile: args.judgeProfile,
          judgeThreshold: args.judgeThreshold,
          adjudicationBand: args.adjudicationBand,
          adjudicateBorderline: args.adjudicateBorderline,
          judgePromptKey: REPLAY_JUDGE_PROMPT_KEY,
          judgeSystemPrompt,
        },
        selection: {
          count: 0,
          scannedCount: 0,
          warnings: [...preflightIssues],
        },
        summary: summarizeCases([], { infraErrors: blockingIssues.length }),
        cases: [],
        baselineDiff: null,
        abComparison: null,
      };
      await writeReplayArtifact(artifactPath, preflightArtifact);
      console.log(`[AI Replay] Artifact written: ${artifactPath}`);
      throw new Error(`Replay preflight failed with ${blockingIssues.length} blocking issue(s).`);
    }
  }

  const selection = await selectReplayCases({
    clientId: args.clientId,
    threadIds,
    channel: args.channel,
    from: new Date(args.from),
    to: new Date(args.to),
    limit: args.limit,
  });

  console.log(`[AI Replay] Selected ${selection.cases.length} case(s) from ${selection.scannedCount} candidate message(s).`);
  if (selection.warnings.length > 0) {
    for (const warning of selection.warnings) {
      console.warn(`[AI Replay][Selection Warning] ${warning}`);
    }
  }

  if (selection.cases.length === 0 && !args.allowEmpty) {
    const selectionArtifact: ReplayRunArtifact = {
      runId,
      createdAt: new Date().toISOString(),
      config: {
        clientId: args.clientId,
        judgeClientId: args.judgeClientId,
        threadIds,
        threadIdsFile: args.threadIdsFile,
        channel: args.channel,
        from: args.from,
        to: args.to,
        limit: args.limit,
        concurrency: args.concurrency,
        retries: args.retries,
        dryRun: args.dryRun,
        cleanupDrafts: args.cleanupDrafts,
        allowEmpty: args.allowEmpty,
        revisionLoopMode: args.revisionLoopMode,
        overseerDecisionMode: args.overseerDecisionMode,
        abModes: resolvedAbModes,
        judgeModel,
        judgeProfile: args.judgeProfile,
        judgeThreshold: args.judgeThreshold,
        adjudicationBand: args.adjudicationBand,
        adjudicateBorderline: args.adjudicateBorderline,
        judgePromptKey: REPLAY_JUDGE_PROMPT_KEY,
        judgeSystemPrompt,
      },
      selection: {
        count: 0,
        scannedCount: selection.scannedCount,
        warnings: [...selection.warnings, "No replay cases selected"],
      },
      summary: summarizeCases([], { selectionErrors: 1 }),
      cases: [],
      baselineDiff: null,
      abComparison: null,
    };
    await writeReplayArtifact(artifactPath, selectionArtifact);
    console.log(`[AI Replay] Artifact written: ${artifactPath}`);
    throw new Error(
      "No replay cases selected. Provide --thread-ids, broaden filters (for example --channel any), or rerun with --allow-empty to bypass this guard."
    );
  }

  const workspaceContextCache = new Map<string, {
    serviceDescription: string | null;
    knowledgeContext: string | null;
    companyName: string | null;
    targetResult: string | null;
  }>();
  const historicalReplyCache = new Map<
    string,
    Array<{ subject: string | null; body: string; sentAt: string; leadSentiment: string | null }>
  >();

  const runMode = async (mode: ReplayRevisionLoopMode): Promise<ReplayCaseResult[]> => {
    if (args.dryRun) {
      return selection.cases.map((selectionCase) => {
        const now = new Date();
        return {
          caseId: selectionCase.caseId,
          messageId: selectionCase.messageId,
          leadId: selectionCase.leadId,
          clientId: selectionCase.clientId,
          channel: selectionCase.channel,
          status: "selected_only",
          attempts: 1,
          startedAt: now.toISOString(),
          completedAt: now.toISOString(),
          durationMs: 0,
          leadSentiment: selectionCase.leadSentiment,
          inboundSubject: selectionCase.inboundSubject,
          inboundBody: selectionCase.inboundBody,
          transcript: null,
          generation: null,
          revisionLoop: {
            mode,
            enabled: false,
            attempted: false,
            applied: false,
            iterationsUsed: 0,
            threshold: null,
            startConfidence: null,
            endConfidence: null,
            stopReason: "disabled",
            finalReason: null,
          },
          generatedDraft: null,
          judge: null,
          invariants: [],
          failureType: null,
          evidencePacket: null,
          skipReason: "dry_run",
          error: null,
          warnings: [],
        };
      });
    }

    return runWithConcurrency(selection.cases, args.concurrency, async (selectionCase) =>
      runCaseWithRetries({
        retries: args.retries,
        runner: async () =>
          runReplayCase({
            selectionCase,
            judgeModel,
            cleanupDrafts: args.cleanupDrafts,
            revisionLoopMode: mode,
            overseerDecisionMode: args.overseerDecisionMode,
            judgeClientId: args.judgeClientId,
            judgeProfile: args.judgeProfile,
            judgeThreshold: args.judgeThreshold,
            adjudicationBand: args.adjudicationBand,
            adjudicateBorderline: args.adjudicateBorderline,
            source,
            workspaceContextCache,
            historicalReplyCache,
          }),
      })
    );
  };

  const primaryMode = args.revisionLoopMode;
  const modeExecutionOrder: ReplayRevisionLoopMode[] = Array.from(
    new Set<ReplayRevisionLoopMode>([primaryMode, ...resolvedAbModes])
  );
  const modeResults: Partial<Record<ReplayRevisionLoopMode, ReplayCaseResult[]>> = {};
  for (const mode of modeExecutionOrder) {
    console.log(`[AI Replay] Running mode: ${mode}`);
    modeResults[mode] = await runMode(mode);
  }

  const cases = modeResults[primaryMode] || [];
  const abComparison =
    modeExecutionOrder.length > 1 ? buildAbComparison(modeResults) : null;

  const artifact: ReplayRunArtifact = {
    runId,
    createdAt: new Date().toISOString(),
    config: {
      clientId: args.clientId,
      judgeClientId: args.judgeClientId,
      threadIds,
      threadIdsFile: args.threadIdsFile,
      channel: args.channel,
      from: args.from,
      to: args.to,
      limit: args.limit,
      concurrency: args.concurrency,
      retries: args.retries,
      dryRun: args.dryRun,
      cleanupDrafts: args.cleanupDrafts,
      allowEmpty: args.allowEmpty,
      revisionLoopMode: args.revisionLoopMode,
      overseerDecisionMode: args.overseerDecisionMode,
      abModes: resolvedAbModes,
      judgeModel,
      judgeProfile: args.judgeProfile,
      judgeThreshold: args.judgeThreshold,
      adjudicationBand: args.adjudicationBand,
      adjudicateBorderline: args.adjudicateBorderline,
      judgePromptKey: REPLAY_JUDGE_PROMPT_KEY,
      judgeSystemPrompt,
    },
    selection: {
      count: selection.cases.length,
      scannedCount: selection.scannedCount,
      warnings: selection.warnings,
    },
    summary: summarizeCases(cases),
    cases,
    baselineDiff: null,
    abComparison,
  };

  if (args.baseline) {
    try {
      const baseline = await readReplayArtifact(args.baseline);
      artifact.baselineDiff = buildBaselineDiff({
        baselinePath: args.baseline,
        baseline,
        current: artifact,
      });
      console.log(
        `[AI Replay] Baseline diff: improved=${artifact.baselineDiff.summary.improved}, regressed=${artifact.baselineDiff.summary.regressed}, unchanged=${artifact.baselineDiff.summary.unchanged}, new=${artifact.baselineDiff.summary.newCases}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown baseline read failure";
      console.warn(`[AI Replay] Failed to read baseline artifact (${args.baseline}): ${message}`);
    }
  }

  await writeReplayArtifact(artifactPath, artifact);
  console.log(`[AI Replay] Artifact written: ${artifactPath}`);
  console.log(
    `[AI Replay] Summary: evaluated=${artifact.summary.evaluated}, passed=${artifact.summary.passed}, failedJudge=${artifact.summary.failedJudge}, failed=${artifact.summary.failed}, averageScore=${artifact.summary.averageScore ?? "n/a"}`
  );
  console.log(
    `[AI Replay] FailureTypes: ${formatFailureTypeCounts(artifact.summary.failureTypeCounts)}`
  );
  console.log(
    `[AI Replay] CriticalInvariants: total=${artifact.summary.criticalMisses}, ${formatInvariantCounts(artifact.summary.criticalInvariantCounts)}`
  );
  if (artifact.abComparison) {
    for (const mode of ["off", "platform", "overseer", "force"] as const) {
      const entry = artifact.abComparison.modes[mode];
      if (!entry) continue;
      console.log(
        `[AI Replay][AB:${mode}] evaluated=${entry.summary.evaluated} passed=${entry.summary.passed} avg=${entry.summary.averageScore ?? "n/a"} critical=${entry.summary.criticalMisses}`
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[AI Replay] Failed:", error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
