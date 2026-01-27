import "server-only";

import { prisma } from "@/lib/prisma";
import { buildSentimentTranscriptFromMessages } from "@/lib/sentiment";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";

export type WorkspaceQualificationQuestion = {
  id: string;
  question: string;
  required: boolean;
};

export type StoredQualificationAnswers = Record<
  string,
  {
    answer: string;
    confidence: number;
  }
>;

export type QualificationAnswerState = {
  requiredQuestionIds: string[];
  missingRequiredQuestionIds: string[];
  hasAllRequiredAnswers: boolean;
  hasAnyAnswers: boolean;
  answers: StoredQualificationAnswers;
};

function toWorkspaceQualificationQuestions(raw: unknown): WorkspaceQualificationQuestion[] {
  if (!Array.isArray(raw)) return [];

  const result: WorkspaceQualificationQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const question = typeof record.question === "string" ? record.question.trim() : "";
    const required = typeof record.required === "boolean" ? record.required : false;
    if (!id || !question) continue;
    result.push({ id, question, required });
  }
  return result;
}

function toStoredQualificationAnswers(raw: unknown): StoredQualificationAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;

  const result: StoredQualificationAnswers = {};
  for (const [questionId, value] of Object.entries(record)) {
    if (!questionId) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const answer = typeof entry.answer === "string" ? entry.answer.trim() : "";
    const confidence = typeof entry.confidence === "number" && Number.isFinite(entry.confidence) ? entry.confidence : null;
    if (!answer || confidence === null) continue;
    result[questionId] = { answer, confidence: Math.max(0, Math.min(1, confidence)) };
  }
  return result;
}

export async function getWorkspaceQualificationQuestions(clientId: string): Promise<WorkspaceQualificationQuestion[]> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { qualificationQuestions: true },
  });

  if (!settings?.qualificationQuestions) return [];

  try {
    return toWorkspaceQualificationQuestions(JSON.parse(settings.qualificationQuestions));
  } catch {
    return [];
  }
}

async function getAskedRequiredQuestionIdsForLead(leadId: string): Promise<string[]> {
  const progressRows = await prisma.leadCampaignBookingProgress.findMany({
    where: { leadId },
    select: { selectedRequiredQuestionIds: true },
  });

  const ids = new Set<string>();
  for (const row of progressRows) {
    for (const id of row.selectedRequiredQuestionIds || []) {
      if (typeof id === "string" && id.trim()) ids.add(id.trim());
    }
  }
  return Array.from(ids);
}

export async function getLeadQualificationAnswerState(opts: {
  leadId: string;
  clientId: string;
}): Promise<QualificationAnswerState> {
  const [questions, lead] = await Promise.all([
    getWorkspaceQualificationQuestions(opts.clientId),
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { qualificationAnswers: true },
    }),
  ]);

  const answers = toStoredQualificationAnswers(lead?.qualificationAnswers);
  const requiredQuestionIds = questions.filter((q) => q.required).map((q) => q.id);
  const missingRequiredQuestionIds = requiredQuestionIds.filter((id) => !answers[id]?.answer);

  return {
    requiredQuestionIds,
    missingRequiredQuestionIds,
    hasAllRequiredAnswers: missingRequiredQuestionIds.length === 0 && requiredQuestionIds.length > 0,
    hasAnyAnswers: Object.keys(answers).length > 0,
    answers,
  };
}

type ExtractionAnswer = {
  questionId: string;
  answer: string;
  confidence: number;
};

function buildExtractionPrompt(): string {
  return `You extract answers to qualification questions from a conversation transcript.

Rules:
- Only extract answers the Lead explicitly provided in the transcript. Do NOT guess.
- If a question is not answered, omit it (do not output empty strings).
- Prefer the Lead's most recent answer if they correct themselves.
- Answers should be concise, but include essential details.
- confidence is 0..1 and reflects whether the transcript clearly supports the answer.

Output JSON with shape:
{ "answers": [{ "question_id": "...", "answer": "...", "confidence": 0.0 }] }`;
}

export async function extractQualificationAnswersFromTranscript(opts: {
  clientId: string;
  leadId: string;
  transcript: string;
  questions: WorkspaceQualificationQuestion[];
  questionIdsToExtract?: string[] | null;
  timeoutMs?: number;
}): Promise<{ success: true; answers: ExtractionAnswer[] } | { success: false; error: string }> {
  if (!process.env.OPENAI_API_KEY) return { success: false, error: "OpenAI API key not configured" };

  const questionsById = new Map(opts.questions.map((q) => [q.id, q.question] as const));
  const requestedIdsRaw = Array.isArray(opts.questionIdsToExtract) ? opts.questionIdsToExtract : null;
  const requestedIds = requestedIdsRaw?.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()) ?? null;

  const questionsToExtract = (requestedIds ?? opts.questions.map((q) => q.id))
    .map((id) => ({ id, question: questionsById.get(id) || "" }))
    .filter((q) => q.question);

  if (questionsToExtract.length === 0) return { success: true, answers: [] };

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question_id: { type: "string" },
            answer: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["question_id", "answer", "confidence"],
        },
      },
    },
    required: ["answers"],
  } as const;

  const validate = (
    value: unknown
  ):
    | { success: true; data: { answers: ExtractionAnswer[] } }
    | { success: false; error: string } => {
    if (!value || typeof value !== "object") return { success: false, error: "not_an_object" };
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.answers)) return { success: false, error: "answers_not_array" };

    const answers: ExtractionAnswer[] = [];
    for (const item of record.answers) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const questionId = typeof row.question_id === "string" ? row.question_id.trim() : "";
      const answer = typeof row.answer === "string" ? row.answer.trim() : "";
      const confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : null;
      if (!questionId || !answer || confidence === null) continue;
      if (!questionsById.has(questionId)) continue;
      answers.push({ questionId, answer, confidence: Math.max(0, Math.min(1, confidence)) });
    }

    return { success: true, data: { answers } };
  };

  const input = [
    {
      role: "user" as const,
      content: `QUALIFICATION QUESTIONS (id -> question text):
${questionsToExtract.map((q) => `- ${q.id}: ${q.question}`).join("\n")}

CONVERSATION TRANSCRIPT:
${opts.transcript}`,
    },
  ];

  const result = await runStructuredJsonPrompt<{ answers: ExtractionAnswer[] }>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    promptKey: "qualification.extract_answers.v1",
    featureId: "qualification.extract_answers",
    model: "gpt-5-mini",
    reasoningEffort: "low",
    systemFallback: buildExtractionPrompt(),
    input,
    schemaName: "qualification_answers",
    schema,
    timeoutMs: typeof opts.timeoutMs === "number" ? opts.timeoutMs : 12_000,
    maxRetries: 0,
    budget: {
      min: 256,
      max: 900,
      retryMax: 1400,
      overheadTokens: 192,
      outputScale: 0.12,
      preferApiCount: true,
    },
    validate,
  });

  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  return { success: true, answers: result.data.answers };
}

export async function ensureLeadQualificationAnswersExtracted(opts: {
  leadId: string;
  clientId: string;
  confidenceThreshold?: number;
  timeoutMs?: number;
}): Promise<QualificationAnswerState> {
  const [lead, questions, askedRequiredIds] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { qualificationAnswers: true, qualificationAnswersExtractedAt: true },
    }),
    getWorkspaceQualificationQuestions(opts.clientId),
    getAskedRequiredQuestionIdsForLead(opts.leadId),
  ]);

  const existing = toStoredQualificationAnswers(lead?.qualificationAnswers);
  const requiredQuestionIds = questions.filter((q) => q.required).map((q) => q.id);

  const missingRequiredQuestionIds = requiredQuestionIds.filter((id) => !existing[id]?.answer);
  const hasAllRequiredAnswers = missingRequiredQuestionIds.length === 0 && requiredQuestionIds.length > 0;

  // If we already have what we need, do not spend tokens.
  if (hasAllRequiredAnswers) {
    return {
      requiredQuestionIds,
      missingRequiredQuestionIds,
      hasAllRequiredAnswers: true,
      hasAnyAnswers: Object.keys(existing).length > 0,
      answers: existing,
    };
  }

  if (questions.length === 0) {
    return {
      requiredQuestionIds: [],
      missingRequiredQuestionIds: [],
      hasAllRequiredAnswers: false,
      hasAnyAnswers: Object.keys(existing).length > 0,
      answers: existing,
    };
  }

  const contextMessages = await prisma.message.findMany({
    where: { leadId: opts.leadId },
    orderBy: { sentAt: "desc" },
    take: 60,
    select: { sentAt: true, channel: true, direction: true, body: true, subject: true },
  });

  const transcript = buildSentimentTranscriptFromMessages([...contextMessages].reverse());
  const confidenceThreshold =
    typeof opts.confidenceThreshold === "number" && Number.isFinite(opts.confidenceThreshold)
      ? Math.max(0, Math.min(1, opts.confidenceThreshold))
      : 0.7;

  const questionIdsToExtract = askedRequiredIds.length > 0 ? askedRequiredIds : requiredQuestionIds;

  const extraction = await extractQualificationAnswersFromTranscript({
    clientId: opts.clientId,
    leadId: opts.leadId,
    transcript,
    questions,
    questionIdsToExtract,
    timeoutMs: opts.timeoutMs,
  });

  if (!extraction.success) {
    return {
      requiredQuestionIds,
      missingRequiredQuestionIds,
      hasAllRequiredAnswers: false,
      hasAnyAnswers: Object.keys(existing).length > 0,
      answers: existing,
    };
  }

  const filtered = extraction.answers.filter((a) => a.confidence >= confidenceThreshold);
  if (filtered.length === 0) {
    return {
      requiredQuestionIds,
      missingRequiredQuestionIds,
      hasAllRequiredAnswers: false,
      hasAnyAnswers: Object.keys(existing).length > 0,
      answers: existing,
    };
  }

  const merged: StoredQualificationAnswers = { ...existing };
  for (const answer of filtered) {
    merged[answer.questionId] = { answer: answer.answer, confidence: answer.confidence };
  }

  await prisma.lead.update({
    where: { id: opts.leadId },
    data: {
      qualificationAnswers: merged,
      qualificationAnswersExtractedAt: new Date(),
    },
  });

  const nextMissing = requiredQuestionIds.filter((id) => !merged[id]?.answer);

  return {
    requiredQuestionIds,
    missingRequiredQuestionIds: nextMissing,
    hasAllRequiredAnswers: nextMissing.length === 0 && requiredQuestionIds.length > 0,
    hasAnyAnswers: Object.keys(merged).length > 0,
    answers: merged,
  };
}

