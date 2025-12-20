import "server-only";

import type OpenAI from "openai";

export function extractJsonObjectFromText(text: string): string {
  const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) return cleaned.slice(first, last + 1);
  return cleaned;
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
