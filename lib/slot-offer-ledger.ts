import "@/lib/server-dns";
import { prisma } from "@/lib/prisma";

function parseUtcIsoToDate(iso: string): Date | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Returns a map of slotUtcIso -> offeredCount for a workspace within a range.
 * Best-effort: if the backing table doesn't exist yet, returns an empty map.
 */
export async function getWorkspaceSlotOfferCountsForRange(
  clientId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<Map<string, number>> {
  try {
    const rows = await prisma.workspaceOfferedSlot.findMany({
      where: {
        clientId,
        slotUtc: { gte: rangeStart, lte: rangeEnd },
      },
      select: { slotUtc: true, offeredCount: true },
    });

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.slotUtc.toISOString(), row.offeredCount);
    }
    return map;
  } catch (error) {
    console.warn("[slot-offer-ledger] Failed to read offer counts:", error);
    return new Map();
  }
}

/**
 * Increment offer count for a slot (soft distribution signal).
 * Best-effort: if the table doesn't exist yet, this is a no-op.
 */
export async function incrementWorkspaceSlotOffersBatch(opts: {
  clientId: string;
  slotUtcIsoList: string[];
  offeredAt?: Date;
}): Promise<void> {
  const offeredAt = opts.offeredAt ?? new Date();
  const slotDates = Array.from(
    new Set(
      opts.slotUtcIsoList
        .map(parseUtcIsoToDate)
        .filter((d): d is Date => !!d)
        .map((d) => d.toISOString())
    )
  ).map((iso) => new Date(iso));

  if (slotDates.length === 0) return;

  try {
    // Avoid interactive/batched transactions here; this ledger is best-effort and should not
    // contend with hot-path DB work. Sequential upserts keep the operation short and resilient.
    for (const slotUtc of slotDates) {
      await prisma.workspaceOfferedSlot.upsert({
        where: { clientId_slotUtc: { clientId: opts.clientId, slotUtc } },
        update: {
          offeredCount: { increment: 1 },
          lastOfferedAt: offeredAt,
        },
        create: {
          clientId: opts.clientId,
          slotUtc,
          offeredCount: 1,
          lastOfferedAt: offeredAt,
        },
      });
    }
  } catch (error) {
    console.warn("[slot-offer-ledger] Failed to increment offer counts:", error);
  }
}

export async function incrementWorkspaceSlotOffers(opts: {
  clientId: string;
  slotUtcIso: string;
  offeredAt?: Date;
}): Promise<void> {
  return incrementWorkspaceSlotOffersBatch({
    clientId: opts.clientId,
    slotUtcIsoList: [opts.slotUtcIso],
    offeredAt: opts.offeredAt,
  });
}
