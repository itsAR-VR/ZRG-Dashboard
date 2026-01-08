/**
 * Backfill Lead.smsCampaignId using GHL contact tags.
 *
 * Run with:
 *   npx tsx scripts/backfill-sms-campaign.ts --dry-run
 *   npx tsx scripts/backfill-sms-campaign.ts --apply --clientId <workspaceId> --limit 200
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
  preferCustomFields: boolean;
  customFieldKeys: string[];
  debugMissing: boolean;
  probeContactId?: string;
  probeExpected?: string;
  forceSingleCampaign: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 500,
    dryRun: true,
    useLlm: true,
    tagPrefixes: (process.env.BACKFILL_TAG_PREFIXES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    preferCustomFields: true,
    customFieldKeys: (process.env.BACKFILL_CUSTOM_FIELD_KEYS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    debugMissing: false,
    probeContactId: undefined,
    probeExpected: undefined,
    forceSingleCampaign: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clientId") args.clientId = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i] || "0") || args.limit;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--use-llm") args.useLlm = true;
    else if (a === "--no-llm") args.useLlm = false;
    else if (a === "--tag-prefix") args.tagPrefixes.push(argv[++i] || "");
    else if (a === "--custom-field-key") args.customFieldKeys.push(argv[++i] || "");
    else if (a === "--no-custom-fields") args.preferCustomFields = false;
    else if (a === "--debug-missing") args.debugMissing = true;
    else if (a === "--probe-contact") args.probeContactId = argv[++i];
    else if (a === "--probe-expected") args.probeExpected = argv[++i];
    else if (a === "--force-single-campaign") args.forceSingleCampaign = true;
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

  if (args.customFieldKeys.length === 0) {
    args.customFieldKeys = [
      "client",
      "Client",
      "client name",
      "Client Name",
      "sub-client",
      "subclient",
      "sms client",
      "sms subclient",
      "sms campaign",
      "campaign",
    ];
  }
  args.customFieldKeys = args.customFieldKeys.map((s) => s.trim()).filter(Boolean);

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

const GHL_CONTACTS_API_VERSION = "2021-07-28";
const GHL_LEGACY_API_VERSION = "2021-04-15";

function contactSignalScore(contact: Record<string, unknown>): number {
  const tags = coerceTags((contact as any).tags);
  const customKeys = listCustomFieldKeysForDebug(contact);
  return tags.length * 10 + customKeys.length;
}

async function fetchGhlContactWithVersion(
  contactId: string,
  privateKey: string,
  apiVersion: string
): Promise<Record<string, unknown> | null> {
  const url = `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`;

  try {
    const response = await fetchWithRetry(
      url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${privateKey}`,
          Version: apiVersion,
          Accept: "application/json",
        },
      },
      { timeoutMs: 20_000, retries: 3 }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as { contact?: unknown };
    const contact = data?.contact;
    if (!contact || typeof contact !== "object") return null;
    return contact as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchGhlContact(contactId: string, privateKey: string): Promise<Record<string, unknown> | null> {
  const [newer, legacy] = await Promise.all([
    fetchGhlContactWithVersion(contactId, privateKey, GHL_CONTACTS_API_VERSION),
    fetchGhlContactWithVersion(contactId, privateKey, GHL_LEGACY_API_VERSION),
  ]);

  if (newer && !legacy) return newer;
  if (!newer && legacy) return legacy;
  if (!newer && !legacy) return null;

  // Prefer the payload that contains more usable signal (tags/custom fields).
  const newerScore = contactSignalScore(newer!);
  const legacyScore = contactSignalScore(legacy!);
  return newerScore >= legacyScore ? newer! : legacy!;
}

function normalizeFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function coerceString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s : null;
}

function coerceTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    // Some payloads represent tags as a comma-separated string.
    return tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

function pickInterestingTags(tags: string[]): string[] {
  const interesting = tags.filter((t) => /\b(sms|client|subclient|sub-client|campaign)\b/i.test(t));
  return interesting.slice(0, 25);
}

function extractLabelFromCustomFields(contact: Record<string, unknown>, preferredKeys: string[]): string | null {
  const preferred = preferredKeys
    .map((k) => ({ raw: k, norm: normalizeFieldKey(k) }))
    .filter((k) => k.norm);

  if (preferred.length === 0) return null;

  // 1) Direct top-level keys (some GHL payloads flatten custom fields)
  for (const k of preferred) {
    for (const [rawKey, rawVal] of Object.entries(contact)) {
      if (normalizeFieldKey(rawKey) !== k.norm) continue;
      const s = coerceString(rawVal);
      if (s) return s;
    }
  }

  // 2) Known custom field containers
  const containers: unknown[] = [
    (contact as any).customFields,
    (contact as any).customField,
    (contact as any).customFieldValues,
    (contact as any).customValues,
    (contact as any).custom_fields,
    (contact as any).custom_field,
    (contact as any).custom_field_values,
  ];

  for (const container of containers) {
    if (!container) continue;

    // 2a) Map/object: { fieldKeyOrId: value }
    if (!Array.isArray(container) && typeof container === "object") {
      const obj = container as Record<string, unknown>;
      for (const k of preferred) {
        for (const [rawKey, rawVal] of Object.entries(obj)) {
          if (normalizeFieldKey(rawKey) !== k.norm) continue;
          const s = coerceString(rawVal);
          if (s) return s;
        }
      }
      continue;
    }

    // 2b) Array of objects: [{ key/name/id, value/fieldValue/... }]
    if (Array.isArray(container)) {
      const arr = container as unknown[];

      for (const k of preferred) {
        for (const item of arr) {
          if (!item || typeof item !== "object") continue;
          const anyItem = item as any;
          const idKey =
            coerceString(anyItem.key) ||
            coerceString(anyItem.name) ||
            coerceString(anyItem.fieldKey) ||
            coerceString(anyItem.fieldName) ||
            coerceString(anyItem.id);
          if (!idKey) continue;
          if (normalizeFieldKey(idKey) !== k.norm) continue;

          const rawVal = anyItem.value ?? anyItem.fieldValue ?? anyItem.field_value ?? anyItem.val;
          const s = coerceString(rawVal);
          if (s) return s;
        }
      }
    }
  }

  return null;
}

function listCustomFieldKeysForDebug(contact: Record<string, unknown>): string[] {
  const keys = new Set<string>();

  const containers: unknown[] = [
    (contact as any).customFields,
    (contact as any).customField,
    (contact as any).customFieldValues,
    (contact as any).customValues,
    (contact as any).custom_fields,
    (contact as any).custom_field,
    (contact as any).custom_field_values,
  ];

  for (const container of containers) {
    if (!container) continue;
    if (!Array.isArray(container) && typeof container === "object") {
      for (const k of Object.keys(container as Record<string, unknown>)) keys.add(k);
      continue;
    }
    if (Array.isArray(container)) {
      for (const item of container) {
        if (!item || typeof item !== "object") continue;
        const anyItem = item as any;
        const idKey =
          coerceString(anyItem.key) ||
          coerceString(anyItem.name) ||
          coerceString(anyItem.fieldKey) ||
          coerceString(anyItem.fieldName) ||
          coerceString(anyItem.id);
        if (idKey) keys.add(idKey);
      }
    }
  }

  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function findCustomFieldKeysMatchingValue(contact: Record<string, unknown>, expected: string): string[] {
  const expectedNorm = expected.trim().toLowerCase();
  if (!expectedNorm) return [];

  const matches = new Set<string>();

  const containers: unknown[] = [
    (contact as any).customFields,
    (contact as any).customField,
    (contact as any).customFieldValues,
    (contact as any).customValues,
    (contact as any).custom_fields,
    (contact as any).custom_field,
    (contact as any).custom_field_values,
  ];

  for (const container of containers) {
    if (!container) continue;

    if (!Array.isArray(container) && typeof container === "object") {
      const obj = container as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        const s = coerceString(v);
        if (!s) continue;
        if (s.toLowerCase().includes(expectedNorm)) matches.add(k);
      }
      continue;
    }

    if (Array.isArray(container)) {
      for (const item of container as unknown[]) {
        if (!item || typeof item !== "object") continue;
        const anyItem = item as any;
        const idKey =
          coerceString(anyItem.key) ||
          coerceString(anyItem.name) ||
          coerceString(anyItem.fieldKey) ||
          coerceString(anyItem.fieldName) ||
          coerceString(anyItem.id);
        if (!idKey) continue;

        const rawVal = anyItem.value ?? anyItem.fieldValue ?? anyItem.field_value ?? anyItem.val;
        const s = coerceString(rawVal);
        if (!s) continue;
        if (s.toLowerCase().includes(expectedNorm)) matches.add(idKey);
      }
    }
  }

  return Array.from(matches).sort((a, b) => a.localeCompare(b));
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

  let singleCampaignFallback: { id: string; name: string } | null = null;
  if (args.forceSingleCampaign) {
    if (!args.clientId) {
      throw new Error("--clientId is required when using --force-single-campaign");
    }

    const campaigns = await prisma.smsCampaign.findMany({
      where: { clientId: args.clientId },
      select: { id: true, name: true },
      orderBy: { nameNormalized: "asc" },
    });

    if (campaigns.length === 1) {
      singleCampaignFallback = campaigns[0];
      console.log(
        `[INFO] --force-single-campaign enabled; using existing SmsCampaign "${singleCampaignFallback.name}" (${singleCampaignFallback.id})`
      );
    } else {
      console.log(
        `[WARN] --force-single-campaign enabled but workspace has ${campaigns.length} SmsCampaign rows; fallback will not be applied.`
      );
    }
  }

  if (args.probeContactId) {
    if (!args.clientId) throw new Error("--clientId is required when using --probe-contact");
    const client = await prisma.client.findUnique({
      where: { id: args.clientId },
      select: { id: true, name: true, ghlPrivateKey: true },
    });
    if (!client?.ghlPrivateKey) throw new Error("Client not found or missing ghlPrivateKey");

    const contact = await fetchGhlContact(args.probeContactId, client.ghlPrivateKey);
    if (!contact) throw new Error("Failed to fetch contact");

    const tags = coerceTags((contact as any).tags);

    const expected = (args.probeExpected || "").trim();
    if (!expected) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            tagsCount: tags.length,
            interestingTags: pickInterestingTags(tags),
            customFieldKeys: listCustomFieldKeysForDebug(contact),
          },
          null,
          2
        )
      );
    } else {
      console.log(
        JSON.stringify(
          {
            ok: true,
            expected,
            tagsCount: tags.length,
            interestingTags: pickInterestingTags(tags),
            matchingKeys: findCustomFieldKeysMatchingValue(contact, expected),
            allCustomFieldKeys: args.debugMissing ? listCustomFieldKeysForDebug(contact) : undefined,
          },
          null,
          2
        )
      );
    }

    await prisma.$disconnect();
    return;
  }

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
  let updatedFromCustomFields = 0;
  let updatedFromTags = 0;
  let skipped = 0;
  let ambiguous = 0;
  let failed = 0;

  for (const lead of leads) {
    const contactId = lead.ghlContactId!;
    const privateKey = (lead as any).client.ghlPrivateKey as string;

    const contact = await fetchGhlContact(contactId, privateKey);
    if (!contact) {
      failed++;
      console.log(`[FAIL] lead=${lead.id} contact=${contactId} err=failed_to_fetch_contact`);
      await sleep(150);
      continue;
    }

    const customFieldLabel = args.preferCustomFields
      ? extractLabelFromCustomFields(contact, args.customFieldKeys)
      : null;

    let chosen: string | null = customFieldLabel;

    // Fallback: derive from tags (heuristic + optional LLM)
    const tags = coerceTags((contact as any).tags);
    const candidates = chosen ? [] : extractCandidatesFromTags(tags, args.tagPrefixes);

    if (!chosen) {
      if (args.debugMissing) {
        const customKeys = listCustomFieldKeysForDebug(contact);
        const interestingTags = pickInterestingTags(tags);
        console.log(
          `[DEBUG] lead=${lead.id} contact=${contactId} tagsCount=${tags.length} interestingTags=${
            interestingTags.join("|") || "<none>"
          } customFieldKeys=${customKeys.join(",") || "<none>"}`
        );
      }

      if (openai && tags.length > 0) {
        chosen = await chooseWithLlm(openai, tags, candidates);
      }
      if (!chosen) {
        if (candidates.length > 1) ambiguous++;
        if (candidates.length === 1) chosen = candidates[0];
      }
    }

    if (!chosen && singleCampaignFallback) {
      chosen = singleCampaignFallback.name;
    }

    const normalized = normalizeSmsCampaignLabel(chosen);
    if (!normalized) {
      skipped++;
      await sleep(150);
      continue;
    }

    if (args.dryRun) {
      updated++;
      if (customFieldLabel) {
        updatedFromCustomFields++;
      } else {
        updatedFromTags++;
      }
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
    if (customFieldLabel) {
      updatedFromCustomFields++;
    } else {
      updatedFromTags++;
    }
    console.log(`[OK] lead=${lead.id} -> "${normalized.name}"`);
    await sleep(150);
  }

  await prisma.$disconnect();

  console.log(
    JSON.stringify(
      {
        updated,
        updatedFromCustomFields,
        updatedFromTags,
        skipped,
        ambiguous,
        failed,
        limit: args.limit,
        dryRun: args.dryRun,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
