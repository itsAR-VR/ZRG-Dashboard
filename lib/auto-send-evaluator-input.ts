import "server-only";

import { buildKnowledgeContextFromAssets, type KnowledgeAssetForContext } from "@/lib/knowledge-asset-context";
import { estimateTokensFromText, truncateTextToTokenEstimate } from "@/lib/ai/token-estimate";

export type AutoSendEvaluatorWorkspaceContext = {
  serviceDescription: string | null;
  goals: string | null;
  knowledgeAssets: KnowledgeAssetForContext[];
};

export type AutoSendEvaluatorInputBuildResult = {
  inputJson: string;
  stats: {
    conversationHistory: { tokensEstimated: number; truncated: boolean };
    latestInbound: { tokensEstimated: number };
    draft: { tokensEstimated: number };
    serviceDescription: { tokensEstimated: number; truncated: boolean };
    goals: { tokensEstimated: number; truncated: boolean };
    knowledgeContext: { tokensEstimated: number; truncatedAssets: number; totalAssets: number; includedAssets: number };
    totalTokensEstimated: number;
  };
};

export function buildAutoSendEvaluatorInput(params: {
  channel: "email" | "sms" | "linkedin";
  subject: string | null;
  latestInbound: string;
  conversationHistory: string;
  categorization: string | null;
  automatedReply: boolean | null;
  replyReceivedAtIso: string | null;
  draft: string;
  workspaceContext: AutoSendEvaluatorWorkspaceContext;
  budgets?: {
    conversationHistoryTokens?: number;
    serviceDescriptionTokens?: number;
    goalsTokens?: number;
    knowledgeContextTokens?: number;
    knowledgeAssetTokens?: number;
  };
}): AutoSendEvaluatorInputBuildResult {
  const budgets = params.budgets ?? {};

  const conversationHistoryMaxTokens =
    typeof budgets.conversationHistoryTokens === "number" && Number.isFinite(budgets.conversationHistoryTokens)
      ? Math.max(0, Math.trunc(budgets.conversationHistoryTokens))
      : 4500;

  const serviceDescriptionMaxTokens =
    typeof budgets.serviceDescriptionTokens === "number" && Number.isFinite(budgets.serviceDescriptionTokens)
      ? Math.max(0, Math.trunc(budgets.serviceDescriptionTokens))
      : 1200;

  const goalsMaxTokens =
    typeof budgets.goalsTokens === "number" && Number.isFinite(budgets.goalsTokens)
      ? Math.max(0, Math.trunc(budgets.goalsTokens))
      : 900;

  const knowledgeContextMaxTokens =
    typeof budgets.knowledgeContextTokens === "number" && Number.isFinite(budgets.knowledgeContextTokens)
      ? Math.max(0, Math.trunc(budgets.knowledgeContextTokens))
      : 8000;

  const knowledgeAssetMaxTokens =
    typeof budgets.knowledgeAssetTokens === "number" && Number.isFinite(budgets.knowledgeAssetTokens)
      ? Math.max(0, Math.trunc(budgets.knowledgeAssetTokens))
      : 1600;

  const conversationHistory = truncateTextToTokenEstimate(params.conversationHistory || "", conversationHistoryMaxTokens, { keep: "end" });
  const serviceDescription = truncateTextToTokenEstimate((params.workspaceContext.serviceDescription || "").trim(), serviceDescriptionMaxTokens);
  const goals = truncateTextToTokenEstimate((params.workspaceContext.goals || "").trim(), goalsMaxTokens);

  const knowledge = buildKnowledgeContextFromAssets({
    assets: params.workspaceContext.knowledgeAssets,
    maxTokens: knowledgeContextMaxTokens,
    maxAssetTokens: knowledgeAssetMaxTokens,
  });

  const payload = {
    channel: params.channel,
    subject: (params.subject || "").trim() || null,
    latest_inbound: (params.latestInbound || "").trim(),
    conversation_history: conversationHistory.text.trim(),
    reply_categorization: (params.categorization || "").trim() || null,
    automated_reply: params.automatedReply ?? null,
    reply_received_at: params.replyReceivedAtIso || null,
    draft_reply: (params.draft || "").trim(),

    // Verified workspace context (AI Personality + Knowledge Assets).
    // This is the ONLY "source of truth" for pricing/service claims beyond the thread itself.
    service_description: serviceDescription.text.trim() || null,
    goals: goals.text.trim() || null,
    knowledge_context: knowledge.context.trim() || null,

    // Instruction hint (kept in payload so we don't have to bump system prompt versions and break overrides).
    verified_context_instructions:
      "Treat service_description, goals, and knowledge_context as verified workspace context. " +
      "Do NOT claim missing context if a fact (e.g., pricing) is present there. " +
      "If the draft claims something not supported by thread + verified context, require human review.",
  };

  const latestInboundTokensEstimated = estimateTokensFromText(payload.latest_inbound);
  const draftTokensEstimated = estimateTokensFromText(payload.draft_reply);

  const totalTokensEstimated = estimateTokensFromText(JSON.stringify(payload));

  return {
    inputJson: JSON.stringify(payload, null, 2),
    stats: {
      conversationHistory: { tokensEstimated: conversationHistory.tokensEstimated, truncated: conversationHistory.truncated },
      latestInbound: { tokensEstimated: latestInboundTokensEstimated },
      draft: { tokensEstimated: draftTokensEstimated },
      serviceDescription: { tokensEstimated: serviceDescription.tokensEstimated, truncated: serviceDescription.truncated },
      goals: { tokensEstimated: goals.tokensEstimated, truncated: goals.truncated },
      knowledgeContext: {
        tokensEstimated: estimateTokensFromText(knowledge.context),
        truncatedAssets: knowledge.stats.truncatedAssets,
        totalAssets: knowledge.stats.totalAssets,
        includedAssets: knowledge.stats.includedAssets,
      },
      totalTokensEstimated,
    },
  };
}
