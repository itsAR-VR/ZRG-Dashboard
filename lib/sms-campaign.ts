export function normalizeSmsCampaignLabel(label: unknown): {
  name: string;
  nameNormalized: string;
} | null {
  if (typeof label !== "string") return null;
  const name = label.trim();
  if (!name) return null;
  return { name, nameNormalized: name.toLowerCase() };
}

