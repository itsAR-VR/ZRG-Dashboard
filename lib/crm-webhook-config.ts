import { isPrivateNetworkHostname } from "@/lib/knowledge-asset-update";

export const CRM_WEBHOOK_EVENT_TYPES = ["lead_created", "crm_row_updated"] as const;
export type CrmWebhookEventType = (typeof CRM_WEBHOOK_EVENT_TYPES)[number];

const CRM_WEBHOOK_EVENT_SET = new Set<string>(CRM_WEBHOOK_EVENT_TYPES);

export const CRM_WEBHOOK_SIGNATURE_HEADER = "x-zrg-signature";
export const CRM_WEBHOOK_TIMESTAMP_HEADER = "x-zrg-timestamp";
export const CRM_WEBHOOK_DELIVERY_ID_HEADER = "x-zrg-delivery-id";
export const CRM_WEBHOOK_EVENT_HEADER = "x-zrg-event";
export const CRM_WEBHOOK_SIGNATURE_ALGORITHM_HEADER = "x-zrg-signature-algorithm";
export const CRM_WEBHOOK_SIGNATURE_ALGORITHM = "hmac-sha256";

export type CrmWebhookSettingsPatch = {
  crmWebhookEnabled?: boolean;
  crmWebhookUrl?: string | null;
  crmWebhookEvents?: CrmWebhookEventType[];
  crmWebhookSecret?: string | null;
};

export type CrmWebhookDispatchConfig = {
  enabled: boolean;
  url: string | null;
  events: CrmWebhookEventType[];
  secret: string | null;
};

export function isCrmWebhookEventType(value: string): value is CrmWebhookEventType {
  return CRM_WEBHOOK_EVENT_SET.has(value);
}

export function normalizeCrmWebhookUrl(value: string | null | undefined): {
  value: string | null;
  error?: string;
} {
  if (value === undefined || value === null) return { value: null };
  const trimmed = value.trim();
  if (!trimmed) return { value: null };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { value: null, error: "crmWebhookUrl must be a valid URL" };
  }

  if (parsed.protocol !== "https:") {
    return { value: null, error: "crmWebhookUrl must use https://" };
  }

  if (isPrivateNetworkHostname(parsed.hostname)) {
    return { value: null, error: "crmWebhookUrl hostname is not allowed" };
  }

  return { value: parsed.href };
}

export function normalizeStoredCrmWebhookEvents(raw: unknown): CrmWebhookEventType[] {
  const events = Array.isArray(raw) ? raw : [];
  const deduped: CrmWebhookEventType[] = [];
  const seen = new Set<CrmWebhookEventType>();
  for (const item of events) {
    if (typeof item !== "string") continue;
    const normalized = item.trim().toLowerCase();
    if (!isCrmWebhookEventType(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}

function normalizeCrmWebhookEventsInput(raw: unknown): {
  value: CrmWebhookEventType[];
  error?: string;
} {
  if (raw === null) return { value: [] };

  const source =
    typeof raw === "string"
      ? raw
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      : Array.isArray(raw)
        ? raw
        : null;

  if (!source) {
    return { value: [], error: "crmWebhookEvents must be an array of strings" };
  }

  const deduped: CrmWebhookEventType[] = [];
  const seen = new Set<CrmWebhookEventType>();

  for (const item of source) {
    if (typeof item !== "string") {
      return { value: [], error: "crmWebhookEvents must only contain strings" };
    }
    const normalized = item.trim().toLowerCase();
    if (!isCrmWebhookEventType(normalized)) {
      return { value: [], error: `Unsupported crmWebhookEvents value: ${item}` };
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }

  return { value: deduped };
}

export function normalizeCrmWebhookSecret(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeCrmWebhookSettingsPatch(input: {
  crmWebhookEnabled?: unknown;
  crmWebhookUrl?: unknown;
  crmWebhookEvents?: unknown;
  crmWebhookSecret?: unknown;
}): { values: CrmWebhookSettingsPatch; error?: string } {
  const values: CrmWebhookSettingsPatch = {};

  if (input.crmWebhookEnabled !== undefined) {
    if (typeof input.crmWebhookEnabled !== "boolean") {
      return { values, error: "crmWebhookEnabled must be a boolean" };
    }
    values.crmWebhookEnabled = input.crmWebhookEnabled;
  }

  if (input.crmWebhookUrl !== undefined) {
    if (input.crmWebhookUrl !== null && typeof input.crmWebhookUrl !== "string") {
      return { values, error: "crmWebhookUrl must be a string or null" };
    }
    const normalizedUrl = normalizeCrmWebhookUrl(input.crmWebhookUrl as string | null);
    if (normalizedUrl.error) return { values, error: normalizedUrl.error };
    values.crmWebhookUrl = normalizedUrl.value;
  }

  if (input.crmWebhookEvents !== undefined) {
    const normalizedEvents = normalizeCrmWebhookEventsInput(input.crmWebhookEvents);
    if (normalizedEvents.error) return { values, error: normalizedEvents.error };
    values.crmWebhookEvents = normalizedEvents.value;
  }

  if (input.crmWebhookSecret !== undefined) {
    if (input.crmWebhookSecret !== null && typeof input.crmWebhookSecret !== "string") {
      return { values, error: "crmWebhookSecret must be a string or null" };
    }
    values.crmWebhookSecret = normalizeCrmWebhookSecret(input.crmWebhookSecret as string | null);
  }

  return { values };
}

export function resolveCrmWebhookDispatchConfig(settings: {
  crmWebhookEnabled?: boolean | null;
  crmWebhookUrl?: string | null;
  crmWebhookEvents?: unknown;
  crmWebhookSecret?: string | null;
}): CrmWebhookDispatchConfig {
  const normalizedUrl = normalizeCrmWebhookUrl(settings.crmWebhookUrl ?? null);
  return {
    enabled: Boolean(settings.crmWebhookEnabled),
    url: normalizedUrl.error ? null : normalizedUrl.value,
    events: normalizeStoredCrmWebhookEvents(settings.crmWebhookEvents),
    secret: normalizeCrmWebhookSecret(settings.crmWebhookSecret ?? null),
  };
}

export function getCrmWebhookSecretSet(secret: string | null | undefined): boolean {
  return Boolean(normalizeCrmWebhookSecret(secret));
}

export function getCrmWebhookDispatchSkipReason(
  config: CrmWebhookDispatchConfig,
  eventType: CrmWebhookEventType
): "disabled" | "missing_url" | "missing_secret" | "event_not_enabled" | null {
  if (!config.enabled) return "disabled";
  if (!config.url) return "missing_url";
  if (!config.secret) return "missing_secret";
  if (!config.events.includes(eventType)) return "event_not_enabled";
  return null;
}
