import "server-only";

import { prisma } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { buildSentimentTranscriptFromMessages } from "@/lib/sentiment";
import { getLeadQualificationAnswerState, getWorkspaceQualificationQuestions } from "@/lib/qualification-answer-extraction";

export type BookingTarget = "with_questions" | "no_questions";

export function determineDeterministicBookingTarget(args: {
  requiredCount: number;
  hasAllRequiredAnswers: boolean;
  hasWithQuestionsTarget: boolean;
  hasNoQuestionsTarget: boolean;
}): { target: BookingTarget; needsNoQuestions: boolean; warning?: string } {
  const needsNoQuestions = args.requiredCount > 0 && !args.hasAllRequiredAnswers;

  if (needsNoQuestions) {
    // Critical invariant: when required answers are missing, we must use the no-questions booking target.
    // Even if it's not configured, returning "with_questions" would be contradictory and can cause
    // availability/booking target drift.
    return {
      target: "no_questions",
      needsNoQuestions,
      warning: args.hasNoQuestionsTarget ? undefined : "no_questions target not configured",
    };
  }

  if (args.hasWithQuestionsTarget) {
    return { target: "with_questions", needsNoQuestions };
  }

  if (args.hasNoQuestionsTarget) {
    return { target: "no_questions", needsNoQuestions, warning: "with_questions target not configured" };
  }

  // Nothing is configured; default to "with_questions" to keep downstream behavior stable.
  return { target: "with_questions", needsNoQuestions: false, warning: "no booking targets configured" };
}

function redactPotentialPii(value: string): string {
  return (
    (value || "")
      // emails
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
      // phone-ish sequences (very loose)
      .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]")
  );
}

function trimForModel(text: string, maxChars = 10_000): string {
  const cleaned = (text || "").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(cleaned.length - maxChars);
}

function coerceBookingTarget(value: unknown): BookingTarget | null {
  if (value === "with_questions" || value === "no_questions") return value;
  return null;
}

export async function selectBookingTargetForLead(opts: {
  clientId: string;
  leadId: string;
  timeoutMs?: number;
}): Promise<{ target: BookingTarget; source: "ai" | "deterministic_fallback"; reason?: string }> {
  const timeoutMs =
    typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs)
      ? Math.max(2_500, Math.trunc(opts.timeoutMs))
      : Math.max(2_500, Number.parseInt(process.env.OPENAI_BOOKING_TARGET_SELECTOR_TIMEOUT_MS || "9000", 10) || 9_000);

  const [settings, questions, answerState, messages] = await Promise.all([
    prisma.workspaceSettings.findUnique({
      where: { clientId: opts.clientId },
      select: {
        meetingBookingProvider: true,
        calendlyEventTypeLink: true,
        calendlyEventTypeUri: true,
        calendlyDirectBookEventTypeLink: true,
        calendlyDirectBookEventTypeUri: true,
        ghlDefaultCalendarId: true,
        ghlDirectBookCalendarId: true,
      },
    }),
    getWorkspaceQualificationQuestions(opts.clientId),
    getLeadQualificationAnswerState({ leadId: opts.leadId, clientId: opts.clientId }),
    prisma.message.findMany({
      where: { leadId: opts.leadId },
      orderBy: { sentAt: "desc" },
      take: 40,
      select: { sentAt: true, channel: true, direction: true, body: true, subject: true },
    }),
  ]);

  const provider = settings?.meetingBookingProvider ?? "GHL";

  const hasCalendlyWithQuestionsTarget = Boolean(
    (settings?.calendlyEventTypeLink || "").trim() || (settings?.calendlyEventTypeUri || "").trim()
  );
  const hasCalendlyNoQuestionsTarget = Boolean(
    (settings?.calendlyDirectBookEventTypeLink || "").trim() || (settings?.calendlyDirectBookEventTypeUri || "").trim()
  );

  const hasQuestionsTarget =
    provider === "CALENDLY"
      ? hasCalendlyWithQuestionsTarget
      : Boolean((settings?.ghlDefaultCalendarId || "").trim());

  const hasNoQuestionsTarget =
    provider === "CALENDLY"
      ? hasCalendlyNoQuestionsTarget
      : Boolean((settings?.ghlDirectBookCalendarId || "").trim());

  const requiredCount = answerState.requiredQuestionIds.length;
  const deterministic = determineDeterministicBookingTarget({
    requiredCount,
    hasAllRequiredAnswers: answerState.hasAllRequiredAnswers,
    hasWithQuestionsTarget: hasQuestionsTarget,
    hasNoQuestionsTarget,
  });

  // If AI isn't configured, default to deterministic behavior.
  if (!process.env.OPENAI_API_KEY) {
    const details = [deterministic.warning, "OPENAI_API_KEY not configured"].filter(Boolean).join("; ");
    return { target: deterministic.target, source: "deterministic_fallback", reason: details };
  }

  const transcript = trimForModel(redactPotentialPii(buildSentimentTranscriptFromMessages([...messages].reverse())), 8_000);

  const systemFallback = `You choose the booking target for direct booking.

Booking targets:
- with_questions: use the booking link/event type that has qualification questions.
- no_questions: use the booking link/event type with no qualification questions.

Rules:
- If ALL required qualification answers are present (or there are no required questions), choose with_questions (unless it is not configured, then choose no_questions if configured).
- If required qualification answers are missing, choose no_questions.
- If required qualification answers are missing and no_questions is not configured, still choose no_questions and explain the missing configuration in the reason.

Output MUST be valid JSON:
{ "target": "with_questions" | "no_questions", "reason": "short" }`;

  const input = [
    {
      role: "user" as const,
      content: JSON.stringify(
        {
          provider,
          targets_configured: {
            with_questions: hasQuestionsTarget,
            no_questions: hasNoQuestionsTarget,
          },
          qualification_questions: questions.map((q) => ({ id: q.id, question: q.question, required: q.required })),
          answer_state_summary: {
            required_question_ids: answerState.requiredQuestionIds,
            missing_required_question_ids: answerState.missingRequiredQuestionIds,
            has_all_required_answers: answerState.hasAllRequiredAnswers,
          },
          transcript,
        },
        null,
        2
      ),
    },
  ];

  const result = await runStructuredJsonPrompt<{ target: BookingTarget; reason: string }>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "booking.target_selector",
    promptKey: "booking.target_selector.v1",
    model: "gpt-5-nano",
    reasoningEffort: "low",
    systemFallback,
    input,
    schemaName: "booking_target_selector",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        target: { type: "string", enum: ["with_questions", "no_questions"] },
        reason: { type: "string" },
      },
      required: ["target", "reason"],
    },
    budget: {
      min: 96,
      max: 300,
      retryMax: 600,
      overheadTokens: 160,
      outputScale: 0.2,
      preferApiCount: true,
    },
    timeoutMs,
    maxRetries: 0,
    validate: (value) => {
      if (!value || typeof value !== "object") return { success: false, error: "not_an_object" };
      const record = value as Record<string, unknown>;
      const target = coerceBookingTarget(record.target);
      const reason = typeof record.reason === "string" ? record.reason.trim() : "";
      if (!target) return { success: false, error: "invalid_target" };
      if (!reason) return { success: false, error: "missing_reason" };
      return { success: true, data: { target, reason } };
    },
  });

  if (!result.success) {
    return {
      target: deterministic.target,
      source: "deterministic_fallback",
      reason: [deterministic.warning, result.error.message].filter(Boolean).join("; "),
    };
  }

  const aiTarget = result.data.target;
  const gatedCanUseWithQuestions = hasQuestionsTarget && !deterministic.needsNoQuestions;
  const gatedCanUseNoQuestions = hasNoQuestionsTarget;

  let finalTarget = aiTarget;

  if (deterministic.needsNoQuestions) {
    finalTarget = "no_questions";
  } else if (aiTarget === "with_questions" && !gatedCanUseWithQuestions) {
    finalTarget = gatedCanUseNoQuestions ? "no_questions" : deterministic.target;
  } else if (aiTarget === "no_questions" && !gatedCanUseNoQuestions) {
    finalTarget = gatedCanUseWithQuestions ? "with_questions" : deterministic.target;
  }

  if (finalTarget !== aiTarget) {
    return {
      target: finalTarget,
      source: "deterministic_fallback",
      reason: `AI chose ${aiTarget} but gated to ${finalTarget}: ${result.data.reason}`,
    };
  }

  return { target: finalTarget, source: "ai", reason: result.data.reason };
}
