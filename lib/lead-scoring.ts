import "server-only";

import "@/lib/server-dns";
import { BackgroundJobType } from "@prisma/client";
import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import { buildSentimentTranscriptFromMessages } from "@/lib/sentiment";

// ============================================================================
// LEAD SCORING TYPES
// ============================================================================

export interface LeadScore {
  fitScore: number; // 1-4 (lower is worse)
  intentScore: number; // 1-4 (lower is worse)
  overallScore: number; // 1-4 (overall priority)
  reasoning: string;
}

export interface LeadScoringContext {
  serviceDescription?: string | null;
  qualificationQuestions?: string | null;
  idealCustomerProfile?: string | null;
  companyName?: string | null;
}

type ScoringMessage = {
  sentAt: Date | string;
  channel?: string | null;
  direction: "inbound" | "outbound" | string;
  body: string;
  subject?: string | null;
};

// ============================================================================
// DISQUALIFICATION CHECK (no AI call)
// ============================================================================

const DISQUALIFIED_SENTIMENT_TAGS = new Set([
  "Blacklist",
  "Opt Out",
  "Opted Out",
  "Unsubscribe",
  "Unsubscribed",
  "Bounced",
  "Bounce",
]);

/** Check if a lead should be automatically disqualified without AI. */
export function isLeadDisqualified(sentimentTag: string | null | undefined): boolean {
  if (!sentimentTag) return false;
  return DISQUALIFIED_SENTIMENT_TAGS.has(sentimentTag);
}

// ============================================================================
// SCORING PROMPT
// ============================================================================

const LEAD_SCORING_SYSTEM_PROMPT = `You are an expert lead qualification analyst. Evaluate the conversation to determine how well the lead fits the client's ideal customer profile (Fit) and how ready they are to take action (Intent).

## Scoring Criteria

### Fit Score (Is this person a match for the client?)
- **1:** Clearly not a fit (wrong industry, wrong role, explicitly disqualified, cannot use the service)
- **2:** Uncertain fit (limited information, ambiguous signals, unclear if they match ICP)
- **3:** Good fit (matches ICP, relevant need/role, could benefit from service)
- **4:** Ideal fit (perfect match, high-value prospect, explicitly matches all ICP criteria)

### Intent Score (How ready are they to take action?)
- **1:** No intent (unresponsive after multiple touches, explicit hard rejection, hostile)
- **2:** Low intent (engaged but noncommittal, just exploring, timing is bad, "not right now")
- **3:** Moderate intent (interested, asking questions, considering, comparing options)
- **4:** High intent (ready to book, asking for next steps, urgency signals, pricing questions)

### Overall Score
Combine fit and intent into a single 1-4 score representing overall lead quality:
- **1:** Not worth pursuing (poor fit OR hard rejection)
- **2:** Low priority (uncertain fit + low intent, or good fit but cold)
- **3:** Medium priority (good fit + some intent, or great fit but needs nurturing)
- **4:** High priority (great fit + high intent - best leads to focus on)

## Rules
- Base your assessment ONLY on the conversation transcript and lead metadata provided.
- If there's limited information, bias toward lower scores (don't assume the best).
- Consider the ENTIRE conversation, not just the most recent message.
- Look for explicit signals over implicit ones.
- Be concise but specific in your reasoning (max 2-3 sentences).

## Output
Return ONLY valid JSON with this exact structure:
{
  "fitScore": <1-4>,
  "intentScore": <1-4>,
  "overallScore": <1-4>,
  "reasoning": "<brief explanation>"
}`;

function buildScoringUserPrompt(opts: {
  transcript: string;
  context: LeadScoringContext;
  leadMetadata?: {
    companyName?: string | null;
    industry?: string | null;
    employeeHeadcount?: string | null;
  };
}): string {
  const parts: string[] = [];

  // Workspace context
  if (opts.context.idealCustomerProfile?.trim()) {
    parts.push(`## Ideal Customer Profile (ICP)\n${opts.context.idealCustomerProfile.trim()}`);
  }

  if (opts.context.serviceDescription?.trim()) {
    parts.push(`## Service/Product Description\n${opts.context.serviceDescription.trim()}`);
  }

  if (opts.context.qualificationQuestions?.trim()) {
    try {
      const questions = JSON.parse(opts.context.qualificationQuestions);
      if (Array.isArray(questions) && questions.length > 0) {
        parts.push(`## Qualification Questions\n${questions.map((q: string, i: number) => `${i + 1}. ${q}`).join("\n")}`);
      }
    } catch {
      // Not valid JSON, use as-is
      parts.push(`## Qualification Questions\n${opts.context.qualificationQuestions.trim()}`);
    }
  }

  // Lead metadata
  const meta = opts.leadMetadata;
  if (meta?.companyName || meta?.industry || meta?.employeeHeadcount) {
    const metaParts: string[] = [];
    if (meta.companyName) metaParts.push(`Company: ${meta.companyName}`);
    if (meta.industry) metaParts.push(`Industry: ${meta.industry}`);
    if (meta.employeeHeadcount) metaParts.push(`Employee Count: ${meta.employeeHeadcount}`);
    parts.push(`## Lead Metadata\n${metaParts.join("\n")}`);
  }

  // Conversation transcript
  parts.push(`## Conversation Transcript\n${opts.transcript}`);

  // Task
  parts.push(`## Task\nAnalyze this conversation and provide fit, intent, and overall scores (1-4) with brief reasoning.`);

  return parts.join("\n\n");
}

// ============================================================================
// CORE SCORING FUNCTION
// ============================================================================

/**
 * Score a lead based on conversation messages.
 * Returns null if there's insufficient data to score (no inbound messages).
 */
export async function scoreLeadFromConversation(
  messages: ScoringMessage[],
  opts: {
    clientId: string;
    leadId?: string | null;
    context?: LeadScoringContext;
    leadMetadata?: {
      companyName?: string | null;
      industry?: string | null;
      employeeHeadcount?: string | null;
    };
    maxRetries?: number;
  }
): Promise<LeadScore | null> {
  // Check for inbound messages - can't score without lead responses
  const hasInbound = messages.some((m) => m.direction === "inbound");
  if (!hasInbound) {
    return null;
  }

  // Build transcript
  const transcript = buildSentimentTranscriptFromMessages(messages);
  if (!transcript.trim()) {
    return null;
  }

  // Truncate very long transcripts (keep most recent)
  const maxTranscriptChars = 24_000;
  const truncatedTranscript =
    transcript.length > maxTranscriptChars
      ? `...[earlier messages truncated]...\n\n${transcript.slice(-maxTranscriptChars)}`
      : transcript;

  const maxRetries = opts.maxRetries ?? 3;
  const model = "gpt-5-nano";

  const userPrompt = buildScoringUserPrompt({
    transcript: truncatedTranscript,
    context: opts.context || {},
    leadMetadata: opts.leadMetadata,
  });

  const baseBudget = await computeAdaptiveMaxOutputTokens({
    model,
    instructions: LEAD_SCORING_SYSTEM_PROMPT,
    input: [{ role: "user", content: userPrompt }] as const,
    min: 400, // Increased from 256 to prevent truncation
    max: 1000, // Increased from 800
    overheadTokens: 128,
    outputScale: 0.1,
    preferApiCount: true,
  });

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      fitScore: { type: "integer", minimum: 1, maximum: 4 },
      intentScore: { type: "integer", minimum: 1, maximum: 4 },
      overallScore: { type: "integer", minimum: 1, maximum: 4 },
      reasoning: { type: "string" },
    },
    required: ["fitScore", "intentScore", "overallScore", "reasoning"],
  } as const;

  const timeoutMs = Math.max(5_000, Number.parseInt(process.env.OPENAI_LEAD_SCORING_TIMEOUT_MS || "20000", 10) || 20_000);
  const attempts = Array.from({ length: Math.max(1, maxRetries) }, (_, attemptIndex) =>
    Math.min(baseBudget.maxOutputTokens + attemptIndex * 250, 1500)
  );

  const result = await runStructuredJsonPrompt<LeadScore>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "lead_scoring.score",
    promptKey: "lead_scoring.score.v1",
    model,
    reasoningEffort: "low",
    systemFallback: LEAD_SCORING_SYSTEM_PROMPT,
    input: [{ role: "user", content: userPrompt }] as const,
    schemaName: "lead_score",
    strict: true,
    schema,
    attempts,
    budget: {
      min: 400,
      max: 1000,
    },
    timeoutMs: timeoutMs + Math.max(0, maxRetries - 1) * 5_000,
    maxRetries: 0,
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
      const fitScore = anyValue.fitScore;
      const intentScore = anyValue.intentScore;
      const overallScore = anyValue.overallScore;
      const reasoning = anyValue.reasoning;
      if (typeof fitScore !== "number" || typeof intentScore !== "number" || typeof overallScore !== "number") {
        return { success: false, error: "scores must be numbers" };
      }
      if (typeof reasoning !== "string") {
        return { success: false, error: "reasoning must be string" };
      }
      return { success: true, data: { fitScore, intentScore, overallScore, reasoning } };
    },
  });

  if (!result.success) {
    const parseLike = result.error.category === "parse_error" || result.error.category === "schema_violation" || result.error.category === "incomplete_output";
    if (parseLike) {
      return null;
    }

    const err = new Error(result.error.message);
    (err as unknown as { retryable?: boolean }).retryable = Boolean(result.error.retryable);
    throw err;
  }

  const clamp = (n: number) => Math.max(1, Math.min(4, Math.round(n)));
  return {
    fitScore: clamp(result.data.fitScore),
    intentScore: clamp(result.data.intentScore),
    overallScore: clamp(result.data.overallScore),
    reasoning: String(result.data.reasoning || "").slice(0, 500),
  };
}

// ============================================================================
// LEAD SCORING RUNNER (FULL PIPELINE)
// ============================================================================

/**
 * Score a lead by ID, fetching messages and workspace context automatically.
 * Handles disqualification (Blacklist/opt-out) by setting score to 1 without AI.
 */
export async function scoreLead(leadId: string): Promise<{
  success: boolean;
  score: LeadScore | null;
  disqualified: boolean;
  error?: string;
  retryable?: boolean;
}> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        clientId: true,
        sentimentTag: true,
        companyName: true,
        industry: true,
        employeeHeadcount: true,
        client: {
          select: {
            settings: {
              select: {
                serviceDescription: true,
                qualificationQuestions: true,
                idealCustomerProfile: true,
                companyName: true,
              },
            },
          },
        },
      },
    });

    if (!lead) {
      return { success: false, score: null, disqualified: false, error: "Lead not found" };
    }

    // Check for disqualification
    if (isLeadDisqualified(lead.sentimentTag)) {
      // Set score to 1 without AI call
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          fitScore: 1,
          intentScore: 1,
          overallScore: 1,
          scoreReasoning: `Disqualified: ${lead.sentimentTag}`,
          scoredAt: new Date(),
        },
      });

      return {
        success: true,
        score: {
          fitScore: 1,
          intentScore: 1,
          overallScore: 1,
          reasoning: `Disqualified: ${lead.sentimentTag}`,
        },
        disqualified: true,
      };
    }

    // Fetch messages for scoring
    const messages = await prisma.message.findMany({
      where: { leadId },
      orderBy: { sentAt: "asc" },
      take: 60,
      select: {
        sentAt: true,
        channel: true,
        direction: true,
        body: true,
        subject: true,
      },
    });

    if (messages.length === 0) {
      return { success: true, score: null, disqualified: false };
    }

    // Score the lead
    const score = await scoreLeadFromConversation(messages, {
      clientId: lead.clientId,
      leadId: lead.id,
      context: {
        serviceDescription: lead.client.settings?.serviceDescription,
        qualificationQuestions: lead.client.settings?.qualificationQuestions,
        idealCustomerProfile: lead.client.settings?.idealCustomerProfile,
        companyName: lead.client.settings?.companyName,
      },
      leadMetadata: {
        companyName: lead.companyName,
        industry: lead.industry,
        employeeHeadcount: lead.employeeHeadcount,
      },
    });

    if (!score) {
      // No score returned (likely no inbound messages)
      return { success: true, score: null, disqualified: false };
    }

    // Update lead with scores
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        fitScore: score.fitScore,
        intentScore: score.intentScore,
        overallScore: score.overallScore,
        scoreReasoning: score.reasoning,
        scoredAt: new Date(),
      },
    });

    return { success: true, score, disqualified: false };
  } catch (error) {
    console.error(`[Lead Scoring] Failed to score lead ${leadId}:`, error);
    return {
      success: false,
      score: null,
      disqualified: false,
      error: error instanceof Error ? error.message : "Unknown error",
      retryable:
        typeof (error as { retryable?: unknown } | null)?.retryable === "boolean"
          ? Boolean((error as { retryable?: boolean }).retryable)
          : undefined,
    };
  }
}

// ============================================================================
// BACKGROUND JOB ENQUEUE
// ============================================================================

/**
 * Enqueue a lead scoring background job.
 * Uses dedupe key to prevent duplicate jobs for the same lead/message.
 */
export async function enqueueLeadScoringJob(opts: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<{ enqueued: boolean; jobId?: string }> {
  const dedupeKey = `lead_scoring:${opts.leadId}:${opts.messageId}`;

  try {
    const job = await prisma.backgroundJob.create({
      data: {
        type: BackgroundJobType.LEAD_SCORING_POST_PROCESS,
        clientId: opts.clientId,
        leadId: opts.leadId,
        messageId: opts.messageId,
        dedupeKey,
        maxAttempts: 3,
      },
      select: { id: true },
    });

    return { enqueued: true, jobId: job.id };
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      return { enqueued: false };
    }
    throw error;
  }
}
