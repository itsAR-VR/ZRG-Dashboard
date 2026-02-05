export type ReactivationPrereqInput = {
  channels: Array<string | null | undefined>;
  lead: {
    phone?: string | null;
    linkedinUrl?: string | null;
  };
  client: {
    ghlPrivateKey?: string | null;
    ghlLocationId?: string | null;
    unipileAccountId?: string | null;
  };
};

const MISSING_LABELS: Record<string, string> = {
  "lead.phone": "lead phone",
  "lead.linkedinUrl": "lead LinkedIn URL",
  "client.ghlPrivateKey": "GHL API key",
  "client.ghlLocationId": "GHL location ID",
  "client.unipileAccountId": "Unipile account",
};

export function getMissingReactivationPrereqs(input: ReactivationPrereqInput): string[] {
  const channels = new Set(
    (input.channels || [])
      .map((c) => (c || "").trim().toLowerCase())
      .filter(Boolean)
  );

  const missing: string[] = [];

  if (channels.has("sms")) {
    if (!input.lead.phone) missing.push("lead.phone");
    if (!input.client.ghlPrivateKey) missing.push("client.ghlPrivateKey");
    if (!input.client.ghlLocationId) missing.push("client.ghlLocationId");
  }

  if (channels.has("linkedin")) {
    if (!input.lead.linkedinUrl) missing.push("lead.linkedinUrl");
    if (!input.client.unipileAccountId) missing.push("client.unipileAccountId");
  }

  return missing;
}

export function formatMissingReactivationPrereqs(missing: string[]): string {
  if (!missing.length) return "";
  const labels = missing.map((key) => MISSING_LABELS[key] || key);
  return `Missing follow-up prerequisites: ${labels.join(", ")}`;
}
