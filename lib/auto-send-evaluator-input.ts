import "server-only";

import { PRIMARY_WEBSITE_ASSET_NAME, buildKnowledgeContextFromAssets, type KnowledgeAssetForContext } from "@/lib/knowledge-asset-context";
import { estimateTokensFromText, truncateTextToTokenEstimate } from "@/lib/ai/token-estimate";

export type AutoSendEvaluatorWorkspaceContext = {
  serviceDescription: string | null;
  goals: string | null;
  knowledgeAssets: KnowledgeAssetForContext[];
  leadPhoneOnFile?: boolean;
};

export type AutoSendEvaluatorInputBuildResult = {
  inputJson: string;
  stats: {
    conversationHistory: { tokensEstimated: number; truncated: boolean };
    latestInbound: { tokensEstimated: number };
    draft: { tokensEstimated: number };
    leadMemoryContext: { tokensEstimated: number };
    serviceDescription: { tokensEstimated: number; truncated: boolean };
    goals: { tokensEstimated: number; truncated: boolean };
    knowledgeContext: { tokensEstimated: number; truncatedAssets: number; totalAssets: number; includedAssets: number };
    pricingCadence: { hasMismatch: boolean; mismatchCount: number; verifiedCount: number; draftCount: number };
    totalTokensEstimated: number;
  };
};

type PricingCadence = "monthly" | "annual" | "quarterly" | "unknown";
type PricingSignal = {
  amount: number;
  cadence: PricingCadence;
};

const DOLLAR_AMOUNT_REGEX = /\$\s*\d[\d,]*(?:\.\d{1,2})?/g;
const MONTHLY_CADENCE_REGEX = /\b(monthly|per\s+month|\/\s?(?:mo|month))\b/i;
const ANNUAL_CADENCE_REGEX = /\b(annual|annually|yearly|per\s+year|\/\s?(?:yr|year))\b/i;
const QUARTERLY_CADENCE_REGEX = /\b(quarterly|per\s+quarter|\/\s?(?:qtr|quarter))\b/i;
const NEGATED_MONTHLY_CADENCE_REGEX = /\b(no\s+monthly\s+(?:payment\s+)?plan|not\s+monthly|without\s+monthly)\b/i;
const THRESHOLD_NEARBY_REGEX = /\b(revenue|arr|mrr|raised|raise|funding|valuation|gmv|run[\s-]?rate)\b/i;

function parseDollarAmountToNumber(token: string): number | null {
  const normalized = token.replace(/^\$/, "").replace(/[,\s]/g, "");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function inferPricingCadence(nearby: string): PricingCadence {
  if (QUARTERLY_CADENCE_REGEX.test(nearby)) return "quarterly";
  if (ANNUAL_CADENCE_REGEX.test(nearby)) return "annual";
  if (MONTHLY_CADENCE_REGEX.test(nearby) && !NEGATED_MONTHLY_CADENCE_REGEX.test(nearby)) return "monthly";
  return "unknown";
}

function extractPricingSignals(text: string): PricingSignal[] {
  if (!text || !text.trim()) return [];
  const signals: PricingSignal[] = [];
  for (const match of text.matchAll(DOLLAR_AMOUNT_REGEX)) {
    const raw = match[0];
    const index = match.index ?? -1;
    if (index < 0) continue;

    const nearby = text.slice(Math.max(0, index - 80), Math.min(text.length, index + raw.length + 80));
    if (THRESHOLD_NEARBY_REGEX.test(nearby)) continue;

    const amount = parseDollarAmountToNumber(raw);
    if (amount === null) continue;
    signals.push({ amount, cadence: inferPricingCadence(nearby) });
  }
  return signals;
}

function buildPricingCadenceMap(signals: PricingSignal[]): Map<number, Set<PricingCadence>> {
  const map = new Map<number, Set<PricingCadence>>();
  for (const signal of signals) {
    const existing = map.get(signal.amount) ?? new Set<PricingCadence>();
    existing.add(signal.cadence);
    map.set(signal.amount, existing);
  }
  return map;
}

function resolvePricingCadenceMismatches(opts: {
  draftSignals: PricingSignal[];
  serviceSignals: PricingSignal[];
  knowledgeSignals: PricingSignal[];
}): Array<{ amount: number; draftCadence: PricingCadence; expectedCadence: PricingCadence[]; source: "service_description" | "knowledge_context" }> {
  const mismatches: Array<{
    amount: number;
    draftCadence: PricingCadence;
    expectedCadence: PricingCadence[];
    source: "service_description" | "knowledge_context";
  }> = [];

  const serviceMap = buildPricingCadenceMap(opts.serviceSignals);
  const knowledgeMap = buildPricingCadenceMap(opts.knowledgeSignals);

  for (const draftSignal of opts.draftSignals) {
    if (draftSignal.cadence === "unknown") continue;

    const sourceCadences = serviceMap.get(draftSignal.amount);
    const source = sourceCadences ? "service_description" : "knowledge_context";
    const fallbackCadences = sourceCadences ?? knowledgeMap.get(draftSignal.amount);
    if (!fallbackCadences) continue;

    const knownExpected = Array.from(fallbackCadences).filter((cadence) => cadence !== "unknown");
    if (knownExpected.length === 0) continue;
    if (knownExpected.includes(draftSignal.cadence)) continue;

    mismatches.push({
      amount: draftSignal.amount,
      draftCadence: draftSignal.cadence,
      expectedCadence: knownExpected,
      source,
    });
  }

  return mismatches;
}

export function buildAutoSendEvaluatorInput(params: {
  channel: "email" | "sms" | "linkedin";
  subject: string | null;
  latestInbound: string;
  conversationHistory: string;
  categorization: string | null;
  automatedReply: boolean | null;
  replyReceivedAtIso: string | null;
  draft: string;
  leadMemoryContext?: string | null;
  workspaceContext: AutoSendEvaluatorWorkspaceContext;
  budgets?: {
    conversationHistoryTokens?: number;
    serviceDescriptionTokens?: number;
    goalsTokens?: number;
    knowledgeContextTokens?: number;
    knowledgeAssetTokens?: number;
  };
  leadPhoneOnFile?: boolean;
  actionSignalCallRequested?: boolean;
  actionSignalExternalCalendar?: boolean;
  actionSignalRouteSummary?: string | null;
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
    assets: params.workspaceContext.knowledgeAssets.filter(
      (asset) => (asset.name || "").trim().toLowerCase() !== PRIMARY_WEBSITE_ASSET_NAME.toLowerCase()
    ),
    maxTokens: knowledgeContextMaxTokens,
    maxAssetTokens: knowledgeAssetMaxTokens,
  });

  const leadMemoryContext = (params.leadMemoryContext || "").trim();
  const serviceSignals = extractPricingSignals(serviceDescription.text);
  const knowledgeSignals = extractPricingSignals(knowledge.context);
  const draftSignals = extractPricingSignals((params.draft || "").trim());
  const pricingCadenceMismatches = resolvePricingCadenceMismatches({
    draftSignals,
    serviceSignals,
    knowledgeSignals,
  });

  const actionSignalCallRequested = Boolean(params.actionSignalCallRequested);
  const actionSignalExternalCalendar = Boolean(params.actionSignalExternalCalendar);
  const actionSignalRouteSummary = (params.actionSignalRouteSummary || "").trim();

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
    lead_memory_context: leadMemoryContext || null,
    lead_phone_on_file: Boolean(params.leadPhoneOnFile),
    action_signal_call_requested: actionSignalCallRequested,
    action_signal_external_calendar: actionSignalExternalCalendar,
    action_signal_route_summary: actionSignalRouteSummary || null,
    pricing_terms_verified: {
      source_precedence: "service_description_first",
      service_description: serviceSignals,
      knowledge_context: knowledgeSignals,
    },
    pricing_terms_draft: draftSignals,
    pricing_terms_mismatch: {
      has_mismatch: pricingCadenceMismatches.length > 0,
      mismatches: pricingCadenceMismatches,
    },

    // Instruction hint (kept in payload so we don't have to bump system prompt versions and break overrides).
    verified_context_instructions:
      "Treat service_description, goals, and knowledge_context as verified workspace context. " +
      "Do NOT claim missing context if a fact (e.g., pricing) is present there. " +
      "If pricing cadence conflicts with verified context (for example monthly wording when context says quarterly billing), require human review. " +
      "If the draft claims something not supported by thread + verified context, require human review.",
  };

  const latestInboundTokensEstimated = estimateTokensFromText(payload.latest_inbound);
  const draftTokensEstimated = estimateTokensFromText(payload.draft_reply);
  const leadMemoryTokensEstimated = leadMemoryContext ? estimateTokensFromText(leadMemoryContext) : 0;

  const totalTokensEstimated = estimateTokensFromText(JSON.stringify(payload));

  return {
    inputJson: JSON.stringify(payload, null, 2),
    stats: {
      conversationHistory: { tokensEstimated: conversationHistory.tokensEstimated, truncated: conversationHistory.truncated },
      latestInbound: { tokensEstimated: latestInboundTokensEstimated },
      draft: { tokensEstimated: draftTokensEstimated },
      leadMemoryContext: { tokensEstimated: leadMemoryTokensEstimated },
      serviceDescription: { tokensEstimated: serviceDescription.tokensEstimated, truncated: serviceDescription.truncated },
      goals: { tokensEstimated: goals.tokensEstimated, truncated: goals.truncated },
      knowledgeContext: {
        tokensEstimated: estimateTokensFromText(knowledge.context),
        truncatedAssets: knowledge.stats.truncatedAssets,
        totalAssets: knowledge.stats.totalAssets,
        includedAssets: knowledge.stats.includedAssets,
      },
      pricingCadence: {
        hasMismatch: pricingCadenceMismatches.length > 0,
        mismatchCount: pricingCadenceMismatches.length,
        verifiedCount: serviceSignals.length + knowledgeSignals.length,
        draftCount: draftSignals.length,
      },
      totalTokensEstimated,
    },
  };
}
