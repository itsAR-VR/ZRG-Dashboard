import "server-only";

import type { PrismaClient } from "@prisma/client";
import { ensureReengagementFollowUpSequenceForClient, REENGAGEMENT_FOLLOWUP_SEQUENCE_NAME } from "@/lib/followup-sequence-reengagement";

type BackfillOpts = {
  apply: boolean;
  clientId?: string;
  allClients?: boolean;
  limit?: number;
  overwriteExisting?: boolean;
  isActive?: boolean;
};

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function backfillReengagementFollowUpSequence(
  prisma: PrismaClient,
  opts: BackfillOpts
): Promise<{
  ok: boolean;
  mode: "dry-run" | "apply";
  templateName: string;
  totalClients: number;
  eligibleClients: number;
  existing: number;
  missing: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  sampleClientIds: string[];
}> {
  const apply = opts.apply === true;
  const overwriteExisting = opts.overwriteExisting === true;
  const limit = typeof opts.limit === "number" && Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : undefined;

  const mode: "dry-run" | "apply" = apply ? "apply" : "dry-run";

  const clientIds = opts.clientId
    ? [opts.clientId]
    : (
        await prisma.client.findMany({
          select: { id: true },
          orderBy: { createdAt: "asc" },
          ...(limit ? { take: limit } : {}),
        })
      ).map((c) => c.id);

  const totalClients = opts.clientId ? 1 : await prisma.client.count();
  const eligibleClients = clientIds.length;

  const existingRows = await prisma.followUpSequence.findMany({
    where: {
      clientId: { in: clientIds },
      name: { equals: REENGAGEMENT_FOLLOWUP_SEQUENCE_NAME, mode: "insensitive" },
    },
    select: { id: true, clientId: true },
  });

  const existingClientIds = new Set(existingRows.map((r) => r.clientId));
  const existing = existingClientIds.size;
  const missing = eligibleClients - existing;

  const targetClientIds = overwriteExisting ? clientIds : clientIds.filter((id) => !existingClientIds.has(id));

  if (!apply) {
    return {
      ok: true,
      mode,
      templateName: REENGAGEMENT_FOLLOWUP_SEQUENCE_NAME,
      totalClients,
      eligibleClients,
      existing,
      missing,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      sampleClientIds: targetClientIds.slice(0, 25),
    };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Keep concurrency modest to avoid overloading Postgres in serverless.
  for (const batch of chunk(targetClientIds, 10)) {
    const results = await Promise.all(
      batch.map((clientId) =>
        ensureReengagementFollowUpSequenceForClient({
          prisma,
          clientId,
          isActive: opts.isActive,
          overwriteExisting,
        }).catch(() => ({ ok: false as const, error: "Unhandled error" }))
      )
    );

    for (const result of results) {
      if (!result.ok) {
        errors++;
        continue;
      }
      if (result.created) created++;
      else if (result.updated) updated++;
      else if (result.skipped) skipped++;
    }
  }

  return {
    ok: errors === 0,
    mode,
    templateName: REENGAGEMENT_FOLLOWUP_SEQUENCE_NAME,
    totalClients,
    eligibleClients,
    existing,
    missing,
    created,
    updated,
    skipped,
    errors,
    sampleClientIds: targetClientIds.slice(0, 25),
  };
}

