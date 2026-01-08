// Minimal repro for signature-extractor JSON parsing failures (no OpenAI call, no PII).
// Mirrors the current `extractJsonObjectFromText()` behavior used in `lib/ai/response-utils.ts`.

function extractJsonObjectFromText(text) {
  const cleaned = String(text).replace(/```json\n?|\n?```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) return cleaned.slice(first, last + 1);
  return cleaned;
}

function extractFirstCompleteJsonObjectFromText(text) {
  const cleaned = String(text).replace(/```json\n?|\n?```/g, "").trim();
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
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return { status: "complete", json: cleaned.slice(start, i + 1) };
    }
  }

  return { status: "incomplete", json: cleaned.slice(start) };
}

function categorizeParseFailure(input) {
  const cleaned = String(input || "").trim();
  if (!cleaned) return "empty_output";
  if (!cleaned.includes("{")) return "non_json_response";
  if (!cleaned.includes("}")) return "truncated_json";
  return "invalid_json";
}

const cases = [
  {
    name: "valid_json",
    content: '{"isFromLead":true,"phone":null,"linkedinUrl":null,"confidence":"high"}',
  },
  {
    name: "truncated_json_like_prod",
    content: '{"isFromLead":false,"phone":null,"linkedinUrl":null,"confidence":"low","reasoning":"',
  },
  {
    name: "non_json",
    content: "Sure! Here is what I found:\n- isFromLead: true\n- phone: none",
  },
  {
    name: "json_in_fence",
    content:
      "```json\n{\"isFromLead\":true,\"phone\":null,\"linkedinUrl\":null,\"confidence\":\"medium\"}\n```",
  },
];

for (const c of cases) {
  const naive = extractJsonObjectFromText(c.content);
  const balanced = extractFirstCompleteJsonObjectFromText(c.content);

  try {
    JSON.parse(naive);
    console.log(`[${c.name}] naive=parse_ok extracted_len=${naive.length}`);
  } catch (e) {
    console.log(
      `[${c.name}] naive=parse_fail category=${categorizeParseFailure(naive)} extracted_len=${naive.length}`
    );
  }

  if (balanced.status === "complete") {
    try {
      JSON.parse(balanced.json);
      console.log(`[${c.name}] balanced=parse_ok extracted_len=${balanced.json.length}`);
    } catch {
      console.log(`[${c.name}] balanced=parse_fail extracted_len=${balanced.json.length}`);
    }
  } else {
    console.log(`[${c.name}] balanced=status=${balanced.status} extracted_len=${balanced.json ? balanced.json.length : 0}`);
  }
}
