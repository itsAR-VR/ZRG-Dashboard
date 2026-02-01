import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type DbSchemaMissingColumns = {
  model: string;
  table: string;
  missingColumns: string[];
};

type CacheEntry = {
  checkedAtMs: number;
  ttlMs: number;
  missing: DbSchemaMissingColumns[];
};

const cache = new Map<string, CacheEntry>();

function getScalarColumnNamesForModel(modelName: string): string[] {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === modelName);
  if (!model) throw new Error(`Unknown Prisma model: ${modelName}`);

  const scalars = model.fields.filter((f) => f.kind === "scalar").map((f) => f.name);
  // Deduplicate defensively.
  return Array.from(new Set(scalars)).sort();
}

export function isPrismaMissingTableOrColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyError = error as { code?: unknown };
  return anyError.code === "P2021" || anyError.code === "P2022";
}

export async function getDbSchemaMissingColumnsForModels(opts: {
  models: string[];
  schema?: string;
  okCacheTtlMs?: number;
  errorCacheTtlMs?: number;
}): Promise<DbSchemaMissingColumns[]> {
  const schema = opts.schema ?? "public";
  const models = Array.from(new Set(opts.models)).filter(Boolean).sort();
  const cacheKey = `${schema}|${models.join(",")}`;

  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.checkedAtMs < cached.ttlMs) return cached.missing;

  if (models.length === 0) return [];

  const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>(
    Prisma.sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = ${schema}
        and table_name in (${Prisma.join(models)})
    `
  );

  const columnsByTable = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = row.table_name;
    const column = row.column_name;
    if (!columnsByTable.has(table)) columnsByTable.set(table, new Set());
    columnsByTable.get(table)!.add(column);
  }

  const missing: DbSchemaMissingColumns[] = [];
  for (const modelName of models) {
    const expectedColumns = getScalarColumnNamesForModel(modelName);
    const actualColumns = columnsByTable.get(modelName) ?? new Set<string>();
    const missingColumns = expectedColumns.filter((col) => !actualColumns.has(col));
    if (missingColumns.length > 0) {
      missing.push({ model: modelName, table: modelName, missingColumns });
    }
  }

  const ttlMs = missing.length === 0 ? (opts.okCacheTtlMs ?? 60_000) : (opts.errorCacheTtlMs ?? 10_000);
  cache.set(cacheKey, { checkedAtMs: now, ttlMs, missing });

  return missing;
}

