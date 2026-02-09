export type MemoryProposalScope = "lead" | "workspace";

export type MemoryProposal = {
  scope: MemoryProposalScope;
  category: string;
  content: string;
  ttlDays: number;
  confidence: number;
};

export type MemoryPolicySettings = {
  allowlistCategories: string[];
  minConfidence: number;
  minTtlDays: number;
  ttlCapDays: number;
};

export const DEFAULT_MEMORY_POLICY: MemoryPolicySettings = {
  allowlistCategories: ["timezone_preference", "scheduling_preference", "communication_preference", "availability_pattern"],
  minConfidence: 0.7,
  minTtlDays: 1,
  ttlCapDays: 90,
};

