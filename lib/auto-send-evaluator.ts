import "@/lib/server-dns";
import { prisma } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { isOptOutText } from "@/lib/sentiment";
import { buildAutoSendEvaluatorInput, type AutoSendEvaluatorWorkspaceContext } from "@/lib/auto-send-evaluator-input";
import {
  buildLeadContextBundle,
  buildLeadContextBundleTelemetryMetadata,
  isLeadContextBundleGloballyDisabled,
} from "@/lib/lead-context-bundle";

export type AutoSendEvaluation = {
  confidence: number;
  safeToSend: boolean;
  requiresHumanReview: boolean;
  reason: string;
  source?: "hard_block" | "model";
  hardBlockCode?:
    | "empty_draft"
    | "opt_out"
    | "blacklist"
    | "automated_reply"
    | "missing_openai_key"
    | "other";
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function interpretAutoSendEvaluatorOutput(value: {
  safe_to_send: boolean;
  requires_human_review: boolean;
  confidence: number;
  reason: string;
}): AutoSendEvaluation {
  const confidence = clamp01(Number(value.confidence));
  const requiresHumanReviewFlag = Boolean(value.requires_human_review);
  const safeToSend = Boolean(value.safe_to_send) && !requiresHumanReviewFlag && confidence >= 0.01;
  const requiresHumanReview = requiresHumanReviewFlag || !safeToSend;

  return {
    confidence,
    safeToSend,
    requiresHumanReview,
    reason: String(value.reason || "").slice(0, 320) || "No reason provided",
    source: "model",
  };
}

async function loadAutoSendWorkspaceContext(opts: {
  clientId: string;
  leadId?: string | null;
}): Promise<AutoSendEvaluatorWorkspaceContext> {
  const empty: AutoSendEvaluatorWorkspaceContext = {
    serviceDescription: null,
    goals: null,
    knowledgeAssets: [],
  };

  const leadId = typeof opts.leadId === "string" && opts.leadId.trim() ? opts.leadId.trim() : null;

  const lead = leadId
    ? await prisma.lead
        .findUnique({
          where: { id: leadId },
          select: {
            id: true,
            clientId: true,
            client: {
              select: {
                name: true,
                aiPersonas: {
                  where: { isDefault: true },
                  take: 1,
                  select: {
                    goals: true,
                    serviceDescription: true,
                  },
                },
                settings: {
                  select: {
                    aiGoals: true,
                    serviceDescription: true,
                    knowledgeAssets: {
                      orderBy: { updatedAt: "desc" },
                      select: {
                        name: true,
                        type: true,
                        originalFileName: true,
                        mimeType: true,
                        textContent: true,
                        updatedAt: true,
                      },
                    },
                  },
                },
              },
            },
            emailCampaign: {
              select: {
                aiPersona: {
                  select: {
                    goals: true,
                    serviceDescription: true,
                  },
                },
              },
            },
          },
        })
        .catch(() => null)
    : null;

  if (lead?.clientId && lead.clientId !== opts.clientId) {
    console.warn("[AutoSendEvaluator] leadId/clientId mismatch; skipping workspace context load", {
      clientId: opts.clientId,
      leadClientId: lead.clientId,
      leadId,
    });
    return empty;
  }

  const client =
    lead?.client ??
    (await prisma.client
      .findUnique({
        where: { id: opts.clientId },
        select: {
          name: true,
          aiPersonas: {
            where: { isDefault: true },
            take: 1,
            select: {
              goals: true,
              serviceDescription: true,
            },
          },
          settings: {
            select: {
              aiGoals: true,
              serviceDescription: true,
              knowledgeAssets: {
                orderBy: { updatedAt: "desc" },
                select: {
                  name: true,
                  type: true,
                  originalFileName: true,
                  mimeType: true,
                  textContent: true,
                  updatedAt: true,
                },
              },
            },
          },
        },
      })
      .catch(() => null));

  const settings = client?.settings ?? null;
  const knowledgeAssets = settings?.knowledgeAssets ?? [];

  const campaignPersona = lead?.emailCampaign?.aiPersona ?? null;
  const defaultPersona = client?.aiPersonas?.[0] ?? null;

  const serviceDescription =
    (campaignPersona?.serviceDescription || "").trim() ||
    (defaultPersona?.serviceDescription || "").trim() ||
    (settings?.serviceDescription || "").trim() ||
    null;

  const goals =
    (campaignPersona?.goals || "").trim() ||
    (defaultPersona?.goals || "").trim() ||
    (settings?.aiGoals || "").trim() ||
    null;

  return {
    serviceDescription,
    goals,
    knowledgeAssets: knowledgeAssets.map((a) => ({
      name: a.name,
      type: a.type,
      originalFileName: a.originalFileName,
      mimeType: a.mimeType,
      textContent: a.textContent,
      updatedAt: a.updatedAt,
    })),
  };
}

export async function evaluateAutoSend(opts: {
  clientId: string;
  leadId?: string | null;
  channel: "email" | "sms" | "linkedin";
  latestInbound: string;
  subject?: string | null;
  conversationHistory: string;
  categorization: string | null;
  automatedReply?: boolean | null;
  replyReceivedAt?: string | Date | null;
  draft: string;
}): Promise<AutoSendEvaluation> {
  const latestInbound = (opts.latestInbound || "").trim();
  const subject = (opts.subject || "").trim();
  const categorization = (opts.categorization || "").trim();
  const draft = (opts.draft || "").trim();

  if (!draft) {
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Draft is empty",
      source: "hard_block",
      hardBlockCode: "empty_draft",
    };
  }

  // Hard safety: never auto-send to opt-outs.
  if (isOptOutText(`Subject: ${subject} | ${latestInbound}`)) {
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Opt-out/unsubscribe request detected",
      source: "hard_block",
      hardBlockCode: "opt_out",
    };
  }

  if (categorization === "Blacklist" || categorization === "Automated Reply") {
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: `Categorized as ${categorization}`,
      source: "hard_block",
      hardBlockCode: categorization === "Automated Reply" ? "automated_reply" : "blacklist",
    };
  }

  if (opts.automatedReply === true && categorization !== "Out of Office") {
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Provider flagged as automated reply",
      source: "hard_block",
      hardBlockCode: "automated_reply",
    };
  }

  // If AI isn't configured, default to safe behavior (no auto-send).
  if (!process.env.OPENAI_API_KEY) {
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "OPENAI_API_KEY not configured",
      source: "hard_block",
      hardBlockCode: "missing_openai_key",
    };
  }

  const workspaceContext = await loadAutoSendWorkspaceContext({
    clientId: opts.clientId,
    leadId: opts.leadId ?? null,
  });

  const settings = await prisma.workspaceSettings
    .findUnique({
      where: { clientId: opts.clientId },
      select: {
        clientId: true,
        serviceDescription: true,
        aiGoals: true,
        leadContextBundleEnabled: true,
        leadContextBundleBudgets: true,
      },
    })
    .catch(() => null);

  const leadContextBundleEnabled =
    Boolean(settings?.leadContextBundleEnabled) && !isLeadContextBundleGloballyDisabled();

  let leadMemoryContext: string | null = null;
  let promptMetadata: unknown = undefined;

  if (leadContextBundleEnabled && opts.leadId) {
    try {
      const bundle = await buildLeadContextBundle({
        clientId: opts.clientId,
        leadId: opts.leadId,
        profile: "auto_send_evaluator",
        timeoutMs: 500,
        settings,
        knowledgeAssets: workspaceContext.knowledgeAssets,
        serviceDescription: workspaceContext.serviceDescription,
        goals: workspaceContext.goals,
      });

      leadMemoryContext = bundle.leadMemoryContext;
      promptMetadata = buildLeadContextBundleTelemetryMetadata(bundle);
    } catch (error) {
      console.warn("[AutoSendEvaluator] LeadContextBundle build failed; continuing without lead memory context", {
        clientId: opts.clientId,
        leadId: opts.leadId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const receivedAt =
    typeof opts.replyReceivedAt === "string"
      ? opts.replyReceivedAt
      : opts.replyReceivedAt instanceof Date
        ? opts.replyReceivedAt.toISOString()
        : "";

  const systemFallback = `Return ONLY valid JSON:
{
  "safe_to_send": true|false,
  "requires_human_review": true|false,
  "confidence": number,
  "reason": "string"
}`;

  const inputBuild = buildAutoSendEvaluatorInput({
    channel: opts.channel,
    subject: subject || null,
    latestInbound,
    conversationHistory: opts.conversationHistory || "",
    categorization: categorization || null,
    automatedReply: opts.automatedReply ?? null,
    replyReceivedAtIso: receivedAt || null,
    draft,
    leadMemoryContext,
    workspaceContext,
  });

  const timeoutMs = Math.max(
    5_000,
    Number.parseInt(process.env.OPENAI_AUTO_SEND_EVALUATOR_TIMEOUT_MS || "20000", 10) || 20_000
  );

  const result = await runStructuredJsonPrompt<{
    safe_to_send: boolean;
    requires_human_review: boolean;
    confidence: number;
    reason: string;
  }>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "auto_send.evaluate",
    promptKey: "auto_send.evaluate.v1",
    metadata: promptMetadata,
    model: "gpt-5-mini",
    reasoningEffort: "low",
    systemFallback,
    templateVars: { inputJson: inputBuild.inputJson },
    schemaName: "auto_send_evaluator",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        safe_to_send: { type: "boolean" },
        requires_human_review: { type: "boolean" },
        confidence: { type: "number" },
        reason: { type: "string" },
      },
      required: ["safe_to_send", "requires_human_review", "confidence", "reason"],
    },
    budget: {
      min: 256,
      max: 1600,
      retryMax: 2400,
      overheadTokens: 384,
      outputScale: 0.22,
      preferApiCount: true,
    },
    timeoutMs,
    maxRetries: 0,
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
      if (typeof anyValue.safe_to_send !== "boolean") return { success: false, error: "safe_to_send must be boolean" };
      if (typeof anyValue.requires_human_review !== "boolean") return { success: false, error: "requires_human_review must be boolean" };
      if (typeof anyValue.confidence !== "number" || !Number.isFinite(anyValue.confidence)) return { success: false, error: "confidence must be number" };
      if (typeof anyValue.reason !== "string") return { success: false, error: "reason must be string" };
      return {
        success: true,
        data: {
          safe_to_send: anyValue.safe_to_send,
          requires_human_review: anyValue.requires_human_review,
          confidence: anyValue.confidence,
          reason: anyValue.reason,
        },
      };
    },
  });

  if (!result.success) {
    if (result.error.category === "timeout" || result.error.category === "rate_limit" || result.error.category === "api_error") {
      console.error("[AutoSendEvaluator] Failed:", result.error.message);
      return {
        confidence: 0,
        safeToSend: false,
        requiresHumanReview: true,
        reason: "Evaluation error",
        source: "hard_block",
        hardBlockCode: "other",
      };
    }
    return {
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "No evaluation returned",
      source: "hard_block",
      hardBlockCode: "other",
    };
  }

  return interpretAutoSendEvaluatorOutput(result.data);
}
