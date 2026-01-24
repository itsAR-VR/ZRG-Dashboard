import "@/lib/server-dns";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
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

function mapKnownRegionSignalsToTimezone(opts: {
  companyState?: string | null;
  phone?: string | null;
  email?: string | null;
  companyWebsite?: string | null;
}): { timezone: string; confidence: number } | null {
  const state = (opts.companyState || "").toLowerCase();
  const email = (opts.email || "").toLowerCase();
  const website = (opts.companyWebsite || "").toLowerCase();
  const phone = (opts.phone || "").replace(/\s+/g, "");

  const looksUk =
    /\b(united kingdom|uk|england|scotland|wales|london|gb)\b/.test(state) ||
    /\.co\.uk\b/.test(email) ||
    /\.co\.uk\b/.test(website) ||
    phone.startsWith("+44");

  if (looksUk) {
    return { timezone: "Europe/London", confidence: 0.98 };
  }

  return null;
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

  // Deterministic: known region signals (e.g., UK).
  const known = mapKnownRegionSignalsToTimezone({
    companyState: lead.companyState,
    phone: lead.phone,
    email: lead.email,
    companyWebsite: lead.companyWebsite,
  });
  if (known?.timezone && isValidIanaTimezone(known.timezone) && known.confidence >= CONFIDENCE_THRESHOLD) {
    if (isValidIanaTimezone(lead.timezone) && lead.timezone === known.timezone) {
      return { timezone: lead.timezone!, source: "existing", confidence: 1 };
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { timezone: known.timezone },
    });
    return { timezone: known.timezone, source: "deterministic", confidence: known.confidence };
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
    const systemFallback = "Infer the lead's IANA timezone. Output only JSON.";
    const input = JSON.stringify(
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
    );

    const result = await runStructuredJsonPrompt<{ timezone: string | null; confidence: number }>({
      pattern: "structured_json",
      clientId: lead.clientId,
      leadId,
      featureId: "timezone.infer",
      promptKey: "timezone.infer.v1",
      model: "gpt-5-nano",
      reasoningEffort: "low",
      systemFallback,
      templateVars: { confidenceThreshold: String(CONFIDENCE_THRESHOLD) },
      input,
      schemaName: "timezone_inference",
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
      budget: {
        min: 240,
        max: 240,
        retryMax: 480,
        overheadTokens: 96,
        outputScale: 0.2,
        preferApiCount: true,
      },
      validate: (value) => {
        const anyValue = value as any;
        if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
        const timezone = anyValue.timezone;
        const confidence = anyValue.confidence;
        if (!(typeof timezone === "string" || timezone === null)) return { success: false, error: "timezone must be string|null" };
        if (typeof confidence !== "number" || !Number.isFinite(confidence)) return { success: false, error: "confidence must be number" };
        return { success: true, data: { timezone, confidence } };
      },
    });

    if (!result.success) {
      const fallback = lead.client.settings?.timezone || null;
      return { timezone: fallback, source: "workspace_fallback" };
    }

    const tz = result.data.timezone;
    const conf = result.data.confidence;

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
