import type { MemoryPolicySettings, MemoryProposal } from "@/lib/memory-governance/types";
import { DEFAULT_MEMORY_POLICY } from "@/lib/memory-governance/types";
import { scrubMemoryProposalContent } from "@/lib/memory-governance/redaction";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.trunc(n));
}

function normalizeAllowlist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = item.trim();
    if (!cleaned) continue;
    if (cleaned.length > 64) continue;
    out.push(cleaned);
  }
  return Array.from(new Set(out));
}

export function resolveMemoryPolicySettings(input?: Partial<MemoryPolicySettings> | null): MemoryPolicySettings {
  const allowlist = normalizeAllowlist(input?.allowlistCategories ?? []);
  const minConfidenceRaw = typeof input?.minConfidence === "number" ? input?.minConfidence : DEFAULT_MEMORY_POLICY.minConfidence;
  const minConfidence = clamp01(minConfidenceRaw);
  const minTtlDays = normalizePositiveInt(input?.minTtlDays, DEFAULT_MEMORY_POLICY.minTtlDays);
  const ttlCapDays = normalizePositiveInt(input?.ttlCapDays, DEFAULT_MEMORY_POLICY.ttlCapDays);

  // If no allowlist configured, fall back to a conservative default set.
  const allowlistCategories = allowlist.length > 0 ? allowlist : DEFAULT_MEMORY_POLICY.allowlistCategories;

  return { allowlistCategories, minConfidence, minTtlDays, ttlCapDays };
}

export type MemoryProposalDecision = {
  proposal: MemoryProposal;
  status: "APPROVED" | "PENDING";
  effectiveTtlDays: number;
  scrubbedContent: string;
};

export function decideMemoryProposal(
  proposal: MemoryProposal,
  policy: MemoryPolicySettings
): MemoryProposalDecision | null {
  const scope = proposal.scope === "lead" || proposal.scope === "workspace" ? proposal.scope : null;
  if (!scope) return null;

  const category = String(proposal.category || "").trim();
  if (!category || category.length > 64) return null;

  const rawContent = String(proposal.content || "").trim();
  if (!rawContent) return null;
  if (rawContent.length > 500) return null;

  const { content: scrubbedContent } = scrubMemoryProposalContent(rawContent);
  if (!scrubbedContent.trim()) return null;

  const ttlDaysRaw = normalizePositiveInt(proposal.ttlDays, 1);
  const confidence = clamp01(Number(proposal.confidence));
  const effectiveTtlDays = Math.min(ttlDaysRaw, Math.max(1, Math.trunc(policy.ttlCapDays)));

  const allowlisted = policy.allowlistCategories.includes(category);
  const eligible =
    allowlisted && confidence >= policy.minConfidence && ttlDaysRaw >= policy.minTtlDays;

  return {
    proposal: { scope, category, content: rawContent, ttlDays: ttlDaysRaw, confidence },
    status: eligible ? "APPROVED" : "PENDING",
    effectiveTtlDays,
    scrubbedContent,
  };
}

