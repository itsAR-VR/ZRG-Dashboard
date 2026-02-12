import "server-only";

import {
  AppointmentSource,
  AppointmentStatus,
  BookingQualificationProvider,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { normalizeQuestionKey } from "@/lib/booking";
import {
  getWorkspaceQualificationQuestions,
  type StoredQualificationAnswers,
  type WorkspaceQualificationQuestion,
} from "@/lib/qualification-answer-extraction";
import { upsertAppointmentWithRollup } from "@/lib/appointment-upsert";
import { cancelCalendlyScheduledEvent } from "@/lib/calendly-api";
import { deleteGHLAppointment } from "@/lib/ghl-api";
import { sendResendEmail } from "@/lib/resend-email";
import { sendSmsSystem } from "@/lib/system-sender";
import { pauseFollowUpsOnBooking } from "@/lib/followup-engine";
import { createCancellationTask } from "@/lib/appointment-cancellation-task";

export type BookingQuestionAnswer = {
  question: string;
  answer: string;
  position: number;
};

export type BookingQualificationResult = {
  qualified: boolean;
  confidence: number;
  reasoning: string;
  disqualificationReasons: string[];
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function toStoredQualificationAnswers(raw: unknown): StoredQualificationAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;

  const result: StoredQualificationAnswers = {};
  for (const [questionId, value] of Object.entries(record)) {
    if (!questionId || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const answer = typeof row.answer === "string" ? row.answer.trim() : "";
    const confidence =
      typeof row.confidence === "number" && Number.isFinite(row.confidence) ? clamp01(row.confidence) : null;
    if (!answer || confidence === null) continue;
    result[questionId] = { answer, confidence };
  }

  return result;
}

function toQuestionAnswerMap(questions: WorkspaceQualificationQuestion[]): Map<string, WorkspaceQualificationQuestion> {
  const map = new Map<string, WorkspaceQualificationQuestion>();
  for (const question of questions) {
    const key = normalizeQuestionKey(question.question);
    if (!key) continue;
    map.set(key, question);
  }
  return map;
}

function toNormalizedFormAnswers(rawAnswers: Record<string, { question: string; answer: string }>): string {
  return Object.entries(rawAnswers)
    .filter(([, value]) => value && typeof value.question === "string" && typeof value.answer === "string")
    .map(([questionId, value]) => `- ${questionId}: ${value.question}\n  Answer: ${value.answer}`)
    .join("\n");
}

function buildQualificationSystemPrompt(): string {
  return `You evaluate whether a booked lead qualifies for a meeting.

Rules:
- Return qualified=true when answers meet the provided criteria.
- Return qualified=false only when evidence is strong and specific.
- If answers are incomplete or ambiguous, return qualified=true with lower confidence.
- confidence is 0..1.
- reasoning must be concise and factual.
- disqualification_reasons must include only explicit, concrete reasons from the provided answers.`;
}

export async function markLeadBookingQualificationPending(leadId: string): Promise<void> {
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      bookingQualificationStatus: "pending",
      bookingQualificationCheckedAt: null,
      bookingQualificationReason: null,
    },
  });
}

export async function markLeadBookingQualified(opts: {
  leadId: string;
  reason?: string | null;
}): Promise<void> {
  await prisma.lead.update({
    where: { id: opts.leadId },
    data: {
      bookingQualificationStatus: "qualified",
      bookingQualificationCheckedAt: new Date(),
      bookingQualificationReason: (opts.reason || "").trim() || null,
    },
  });
}

export async function storeBookingFormAnswersOnLead(opts: {
  leadId: string;
  clientId: string;
  questionsAndAnswers: BookingQuestionAnswer[];
}): Promise<{ storedCount: number }> {
  const questionsAndAnswers = Array.isArray(opts.questionsAndAnswers) ? opts.questionsAndAnswers : [];
  if (questionsAndAnswers.length === 0) return { storedCount: 0 };

  const [workspaceQuestions, lead] = await Promise.all([
    getWorkspaceQualificationQuestions(opts.clientId),
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { qualificationAnswers: true },
    }),
  ]);

  if (workspaceQuestions.length === 0) return { storedCount: 0 };

  const questionByNormalized = toQuestionAnswerMap(workspaceQuestions);
  const merged: StoredQualificationAnswers = {
    ...toStoredQualificationAnswers(lead?.qualificationAnswers),
  };

  let storedCount = 0;
  for (const row of questionsAndAnswers) {
    const question = (row?.question || "").trim();
    const answer = (row?.answer || "").trim();
    if (!question || !answer) continue;
    const mapped = questionByNormalized.get(normalizeQuestionKey(question));
    if (!mapped) continue;
    merged[mapped.id] = { answer, confidence: 1 };
    storedCount++;
  }

  if (storedCount === 0) return { storedCount: 0 };

  await prisma.lead.update({
    where: { id: opts.leadId },
    data: {
      qualificationAnswers: merged,
      qualificationAnswersExtractedAt: new Date(),
    },
  });

  return { storedCount };
}

export function extractQualificationAnswersFromGhlCustomFields(opts: {
  questions: WorkspaceQualificationQuestion[];
  customFields: Array<{
    id?: string;
    key?: string;
    name?: string;
    fieldKey?: string;
    value?: unknown;
  }> | null | undefined;
}): BookingQuestionAnswer[] {
  const questionByNormalized = toQuestionAnswerMap(opts.questions);
  if (questionByNormalized.size === 0) return [];
  if (!Array.isArray(opts.customFields)) return [];

  const deduped = new Set<string>();
  const output: BookingQuestionAnswer[] = [];

  for (const field of opts.customFields) {
    if (!field || typeof field !== "object") continue;
    const valueRaw = field.value;
    const answer =
      typeof valueRaw === "string"
        ? valueRaw.trim()
        : typeof valueRaw === "number" || typeof valueRaw === "boolean"
          ? String(valueRaw)
          : "";
    if (!answer) continue;

    const labelCandidates = [field.name, field.key, field.fieldKey, field.id]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim());

    let matchedQuestion: WorkspaceQualificationQuestion | null = null;
    for (const label of labelCandidates) {
      const found = questionByNormalized.get(normalizeQuestionKey(label));
      if (found) {
        matchedQuestion = found;
        break;
      }
    }
    if (!matchedQuestion) continue;
    if (deduped.has(matchedQuestion.id)) continue;
    deduped.add(matchedQuestion.id);
    output.push({
      question: matchedQuestion.question,
      answer,
      position: output.length,
    });
  }

  return output;
}

export async function evaluateBookingQualification(opts: {
  clientId: string;
  leadId: string;
  formAnswers: Record<string, { question: string; answer: string }>;
  qualificationCriteria: string;
  idealCustomerProfile?: string | null;
  serviceDescription?: string | null;
}): Promise<BookingQualificationResult | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!opts.qualificationCriteria.trim()) return null;

  const answersText = toNormalizedFormAnswers(opts.formAnswers);
  if (!answersText) return null;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      qualified: { type: "boolean" },
      confidence: { type: "number" },
      reasoning: { type: "string" },
      disqualification_reasons: { type: "array", items: { type: "string" } },
    },
    required: ["qualified", "confidence", "reasoning", "disqualification_reasons"],
  } as const;

  const validate = (
    value: unknown
  ): { success: true; data: BookingQualificationResult } | { success: false; error: string } => {
    if (!value || typeof value !== "object") return { success: false, error: "not_an_object" };
    const row = value as Record<string, unknown>;
    if (typeof row.qualified !== "boolean") return { success: false, error: "missing_qualified" };
    if (typeof row.confidence !== "number" || !Number.isFinite(row.confidence)) {
      return { success: false, error: "invalid_confidence" };
    }
    if (typeof row.reasoning !== "string") return { success: false, error: "missing_reasoning" };
    if (!Array.isArray(row.disqualification_reasons)) {
      return { success: false, error: "missing_disqualification_reasons" };
    }
    return {
      success: true,
      data: {
        qualified: row.qualified,
        confidence: clamp01(row.confidence),
        reasoning: row.reasoning.trim(),
        disqualificationReasons: row.disqualification_reasons
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean),
      },
    };
  };

  const input = [
    {
      role: "user" as const,
      content: `QUALIFICATION CRITERIA:
${opts.qualificationCriteria.trim()}

IDEAL CUSTOMER PROFILE:
${(opts.idealCustomerProfile || "").trim() || "Not provided"}

SERVICE DESCRIPTION:
${(opts.serviceDescription || "").trim() || "Not provided"}

FORM ANSWERS:
${answersText}`,
    },
  ];

  const result = await runStructuredJsonPrompt<BookingQualificationResult>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    promptKey: "booking.qualification.evaluate.v1",
    featureId: "booking.qualification.evaluate",
    model: "gpt-5-mini",
    reasoningEffort: "medium",
    temperature: 0,
    systemFallback: buildQualificationSystemPrompt(),
    input,
    schemaName: "booking_qualification_evaluation",
    schema,
    timeoutMs: 12_000,
    maxRetries: 0,
    budget: {
      min: 400,
      max: 800,
      retryMax: 1200,
      overheadTokens: 256,
      outputScale: 0.16,
      preferApiCount: true,
    },
    validate,
  });

  if (!result.success) return null;
  return result.data;
}

export function buildDisqualificationMessage(opts: {
  template?: string | null;
  reasons: string[];
  companyName?: string | null;
}): string {
  const reasonsText =
    opts.reasons.length > 0
      ? opts.reasons.map((reason) => `- ${reason}`).join("\n")
      : "- We reviewed your details and this is not the right fit right now.";
  const companyName = (opts.companyName || "").trim() || "our team";

  const template = (opts.template || "").trim();
  if (!template) {
    return `Thanks for booking with ${companyName}. After reviewing your responses, we need to cancel this meeting because it is not the right fit right now.

Reasons:
${reasonsText}

If your situation changes, feel free to reply and we can revisit.`;
  }

  return template
    .replace(/\{reasons\}/g, reasonsText)
    .replace(/\{companyName\}/g, companyName);
}

export async function executeBookingDisqualification(opts: {
  clientId: string;
  leadId: string;
  provider: BookingQualificationProvider;
  scheduledEventUri?: string | null;
  ghlAppointmentId?: string | null;
  reasoning: string;
  disqualificationReasons: string[];
}): Promise<{ success: boolean; cancelResult?: string; messageResult?: string; error?: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: {
      id: true,
      clientId: true,
      status: true,
      email: true,
      ghlAppointmentId: true,
      calendlyInviteeUri: true,
      calendlyScheduledEventUri: true,
      appointmentStartAt: true,
      appointmentEndAt: true,
      client: {
        select: {
          ghlPrivateKey: true,
          calendlyAccessToken: true,
          resendApiKey: true,
          resendFromEmail: true,
          settings: {
            select: {
              companyName: true,
              bookingDisqualificationMessage: true,
            },
          },
        },
      },
    },
  });

  if (!lead) return { success: false, error: "Lead not found" };

  const reasonText = (opts.reasoning || "").trim();
  const cancelReason =
    reasonText || (opts.disqualificationReasons.length > 0 ? opts.disqualificationReasons.join("; ") : "Disqualified");

  let cancelResult = "not_attempted";

  if (opts.provider === BookingQualificationProvider.CALENDLY) {
    const scheduledEventUri = (opts.scheduledEventUri || lead.calendlyScheduledEventUri || "").trim();
    const accessToken = (lead.client.calendlyAccessToken || "").trim();
    if (!scheduledEventUri) return { success: false, error: "Missing Calendly scheduled event URI" };
    if (!accessToken) return { success: false, error: "Missing Calendly access token" };

    const canceled = await cancelCalendlyScheduledEvent(accessToken, scheduledEventUri, { reason: cancelReason });
    if (!canceled.success) {
      return {
        success: false,
        error: canceled.error || "Failed to cancel Calendly scheduled event",
      };
    }
    cancelResult = "calendly_canceled";

    if (lead.calendlyInviteeUri) {
      await upsertAppointmentWithRollup({
        leadId: lead.id,
        provider: "CALENDLY",
        source: AppointmentSource.MANUAL,
        calendlyInviteeUri: lead.calendlyInviteeUri,
        calendlyScheduledEventUri: scheduledEventUri,
        startAt: lead.appointmentStartAt,
        endAt: lead.appointmentEndAt,
        status: AppointmentStatus.CANCELED,
        canceledAt: new Date(),
        cancelReason,
      });
    } else {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          appointmentStatus: "canceled",
          appointmentCanceledAt: new Date(),
        },
      });
    }
  } else {
    const appointmentId = (opts.ghlAppointmentId || lead.ghlAppointmentId || "").trim();
    const privateKey = (lead.client.ghlPrivateKey || "").trim();
    if (!appointmentId) return { success: false, error: "Missing GHL appointment ID" };
    if (!privateKey) return { success: false, error: "Missing GHL private key" };

    const canceled = await deleteGHLAppointment(appointmentId, privateKey);
    if (!canceled.success) {
      return {
        success: false,
        error: canceled.error || "Failed to cancel GHL appointment",
      };
    }
    cancelResult = "ghl_canceled";

    await upsertAppointmentWithRollup({
      leadId: lead.id,
      provider: "GHL",
      source: AppointmentSource.MANUAL,
      ghlAppointmentId: appointmentId,
      startAt: lead.appointmentStartAt,
      endAt: lead.appointmentEndAt,
      status: AppointmentStatus.CANCELED,
      canceledAt: new Date(),
      cancelReason,
    });
  }

  if (lead.appointmentStartAt) {
    await createCancellationTask({
      leadId: lead.id,
      taskType: "meeting-canceled",
      appointmentStartTime: lead.appointmentStartAt,
      provider: opts.provider === BookingQualificationProvider.CALENDLY ? "CALENDLY" : "GHL",
    });
  }

  await pauseFollowUpsOnBooking(lead.id, { mode: "complete" });

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: "unqualified",
      bookingQualificationStatus: "disqualified",
      bookingQualificationCheckedAt: new Date(),
      bookingQualificationReason: reasonText || null,
    },
  });

  const body = buildDisqualificationMessage({
    template: lead.client.settings?.bookingDisqualificationMessage,
    reasons: opts.disqualificationReasons,
    companyName: lead.client.settings?.companyName,
  });

  let messageResult = "notification_skipped";
  if (opts.provider === BookingQualificationProvider.CALENDLY) {
    const email = (lead.email || "").trim();
    if (email) {
      const sent = await sendResendEmail({
        apiKey: lead.client.resendApiKey,
        fromEmail: lead.client.resendFromEmail,
        to: [email],
        subject: "Update about your booked meeting",
        text: body,
      });
      messageResult = sent.success ? "email_sent" : `email_failed:${sent.error || "unknown"}`;
    } else {
      messageResult = "email_skipped_missing_recipient";
    }
  } else {
    const sent = await sendSmsSystem(lead.id, body, {
      sentBy: "ai",
      skipBookingProgress: true,
    });
    messageResult = sent.success ? "sms_sent" : `sms_failed:${sent.error || "unknown"}`;
  }

  return { success: true, cancelResult, messageResult };
}
