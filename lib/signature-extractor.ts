/**
 * AI-powered email signature extraction
 * Uses GPT-5-mini to intelligently extract contact info from email signatures
 * while verifying the email is from the actual lead (not an assistant)
 */

import "@/lib/server-dns";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { extractJsonObjectFromText, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";
import { normalizeLinkedInUrl } from "./linkedin-utils";
import { toStoredPhone } from "./phone-utils";

export interface SignatureExtractionResult {
  isFromLead: boolean;       // AI confirms email is from the actual lead
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
    isFromLead: false,
    phone: null,
    linkedinUrl: null,
    confidence: "low",
  };

  if (!emailBody || !process.env.OPENAI_API_KEY) {
    return defaultResult;
  }

  const promptTemplate = getAIPromptTemplate("signature.extract.v1");
  const instructionsTemplate =
    promptTemplate?.messages.find((m) => m.role === "system")?.content ||
    "Extract contact info from the signature and return JSON.";
  const instructions = instructionsTemplate
    .replaceAll("{leadName}", leadName)
    .replaceAll("{leadEmail}", leadEmail);

  try {
    // GPT-5-nano for signature extraction using Responses API
    // Use low reasoning effort to ensure we get a textual JSON output within the token budget.
    const signatureInput = `Email from: ${leadEmail}
Expected lead name: ${leadName}

Email body:
${emailBody.slice(0, 5000)}`;

    let response: Awaited<ReturnType<typeof runResponseWithInteraction>>["response"];
    let interactionId: string | null = null;

    try {
      const result = await runResponseWithInteraction({
        clientId: meta.clientId,
        leadId: meta.leadId,
        featureId: promptTemplate?.featureId || "signature.extract",
        promptKey: promptTemplate?.key || "signature.extract.v1",
        params: {
          model: "gpt-5-nano",
          temperature: 0,
          instructions,
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "signature_extraction",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  isFromLead: { type: "boolean" },
                  phone: { type: ["string", "null"] },
                  linkedinUrl: { type: ["string", "null"] },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                },
                required: ["isFromLead", "phone", "linkedinUrl", "confidence"],
              },
            },
          },
          input: signatureInput,
          reasoning: { effort: "minimal" },
          // `max_output_tokens` includes reasoning tokens; keep headroom so we don't
          // end up with an empty/truncated JSON body.
          max_output_tokens: 450,
        },
      });
      response = result.response;
      interactionId = result.interactionId;
    } catch (error) {
      // Fallback: if Structured Outputs are unsupported/rejected, retry without json_schema.
      const msg = error instanceof Error ? error.message : String(error);
      const lower = msg.toLowerCase();
      const looksLikeSchemaUnsupported =
        lower.includes("json_schema") ||
        lower.includes("response_format") ||
        lower.includes("structured") ||
        lower.includes("text.format") ||
        lower.includes("invalid schema");

      if (!looksLikeSchemaUnsupported) {
        throw error;
      }

      console.warn("[SignatureExtractor] Structured output rejected, retrying without json_schema");

      const result = await runResponseWithInteraction({
        clientId: meta.clientId,
        leadId: meta.leadId,
        featureId: promptTemplate?.featureId || "signature.extract",
        promptKey: (promptTemplate?.key || "signature.extract.v1") + ".fallback",
        params: {
          model: "gpt-5-nano",
          temperature: 0,
          instructions,
          input: signatureInput,
          reasoning: { effort: "minimal" },
          max_output_tokens: 450,
        },
      });

      response = result.response;
      interactionId = result.interactionId;
    }

    const content = getTrimmedOutputText(response);

    if (!content) {
      console.log("[SignatureExtractor] No response from AI");
      if (interactionId) {
        const details = summarizeResponseForTelemetry(response);
        await markAiInteractionError(
          interactionId,
          `Post-process error: empty output_text${details ? ` (${details})` : ""}`
        );
      }
      return defaultResult;
    }

    // Parse JSON response
    let parsed: {
      isFromLead: boolean;
      phone: string | null;
      linkedinUrl: string | null;
      confidence: "high" | "medium" | "low";
      reasoning?: string;
    };

    try {
      parsed = JSON.parse(extractJsonObjectFromText(content));
    } catch (parseError) {
      if (interactionId) {
        const details = summarizeResponseForTelemetry(response);
        await markAiInteractionError(
          interactionId,
          `Post-process error: failed to parse JSON (${parseError instanceof Error ? parseError.message : "unknown"})${
            details ? ` (${details})` : ""
          }`
        );
      }
      console.error("[SignatureExtractor] Failed to parse AI response:", content);
      return defaultResult;
    }

    // Validate and normalize results
    if (typeof parsed?.isFromLead !== "boolean" || !["high", "medium", "low"].includes(parsed?.confidence)) {
      if (interactionId) {
        await markAiInteractionError(interactionId, "Post-process error: invalid JSON shape for signature extraction");
      }
      console.error("[SignatureExtractor] Invalid JSON shape:", parsed);
      return defaultResult;
    }

    const result: SignatureExtractionResult = {
      isFromLead: Boolean(parsed.isFromLead),
      phone: parsed.phone ? toStoredPhone(parsed.phone) : null,
      linkedinUrl: parsed.linkedinUrl ? normalizeLinkedInUrl(parsed.linkedinUrl) : null,
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
      reasoning: parsed.reasoning,
    };

    console.log(`[SignatureExtractor] Result: isFromLead=${result.isFromLead}, phone=${result.phone}, linkedin=${result.linkedinUrl}, confidence=${result.confidence}`);

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
      return normalizeLinkedInUrl(match[0]);
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
    result.linkedinUrl = linkedin;
    result.foundInMessage = true;
    console.log(`[MessageExtractor] Found LinkedIn in message: ${linkedin}`);
  }

  return result;
}
