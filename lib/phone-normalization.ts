import "server-only";

import parsePhoneNumberFromString, { getCountries } from "libphonenumber-js/core";
import libPhoneMetadataMin from "libphonenumber-js/min/metadata";
import type { CountryCode, MetadataJson } from "libphonenumber-js";

import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { normalizePhoneDigits } from "@/lib/phone-utils";

export type PhoneE164Resolution =
  | { ok: true; e164: string; source: "explicit_e164" | "digits_e164" | "region_deterministic" | "default_calling_code" | "ai_region"; region?: string; confidence?: number }
  | { ok: false; e164: null; source: "none"; reason: string };

const LIBPHONENUMBER_METADATA: MetadataJson = ((libPhoneMetadataMin as any)?.default ?? libPhoneMetadataMin) as MetadataJson;

function normalizeInternationalPrefix(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("00")) return `+${trimmed.slice(2)}`;
  return trimmed;
}

function parseE164(value: string): string | null {
  const parsed = parsePhoneNumberFromString(value, LIBPHONENUMBER_METADATA);
  if (!parsed) return null;
  if (!parsed.isValid()) return null;
  return parsed.number;
}

function tryParseNationalToE164(digitsOnly: string, region: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(digitsOnly, region, LIBPHONENUMBER_METADATA);
  if (!parsed) return null;
  if (!parsed.isValid()) return null;
  return parsed.number;
}

function normalizeCountryCallingCode(value: string | null | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) return null;
  if (digits.length > 3) return null;
  return digits;
}

function inferDeterministicRegions(opts: {
  leadTimezone?: string | null;
  workspaceTimezone?: string | null;
  companyState?: string | null;
  email?: string | null;
  companyWebsite?: string | null;
}): CountryCode[] {
  const regions = new Set<CountryCode>();

  const tz = (opts.leadTimezone || opts.workspaceTimezone || "").trim();
  const tzMap: Array<[string, CountryCode]> = [
    ["Europe/London", "GB"],
    ["America/New_York", "US"],
    ["America/Chicago", "US"],
    ["America/Denver", "US"],
    ["America/Los_Angeles", "US"],
    ["America/Phoenix", "US"],
    ["America/Anchorage", "US"],
    ["Pacific/Honolulu", "US"],
    ["America/Sao_Paulo", "BR"],
    ["Asia/Singapore", "SG"],
    ["Asia/Kolkata", "IN"],
  ];
  for (const [prefix, region] of tzMap) {
    if (tz === prefix || tz.startsWith(`${prefix}/`)) {
      regions.add(region);
      break;
    }
  }

  const state = (opts.companyState || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(state)) {
    // Treat US state codes as US (best-effort; avoids inventing country codes from 11-digit nationals).
    regions.add("US");
  }

  const email = (opts.email || "").toLowerCase();
  const website = (opts.companyWebsite || "").toLowerCase();

  const hasUkSignal = /\.co\.uk\b/.test(email) || /\.co\.uk\b/.test(website) || /\b\.uk\b/.test(email) || /\b\.uk\b/.test(website);
  if (hasUkSignal) regions.add("GB");

  const tldSignals: Array<[RegExp, CountryCode]> = [
    [/\.com\.br\b|\.br\b/, "BR"],
    [/\.com\.au\b|\.au\b/, "AU"],
    [/\.ca\b/, "CA"],
    [/\.de\b/, "DE"],
    [/\.fr\b/, "FR"],
    [/\.in\b/, "IN"],
    [/\.sg\b/, "SG"],
    [/\.nl\b/, "NL"],
  ];
  for (const [pattern, region] of tldSignals) {
    if (pattern.test(email) || pattern.test(website)) {
      regions.add(region);
    }
  }

  return Array.from(regions);
}

function isSupportedCountryCode(value: string): value is CountryCode {
  if (!/^[A-Z]{2}$/.test(value)) return false;
  return (getCountries(LIBPHONENUMBER_METADATA) as string[]).includes(value);
}

function getAiEnabled(): boolean {
  return process.env.PHONE_E164_AI_ENABLED === "true";
}

function getAiConfidenceThreshold(): number {
  const parsed = Number.parseFloat(process.env.PHONE_E164_AI_CONFIDENCE_THRESHOLD || "");
  if (!Number.isFinite(parsed)) return 0.9;
  return Math.min(1, Math.max(0, parsed));
}

function getAiModel(): string {
  return (process.env.PHONE_E164_AI_MODEL || "gpt-5-mini").trim() || "gpt-5-mini";
}

export async function resolvePhoneE164ForGhl(opts: {
  clientId: string;
  leadId?: string | null;
  phone: string | null | undefined;
  leadTimezone?: string | null;
  workspaceTimezone?: string | null;
  companyState?: string | null;
  email?: string | null;
  companyWebsite?: string | null;
  defaultCountryCallingCode?: string | null;
}): Promise<PhoneE164Resolution> {
  const raw = (opts.phone || "").trim();
  if (!raw) return { ok: false, e164: null, source: "none", reason: "no_phone" };

  const normalizedPrefix = normalizeInternationalPrefix(raw);

  // 1) Explicit international inputs.
  if (normalizedPrefix.startsWith("+")) {
    const parsed = parseE164(normalizedPrefix);
    if (parsed) return { ok: true, e164: parsed, source: "explicit_e164" };
  }

  const digits = normalizePhoneDigits(normalizedPrefix);
  if (!digits) return { ok: false, e164: null, source: "none", reason: "no_digits" };
  if (digits.length > 15) return { ok: false, e164: null, source: "none", reason: "too_long" };

  // 2) Digits already include country calling code (stored without '+').
  const asE164 = parseE164(`+${digits}`);
  if (asE164) return { ok: true, e164: asE164, source: "digits_e164" };

  // 3) Deterministic region inference from existing signals.
  const regions = inferDeterministicRegions({
    leadTimezone: opts.leadTimezone,
    workspaceTimezone: opts.workspaceTimezone,
    companyState: opts.companyState,
    email: opts.email,
    companyWebsite: opts.companyWebsite,
  });
  for (const region of regions) {
    const candidate = tryParseNationalToE164(digits, region);
    if (candidate) return { ok: true, e164: candidate, source: "region_deterministic", region };
  }

  // 4) Deployment-level default calling code (best-effort; validated).
  const cc = normalizeCountryCallingCode(opts.defaultCountryCallingCode);
  if (cc) {
    const candidate = parseE164(`+${cc}${digits}`);
    if (candidate) return { ok: true, e164: candidate, source: "default_calling_code" };
  }

  // 5) Optional AI-assisted region inference for ambiguous national-format numbers.
  if (getAiEnabled() && process.env.OPENAI_API_KEY) {
    try {
      const systemFallback =
        "Infer the most likely ISO 3166-1 alpha-2 region code to parse the provided national phone digits into E.164. Output only JSON. If unsure, set region=null.";

      const input = JSON.stringify(
        {
          phoneRaw: raw,
          phoneDigits: digits,
          leadTimezone: opts.leadTimezone || null,
          workspaceTimezone: opts.workspaceTimezone || null,
          companyState: opts.companyState || null,
          email: opts.email || null,
          companyWebsite: opts.companyWebsite || null,
          defaultCountryCallingCode: opts.defaultCountryCallingCode || null,
        },
        null,
        2
      );

      const result = await runStructuredJsonPrompt<{ region: string | null; confidence: number }>({
        pattern: "structured_json",
        clientId: opts.clientId,
        leadId: opts.leadId || null,
        featureId: "phone.e164_region_infer",
        promptKey: "phone.e164_region_infer.v1",
        model: getAiModel(),
        reasoningEffort: "low",
        systemFallback,
        input,
        schemaName: "phone_e164_region_inference",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            region: { type: ["string", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["region", "confidence"],
        },
        budget: {
          min: 260,
          max: 260,
          retryMax: 520,
          overheadTokens: 96,
          outputScale: 0.2,
          preferApiCount: true,
        },
        validate: (value) => {
          const anyValue = value as any;
          if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
          const region = anyValue.region;
          const confidence = anyValue.confidence;
          if (!(typeof region === "string" || region === null)) return { success: false, error: "region must be string|null" };
          if (typeof confidence !== "number" || !Number.isFinite(confidence)) return { success: false, error: "confidence must be number" };
          return { success: true, data: { region, confidence } };
        },
      });

      if (result.success) {
        const regionRaw = (result.data.region || "").trim().toUpperCase();
        const conf = result.data.confidence;
        const threshold = getAiConfidenceThreshold();

        if (regionRaw && conf >= threshold && isSupportedCountryCode(regionRaw)) {
          const candidate = tryParseNationalToE164(digits, regionRaw);
          if (candidate) {
            return { ok: true, e164: candidate, source: "ai_region", region: regionRaw, confidence: conf };
          }
        }
      }
    } catch {
      // Ignore AI failures; fall through to none.
    }
  }

  return { ok: false, e164: null, source: "none", reason: "unresolved" };
}
