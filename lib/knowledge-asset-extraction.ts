import "server-only";

import { runTextPrompt } from "@/lib/ai/prompt-runner";

function isImageMimeType(mimeType: string): boolean {
  const m = (mimeType || "").toLowerCase();
  return m === "image/png" || m === "image/jpeg" || m === "image/jpg" || m === "image/webp";
}

function buildKnowledgeNotesPrompt(opts: { sourceLabel: string }) {
  return `You are extracting internal knowledge for a sales team.

SOURCE: ${opts.sourceLabel}

TASK:
Create concise, high-signal notes that can be used to write better outbound replies and follow-ups.

OUTPUT FORMAT (plain text, no markdown fences):
- 1-2 sentence summary
- Key facts (bullets)
- Messaging angles (bullets)
- Proof/credibility (bullets)
- Links mentioned (bullets; include full URLs if present)

RULES:
- Be factual; don't invent details.
- If the document is mostly irrelevant/noisy, say so briefly and extract what you can.
- Keep it under ~1500 words.`;
}

async function summarizeTextToKnowledgeNotes(opts: {
  clientId: string;
  sourceLabel: string;
  text: string;
}): Promise<string> {
  const prompt = buildKnowledgeNotesPrompt({ sourceLabel: opts.sourceLabel });
  const inputText = opts.text.length > 120_000 ? `${opts.text.slice(0, 120_000)}\n\n[TRUNCATED]` : opts.text;

  const result = await runTextPrompt({
    pattern: "text",
    clientId: opts.clientId,
    featureId: "knowledge_assets.summarize_text",
    promptKey: "knowledge_assets.summarize_text.v1",
    model: "gpt-5-mini",
    reasoningEffort: "low",
    systemFallback: prompt,
    input: [{ role: "user" as const, content: inputText }],
    maxOutputTokens: 2200,
    timeoutMs: Math.max(10_000, Number.parseInt(process.env.OPENAI_OCR_TIMEOUT_MS || "120000", 10) || 120_000),
    maxRetries: 0,
  });

  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.data.trim();
}

export async function summarizeKnowledgeRawTextToNotes(opts: {
  clientId: string;
  sourceLabel: string;
  rawText: string;
}): Promise<string> {
  if (!opts.rawText || !opts.rawText.trim()) return "";
  return summarizeTextToKnowledgeNotes({
    clientId: opts.clientId,
    sourceLabel: opts.sourceLabel,
    text: opts.rawText,
  });
}

export async function extractKnowledgeRawTextFromText(opts: {
  sourceLabel: string;
  text: string;
}): Promise<string> {
  if (!opts.text || !opts.text.trim()) return "";
  const raw = opts.text.trim();
  return raw.length > 180_000 ? `${raw.slice(0, 180_000)}\n\n[TRUNCATED]` : raw;
}

export async function extractKnowledgeRawTextFromFile(opts: {
  clientId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  fallbackText?: string | null;
}): Promise<string> {
  const sourceLabel = `${opts.filename} (${opts.mimeType || "unknown"})`;
  const mimeType = opts.mimeType || "application/octet-stream";

  if (opts.fallbackText && opts.fallbackText.trim().length > 0) {
    return extractKnowledgeRawTextFromText({ sourceLabel, text: opts.fallbackText });
  }

  if (mimeType === "application/pdf") {
    const base64 = opts.bytes.toString("base64");
    const result = await runTextPrompt({
      pattern: "text",
      clientId: opts.clientId,
      featureId: "knowledge_assets.ocr_pdf",
      promptKey: "knowledge_assets.ocr_pdf.v1",
      model: "gpt-5-mini",
      reasoningEffort: "low",
      systemFallback: `Extract all readable text from SOURCE ${sourceLabel}.\nReturn plain text only.`,
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_file",
              filename: opts.filename || "document.pdf",
              file_data: `data:${mimeType};base64,${base64}`,
            },
          ],
        },
      ],
      maxOutputTokens: 6000,
      timeoutMs: Math.max(10_000, Number.parseInt(process.env.OPENAI_OCR_TIMEOUT_MS || "180000", 10) || 180_000),
      maxRetries: 0,
    });

    if (!result.success) {
      throw new Error(result.error.message);
    }

    return extractKnowledgeRawTextFromText({ sourceLabel, text: result.data });
  }

  if (isImageMimeType(mimeType)) {
    const base64 = opts.bytes.toString("base64");
    const result = await runTextPrompt({
      pattern: "text",
      clientId: opts.clientId,
      featureId: "knowledge_assets.ocr_image",
      promptKey: "knowledge_assets.ocr_image.v1",
      model: "gpt-5-mini",
      reasoningEffort: "low",
      systemFallback: `Extract all readable text from SOURCE ${sourceLabel}.\nReturn plain text only.`,
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_image",
              detail: "auto",
              image_url: `data:${mimeType};base64,${base64}`,
            },
          ],
        },
      ],
      maxOutputTokens: 6000,
      timeoutMs: Math.max(10_000, Number.parseInt(process.env.OPENAI_OCR_TIMEOUT_MS || "120000", 10) || 120_000),
      maxRetries: 0,
    });

    if (!result.success) {
      throw new Error(result.error.message);
    }

    return extractKnowledgeRawTextFromText({ sourceLabel, text: result.data });
  }

  return extractKnowledgeRawTextFromText({
    sourceLabel,
    text: opts.bytes.toString("utf8"),
  });
}

export async function extractKnowledgeNotesFromText(opts: {
  clientId: string;
  sourceLabel: string;
  text: string;
}): Promise<string> {
  const rawText = await extractKnowledgeRawTextFromText({
    sourceLabel: opts.sourceLabel,
    text: opts.text,
  });
  return summarizeKnowledgeRawTextToNotes({
    clientId: opts.clientId,
    sourceLabel: opts.sourceLabel,
    rawText,
  });
}

export async function extractKnowledgeNotesFromFile(opts: {
  clientId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  fallbackText?: string | null;
}): Promise<string> {
  const sourceLabel = `${opts.filename} (${opts.mimeType || "unknown"})`;
  const rawText = await extractKnowledgeRawTextFromFile({
    clientId: opts.clientId,
    filename: opts.filename,
    mimeType: opts.mimeType,
    bytes: opts.bytes,
    fallbackText: opts.fallbackText,
  });
  return summarizeKnowledgeRawTextToNotes({
    clientId: opts.clientId,
    sourceLabel,
    rawText,
  });
}
