/**
 * Backfill GHL contact linkage + missing lead fields (phone/email/name/company) from GoHighLevel.
 *
 * Policy:
 * - Search/link/hydrate only (NO contact creation/upsert).
 * - Designed to run across ALL clients and ALL leads (including non-responders).
 *
 * Run:
 *   npx tsx scripts/backfill-ghl-lead-hydration.ts --dry-run
 *   npx tsx scripts/backfill-ghl-lead-hydration.ts --apply
 *   npx tsx scripts/backfill-ghl-lead-hydration.ts --apply --clientId <workspaceId>
 *   npx tsx scripts/backfill-ghl-lead-hydration.ts --apply --resume --state-file ./.backfill-ghl-hydration.json
 *
 * Env:
 *   DATABASE_URL            - required
 *   GHL_REQUESTS_PER_10S    - optional (default 90; documented burst is 100/10s)
 *   GHL_MAX_429_RETRIES     - optional (default 3)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { getGHLContact, searchGHLContactsAdvanced, type GHLContact } from "../lib/ghl-api";
import { toStoredPhone } from "../lib/phone-utils";

type Args = {
  clientId?: string;
  dryRun: boolean;
  pageSize: number;
  leadConcurrency: number;
  clientConcurrency: number;
  maxLeads: number;
  resume: boolean;
  stateFile: string;
};

type BackfillState = Record<string, { lastLeadId?: string }>;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    clientId: undefined,
    dryRun: true,
    pageSize: 200,
    leadConcurrency: 25,
    clientConcurrency: 3,
    maxLeads: Number.POSITIVE_INFINITY,
    resume: false,
    stateFile: ".backfill-ghl-hydration.state.json",
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clientId" || a === "--client-id") args.clientId = argv[++i];
    else if (a === "--dry-run" || a === "--dryRun") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--page-size" || a === "--pageSize") args.pageSize = Number(argv[++i] || "0") || args.pageSize;
    else if (a === "--concurrency" || a === "--lead-concurrency" || a === "--leadConcurrency") {
      args.leadConcurrency = Number(argv[++i] || "0") || args.leadConcurrency;
    } else if (a === "--client-concurrency" || a === "--clientConcurrency") {
      args.clientConcurrency = Number(argv[++i] || "0") || args.clientConcurrency;
    } else if (a === "--max-leads" || a === "--maxLeads") {
      const parsed = Number(argv[++i] || "");
      if (Number.isFinite(parsed) && parsed > 0) args.maxLeads = parsed;
    } else if (a === "--resume") args.resume = true;
    else if (a === "--state-file" || a === "--stateFile") args.stateFile = argv[++i] || args.stateFile;
  }

  args.pageSize = Math.max(1, Math.floor(args.pageSize));
  args.leadConcurrency = Math.max(1, Math.floor(args.leadConcurrency));
  args.clientConcurrency = Math.max(1, Math.floor(args.clientConcurrency));
  return args;
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const s = email.trim().toLowerCase();
  return s ? s : null;
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s ? s : null;
}

function pickFirstContact(payload: unknown): (GHLContact & Record<string, unknown>) | null {
  const data = payload as any;
  const contacts: unknown[] =
    (Array.isArray(data?.contacts) && data.contacts) ||
    (Array.isArray(data?.data?.contacts) && data.data.contacts) ||
    [];

  const first = contacts[0] as any;
  if (!first || typeof first.id !== "string") return null;
  return first as GHLContact & Record<string, unknown>;
}

async function readState(path: string): Promise<BackfillState> {
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as BackfillState;
  } catch {
    return {};
  }
}

async function writeState(path: string, state: BackfillState): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.writeFile(path, JSON.stringify(state, null, 2));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const current = idx++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

type ClientRow = {
  id: string;
  name: string;
  ghlLocationId: string | null;
  ghlPrivateKey: string | null;
};

type LeadRow = {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  enrichmentStatus: string | null;
  ghlContactId: string | null;
};

type LeadBackfillResult = {
  scanned: number;
  linked: number;
  updated: number;
  phoneHydrated: number;
  notFound: number;
  errors: number;
};

function buildLeadUpdateFromContact(lead: LeadRow, contact: GHLContact & Record<string, unknown>): {
  updateData: Record<string, unknown>;
  updatedFields: string[];
} {
  const updateData: Record<string, unknown> = {};
  const updatedFields: string[] = [];

  if (!lead.ghlContactId && contact.id) {
    updateData.ghlContactId = contact.id;
    updatedFields.push("ghlContactId");
  }

  if (!lead.email && contact.email) {
    updateData.email = normalizeEmail(contact.email) || contact.email;
    updatedFields.push("email");
  }

  if (!lead.firstName && contact.firstName) {
    updateData.firstName = contact.firstName;
    updatedFields.push("firstName");
  }
  if (!lead.lastName && contact.lastName) {
    updateData.lastName = contact.lastName;
    updatedFields.push("lastName");
  }

  const companyName = safeString((contact as any).companyName);
  if (!lead.companyName && companyName) {
    updateData.companyName = companyName;
    updatedFields.push("companyName");
  }

  const phoneRaw = safeString(contact.phone);
  if (!lead.phone && phoneRaw) {
    const stored = toStoredPhone(phoneRaw) || phoneRaw;
    updateData.phone = stored;
    updatedFields.push("phone");

    if (lead.enrichmentStatus !== "not_needed") {
      updateData.enrichmentStatus = "enriched";
      updateData.enrichmentSource = "ghl";
      updateData.enrichedAt = new Date();
      updatedFields.push("enrichmentStatus");
    }
  }

  return { updateData, updatedFields };
}

async function backfillLead(opts: {
  prisma: PrismaClient;
  lead: LeadRow;
  client: ClientRow;
  dryRun: boolean;
}): Promise<{ linked: boolean; updatedFields: string[]; phoneHydrated: boolean; notFound: boolean; error?: string }> {
  const { prisma, lead, client, dryRun } = opts;
  if (!client.ghlPrivateKey || !client.ghlLocationId) {
    return { linked: false, updatedFields: [], phoneHydrated: false, notFound: false, error: "Missing GHL config" };
  }

  const privateKey = client.ghlPrivateKey;
  const locationId = client.ghlLocationId;

  let contact: (GHLContact & Record<string, unknown>) | null = null;

  if (lead.ghlContactId) {
    const res = await getGHLContact(lead.ghlContactId, privateKey, { locationId });
    contact = res.success ? (res.data?.contact as any) : null;
    if (!contact) return { linked: false, updatedFields: [], phoneHydrated: false, notFound: false, error: res.error || "Contact fetch failed" };
  } else {
    const email = normalizeEmail(lead.email);
    if (!email) {
      return { linked: false, updatedFields: [], phoneHydrated: false, notFound: true };
    }

    const search = await searchGHLContactsAdvanced(
      {
        locationId,
        page: 1,
        pageLimit: 1,
        filters: [{ field: "email", operator: "eq", value: email }],
      },
      privateKey
    );

    if (!search.success || !search.data) {
      return { linked: false, updatedFields: [], phoneHydrated: false, notFound: false, error: search.error || "Search failed" };
    }

    contact = pickFirstContact(search.data);
    if (!contact) {
      return { linked: false, updatedFields: [], phoneHydrated: false, notFound: true };
    }
  }

  const { updateData, updatedFields } = buildLeadUpdateFromContact(lead, contact);
  if (Object.keys(updateData).length === 0) {
    return { linked: false, updatedFields: [], phoneHydrated: false, notFound: false };
  }

  if (!dryRun) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: updateData as any,
    });
  }

  const phoneHydrated = updatedFields.includes("phone");
  const linked = updatedFields.includes("ghlContactId");
  return { linked, updatedFields, phoneHydrated, notFound: false };
}

async function main() {
  const args = parseArgs(process.argv);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const state = args.resume ? await readState(args.stateFile) : {};
  let stateWriteChain = Promise.resolve();
  const queueWriteState = async () => {
    if (!args.resume) return;
    stateWriteChain = stateWriteChain
      .catch(() => undefined)
      .then(() => writeState(args.stateFile, state))
      .catch(() => undefined);
    await stateWriteChain;
  };

  const clients = await prisma.client.findMany({
    where: args.clientId ? { id: args.clientId } : {},
    select: {
      id: true,
      name: true,
      ghlLocationId: true,
      ghlPrivateKey: true,
    },
    orderBy: { name: "asc" },
  });

  const eligibleClients = clients.filter((c) => c.ghlLocationId && c.ghlPrivateKey);
  console.log(
    `[Backfill] Starting (dryRun=${args.dryRun}) for ${eligibleClients.length}/${clients.length} clients (pageSize=${args.pageSize}, leadConcurrency=${args.leadConcurrency}, clientConcurrency=${args.clientConcurrency})`
  );

  let remaining = args.maxLeads;
  let remainingChain = Promise.resolve();

  const reserveLeads = async (requested: number): Promise<number> => {
    if (!Number.isFinite(remaining)) return requested;
    const r = Math.max(0, Math.floor(requested));
    const p = remainingChain.then(() => {
      const granted = Math.min(r, remaining);
      remaining -= granted;
      return granted;
    });
    remainingChain = p.then(
      () => undefined,
      () => undefined
    );
    return p;
  };

  const releaseLeads = async (count: number): Promise<void> => {
    if (!Number.isFinite(remaining)) return;
    const r = Math.max(0, Math.floor(count));
    if (!r) return;
    const p = remainingChain.then(() => {
      remaining += r;
    });
    remainingChain = p.then(
      () => undefined,
      () => undefined
    );
    await p;
  };

  const totals: LeadBackfillResult = { scanned: 0, linked: 0, updated: 0, phoneHydrated: 0, notFound: 0, errors: 0 };

  await mapWithConcurrency(eligibleClients as ClientRow[], args.clientConcurrency, async (client) => {
    const clientState = state[client.id] || {};
    let lastId = args.resume ? clientState.lastLeadId : undefined;

    const clientTotals: LeadBackfillResult = { scanned: 0, linked: 0, updated: 0, phoneHydrated: 0, notFound: 0, errors: 0 };
    console.log(`[Backfill] Client ${client.name} (${client.id}) starting${lastId ? ` (resume after ${lastId})` : ""}`);

    while (true) {
      const take = await reserveLeads(args.pageSize);
      if (take <= 0) break;

      const leads = await prisma.lead.findMany({
        where: {
          clientId: client.id,
          ...(lastId ? { id: { gt: lastId } } : {}),
          OR: [
            { phone: null },
            { email: null },
            { firstName: null },
            { lastName: null },
            { companyName: null },
            { AND: [{ ghlContactId: null }, { email: { not: null } }] },
          ],
        },
        orderBy: { id: "asc" },
        take,
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          companyName: true,
          enrichmentStatus: true,
          ghlContactId: true,
        },
      });

      if (leads.length === 0) {
        await releaseLeads(take);
        break;
      }

      lastId = leads[leads.length - 1].id;
      if (leads.length < take) {
        await releaseLeads(take - leads.length);
      }

      clientTotals.scanned += leads.length;
      totals.scanned += leads.length;

      const results = await mapWithConcurrency(leads as LeadRow[], args.leadConcurrency, async (lead) => {
        try {
          return await backfillLead({ prisma, lead, client, dryRun: args.dryRun });
        } catch (error) {
          return {
            linked: false,
            updatedFields: [],
            phoneHydrated: false,
            notFound: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      });

      for (const r of results) {
        if (r.error) {
          clientTotals.errors++;
          totals.errors++;
          continue;
        }
        if (r.notFound) {
          clientTotals.notFound++;
          totals.notFound++;
          continue;
        }
        if (r.linked) {
          clientTotals.linked++;
          totals.linked++;
        }
        if (r.updatedFields.length > 0) {
          clientTotals.updated++;
          totals.updated++;
        }
        if (r.phoneHydrated) {
          clientTotals.phoneHydrated++;
          totals.phoneHydrated++;
        }
      }

      state[client.id] = { lastLeadId: lastId };
      await queueWriteState();

      console.log(
        `[Backfill] Client ${client.name} progress: scanned=${clientTotals.scanned} updated=${clientTotals.updated} linked=${clientTotals.linked} phoneHydrated=${clientTotals.phoneHydrated} notFound=${clientTotals.notFound} errors=${clientTotals.errors}`
      );
    }

    console.log(
      `[Backfill] Client ${client.name} done: scanned=${clientTotals.scanned} updated=${clientTotals.updated} linked=${clientTotals.linked} phoneHydrated=${clientTotals.phoneHydrated} notFound=${clientTotals.notFound} errors=${clientTotals.errors}`
    );
  });

  console.log(
    `[Backfill] Done: scanned=${totals.scanned} updated=${totals.updated} linked=${totals.linked} phoneHydrated=${totals.phoneHydrated} notFound=${totals.notFound} errors=${totals.errors}`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Backfill] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
