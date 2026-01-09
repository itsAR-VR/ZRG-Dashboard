import "server-only";

import { runResponse } from "@/lib/ai/openai-telemetry";
import { getTrimmedOutputText } from "@/lib/ai/response-utils";

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

  const resp = await runResponse({
    clientId: opts.clientId,
    featureId: "knowledge_assets.summarize_text",
    promptKey: "knowledge_assets.summarize_text.v1",
    params: {
      model: "gpt-5-mini",
      reasoning: { effort: "low" },
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_text", text: inputText },
          ],
        },
      ],
      max_output_tokens: 2200,
    },
    requestOptions: {
      timeout: Math.max(10_000, Number.parseInt(process.env.OPENAI_OCR_TIMEOUT_MS || "120000", 10) || 120_000),
      maxRetries: 0,
    },
  });

  return (getTrimmedOutputText(resp) || "").trim();
}

export async function extractKnowledgeNotesFromText(opts: {
  clientId: string;
  sourceLabel: string;
  text: string;
}): Promise<string> {
  if (!opts.text || !opts.text.trim()) return "";
  return summarizeTextToKnowledgeNotes(opts);
}

export async function extractKnowledgeNotesFromFile(opts: {
  clientId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  fallbackText?: string | null;
}): Promise<string> {
  const sourceLabel = `${opts.filename} (${opts.mimeType || "unknown"})`;
  const mimeType = opts.mimeType || "application/octet-stream";

  // If we already have extracted text (e.g., DOCX via mammoth), just summarize it.
  if (opts.fallbackText && opts.fallbackText.trim().length > 0) {
    return summarizeTextToKnowledgeNotes({
      clientId: opts.clientId,
      sourceLabel,
      text: opts.fallbackText,
    });
  }

  // PDF: send as input_file (supports scanned PDFs: text + page images).
  if (mimeType === "application/pdf") {
    const base64 = opts.bytes.toString("base64");
    const resp = await runResponse({
      clientId: opts.clientId,
      featureId: "knowledge_assets.ocr_pdf",
      promptKey: "knowledge_assets.ocr_pdf.v1",
      params: {
        model: "gpt-5-mini",
        reasoning: { effort: "low" },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: buildKnowledgeNotesPrompt({ sourceLabel }) },
              {
                type: "input_file",
                filename: opts.filename || "document.pdf",
                file_data: `data:${mimeType};base64,${base64}`,
              },
            ],
          },
        ],
        max_output_tokens: 2200,
      },
      requestOptions: {
        timeout: Math.max(10_000, Number.parseInt(process.env.OPENAI_OCR_TIMEOUT_MS || "180000", 10) || 180_000),
        maxRetries: 0,
      },
    });

    return (getTrimmedOutputText(resp) || "").trim();
  }

  // Images: OCR via vision input_image base64.
  if (isImageMimeType(mimeType)) {
    const base64 = opts.bytes.toString("base64");
    const resp = await runResponse({
      clientId: opts.clientId,
      featureId: "knowledge_assets.ocr_image",
      promptKey: "knowledge_assets.ocr_image.v1",
      params: {
        model: "gpt-5-mini",
        reasoning: { effort: "low" },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: buildKnowledgeNotesPrompt({ sourceLabel }) },
              {
                type: "input_image",
                image_url: `data:${mimeType};base64,${base64}`,
              },
            ],
          },
        ],
        max_output_tokens: 2200,
      },
      requestOptions: {
        timeout: Math.max(10_000, Number.parseInt(process.env.OPENAI_OCR_TIMEOUT_MS || "120000", 10) || 120_000),
        maxRetries: 0,
      },
    });

    return (getTrimmedOutputText(resp) || "").trim();
  }

  // As a fallback, treat bytes as UTF-8 text and summarize.
  const text = opts.bytes.toString("utf8");
  if (!text.trim()) return "";

  return summarizeTextToKnowledgeNotes({
    clientId: opts.clientId,
    sourceLabel,
    text,
  });
}
