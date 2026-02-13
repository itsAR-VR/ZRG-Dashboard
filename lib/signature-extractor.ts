/**
 * AI-powered email signature extraction
 * Uses GPT-5-mini to intelligently extract contact info from email signatures
 * while verifying the email is from the actual lead (not an assistant)
 */

import "@/lib/server-dns";
import { runStructuredJsonPrompt, runTextPrompt } from "@/lib/ai/prompt-runner";
import { extractFirstCompleteJsonObjectFromText } from "@/lib/ai/response-utils";
import { normalizeLinkedInUrl, normalizeLinkedInUrlAny } from "./linkedin-utils";
import { toStoredPhone } from "./phone-utils";

export interface SignatureExtractionResult {
  isFromLead: "yes" | "no" | "unknown"; // AI confirms email is from the actual lead (or unknown on failure)
  phone: string | null;      // Extracted phone (normalized)
  linkedinUrl: string | null; // Extracted LinkedIn URL (normalized)
  confidence: "high" | "medium" | "low";
  reasoning?: string;        // Brief explanation of extraction
}

/**
 * Extract contact information from an email signature using AI
 * Verifies the email is from the actual lead before extracting
 * 
 * @param emailBody - The full email body text
 * @param leadName - The lead's name (first + last)
 * @param leadEmail - The lead's email address
 * @returns Extraction result with phone and LinkedIn URL if found
 */
export async function extractContactFromSignature(
  emailBody: string,
  leadName: string,
  leadEmail: string,
  meta: { clientId: string; leadId?: string | null }
): Promise<SignatureExtractionResult> {
  // Default result for failures
  const defaultResult: SignatureExtractionResult = {
    isFromLead: "unknown",
    phone: null,
    linkedinUrl: null,
    confidence: "low",
  };

  if (!emailBody || !process.env.OPENAI_API_KEY) {
    return defaultResult;
  }

  const systemFallback = "Extract contact info from the signature and return JSON.";

  try {
    const signatureInput = `Email from: ${leadEmail}
Expected lead name: ${leadName}

Email body:
${emailBody.slice(0, 5000)}`;

    const structured = await runStructuredJsonPrompt<{
      isFromLead: boolean;
      phone: string | null;
      linkedinUrl: string | null;
      confidence: "high" | "medium" | "low";
      reasoning?: string;
    }>({
      pattern: "structured_json",
      clientId: meta.clientId,
      leadId: meta.leadId,
      featureId: "signature.extract",
      promptKey: "signature.extract.v1",
      model: "gpt-5-nano",
      reasoningEffort: "minimal",
      systemFallback,
      templateVars: { leadName, leadEmail },
      input: signatureInput,
      schemaName: "signature_extraction",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          isFromLead: { type: "boolean" },
          phone: { type: ["string", "null"] },
          linkedinUrl: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reasoning: { type: ["string", "null"] },
        },
        required: ["isFromLead", "phone", "linkedinUrl", "confidence", "reasoning"],
      },
      budget: {
        min: 500,
        max: 1200,
        retryMax: 2400,
        retryMinBaseTokens: 700,
        retryExtraTokens: 600,
        overheadTokens: 256,
        outputScale: 0.2,
        preferApiCount: true,
      },
      validate: (value) => {
        const anyValue = value as any;
        if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
        if (typeof anyValue.isFromLead !== "boolean") return { success: false, error: "isFromLead must be boolean" };
        if (!(typeof anyValue.phone === "string" || anyValue.phone === null)) return { success: false, error: "phone must be string|null" };
        if (!(typeof anyValue.linkedinUrl === "string" || anyValue.linkedinUrl === null)) return { success: false, error: "linkedinUrl must be string|null" };
        if (!["high", "medium", "low"].includes(anyValue.confidence)) return { success: false, error: "confidence invalid" };
        return {
          success: true,
          data: {
            isFromLead: anyValue.isFromLead,
            phone: anyValue.phone,
            linkedinUrl: anyValue.linkedinUrl,
            confidence: anyValue.confidence,
            ...(typeof anyValue.reasoning === "string" ? { reasoning: anyValue.reasoning } : {}),
          },
        };
      },
    });

    let parsed = structured.success ? structured.data : null;

    if (!parsed && !structured.success) {
      const msg = structured.error.message.toLowerCase();
      const looksLikeSchemaUnsupported =
        msg.includes("json_schema") ||
        msg.includes("response_format") ||
        msg.includes("structured") ||
        msg.includes("text.format") ||
        msg.includes("invalid schema");

      if (looksLikeSchemaUnsupported) {
        console.warn("[SignatureExtractor] Structured output rejected, retrying without json_schema");
        const fallback = await runTextPrompt({
          pattern: "text",
          clientId: meta.clientId,
          leadId: meta.leadId,
          featureId: "signature.extract",
          promptKey: "signature.extract.v1",
          model: "gpt-5-nano",
          reasoningEffort: "minimal",
          systemFallback,
          templateVars: { leadName, leadEmail },
          input: signatureInput,
          maxOutputTokens: 2400,
        });

        if (fallback.success) {
          const extracted = extractFirstCompleteJsonObjectFromText(fallback.data);
          if (extracted.status === "complete") {
            try {
              parsed = JSON.parse(extracted.json) as typeof parsed;
            } catch {
              parsed = null;
            }
          }
        }
      }
    }

    if (!parsed || typeof parsed.isFromLead !== "boolean" || !["high", "medium", "low"].includes(parsed.confidence)) {
      return defaultResult;
    }

    const result: SignatureExtractionResult = {
      isFromLead: parsed.isFromLead ? "yes" : "no",
      phone: parsed.phone ? toStoredPhone(parsed.phone) : null,
      linkedinUrl: parsed.linkedinUrl ? normalizeLinkedInUrlAny(parsed.linkedinUrl) : null,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    };

    console.log(
      `[SignatureExtractor] Result: isFromLead=${result.isFromLead}, confidence=${result.confidence}, hasPhone=${Boolean(result.phone)}, hasLinkedIn=${Boolean(result.linkedinUrl)}`
    );

    return result;
  } catch (error) {
    console.error("[SignatureExtractor] AI extraction failed:", error);
    return defaultResult;
  }
}

/**
 * Simple regex-based phone extraction as fallback
 * Used when AI is not available or for validation
 */
export function extractPhoneFromText(text: string): string | null {
  if (!text) return null;

  // Common phone number patterns
  const patterns = [
    // International format: +1 234-567-8901
    /\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    // US format: (234) 567-8901 or 234-567-8901
    /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      // Return the first match that looks like a real phone number
      for (const match of matches) {
        const digits = match.replace(/\D/g, "");
        // Valid phone numbers have 10-15 digits
        if (digits.length >= 10 && digits.length <= 15) {
          return toStoredPhone(match);
        }
      }
    }
  }

  return null;
}

/**
 * Extract LinkedIn URL from text using regex
 */
export function extractLinkedInFromText(text: string): string | null {
  if (!text) return null;

  // LinkedIn URL patterns
  const patterns = [
    // Standard LinkedIn profile URL
    /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)\/?/gi,
    // LinkedIn company URL (less common for leads)
    /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9_-]+)\/?/gi,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[0]) {
      return normalizeLinkedInUrlAny(match[0]);
    }
  }

  return null;
}

/**
 * Result from extracting contact info from message content
 */
export interface MessageContentExtractionResult {
  phone: string | null;
  linkedinUrl: string | null;
  foundInMessage: boolean;
}

/**
 * Extract phone number and LinkedIn URL from the FULL message content
 * This should run BEFORE signature extraction and Clay enrichment
 * 
 * Looks for contact info anywhere in the message body, including:
 * - Phone numbers mentioned in the text (e.g., "reach me at 555-123-4567")
 * - LinkedIn URLs shared in the message
 * 
 * This is a quick regex-based extraction (no AI) that should be the first
 * step in the enrichment sequence to avoid unnecessary API calls.
 * 
 * @param messageBody - The full message body text
 * @returns Extracted phone and LinkedIn URL if found
 */
export function extractContactFromMessageContent(
  messageBody: string
): MessageContentExtractionResult {
  const result: MessageContentExtractionResult = {
    phone: null,
    linkedinUrl: null,
    foundInMessage: false,
  };

  if (!messageBody) {
    return result;
  }

  // Extract phone from message body
  const phone = extractPhoneFromText(messageBody);
  if (phone) {
    result.phone = phone;
    result.foundInMessage = true;
    console.log(`[MessageExtractor] Found phone in message: ${phone}`);
  }

  // Extract LinkedIn from message body
  const linkedin = extractLinkedInFromText(messageBody);
  if (linkedin) {
    result.foundInMessage = true;
    const normalized = normalizeLinkedInUrlAny(linkedin);
    if (normalized) {
      result.linkedinUrl = normalized;
      console.log(`[MessageExtractor] Found LinkedIn in message: ${normalized}`);
    } else {
      console.log(`[MessageExtractor] Found non-profile LinkedIn in message: ${linkedin}`);
    }
  }

  return result;
}
