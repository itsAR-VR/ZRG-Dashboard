import type { AvailabilitySource } from "@prisma/client";

export type OfferedSlot = {
  datetime: string;
  label: string;
  offeredAt: string;
  availabilitySource?: AvailabilitySource;
};

export function safeParseOfferedSlotsJson(value: string | null | undefined): OfferedSlot[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: OfferedSlot[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const anyItem = item as { datetime?: unknown; label?: unknown; offeredAt?: unknown; availabilitySource?: unknown };
      if (typeof anyItem.datetime !== "string" || typeof anyItem.label !== "string") continue;
      const offeredAt = typeof anyItem.offeredAt === "string" ? anyItem.offeredAt : "";
      const availabilitySource = anyItem.availabilitySource as AvailabilitySource | undefined;
      out.push({
        datetime: anyItem.datetime,
        label: anyItem.label,
        offeredAt,
        availabilitySource,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function computeRefreshedOfferedSlots(opts: {
  existingOfferedSlotsJson: string | null | undefined;
  updatedDraft: string;
  replacementsApplied: Array<{ oldText: string; newText: string }>;
  labelToDatetimeUtcIso: Record<string, string>;
  offeredAtIso: string;
  availabilitySource: AvailabilitySource;
}): OfferedSlot[] {
  const existing = safeParseOfferedSlotsJson(opts.existingOfferedSlotsJson);
  const replacementsByOldLabel = new Map<string, string>();
  const replacementNewLabels: string[] = [];
  for (const r of opts.replacementsApplied) {
    replacementsByOldLabel.set(r.oldText, r.newText);
    replacementNewLabels.push(r.newText);
  }

  const usedLabels = new Set<string>();
  const out: OfferedSlot[] = [];

  for (const slot of existing) {
    const replacedLabel = replacementsByOldLabel.get(slot.label) ?? null;
    const label = replacedLabel ?? slot.label;
    const datetime = replacedLabel ? opts.labelToDatetimeUtcIso[label] ?? slot.datetime : slot.datetime;

    if (!opts.updatedDraft.includes(label)) continue;
    if (usedLabels.has(label)) continue;

    usedLabels.add(label);
    out.push({
      datetime,
      label,
      offeredAt: opts.offeredAtIso,
      availabilitySource: opts.availabilitySource,
    });
  }

  for (const label of replacementNewLabels) {
    if (usedLabels.has(label)) continue;
    if (!opts.updatedDraft.includes(label)) continue;
    const datetime = opts.labelToDatetimeUtcIso[label];
    if (!datetime) continue;

    usedLabels.add(label);
    out.push({
      datetime,
      label,
      offeredAt: opts.offeredAtIso,
      availabilitySource: opts.availabilitySource,
    });
  }

  out.sort((a, b) => opts.updatedDraft.indexOf(a.label) - opts.updatedDraft.indexOf(b.label));
  return out;
}

