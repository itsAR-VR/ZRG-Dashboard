import "@/lib/server-dns";
import { prisma } from "@/lib/prisma";
import type { AvailabilitySource } from "@prisma/client";

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
  rangeEnd: Date,
  opts?: { availabilitySource?: AvailabilitySource }
): Promise<Map<string, number>> {
  const availabilitySource: AvailabilitySource =
    opts?.availabilitySource === "DIRECT_BOOK" ? "DIRECT_BOOK" : "DEFAULT";

  try {
    const rows = await prisma.workspaceOfferedSlot.findMany({
      where: {
        clientId,
        availabilitySource,
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
  availabilitySource?: AvailabilitySource;
}): Promise<void> {
  const offeredAt = opts.offeredAt ?? new Date();
  const availabilitySource: AvailabilitySource =
    opts.availabilitySource === "DIRECT_BOOK" ? "DIRECT_BOOK" : "DEFAULT";
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
        where: {
          clientId_availabilitySource_slotUtc: {
            clientId: opts.clientId,
            availabilitySource,
            slotUtc,
          },
        },
        update: {
          offeredCount: { increment: 1 },
          lastOfferedAt: offeredAt,
        },
        create: {
          clientId: opts.clientId,
          availabilitySource,
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
  availabilitySource?: AvailabilitySource;
}): Promise<void> {
  return incrementWorkspaceSlotOffersBatch({
    clientId: opts.clientId,
    slotUtcIsoList: [opts.slotUtcIso],
    offeredAt: opts.offeredAt,
    availabilitySource: opts.availabilitySource,
  });
}
