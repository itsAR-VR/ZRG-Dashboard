type RewriteGuardrailConfig = {
  ratio: number;
  minDelta: number;
  maxDelta: number;
  lineRatio: number;
  minLineDelta: number;
};

type RewriteGuardrailStats = {
  beforeLen: number;
  afterLen: number;
  delta: number;
  ratio: number;
  beforeLines: number;
  afterLines: number;
  lineDelta: number;
  lineRatio: number;
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function parsePositiveFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseFloat(raw || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getRewriteGuardrailConfig(): RewriteGuardrailConfig {
  return {
    ratio: parsePositiveFloatEnv("OPENAI_EMAIL_STEP3_REWRITE_RATIO", 0.45),
    minDelta: parsePositiveIntEnv("OPENAI_EMAIL_STEP3_REWRITE_MIN_DELTA", 250),
    maxDelta: parsePositiveIntEnv("OPENAI_EMAIL_STEP3_REWRITE_MAX_DELTA", 900),
    lineRatio: parsePositiveFloatEnv("OPENAI_EMAIL_STEP3_REWRITE_LINE_RATIO", 0.5),
    minLineDelta: parsePositiveIntEnv("OPENAI_EMAIL_STEP3_REWRITE_MIN_LINE_DELTA", 3),
  };
}

function countNonEmptyLines(input: string): number {
  const lines = input.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.length;
}

export function evaluateStep3RewriteGuardrail(before: string, after: string): {
  isRewrite: boolean;
  stats: RewriteGuardrailStats;
  config: RewriteGuardrailConfig;
} {
  const beforeTrimmed = before.trim();
  const afterTrimmed = after.trim();

  const beforeLen = beforeTrimmed.length;
  const afterLen = afterTrimmed.length;
  const delta = Math.abs(afterLen - beforeLen);
  const ratio = delta / Math.max(1, beforeLen);

  const beforeLines = countNonEmptyLines(beforeTrimmed);
  const afterLines = countNonEmptyLines(afterTrimmed);
  const lineDelta = Math.abs(afterLines - beforeLines);
  const lineRatio = lineDelta / Math.max(1, beforeLines);

  const config = getRewriteGuardrailConfig();

  const isRewrite =
    ((ratio > config.ratio && delta > config.minDelta) || delta > config.maxDelta) ||
    (lineRatio > config.lineRatio && lineDelta >= config.minLineDelta);

  return {
    isRewrite,
    stats: {
      beforeLen,
      afterLen,
      delta,
      ratio,
      beforeLines,
      afterLines,
      lineDelta,
      lineRatio,
    },
    config,
  };
}

export function normalizeDraftForCompare(input: string): string {
  return input.replace(/\r\n/g, "\n").trim();
}
