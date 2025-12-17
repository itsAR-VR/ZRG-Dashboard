import "@/lib/server-dns";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { prisma } from "@/lib/prisma";

const CONFIDENCE_THRESHOLD = 0.95;

function isValidIanaTimezone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    // Throws RangeError on invalid IANA tz names
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeState(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Handle "CA", "California", "CA - ..." etc.
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;

  const match = upper.match(/\b([A-Z]{2})\b/);
  if (match?.[1]) return match[1];

  return trimmed;
}

function mapUsStateToTimezone(state: string): { timezone: string; confidence: number } | null {
  // Best-effort defaults (some states have multiple timezones; we choose the most common).
  const map: Record<string, string> = {
    AL: "America/Chicago",
    AK: "America/Anchorage",
    AZ: "America/Phoenix",
    AR: "America/Chicago",
    CA: "America/Los_Angeles",
    CO: "America/Denver",
    CT: "America/New_York",
    DE: "America/New_York",
    FL: "America/New_York",
    GA: "America/New_York",
    HI: "Pacific/Honolulu",
    ID: "America/Denver",
    IL: "America/Chicago",
    IN: "America/Indiana/Indianapolis",
    IA: "America/Chicago",
    KS: "America/Chicago",
    KY: "America/New_York",
    LA: "America/Chicago",
    ME: "America/New_York",
    MD: "America/New_York",
    MA: "America/New_York",
    MI: "America/Detroit",
    MN: "America/Chicago",
    MS: "America/Chicago",
    MO: "America/Chicago",
    MT: "America/Denver",
    NE: "America/Chicago",
    NV: "America/Los_Angeles",
    NH: "America/New_York",
    NJ: "America/New_York",
    NM: "America/Denver",
    NY: "America/New_York",
    NC: "America/New_York",
    ND: "America/Chicago",
    OH: "America/New_York",
    OK: "America/Chicago",
    OR: "America/Los_Angeles",
    PA: "America/New_York",
    RI: "America/New_York",
    SC: "America/New_York",
    SD: "America/Chicago",
    TN: "America/Chicago",
    TX: "America/Chicago",
    UT: "America/Denver",
    VT: "America/New_York",
    VA: "America/New_York",
    WA: "America/Los_Angeles",
    WV: "America/New_York",
    WI: "America/Chicago",
    WY: "America/Denver",
  };

  const timezone = map[state.toUpperCase()];
  if (!timezone) return null;
  return { timezone, confidence: 0.98 };
}

export async function ensureLeadTimezone(leadId: string): Promise<{
  timezone: string | null;
  source: "existing" | "deterministic" | "ai" | "workspace_fallback";
  confidence?: number;
}> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      clientId: true,
      timezone: true,
      companyState: true,
      phone: true,
      email: true,
      companyName: true,
      companyWebsite: true,
      client: { select: { settings: { select: { timezone: true } } } },
    },
  });

  if (!lead) {
    return { timezone: null, source: "workspace_fallback" };
  }

  if (isValidIanaTimezone(lead.timezone)) {
    return { timezone: lead.timezone!, source: "existing", confidence: 1 };
  }

  // Deterministic: if companyState is a US state code, use a best-effort timezone.
  const state = normalizeState(lead.companyState);
  if (state && /^[A-Z]{2}$/.test(state)) {
    const mapped = mapUsStateToTimezone(state);
    if (mapped?.timezone && isValidIanaTimezone(mapped.timezone) && mapped.confidence >= CONFIDENCE_THRESHOLD) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { timezone: mapped.timezone },
      });
      return { timezone: mapped.timezone, source: "deterministic", confidence: mapped.confidence };
    }
  }

  // AI inference (only if configured)
  if (!process.env.OPENAI_API_KEY) {
    const fallback = lead.client.settings?.timezone || null;
    return { timezone: fallback, source: "workspace_fallback" };
  }

  try {
    const promptTemplate = getAIPromptTemplate("timezone.infer.v1");
    const instructionsTemplate =
      promptTemplate?.messages.find((m) => m.role === "system")?.content ||
      "Infer the lead's IANA timezone. Output only JSON.";
    const instructions = instructionsTemplate.replaceAll(
      "{confidenceThreshold}",
      String(CONFIDENCE_THRESHOLD)
    );

    const { response, interactionId } = await runResponseWithInteraction({
      clientId: lead.clientId,
      leadId,
      featureId: promptTemplate?.featureId || "timezone.infer",
      promptKey: promptTemplate?.key || "timezone.infer.v1",
      params: {
        model: "gpt-5-nano",
        reasoning: { effort: "low" },
        max_output_tokens: 120,
        instructions,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "timezone_inference",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                timezone: { type: ["string", "null"] },
                confidence: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["timezone", "confidence"],
            },
          },
        },
        input: JSON.stringify(
          {
            companyState: lead.companyState,
            phone: lead.phone,
            email: lead.email,
            companyName: lead.companyName,
            companyWebsite: lead.companyWebsite,
            workspaceTimezone: lead.client.settings?.timezone || null,
          },
          null,
          2
        ),
        temperature: 0,
      },
    });

    const text = response.output_text?.trim();
    if (!text) {
      if (interactionId) {
        await markAiInteractionError(interactionId, "Post-process error: empty output_text");
      }
      const fallback = lead.client.settings?.timezone || null;
      return { timezone: fallback, source: "workspace_fallback" };
    }

    const jsonText = text.replace(/```json\n?|\n?```/g, "").trim();
    let parsed: { timezone: string | null; confidence: number };
    try {
      parsed = JSON.parse(jsonText) as { timezone: string | null; confidence: number };
    } catch (parseError) {
      if (interactionId) {
        await markAiInteractionError(
          interactionId,
          `Post-process error: failed to parse JSON (${parseError instanceof Error ? parseError.message : "unknown"})`
        );
      }
      const fallback = lead.client.settings?.timezone || null;
      return { timezone: fallback, source: "workspace_fallback" };
    }

    const tz = parsed?.timezone;
    const conf = typeof parsed?.confidence === "number" ? parsed.confidence : 0;

    if (tz && conf >= CONFIDENCE_THRESHOLD && isValidIanaTimezone(tz)) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { timezone: tz },
      });
      return { timezone: tz, source: "ai", confidence: conf };
    }

    const fallback = lead.client.settings?.timezone || null;
    return { timezone: fallback, source: "workspace_fallback", confidence: conf };
  } catch {
    const fallback = lead.client.settings?.timezone || null;
    return { timezone: fallback, source: "workspace_fallback" };
  }
}
