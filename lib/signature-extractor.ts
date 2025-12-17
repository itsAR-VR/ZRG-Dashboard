/**
 * AI-powered email signature extraction
 * Uses GPT-5-mini to intelligently extract contact info from email signatures
 * while verifying the email is from the actual lead (not an assistant)
 */

import "@/lib/server-dns";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { runResponse } from "@/lib/ai/openai-telemetry";
import { normalizeLinkedInUrl } from "./linkedin-utils";
import { normalizePhone } from "./lead-matching";

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

  try {
    const promptTemplate = getAIPromptTemplate("signature.extract.v1");
    const instructionsTemplate =
      promptTemplate?.messages.find((m) => m.role === "system")?.content ||
      "Extract contact info from the signature and return JSON.";
    const instructions = instructionsTemplate
      .replaceAll("{leadName}", leadName)
      .replaceAll("{leadEmail}", leadEmail);

    // GPT-5-nano for signature extraction using Responses API
    // Use low reasoning effort to ensure we get a textual JSON output within the token budget.
    const response = await runResponse({
      clientId: meta.clientId,
      leadId: meta.leadId,
      featureId: promptTemplate?.featureId || "signature.extract",
      promptKey: promptTemplate?.key || "signature.extract.v1",
      params: {
        model: "gpt-5-nano",
        instructions,
        input: `Email from: ${leadEmail}
Expected lead name: ${leadName}

Email body:
${emailBody.slice(0, 5000)}`,
        reasoning: { effort: "low" },
        max_output_tokens: 200,
      },
    });

    const content = response.output_text?.trim();

    if (!content) {
      console.log("[SignatureExtractor] No response from AI");
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
      // Handle potential markdown code blocks
      const jsonContent = content.replace(/```json\n?|\n?```/g, "").trim();
      parsed = JSON.parse(jsonContent);
    } catch {
      console.error("[SignatureExtractor] Failed to parse AI response:", content);
      return defaultResult;
    }

    // Validate and normalize results
    const result: SignatureExtractionResult = {
      isFromLead: Boolean(parsed.isFromLead),
      phone: parsed.phone ? normalizePhone(parsed.phone) : null,
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
          return normalizePhone(match);
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
