export const SMS_MAX_CHARS_PER_PART = 160;
export const SMS_MAX_PARTS = 3;

export class SmsDraftPartsError extends Error {
  code:
    | "empty"
    | "too_many_parts"
    | "part_too_long"
    | "cannot_split"
    | "invalid_format";

  constructor(code: SmsDraftPartsError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function countSmsChars(text: string): number {
  return Array.from(text || "").length;
}

function tryParseJsonParts(content: string): string[] | null {
  const trimmed = (content || "").trim();
  if (!trimmed) return null;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
      return parsed.map((p) => p.trim()).filter(Boolean);
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      "parts" in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>).parts)
    ) {
      const parts = (parsed as Record<string, unknown>).parts as unknown[];
      if (!parts.every((p) => typeof p === "string")) return null;
      return (parts as string[]).map((p) => p.trim()).filter(Boolean);
    }
  } catch {
    return null;
  }

  return null;
}

function parseTagParts(content: string): string[] | null {
  const trimmed = (content || "").trim();
  if (!trimmed) return null;
  if (!trimmed.includes("<sms_part")) return null;

  const parts: string[] = [];
  const re = /<sms_part\b[^>]*>([\s\S]*?)<\/sms_part>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed))) {
    const part = (match[1] || "").trim();
    if (part) parts.push(part);
  }

  return parts.length ? parts : null;
}

function parseDelimitedParts(content: string): string[] {
  const trimmed = (content || "").trim();
  if (!trimmed) return [];

  return trimmed
    .split(/\n\s*---\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function splitSmsTextIntoParts(text: string, opts?: { maxChars?: number; maxParts?: number }): string[] | null {
  const maxChars = opts?.maxChars ?? SMS_MAX_CHARS_PER_PART;
  const maxParts = opts?.maxParts ?? SMS_MAX_PARTS;

  const words = (text || "")
    .trim()
    .split(/\s+/g)
    .filter(Boolean);

  if (words.length === 0) return [];

  const parts: string[] = [];
  let current = "";

  for (const word of words) {
    if (countSmsChars(word) > maxChars) {
      return null;
    }

    const next = current ? `${current} ${word}` : word;
    if (countSmsChars(next) <= maxChars) {
      current = next;
      continue;
    }

    if (!current) {
      return null;
    }

    parts.push(current);
    current = word;

    if (parts.length >= maxParts) {
      // Still have words remaining and no more part budget.
      return null;
    }
  }

  if (current) parts.push(current);
  return parts;
}

export function getSmsDraftParts(
  content: string,
  opts?: { allowFallbackSplit?: boolean }
): { parts: string[]; format: "json" | "tags" | "delimited" | "single" } {
  const trimmed = (content || "").trim();
  if (!trimmed) {
    throw new SmsDraftPartsError("empty", "SMS draft content is empty.");
  }

  const jsonParts = tryParseJsonParts(trimmed);
  if (jsonParts && jsonParts.length > 0) {
    return { parts: jsonParts, format: "json" };
  }

  const tagParts = parseTagParts(trimmed);
  if (tagParts && tagParts.length > 0) {
    return { parts: tagParts, format: "tags" };
  }

  const delimited = parseDelimitedParts(trimmed);
  if (delimited.length > 1) {
    return { parts: delimited, format: "delimited" };
  }

  return { parts: [trimmed], format: "single" };
}

export function validateSmsDraftParts(parts: string[]): void {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new SmsDraftPartsError("empty", "SMS draft has no message parts.");
  }

  if (parts.length > SMS_MAX_PARTS) {
    throw new SmsDraftPartsError(
      "too_many_parts",
      `SMS draft has ${parts.length} parts; max is ${SMS_MAX_PARTS}.`
    );
  }

  for (let i = 0; i < parts.length; i++) {
    const part = (parts[i] || "").trim();
    if (!part) {
      throw new SmsDraftPartsError("invalid_format", `SMS draft part ${i + 1} is empty.`);
    }

    if (countSmsChars(part) > SMS_MAX_CHARS_PER_PART) {
      throw new SmsDraftPartsError(
        "part_too_long",
        `SMS draft part ${i + 1} exceeds ${SMS_MAX_CHARS_PER_PART} characters.`
      );
    }
  }
}

export function coerceSmsDraftPartsOrThrow(
  content: string,
  opts?: { allowFallbackSplit?: boolean }
): { parts: string[]; format: "json" | "tags" | "delimited" | "single" | "fallback_split" } {
  const parsed = getSmsDraftParts(content, opts);

  try {
    validateSmsDraftParts(parsed.parts);
    return parsed;
  } catch (error) {
    if (!opts?.allowFallbackSplit) throw error;

    const joined = parsed.parts.map((p) => p.trim()).filter(Boolean).join(" ");
    const fallback = splitSmsTextIntoParts(joined);
    if (!fallback) {
      throw new SmsDraftPartsError(
        "cannot_split",
        `SMS draft cannot be split into <=${SMS_MAX_PARTS} parts of <=${SMS_MAX_CHARS_PER_PART} characters.`
      );
    }

    validateSmsDraftParts(fallback);
    return { parts: fallback, format: "fallback_split" };
  }
}

export function formatSmsDraftPartsForStorage(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join("\n---\n");
}

