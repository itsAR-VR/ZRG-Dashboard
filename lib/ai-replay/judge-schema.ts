import type { ReplayJudgeScore } from "@/lib/ai-replay/types";

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function validateScore01(value: unknown, field: string): number {
  const parsed = asNumber(value);
  if (parsed === null || parsed < 0 || parsed > 1) {
    throw new Error(`${field} must be a number between 0 and 1`);
  }
  return parsed;
}

function validateScore100(value: unknown, field: string): number {
  const parsed = asNumber(value);
  if (parsed === null || parsed < 0 || parsed > 100) {
    throw new Error(`${field} must be a number between 0 and 100`);
  }
  return Math.round(parsed);
}

function validateStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function validateBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
  return value;
}

export function validateReplayJudgeScore(value: unknown): ReplayJudgeScore {
  if (!value || typeof value !== "object") throw new Error("judge payload must be an object");

  const record = value as Record<string, unknown>;
  if (typeof record.pass !== "boolean") throw new Error("pass must be boolean");

  const confidence = validateScore01(record.confidence, "confidence");
  const overallScore = validateScore100(record.overallScore, "overallScore");

  if (!record.dimensions || typeof record.dimensions !== "object") {
    throw new Error("dimensions must be an object");
  }
  const dimensions = record.dimensions as Record<string, unknown>;

  const parsed: ReplayJudgeScore = {
    pass: record.pass,
    judgeMode: record.judgeMode === "hybrid_v1" ? "hybrid_v1" : "hybrid_v1",
    judgeProfile:
      record.judgeProfile === "strict" || record.judgeProfile === "balanced" || record.judgeProfile === "lenient"
        ? record.judgeProfile
        : "balanced",
    judgeThreshold: record.judgeThreshold == null ? 62 : validateScore100(record.judgeThreshold, "judgeThreshold"),
    confidence,
    llmPass: record.llmPass == null ? record.pass : validateBoolean(record.llmPass, "llmPass"),
    llmOverallScore: record.llmOverallScore == null ? overallScore : validateScore100(record.llmOverallScore, "llmOverallScore"),
    objectivePass: record.objectivePass == null ? true : validateBoolean(record.objectivePass, "objectivePass"),
    objectiveOverallScore:
      record.objectiveOverallScore == null ? 100 : validateScore100(record.objectiveOverallScore, "objectiveOverallScore"),
    objectiveCriticalReasons:
      record.objectiveCriticalReasons == null
        ? []
        : validateStringArray(record.objectiveCriticalReasons, "objectiveCriticalReasons"),
    blendedScore: record.blendedScore == null ? overallScore : validateScore100(record.blendedScore, "blendedScore"),
    adjudicated: record.adjudicated == null ? false : validateBoolean(record.adjudicated, "adjudicated"),
    adjudicationBand:
      record.adjudicationBand && typeof record.adjudicationBand === "object"
        ? {
            min: validateScore100((record.adjudicationBand as Record<string, unknown>).min, "adjudicationBand.min"),
            max: validateScore100((record.adjudicationBand as Record<string, unknown>).max, "adjudicationBand.max"),
          }
        : { min: 40, max: 80 },
    overallScore,
    promptKey: typeof record.promptKey === "string" && record.promptKey.trim() ? record.promptKey.trim() : "meeting.overseer.gate.v1",
    promptClientId: typeof record.promptClientId === "string" && record.promptClientId.trim() ? record.promptClientId.trim() : null,
    systemPrompt: typeof record.systemPrompt === "string" && record.systemPrompt.trim() ? record.systemPrompt.trim() : "N/A",
    decisionContract:
      record.decisionContract && typeof record.decisionContract === "object"
        ? (record.decisionContract as Record<string, unknown>)
        : null,
    dimensions: {
      pricingCadenceAccuracy: validateScore100(dimensions.pricingCadenceAccuracy, "dimensions.pricingCadenceAccuracy"),
      factualAlignment: validateScore100(dimensions.factualAlignment, "dimensions.factualAlignment"),
      safetyAndPolicy: validateScore100(dimensions.safetyAndPolicy, "dimensions.safetyAndPolicy"),
      responseQuality: validateScore100(dimensions.responseQuality, "dimensions.responseQuality"),
    },
    failureReasons: validateStringArray(record.failureReasons, "failureReasons"),
    suggestedFixes: validateStringArray(record.suggestedFixes, "suggestedFixes"),
    summary: typeof record.summary === "string" ? record.summary.trim() : "",
  };

  if (parsed.adjudicationBand.min > parsed.adjudicationBand.max) {
    throw new Error("adjudicationBand.min must be <= adjudicationBand.max");
  }
  if (!parsed.summary) throw new Error("summary must be a non-empty string");
  return parsed;
}
