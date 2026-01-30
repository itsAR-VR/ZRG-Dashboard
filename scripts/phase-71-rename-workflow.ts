/**
 * Phase 71 — Rename Meeting Requested workflow to "ZRG Workflow V1" for ZRG workspaces only.
 *
 * Policy:
 * - ZRG workspaces: WorkspaceSettings.brandName IS NULL  -> rename legacy Meeting Requested to "ZRG Workflow V1"
 * - Branded workspaces (brandName != NULL, e.g. Founders Club) -> do NOT rename
 *
 * Safety:
 * - Dry-run by default (no writes)
 * - `--apply` to write
 * - `--clientId <uuid>` to canary a single workspace
 * - Skips any workspace that already has a "ZRG Workflow V1" sequence (to avoid duplicates)
 * - Skips any workspace with multiple legacy sequences (manual review)
 *
 * Run:
 *   npx tsx scripts/phase-71-rename-workflow.ts
 *   npx tsx scripts/phase-71-rename-workflow.ts --clientId <uuid>
 *   npx tsx scripts/phase-71-rename-workflow.ts --apply
 *
 * Env:
 *   DIRECT_URL (preferred) or DATABASE_URL - required
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { MEETING_REQUESTED_SEQUENCE_NAME_LEGACY, ZRG_WORKFLOW_V1_SEQUENCE_NAME } from "../lib/followup-sequence-names";

function getFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function createPrismaClient(): PrismaClient {
  const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!directUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL environment variable required");
  }
  const adapter = new PrismaPg({ connectionString: directUrl });
  return new PrismaClient({ adapter });
}

type CandidateSequence = {
  id: string;
  clientId: string;
  createdAt: Date;
  client: {
    name: string;
    settings: { brandName: string | null } | null;
  };
};

async function main() {
  const apply = getFlag("--apply");
  const clientId = getArg("--clientId");

  const prisma = createPrismaClient();

  try {
    console.log("\nPhase 71 — Rename Meeting Requested workflow\n");
    console.log("Legacy:", MEETING_REQUESTED_SEQUENCE_NAME_LEGACY);
    console.log("New:", ZRG_WORKFLOW_V1_SEQUENCE_NAME);
    console.log("Mode:", apply ? "APPLY" : "DRY-RUN");
    if (clientId) console.log("Client:", clientId);
    console.log("");

    const candidates = (await prisma.followUpSequence.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        name: MEETING_REQUESTED_SEQUENCE_NAME_LEGACY,
        client: {
          settings: {
            is: {
              brandName: null,
            },
          },
        },
      },
      select: {
        id: true,
        clientId: true,
        createdAt: true,
        client: { select: { name: true, settings: { select: { brandName: true } } } },
      },
      orderBy: { createdAt: "desc" },
    })) as CandidateSequence[];

    if (candidates.length === 0) {
      console.log("No legacy Meeting Requested sequences found for ZRG workspaces. ✅");
      return;
    }

    const uniqueClientIds = Array.from(new Set(candidates.map((s) => s.clientId)));

    const alreadyRenamed = await prisma.followUpSequence.findMany({
      where: {
        clientId: { in: uniqueClientIds },
        name: ZRG_WORKFLOW_V1_SEQUENCE_NAME,
      },
      select: { id: true, clientId: true },
    });
    const clientIdsWithNewName = new Set(alreadyRenamed.map((s) => s.clientId));

    const grouped = new Map<string, CandidateSequence[]>();
    for (const seq of candidates) {
      const list = grouped.get(seq.clientId) ?? [];
      list.push(seq);
      grouped.set(seq.clientId, list);
    }

    const toRename: CandidateSequence[] = [];
    const skipped: Array<{ clientId: string; clientName: string; reason: string; sequenceIds: string[] }> = [];

    for (const [cid, seqs] of grouped.entries()) {
      const clientName = seqs[0]?.client.name ?? cid;

      if (clientIdsWithNewName.has(cid)) {
        skipped.push({
          clientId: cid,
          clientName,
          reason: "already_has_new_name",
          sequenceIds: seqs.map((s) => s.id),
        });
        continue;
      }

      if (seqs.length !== 1) {
        skipped.push({
          clientId: cid,
          clientName,
          reason: `multiple_legacy_sequences(${seqs.length})`,
          sequenceIds: seqs.map((s) => s.id),
        });
        continue;
      }

      toRename.push(seqs[0]!);
    }

    console.log(`Found ${candidates.length} legacy sequences across ${grouped.size} workspaces.`);
    console.log(`Ready to rename: ${toRename.length}`);
    console.log(`Skipped: ${skipped.length}\n`);

    if (skipped.length > 0) {
      console.log("Skipped workspaces:");
      for (const s of skipped) {
        console.log(`- ${s.clientName} (${s.clientId}) [${s.reason}]`);
      }
      console.log("");
    }

    console.log("Will rename:");
    for (const seq of toRename) {
      console.log(`- ${seq.client.name} (${seq.clientId}) seq=${seq.id}`);
    }
    console.log("");

    if (!apply) {
      console.log("Dry-run complete. Use --apply to perform the rename.\n");
      return;
    }

    const updateResult = await prisma.followUpSequence.updateMany({
      where: { id: { in: toRename.map((s) => s.id) } },
      data: { name: ZRG_WORKFLOW_V1_SEQUENCE_NAME },
    });

    console.log(`✅ Renamed ${updateResult.count} sequences to "${ZRG_WORKFLOW_V1_SEQUENCE_NAME}".\n`);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

