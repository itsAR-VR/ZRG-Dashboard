import fs from "node:fs/promises";
import path from "node:path";

import type { ReplayBaselineDiff, ReplayBaselineDiffCase, ReplayCaseResult, ReplayRunArtifact } from "@/lib/ai-replay/types";

function toCaseScore(caseResult: ReplayCaseResult): number | null {
  if (caseResult.status !== "evaluated" || !caseResult.judge) return null;
  return caseResult.judge.overallScore;
}

function toCasePass(caseResult: ReplayCaseResult): boolean | null {
  if (caseResult.status !== "evaluated" || !caseResult.judge) return null;
  return caseResult.judge.pass;
}

function classifyDiff(opts: {
  previousScore: number | null;
  currentScore: number | null;
  previousPass: boolean | null;
  currentPass: boolean | null;
}): ReplayBaselineDiffCase["classification"] {
  if (opts.previousScore === null && opts.previousPass === null) return "new_case";

  const delta = opts.previousScore !== null && opts.currentScore !== null ? opts.currentScore - opts.previousScore : 0;
  const promotedToPass = opts.previousPass === false && opts.currentPass === true;
  const droppedFromPass = opts.previousPass === true && opts.currentPass === false;

  if (promotedToPass || delta >= 5) return "improved";
  if (droppedFromPass || delta <= -5) return "regressed";
  return "unchanged";
}

export function buildBaselineDiff(opts: {
  baselinePath: string;
  baseline: ReplayRunArtifact;
  current: ReplayRunArtifact;
}): ReplayBaselineDiff {
  const baselineByCaseId = new Map(opts.baseline.cases.map((entry) => [entry.caseId, entry]));
  const cases: ReplayBaselineDiffCase[] = opts.current.cases.map((entry) => {
    const previous = baselineByCaseId.get(entry.caseId) || null;
    const previousScore = previous ? toCaseScore(previous) : null;
    const currentScore = toCaseScore(entry);
    const previousPass = previous ? toCasePass(previous) : null;
    const currentPass = toCasePass(entry);
    const delta = previousScore !== null && currentScore !== null ? currentScore - previousScore : null;
    return {
      caseId: entry.caseId,
      previousPass,
      currentPass,
      previousScore,
      currentScore,
      delta,
      classification: classifyDiff({ previousScore, currentScore, previousPass, currentPass }),
    };
  });

  const summary = {
    improved: cases.filter((entry) => entry.classification === "improved").length,
    regressed: cases.filter((entry) => entry.classification === "regressed").length,
    unchanged: cases.filter((entry) => entry.classification === "unchanged").length,
    newCases: cases.filter((entry) => entry.classification === "new_case").length,
  };

  return {
    baselinePath: opts.baselinePath,
    summary,
    cases,
  };
}

export async function writeReplayArtifact(filePath: string, artifact: ReplayRunArtifact): Promise<void> {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

export async function readReplayArtifact(filePath: string): Promise<ReplayRunArtifact> {
  const raw = await fs.readFile(path.resolve(filePath), "utf8");
  return JSON.parse(raw) as ReplayRunArtifact;
}
