import "server-only";

import type OpenAI from "openai";

export function extractJsonObjectFromText(text: string): string {
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) return cleaned.slice(first, last + 1);
  return cleaned;
}

export type ExtractedJsonObject =
  | { status: "none"; json: null }
  | { status: "incomplete"; json: string }
  | { status: "complete"; json: string };

/**
 * Extract the first complete top-level JSON object from text.
 * - Removes ```json fences
 * - Uses brace balancing while respecting quoted strings
 */
export function extractFirstCompleteJsonObjectFromText(text: string): ExtractedJsonObject {
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return { status: "none", json: null };

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return { status: "complete", json: cleaned.slice(start, i + 1) };
      }
    }
  }

  return { status: "incomplete", json: cleaned.slice(start) };
}

export function getTrimmedOutputText(response: OpenAI.Responses.Response): string | null {
  const text = response.output_text?.trim() || "";
  return text ? text : null;
}

export function getFirstRefusal(response: OpenAI.Responses.Response): string | null {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "refusal") {
        const refusal = String((content as { refusal?: string }).refusal || "").trim();
        return refusal ? refusal : null;
      }
    }
  }
  return null;
}

export function summarizeResponseForTelemetry(response: OpenAI.Responses.Response): string {
  const parts: string[] = [];

  if (response.error) {
    const code = (response.error as { code?: string }).code;
    const message = (response.error as { message?: string }).message;
    parts.push(`response_error=${String(code || "unknown")}:${String(message || "").slice(0, 200)}`);
  }

  const incomplete = response.incomplete_details?.reason;
  if (incomplete) parts.push(`incomplete=${incomplete}`);

  const outputTypes = (response.output || []).map((o) => o.type);
  if (outputTypes.length) parts.push(`output_types=${outputTypes.join(",")}`);

  const messageContentTypes: string[] = [];
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type) messageContentTypes.push(String(content.type));
    }
  }
  if (messageContentTypes.length) {
    parts.push(`message_content_types=${Array.from(new Set(messageContentTypes)).join(",")}`);
  }

  const refusal = getFirstRefusal(response);
  if (refusal) parts.push(`refusal=${refusal.slice(0, 200)}`);

  return parts.join(" ");
}
