/**
 * AI-powered email signature/footer context extraction for draft generation.
 *
 * Goal: given an email's original body (rawText/rawHtml), extract only the important
 * contact + scheduling-link info from the signature/footer and drop boilerplate.
 */

import "server-only";
import "@/lib/server-dns";

import { runStructuredJsonPrompt, runTextPrompt } from "@/lib/ai/prompt-runner";
import { extractFirstCompleteJsonObjectFromText } from "@/lib/ai/response-utils";
import { normalizeLinkedInUrl } from "@/lib/linkedin-utils";
import { toStoredPhone } from "@/lib/phone-utils";

export type EmailSignatureContextExtraction = {
  name: string | null;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  schedulingLinks: string[];
  otherLinks: string[];
  importantLines: string[];
  confidence: "high" | "medium" | "low";
};

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function decodeBasicHtmlEntities(input: string): string {
  return input
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[),.;:\]\}]+$/g, "");
}

function normalizeUrlCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cleaned = stripTrailingPunctuation(trimmed);
  const withScheme = cleaned.startsWith("http://") || cleaned.startsWith("https://") ? cleaned : cleaned.startsWith("www.") ? `https://${cleaned}` : null;
  if (!withScheme) return null;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractUrlsFromText(text: string): string[] {
  const raw = text || "";
  if (!raw.trim()) return [];

  const candidates = raw.match(/https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi) || [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = normalizeUrlCandidate(candidate);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 25) break;
  }

  return out;
}

function stripQuotedThreadSections(text: string): string {
  let result = normalizeNewlines(text || "");
  if (!result.trim()) return "";

  result = result
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");

  const threadMarkers: RegExp[] = [
    /On .*wrote:/i,
    /^From:\s.+$/im,
    /^Sent:\s.+$/im,
    /^To:\s.+$/im,
    /^Subject:\s.+$/im,
    /^-----Original Message-----$/im,
  ];

  let earliestMarkerIndex = -1;
  for (const marker of threadMarkers) {
    const idx = result.search(marker);
    if (idx !== -1 && (earliestMarkerIndex === -1 || idx < earliestMarkerIndex)) {
      earliestMarkerIndex = idx;
    }
  }
  if (earliestMarkerIndex !== -1) {
    result = result.slice(0, earliestMarkerIndex);
  }

  return result.trim();
}

function htmlToPlainTextPreservingAnchorHrefs(html: string): string {
  const withoutScripts = (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "");

  const anchorsPreserved = withoutScripts.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const text = decodeBasicHtmlEntities(stripHtmlTags(String(inner || "")).replace(/\s+/g, " ").trim());
    const normalized = normalizeUrlCandidate(decodeBasicHtmlEntities(String(href || "")));
    if (!normalized) return text || "";
    return text ? `${text} (${normalized})` : normalized;
  });

  const withBreaks = anchorsPreserved
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n");

  const noTags = stripHtmlTags(withBreaks);
  const decoded = decodeBasicHtmlEntities(noTags);

  return decoded.replace(/\n{3,}/g, "\n\n").trim();
}

function extractSignatureFooterCandidate(text: string): string {
  const stripped = stripQuotedThreadSections(text);
  if (!stripped) return "";

  // Signature delimiter: "--" on its own line.
  const delimiterIndex = stripped.search(/^\s*--\s*$/m);
  if (delimiterIndex !== -1) {
    return stripped.slice(delimiterIndex).trim();
  }

  const lines = stripped.split("\n");
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();

  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const urlPattern = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
  const phonePattern = /(?:\+?\d{1,3}[-.\s]?)?(?:\(\d{2,4}\)|\d{2,4})[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/;
  const signatureLabelPattern = /\b(tel|telephone|phone|mobile|cell|direct|whats\s*app|whatsapp|linkedin|website|www)\b|(?:^|\s)(t:|m:|p:|e:)\b/i;

  // Find last blank line as a separator between body and footer.
  let lastBlankLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) {
      lastBlankLine = i;
      break;
    }
  }

  if (lastBlankLine !== -1) {
    const footer = lines.slice(lastBlankLine + 1).filter((l) => l.trim());
    if (footer.length >= 1) {
      const footerText = footer.join("\n");
      const looksLikeSignature =
        emailPattern.test(footerText) ||
        urlPattern.test(footerText) ||
        phonePattern.test(footerText) ||
        signatureLabelPattern.test(footerText);

      if (looksLikeSignature) {
        return footerText.trim();
      }
    }
  }

  // Fallback: take the last N lines (signature is typically at the bottom).
  return lines.slice(Math.max(0, lines.length - 20)).join("\n").trim();
}

function clampSignatureCandidate(input: string): string {
  const normalized = normalizeNewlines(input || "").trim();
  if (!normalized) return "";

  // Prefer a tail slice (signatures are at the bottom).
  const maxChars = 6000;
  const tail = normalized.length > maxChars ? normalized.slice(-maxChars) : normalized;

  const lines = tail.split("\n");
  const maxLines = 120;
  const sliced = lines.length > maxLines ? lines.slice(lines.length - maxLines).join("\n") : tail;

  return sliced.trim();
}

function hasSignatureSignal(text: string): boolean {
  return /(https?:\/\/|www\.|calendly\.com|meetings\.hubspot\.com|hubspot\.com\/meetings|msgsndr\.com|gohighlevel\.com|linkedin\.com|\b(tel|phone|mobile|direct)\b|\b(t:|m:|p:|e:)\b|@)/i.test(
    text || ""
  );
}

function uniqBy<T>(items: T[], key: (item: T) => string): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function normalizeExtractedTextLine(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > 160 ? trimmed.slice(0, 160) : trimmed;
}

function normalizeExtractedUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const normalized = normalizeUrlCandidate(input);
  return normalized;
}

function clampTextField(input: unknown, maxLen: number): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

export async function extractImportantEmailSignatureContext(opts: {
  clientId: string;
  leadId?: string | null;
  leadName?: string | null;
  leadEmail?: string | null;
  rawText?: string | null;
  rawHtml?: string | null;
  timeoutMs?: number;
}): Promise<EmailSignatureContextExtraction | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const sourceText = (() => {
    const rawText = (opts.rawText || "").trim();
    if (rawText) return rawText;
    const rawHtml = (opts.rawHtml || "").trim();
    if (rawHtml) return htmlToPlainTextPreservingAnchorHrefs(rawHtml);
    return "";
  })();

  const clamped = clampSignatureCandidate(sourceText);
  if (!clamped) return null;
  if (!hasSignatureSignal(clamped)) return null;

  const signatureFooterCandidate = extractSignatureFooterCandidate(clamped);
  if (!signatureFooterCandidate) return null;

  const detectedUrls = extractUrlsFromText(signatureFooterCandidate);

  const leadName = opts.leadName?.trim() || "Unknown";
  const leadEmail = opts.leadEmail?.trim() || "unknown@example.com";

  const systemFallback =
    "Extract the important contact + scheduling-link info from an email signature/footer. Output valid JSON only.";

  const input = `Expected lead: ${leadName} <${leadEmail}>\n\nSignature/footer candidate (may include junk/disclaimers):\n${signatureFooterCandidate.slice(0, 5000)}\n\nDetected URLs (choose only from these; do not invent):\n${detectedUrls.map((u) => `- ${u}`).join("\n") || "(none)"}`;

  const structured = await runStructuredJsonPrompt<EmailSignatureContextExtraction>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    featureId: "signature.context",
    promptKey: "signature.context.v1",
    model: "gpt-5-nano",
    reasoningEffort: "minimal",
    systemFallback,
    templateVars: { leadName, leadEmail },
    input,
    schemaName: "email_signature_context",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: ["string", "null"] },
        title: { type: ["string", "null"] },
        company: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        phone: { type: ["string", "null"] },
        linkedinUrl: { type: ["string", "null"] },
        schedulingLinks: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
        otherLinks: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 10 },
        importantLines: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 10 },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: [
        "name",
        "title",
        "company",
        "email",
        "phone",
        "linkedinUrl",
        "schedulingLinks",
        "otherLinks",
        "importantLines",
        "confidence",
      ],
    },
    budget: {
      min: 300,
      max: 900,
      retryMax: 1600,
      retryMinBaseTokens: 600,
      retryExtraTokens: 500,
      overheadTokens: 256,
      outputScale: 0.15,
      preferApiCount: true,
    },
    timeoutMs: typeof opts.timeoutMs === "number" ? Math.max(1000, Math.trunc(opts.timeoutMs)) : 4500,
    maxRetries: 0,
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };

      const confidence = anyValue.confidence;
      if (!["high", "medium", "low"].includes(confidence)) return { success: false, error: "confidence invalid" };

      const normalizeUrls = (list: unknown, max: number): string[] => {
        if (!Array.isArray(list)) return [];
        const out: string[] = [];
        for (const item of list) {
          const normalized = normalizeExtractedUrl(item);
          if (!normalized) continue;
          out.push(normalized);
          if (out.length >= max) break;
        }
        return uniqBy(out, (u) => u);
      };

      const schedulingLinks = normalizeUrls(anyValue.schedulingLinks, 5);
      const otherLinks = normalizeUrls(anyValue.otherLinks, 10);

      // Safety: prefer links we actually observed in the input.
      const observed = new Set(detectedUrls);
      const filterObserved = (u: string) => observed.has(u);
      const schedulingObserved = schedulingLinks.filter(filterObserved);
      const otherObserved = otherLinks.filter(filterObserved);

      const importantLines = (() => {
        if (!Array.isArray(anyValue.importantLines)) return [];
        const out: string[] = [];
        for (const item of anyValue.importantLines) {
          const line = normalizeExtractedTextLine(item);
          if (!line) continue;
          out.push(line);
          if (out.length >= 10) break;
        }
        return out;
      })();

      const linkedinUrl = (() => {
        const raw = clampTextField(anyValue.linkedinUrl, 256);
        return raw ? normalizeLinkedInUrl(raw) : null;
      })();

      const phone = (() => {
        const raw = clampTextField(anyValue.phone, 64);
        return raw ? toStoredPhone(raw) : null;
      })();

      const email = clampTextField(anyValue.email, 254);
      const name = clampTextField(anyValue.name, 120);
      const title = clampTextField(anyValue.title, 120);
      const company = clampTextField(anyValue.company, 160);

      return {
        success: true,
        data: {
          name,
          title,
          company,
          email,
          phone,
          linkedinUrl,
          // Extra safety: only trust observed links.
          schedulingLinks: schedulingObserved,
          otherLinks: otherObserved.filter((u) => !schedulingObserved.includes(u)),
          importantLines,
          confidence,
        },
      };
    },
  });

  let parsed: EmailSignatureContextExtraction | null = structured.success ? structured.data : null;

  if (!parsed && !structured.success) {
    const msg = structured.error.message.toLowerCase();
    const looksLikeSchemaUnsupported =
      msg.includes("json_schema") ||
      msg.includes("response_format") ||
      msg.includes("structured") ||
      msg.includes("text.format") ||
      msg.includes("invalid schema");

    if (looksLikeSchemaUnsupported) {
      console.warn("[SignatureContext] Structured output rejected, retrying without json_schema");
      const fallback = await runTextPrompt({
        pattern: "text",
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: "signature.context",
        promptKey: "signature.context.v1",
        model: "gpt-5-nano",
        reasoningEffort: "minimal",
        systemFallback,
        templateVars: { leadName, leadEmail },
        input,
        maxOutputTokens: 1600,
        timeoutMs: typeof opts.timeoutMs === "number" ? Math.max(1000, Math.trunc(opts.timeoutMs)) : 4500,
        maxRetries: 0,
      });

      if (fallback.success) {
        const extracted = extractFirstCompleteJsonObjectFromText(fallback.data);
        if (extracted.status === "complete") {
          try {
            parsed = JSON.parse(extracted.json) as EmailSignatureContextExtraction;
          } catch {
            parsed = null;
          }
        }
      }
    }
  }

  if (!parsed) return null;

  const schedulingLinks = uniqBy(parsed.schedulingLinks, (u) => u);
  const otherLinks = uniqBy(parsed.otherLinks, (u) => u).filter((u) => !schedulingLinks.includes(u));

  const finalResult: EmailSignatureContextExtraction = { ...parsed, schedulingLinks, otherLinks };

  const hasAny =
    Boolean(finalResult.phone) ||
    Boolean(finalResult.linkedinUrl) ||
    finalResult.schedulingLinks.length > 0 ||
    finalResult.otherLinks.length > 0 ||
    finalResult.importantLines.length > 0;

  return hasAny ? finalResult : null;
}
