import "server-only";

const BYTES_PER_TOKEN = 4;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function estimateTokensFromBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.max(0, Math.ceil(bytes / BYTES_PER_TOKEN));
}

export function estimateTokensFromText(text: string): number {
  // Rough heuristic: ~4 UTF-8 bytes per token for English-ish text.
  return estimateTokensFromBytes(estimateBytesFromText(text));
}

export function estimateBytesFromText(text: string): number {
  return Buffer.byteLength(text || "", "utf8");
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function truncateTextToTokenEstimate(
  text: string,
  maxTokens: number,
  opts?: { keep?: "start" | "end" }
): { text: string; truncated: boolean; tokensEstimated: number; bytes: number } {
  const keep = opts?.keep ?? "start";
  const budgetTokens = clampInt(maxTokens, 0, 10_000_000);
  const maxBytes = budgetTokens * BYTES_PER_TOKEN;
  const raw = text || "";

  if (maxBytes <= 0) {
    return {
      text: "",
      truncated: Boolean(raw),
      tokensEstimated: 0,
      bytes: 0,
    };
  }

  const rawBytes = estimateBytesFromText(raw);
  if (rawBytes <= maxBytes) {
    return {
      text: raw,
      truncated: false,
      tokensEstimated: estimateTokensFromBytes(rawBytes),
      bytes: rawBytes,
    };
  }

  const rawBuffer = Buffer.from(raw, "utf8");
  let slice = "";

  if (keep === "end") {
    let start = Math.max(0, rawBuffer.length - maxBytes);
    for (let i = 0; i < 4 && start < rawBuffer.length; i += 1) {
      try {
        slice = utf8Decoder.decode(rawBuffer.subarray(start));
        break;
      } catch {
        start += 1;
      }
    }
    if (!slice) {
      slice = rawBuffer.subarray(start).toString("utf8");
    }
  } else {
    let end = Math.min(rawBuffer.length, maxBytes);
    for (let i = 0; i < 4 && end > 0; i += 1) {
      try {
        slice = utf8Decoder.decode(rawBuffer.subarray(0, end));
        break;
      } catch {
        end -= 1;
      }
    }
    if (!slice) {
      slice = rawBuffer.subarray(0, end).toString("utf8");
    }
  }

  const bytes = estimateBytesFromText(slice);
  return {
    text: slice,
    truncated: true,
    tokensEstimated: estimateTokensFromBytes(bytes),
    bytes,
  };
}
