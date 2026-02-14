import path from "node:path";

import type {
  ReplayChannelFilter,
  ReplayOverseerDecisionMode,
  ReplayJudgeProfile,
  ReplayRevisionLoopMode,
} from "@/lib/ai-replay/types";

export type ReplayCliArgs = {
  clientId: string | null;
  judgeClientId: string | null;
  threadIds: string[];
  threadIdsFile: string | null;
  limit: number;
  concurrency: number;
  retries: number;
  from: string;
  to: string;
  dryRun: boolean;
  out: string | null;
  baseline: string | null;
  channel: ReplayChannelFilter;
  judgeModel: string | null;
  cleanupDrafts: boolean;
  allowEmpty: boolean;
  revisionLoopMode: ReplayRevisionLoopMode;
  overseerDecisionMode: ReplayOverseerDecisionMode;
  judgeProfile: ReplayJudgeProfile;
  judgeThreshold: number;
  adjudicationBand: {
    min: number;
    max: number;
  };
  adjudicateBorderline: boolean;
  abModes: string[];
};

const DEFAULT_LIMIT = 20;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRIES = 1;
const DEFAULT_CHANNEL: ReplayChannelFilter = "any";
const DEFAULT_REVISION_LOOP_MODE: ReplayRevisionLoopMode = "overseer";
const DEFAULT_OVERSEER_DECISION_MODE: ReplayOverseerDecisionMode = "fresh";
const DEFAULT_JUDGE_PROFILE: ReplayJudgeProfile = "balanced";
const DEFAULT_ADJUDICATION_BAND = { min: 40, max: 80 };

function defaultJudgeThresholdForProfile(profile: ReplayJudgeProfile): number {
  if (profile === "strict") return 72;
  if (profile === "lenient") return 52;
  return 62;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseScore(raw: string | undefined): number | null {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed > 100) return null;
  return parsed;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeChannel(raw: string | undefined): ReplayChannelFilter | null {
  if (!raw) return DEFAULT_CHANNEL;
  const lowered = raw.trim().toLowerCase();
  if (lowered === "email" || lowered === "sms" || lowered === "linkedin" || lowered === "any") return lowered;
  return null;
}

function normalizeRevisionLoopMode(raw: string | undefined): ReplayRevisionLoopMode | null {
  if (!raw) return DEFAULT_REVISION_LOOP_MODE;
  const lowered = raw.trim().toLowerCase();
  if (lowered === "platform" || lowered === "force" || lowered === "off" || lowered === "overseer") return lowered;
  return null;
}

function normalizeOverseerDecisionMode(raw: string | undefined): ReplayOverseerDecisionMode | null {
  if (!raw) return DEFAULT_OVERSEER_DECISION_MODE;
  const lowered = raw.trim().toLowerCase();
  if (lowered === "fresh" || lowered === "persisted") return lowered;
  return null;
}

function normalizeJudgeProfile(raw: string | undefined): ReplayJudgeProfile | null {
  if (!raw) return DEFAULT_JUDGE_PROFILE;
  const lowered = raw.trim().toLowerCase();
  if (lowered === "strict" || lowered === "balanced" || lowered === "lenient") return lowered;
  return null;
}

function parseAdjudicationBand(raw: string | undefined): { min: number; max: number } | null {
  const value = (raw || "").trim();
  if (!value) return null;
  const [minRaw, maxRaw] = value.split(",").map((entry) => entry.trim());
  if (!minRaw || !maxRaw) return null;
  const min = parseScore(minRaw);
  const max = parseScore(maxRaw);
  if (min === null || max === null || min > max) return null;
  return { min, max };
}

export function defaultFromIso(now: Date): string {
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

export function defaultToIso(now: Date): string {
  return now.toISOString();
}

export function defaultArtifactPath(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(".artifacts", "ai-replay", `run-${stamp}.json`);
}

export function formatReplayUsage(): string {
  return [
    "Usage:",
    "  npm run test:ai-replay -- --client-id <uuid> [options]",
    "  npm run test:ai-replay -- --thread-ids <messageId1,messageId2> [options]",
    "",
    "Options:",
    "  --client-id <uuid>           Workspace client ID (required unless --thread-ids or --thread-ids-file is provided)",
    "  --judge-client-id <uuid>     Force judge prompt/model context to this workspace client ID",
    "  --thread-ids <csv>           Explicit inbound message IDs to replay",
    "  --thread-ids-file <path>     JSON file containing case/message IDs (manifest-style)",
    "  --channel <email|sms|linkedin|any>  Candidate channel for auto-selection (default: any)",
    "  --from <ISO>                 Start timestamp (default: now-30d)",
    "  --to <ISO>                   End timestamp (default: now)",
    "  --limit <n>                  Max selected cases (default: 20)",
    "  --concurrency <n>            Concurrent case workers (default: 3)",
    "  --retries <n>                Retry attempts per failed case (default: 1)",
    "  --judge-model <name>         Override replay judge model",
    "  --revision-loop <platform|force|off|overseer>  Replay revision loop mode (default: overseer)",
    "  --overseer-mode <fresh|persisted>     Meeting overseer decision mode (default: fresh)",
    "  --judge-profile <strict|balanced|lenient>  Hybrid judge profile (default: balanced)",
    "  --judge-threshold <0..100>      Override pass threshold for hybrid judge",
    "  --adjudication-band <min,max>   Borderline band for second-pass adjudication (default: 40,80)",
    "  --no-adjudicate-borderline      Disable second-pass adjudication in borderline band",
    "  --ab-mode <off|platform|force|overseer|all>   Run additional A/B modes (repeatable or CSV)",
    "  --baseline <path>            Compare results against a prior artifact",
    "  --out <path>                 Artifact output path (default: .artifacts/ai-replay/run-<timestamp>.json)",
    "  --dry-run                    Selection only; skip live generation/judging",
    "  --keep-drafts                Keep generated AIDraft rows (default: delete replay drafts)",
    "  --allow-empty                Exit successfully when selection yields 0 cases",
    "  --help                       Show this message",
  ].join("\n");
}

export function parseReplayCliArgs(argv: string[], now: Date = new Date()): {
  ok: true;
  args: ReplayCliArgs;
} | {
  ok: false;
  error: string;
} {
  const args: ReplayCliArgs = {
    clientId: null,
    judgeClientId: (process.env.AI_REPLAY_JUDGE_CLIENT_ID || "").trim() || null,
    threadIds: [],
    threadIdsFile: null,
    limit: DEFAULT_LIMIT,
    concurrency: DEFAULT_CONCURRENCY,
    retries: DEFAULT_RETRIES,
    from: defaultFromIso(now),
    to: defaultToIso(now),
    dryRun: false,
    out: null,
    baseline: null,
    channel: DEFAULT_CHANNEL,
    judgeModel: process.env.AI_REPLAY_JUDGE_MODEL || null,
    cleanupDrafts: true,
    allowEmpty: false,
    revisionLoopMode: DEFAULT_REVISION_LOOP_MODE,
    overseerDecisionMode: DEFAULT_OVERSEER_DECISION_MODE,
    judgeProfile: DEFAULT_JUDGE_PROFILE,
    judgeThreshold: defaultJudgeThresholdForProfile(DEFAULT_JUDGE_PROFILE),
    adjudicationBand: DEFAULT_ADJUDICATION_BAND,
    adjudicateBorderline: true,
    abModes: [],
  };
  let judgeThresholdExplicit = false;

  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "help" };
    }
    if (token === "--client-id") {
      args.clientId = (argv[++i] || "").trim() || null;
      continue;
    }
    if (token === "--thread-ids") {
      args.threadIds = parseCsv(argv[++i]);
      continue;
    }
    if (token === "--judge-client-id") {
      args.judgeClientId = (argv[++i] || "").trim() || null;
      continue;
    }
    if (token === "--thread-ids-file") {
      args.threadIdsFile = (argv[++i] || "").trim() || null;
      continue;
    }
    if (token === "--channel") {
      const parsed = normalizeChannel(argv[++i]);
      if (!parsed) return { ok: false, error: "Invalid --channel value. Use email|sms|linkedin|any." };
      args.channel = parsed;
      continue;
    }
    if (token === "--from") {
      args.from = (argv[++i] || "").trim();
      continue;
    }
    if (token === "--to") {
      args.to = (argv[++i] || "").trim();
      continue;
    }
    if (token === "--limit") {
      args.limit = parsePositiveInt(argv[++i], DEFAULT_LIMIT);
      continue;
    }
    if (token === "--concurrency") {
      args.concurrency = parsePositiveInt(argv[++i], DEFAULT_CONCURRENCY);
      continue;
    }
    if (token === "--retries") {
      args.retries = parsePositiveInt(argv[++i], DEFAULT_RETRIES);
      continue;
    }
    if (token === "--judge-model") {
      args.judgeModel = (argv[++i] || "").trim() || null;
      continue;
    }
    if (token === "--revision-loop") {
      const parsed = normalizeRevisionLoopMode(argv[++i]);
      if (!parsed) return { ok: false, error: "Invalid --revision-loop value. Use platform|force|off|overseer." };
      args.revisionLoopMode = parsed;
      continue;
    }
    if (token === "--overseer-mode") {
      const parsed = normalizeOverseerDecisionMode(argv[++i]);
      if (!parsed) return { ok: false, error: "Invalid --overseer-mode value. Use fresh|persisted." };
      args.overseerDecisionMode = parsed;
      continue;
    }
    if (token === "--judge-profile") {
      const parsed = normalizeJudgeProfile(argv[++i]);
      if (!parsed) return { ok: false, error: "Invalid --judge-profile value. Use strict|balanced|lenient." };
      args.judgeProfile = parsed;
      if (!judgeThresholdExplicit) {
        args.judgeThreshold = defaultJudgeThresholdForProfile(parsed);
      }
      continue;
    }
    if (token === "--judge-threshold") {
      const parsed = parseScore(argv[++i]);
      if (parsed === null) return { ok: false, error: "Invalid --judge-threshold value. Use 0..100." };
      args.judgeThreshold = parsed;
      judgeThresholdExplicit = true;
      continue;
    }
    if (token === "--adjudication-band") {
      const parsed = parseAdjudicationBand(argv[++i]);
      if (!parsed) return { ok: false, error: "Invalid --adjudication-band value. Use <min,max> with 0..100 and min<=max." };
      args.adjudicationBand = parsed;
      continue;
    }
    if (token === "--adjudicate-borderline") {
      args.adjudicateBorderline = true;
      continue;
    }
    if (token === "--no-adjudicate-borderline") {
      args.adjudicateBorderline = false;
      continue;
    }
    if (token === "--ab-mode") {
      const raw = (argv[++i] || "").trim();
      if (!raw) return { ok: false, error: "Missing value for --ab-mode." };
      const values = parseCsv(raw);
      if (values.length === 0) return { ok: false, error: "Missing value for --ab-mode." };
      const invalid = values.find((value) => !["off", "platform", "force", "overseer", "all"].includes(value.toLowerCase()));
      if (invalid) return { ok: false, error: `Invalid --ab-mode value: ${invalid}. Use off|platform|force|overseer|all.` };
      args.abModes.push(...values);
      continue;
    }
    if (token === "--baseline") {
      args.baseline = (argv[++i] || "").trim() || null;
      continue;
    }
    if (token === "--out") {
      args.out = (argv[++i] || "").trim() || null;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--keep-drafts") {
      args.cleanupDrafts = false;
      continue;
    }
    if (token === "--allow-empty") {
      args.allowEmpty = true;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${token}` };
  }

  const hasExplicitThreadIds = args.threadIds.length > 0 || Boolean(args.threadIdsFile);
  if (!hasExplicitThreadIds && !args.clientId) {
    return { ok: false, error: "--client-id is required unless --thread-ids or --thread-ids-file is provided." };
  }

  const fromDate = new Date(args.from);
  if (Number.isNaN(fromDate.getTime())) {
    return { ok: false, error: `Invalid --from ISO timestamp: ${args.from}` };
  }
  const toDate = new Date(args.to);
  if (Number.isNaN(toDate.getTime())) {
    return { ok: false, error: `Invalid --to ISO timestamp: ${args.to}` };
  }
  if (fromDate.getTime() > toDate.getTime()) {
    return { ok: false, error: "--from must be earlier than --to." };
  }

  return { ok: true, args };
}
