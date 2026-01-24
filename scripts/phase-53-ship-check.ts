/**
 * Phase 53 shipping readiness check.
 *
 * Verifies DB schema + backfill readiness for:
 * - WebhookEvent queue (Email webhook burst hardening)
 * - Lead.lastZrgOutboundAt rollup (Inbox counts)
 * - Lead.linkedinUnreachable* fields (Unipile health gate)
 *
 * Usage:
 * - npx tsx scripts/phase-53-ship-check.ts
 * - npx tsx scripts/phase-53-ship-check.ts --strict
 *
 * Notes:
 * - Prints only sanitized DB info (no credentials).
 * - Exits with code 1 in --strict mode when required schema is missing.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function parseArgs(argv: string[]) {
  const args = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i++;
    }
  }
  return args;
}

function safeDbLabel(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const dbName = (url.pathname || "").replace(/^\//, "") || "unknown_db";
    const host = url.hostname || "unknown_host";
    const isSupabase = host.endsWith(".supabase.co");
    return `${host}/${dbName}${isSupabase ? " (supabase)" : ""}`;
  } catch {
    return "unparseable DATABASE_URL";
  }
}

function isDatabaseNotReachable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyError = error as { code?: unknown; message?: unknown; meta?: unknown };
  if (anyError.code !== "P2010") return false;
  const message = typeof anyError.message === "string" ? anyError.message : "";
  if (message.includes("Can't reach database server")) return true;

  const meta = anyError.meta as { driverAdapterError?: unknown } | undefined;
  const driverAdapterError = meta?.driverAdapterError;
  return typeof driverAdapterError === "object" && driverAdapterError !== null
    ? String(driverAdapterError).includes("DatabaseNotReachable")
    : false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const strict = args.get("strict") === true;

  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  const connectionSource = process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL";
  if (!connectionString) {
    throw new Error("DIRECT_URL or DATABASE_URL is required");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    console.log(`[Phase 53 Ship Check] DB (${connectionSource}): ${safeDbLabel(connectionString)}`);

    const asyncFlag = (process.env.INBOXXIA_EMAIL_SENT_ASYNC || "").toLowerCase();
    const unipileGateFlag = (process.env.UNIPILE_HEALTH_GATE || "").toLowerCase();
    console.log(
      `[Phase 53 Ship Check] Flags: INBOXXIA_EMAIL_SENT_ASYNC=${asyncFlag || "unset"} UNIPILE_HEALTH_GATE=${unipileGateFlag || "unset"}`
    );

    const webhookEventExistsRows = await prisma.$queryRaw<Array<{ regclass: string | null }>>`
      select to_regclass('public."WebhookEvent"')::text as regclass
    `;
    const hasWebhookEventTable = Boolean(webhookEventExistsRows[0]?.regclass);

    const leadColumnsRows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'Lead'
    `;
    const leadColumns = new Set(leadColumnsRows.map((r) => r.column_name));
    const requiredLeadColumns = ["lastZrgOutboundAt", "linkedinUnreachableAt", "linkedinUnreachableReason"] as const;
    const missingLeadColumns = requiredLeadColumns.filter((c) => !leadColumns.has(c));

    console.log(
      `[Phase 53 Ship Check] Schema: WebhookEvent=${hasWebhookEventTable ? "OK" : "MISSING"} LeadColumnsMissing=${missingLeadColumns.length ? missingLeadColumns.join(",") : "none"}`
    );

    if ((asyncFlag === "1" || asyncFlag === "true" || asyncFlag === "yes") && !hasWebhookEventTable) {
      console.warn(
        "[Phase 53 Ship Check] WARNING: INBOXXIA_EMAIL_SENT_ASYNC is enabled but WebhookEvent table is missing. Expect /api/webhooks/email EMAIL_SENT to fail."
      );
    }

    if ((unipileGateFlag === "1" || unipileGateFlag === "true" || unipileGateFlag === "yes") && missingLeadColumns.length) {
      console.warn(
        `[Phase 53 Ship Check] WARNING: UNIPILE_HEALTH_GATE is enabled but Lead columns are missing (${missingLeadColumns.join(
          ", "
        )}). Expect LinkedIn gating writes to fail.`
      );
    }

    if (!missingLeadColumns.includes("lastZrgOutboundAt")) {
      const backfillNeededRows = await prisma.$queryRaw<Array<{ needs_backfill: number }>>`
        select count(*)::int as needs_backfill
        from "Lead" l
        where l."lastZrgOutboundAt" is null
          and exists (
            select 1 from "Message" m
            where m."leadId" = l.id
              and m.direction = 'outbound'
              and m.source = 'zrg'
          )
      `;
      const needsBackfill = backfillNeededRows[0]?.needs_backfill ?? 0;
      console.log(`[Phase 53 Ship Check] Backfill: leads_missing_lastZrgOutboundAt=${needsBackfill}`);
      if (needsBackfill > 0) {
        console.warn(
          "[Phase 53 Ship Check] Recommendation: run `npx tsx scripts/backfill-lead-message-rollups.ts` before relying on inbox counts."
        );
      }
    }

    if (strict && (!hasWebhookEventTable || missingLeadColumns.length > 0)) {
      console.error("[Phase 53 Ship Check] FAIL (--strict): required schema is missing.");
      process.exitCode = 1;
      return;
    }

    console.log("[Phase 53 Ship Check] OK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  if (isDatabaseNotReachable(err)) {
    console.error(
      "[Phase 53 Ship Check] Fatal: Can't reach the database server from this environment. Run from a network that can reach your Postgres host (or check IP allowlists / VPN)."
    );
  } else {
    console.error("[Phase 53 Ship Check] Fatal:", err);
  }
  process.exitCode = 1;
});
