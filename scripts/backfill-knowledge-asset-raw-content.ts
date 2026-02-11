/**
 * Backfill Knowledge Asset Raw Content
 *
 * Copies existing knowledge asset content into `rawContent` for legacy rows
 * that predate raw-source storage.
 *
 * Strategy:
 * - For `text` and `file` assets, copy from `textContent` when `rawContent` is empty.
 * - For `url` assets, prefer `fileUrl`, then fallback to `textContent`.
 * - Normalize invalid/missing `aiContextMode` to `notes`.
 *
 * Run:
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-knowledge-asset-raw-content.ts --dry-run
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-knowledge-asset-raw-content.ts --apply
 *   node --require ./scripts/server-only-mock.cjs --import tsx scripts/backfill-knowledge-asset-raw-content.ts --apply --limit 500
 *
 * Env:
 *   DATABASE_URL  Required
 */
import dns from "node:dns";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

dns.setDefaultResultOrder("ipv4first");

type Args = {
  dryRun: boolean;
  limit: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: true, limit: 250 };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run" || token === "--dryRun") args.dryRun = true;
    else if (token === "--apply") args.dryRun = false;
    else if (token === "--limit") args.limit = Number(argv[i + 1] || "0") || args.limit;
    if (token === "--limit") i += 1;
  }
  args.limit = Math.max(1, Math.trunc(args.limit));
  return args;
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : null;
}

function normalizeMode(mode: string | null | undefined): "notes" | "raw" {
  return mode === "raw" ? "raw" : "notes";
}

function deriveRawContent(asset: {
  type: string;
  rawContent: string | null;
  textContent: string | null;
  fileUrl: string | null;
}): string | null {
  const existingRaw = trimOrNull(asset.rawContent);
  if (existingRaw) return existingRaw;

  const text = trimOrNull(asset.textContent);
  const fileUrl = trimOrNull(asset.fileUrl);

  if (asset.type === "url") return fileUrl || text;
  return text;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL environment variable is required");

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  console.log("=".repeat(80));
  console.log("Backfill Knowledge Asset Raw Content");
  console.log("=".repeat(80));
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Mode:    ${args.dryRun ? "DRY RUN (no writes)" : "APPLY"}`);
  console.log(`Limit:   ${args.limit}`);
  console.log("=".repeat(80));

  let scanned = 0;
  let updated = 0;
  let backfilledRaw = 0;
  let normalizedMode = 0;
  let unchanged = 0;

  for (;;) {
    const rows = await prisma.knowledgeAsset.findMany({
      where: {
        OR: [{ rawContent: { equals: null } }, { rawContent: "" }, { aiContextMode: "" }],
      },
      orderBy: { id: "asc" },
      take: args.limit,
      select: {
        id: true,
        name: true,
        type: true,
        fileUrl: true,
        textContent: true,
        rawContent: true,
        aiContextMode: true,
        workspaceSettings: {
          select: {
            clientId: true,
          },
        },
      },
    });

    if (rows.length === 0) break;
    scanned += rows.length;

    for (const row of rows) {
      const nextRaw = deriveRawContent(row);
      const nextMode = normalizeMode(row.aiContextMode);
      const updateData: { rawContent?: string | null; aiContextMode?: "notes" | "raw" } = {};

      if ((row.rawContent || "").trim() === "" && nextRaw) {
        updateData.rawContent = nextRaw;
      }
      if ((row.aiContextMode || "").trim() !== nextMode) {
        updateData.aiContextMode = nextMode;
      }

      const hasUpdate = Object.keys(updateData).length > 0;
      if (!hasUpdate) {
        unchanged += 1;
        continue;
      }

      if (updateData.rawContent !== undefined) backfilledRaw += 1;
      if (updateData.aiContextMode !== undefined) normalizedMode += 1;

      if (args.dryRun) {
        console.log(
          `[DRY RUN] ${row.id} client=${row.workspaceSettings.clientId} type=${row.type} updates=${JSON.stringify(updateData)}`
        );
        continue;
      }

      await prisma.knowledgeAsset.update({
        where: { id: row.id },
        data: updateData,
        select: { id: true },
      });
      updated += 1;
    }

    if (rows.length < args.limit) break;
    if (args.dryRun) break;
  }

  console.log("");
  console.log(`[Done] scanned=${scanned}`);
  console.log(`[Done] updated=${args.dryRun ? 0 : updated}`);
  console.log(`[Done] raw_backfilled=${backfilledRaw}`);
  console.log(`[Done] mode_normalized=${normalizedMode}`);
  console.log(`[Done] unchanged=${unchanged}`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("[Backfill] Failed:", error);
  process.exit(1);
});
