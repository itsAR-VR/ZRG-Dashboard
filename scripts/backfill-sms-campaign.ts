/**
 * Backfill Lead.smsCampaignId using GHL contact tags.
 *
 * Run with:
 *   npx tsx scripts/backfill-sms-campaign.ts --dry-run
 *   npx tsx scripts/backfill-sms-campaign.ts --clientId <workspaceId> --limit 200
 *
 * Env:
 *   DATABASE_URL            - required
 *   OPENAI_API_KEY          - required by default (disable with --no-llm)
 *   BACKFILL_TAG_PREFIXES   - optional comma-separated (defaults provided)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { normalizeSmsCampaignLabel } from "../lib/sms-campaign";
import dns from "node:dns";

// Some environments resolve the Supabase pooler + OpenAI to IPv6 first and fail to connect.
dns.setDefaultResultOrder("ipv4first");

type Args = {
  clientId?: string;
  limit: number;
  dryRun: boolean;
  useLlm: boolean;
  tagPrefixes: string[];
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 500,
    dryRun: false,
    useLlm: true,
    tagPrefixes: (process.env.BACKFILL_TAG_PREFIXES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clientId") args.clientId = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i] || "0") || args.limit;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--use-llm") args.useLlm = true;
    else if (a === "--no-llm") args.useLlm = false;
    else if (a === "--tag-prefix") args.tagPrefixes.push(argv[++i] || "");
  }

  if (args.tagPrefixes.length === 0) {
    args.tagPrefixes = [
      "client:",
      "client -",
      "subclient:",
      "sub-client:",
      "sms client:",
      "sms subclient:",
      "campaign:",
    ];
  }

  args.tagPrefixes = args.tagPrefixes.map((s) => s.trim()).filter(Boolean);
  return args;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: { timeoutMs?: number; retries?: number }
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const retries = options?.retries ?? 3;
  const method = (init.method || "GET").toUpperCase();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const retryableStatus = res.status === 429 || res.status >= 500;
      const canRetry = method === "GET" && attempt < retries && retryableStatus;

      if (canRetry) {
        const backoffMs = Math.pow(2, attempt) * 500;
        await sleep(backoffMs);
        continue;
      }

      return res;
    } catch (error) {
      const canRetry = method === "GET" && attempt < retries;
      if (!canRetry) throw error;
      const backoffMs = Math.pow(2, attempt) * 500;
      await sleep(backoffMs);
    }
  }

  throw new Error("fetchWithRetry: exhausted retries");
}

async function fetchGhlContactTags(contactId: string, privateKey: string): Promise<string[] | null> {
  const url = `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`;

  try {
    const response = await fetchWithRetry(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${privateKey}`,
          Version: "2021-04-15",
          Accept: "application/json",
        },
      },
      { timeoutMs: 20_000, retries: 3 }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as { contact?: { tags?: unknown } };
    const tags = data?.contact?.tags;
    if (!Array.isArray(tags)) return [];
    return tags.filter((t): t is string => typeof t === "string").filter(Boolean);
  } catch {
    return null;
  }
}

function extractCandidatesFromTags(tags: string[], prefixes: string[]): string[] {
  const candidates: string[] = [];

  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const lower = tag.toLowerCase();

    for (const rawPrefix of prefixes) {
      const prefix = rawPrefix.toLowerCase().trim();
      if (!prefix) continue;
      if (!lower.startsWith(prefix)) continue;

      const extracted = tag.slice(prefix.length).trim().replace(/^[-:–—\s]+/, "").trim();
      if (extracted) candidates.push(extracted);
    }
  }

  // Heuristic: tags in the format "<client name> sms <date>" (e.g. "wayne wright sms dec 9")
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const lower = tag.toLowerCase();

    const smsMarker = " sms ";
    const idx = lower.indexOf(smsMarker);
    if (idx <= 0) continue; // ignore tags that start with "sms ..."

    const before = tag.slice(0, idx).trim();
    if (before) candidates.push(before);
  }

  // De-dupe case-insensitively while preserving first-seen casing
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of candidates) {
    const key = c.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c.trim());
  }
  return unique;
}

function isRetryableOpenAiError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyErr = error as any;
  const status = Number(anyErr.status || anyErr.response?.status || 0) || 0;
  if (status === 429 || status >= 500) return true;
  const msg = String(anyErr.message || "");
  return (
    msg.includes("timeout") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ENETUNREACH") ||
    msg.includes("fetch failed")
  );
}

async function chooseWithLlm(openai: OpenAI, tags: string[], candidates: string[]) {
  const prompt = [
    "You are mapping GoHighLevel contact tags to an SMS sub-client label.",
    "Pick the best sub-client label (or null if not present).",
    "Rules:",
    "- Prefer explicit client/subclient/campaign tags.",
    "- If you see a tag like \"<name> sms <date>\", the label is \"<name>\" (the part before \"sms\").",
    "- Output ONLY valid JSON: {\"label\": string|null}.",
    "",
    `Tags: ${JSON.stringify(tags)}`,
    `Candidates (derived): ${JSON.stringify(candidates)}`,
  ].join("\n");

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await openai.responses.create({
        model: "gpt-5-nano",
        input: prompt,
        reasoning: { effort: "low" },
        max_output_tokens: 120,
      });

      const text = resp.output_text?.trim() || "";
      const parsed = JSON.parse(text) as { label: string | null };
      return typeof parsed?.label === "string" ? parsed.label : null;
    } catch (error) {
      const shouldRetry = isRetryableOpenAiError(error) && attempt < 3;
      if (!shouldRetry) return null;
      const backoffMs = Math.pow(2, attempt) * 750;
      await sleep(backoffMs);
    }
  }

  return null;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  if (args.useLlm && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required unless you pass --no-llm");
  }

  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const openai = args.useLlm ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

  const leads = await prisma.lead.findMany({
    where: {
      clientId: args.clientId,
      ghlContactId: { not: null },
      smsCampaignId: null,
    },
    include: { client: true },
    take: args.limit,
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `Found ${leads.length} leads missing smsCampaignId` +
      (args.clientId ? ` for clientId=${args.clientId}` : "") +
      (args.dryRun ? " (dry-run)" : "")
  );

  let updated = 0;
  let skipped = 0;
  let ambiguous = 0;
  let failed = 0;

  for (const lead of leads) {
    const contactId = lead.ghlContactId!;
    const privateKey = (lead as any).client.ghlPrivateKey as string;

    const tags = await fetchGhlContactTags(contactId, privateKey);
    if (!tags) {
      failed++;
      console.log(`[FAIL] lead=${lead.id} contact=${contactId} err=failed_to_fetch_tags`);
      await sleep(150);
      continue;
    }

    const candidates = extractCandidatesFromTags(tags, args.tagPrefixes);

    let chosen: string | null = null;
    if (openai && tags.length > 0) {
      chosen = await chooseWithLlm(openai, tags, candidates);
    }
    if (!chosen) {
      if (candidates.length > 1) ambiguous++;
      if (candidates.length === 1) chosen = candidates[0];
    }

    const normalized = normalizeSmsCampaignLabel(chosen);
    if (!normalized) {
      skipped++;
      await sleep(150);
      continue;
    }

    if (args.dryRun) {
      updated++;
      console.log(`[DRY] lead=${lead.id} -> "${normalized.name}"`);
      await sleep(150);
      continue;
    }

    const smsCampaign = await prisma.smsCampaign.upsert({
      where: {
        clientId_nameNormalized: {
          clientId: lead.clientId,
          nameNormalized: normalized.nameNormalized,
        },
      },
      create: {
        clientId: lead.clientId,
        name: normalized.name,
        nameNormalized: normalized.nameNormalized,
      },
      update: { name: normalized.name },
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: { smsCampaignId: smsCampaign.id },
    });

    updated++;
    console.log(`[OK] lead=${lead.id} -> "${normalized.name}"`);
    await sleep(150);
  }

  await prisma.$disconnect();

  console.log(
    JSON.stringify(
      { updated, skipped, ambiguous, failed, limit: args.limit, dryRun: args.dryRun },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
