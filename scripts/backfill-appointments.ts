/**
 * Backfill Appointment Reconciliation (Phase 28 follow-up)
 *
 * Resumable CLI script to reconcile appointment booking state across all leads.
 * Uses the same reconciliation logic as the cron endpoint but with:
 * - Resumable state persistence (cursor per client)
 * - Configurable concurrency and batch sizes
 * - Safety caps (max leads total)
 *
 * Run:
 *   npx tsx scripts/backfill-appointments.ts --dry-run
 *   npx tsx scripts/backfill-appointments.ts --apply
 *   npx tsx scripts/backfill-appointments.ts --apply --clientId <workspaceId>
 *   npx tsx scripts/backfill-appointments.ts --apply --resume --state-file ./.backfill-appointments.json
 *
 * Env:
 *   DATABASE_URL          - required
 *   GHL_REQUESTS_PER_10S  - optional (default 90; GHL burst is 100/10s)
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient, type MeetingBookingProvider } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  reconcileGHLAppointmentForLead,
  reconcileGHLAppointmentById,
  type GHLReconcileResult,
} from "../lib/ghl-appointment-reconcile";
import {
  reconcileCalendlyBookingForLead,
  reconcileCalendlyBookingByUri,
  type CalendlyReconcileResult,
} from "../lib/calendly-appointment-reconcile";
import { APPOINTMENT_SOURCE } from "../lib/meeting-lifecycle";

type Args = {
  clientId?: string;
  dryRun: boolean;
  pageSize: number;
  leadConcurrency: number;
  clientConcurrency: number;
  maxLeads: number;
  resume: boolean;
  stateFile: string;
  staleDays: number;
  skipSideEffects: boolean;
};

type BackfillState = Record<string, { lastLeadId?: string }>;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    clientId: undefined,
    dryRun: true,
    pageSize: 100,
    leadConcurrency: 5, // Lower than hydration script due to external API calls
    clientConcurrency: 2,
    maxLeads: Number.POSITIVE_INFINITY,
    resume: false,
    stateFile: ".backfill-appointments.state.json",
    staleDays: 7,
    skipSideEffects: false,
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
    else if (a === "--stale-days" || a === "--staleDays") args.staleDays = Number(argv[++i] || "0") || args.staleDays;
    else if (a === "--skip-side-effects" || a === "--skipSideEffects") args.skipSideEffects = true;
  }

  args.pageSize = Math.max(1, Math.floor(args.pageSize));
  args.leadConcurrency = Math.max(1, Math.floor(args.leadConcurrency));
  args.clientConcurrency = Math.max(1, Math.floor(args.clientConcurrency));
  return args;
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
  calendlyAccessToken: string | null;
  calendlyOrganizationUri: string | null;
  provider: MeetingBookingProvider;
};

type LeadRow = {
  id: string;
  email: string | null;
  ghlContactId: string | null;
  ghlAppointmentId: string | null;
  calendlyScheduledEventUri: string | null;
};

type BackfillResult = {
  scanned: number;
  booked: number;
  canceled: number;
  noChange: number;
  skipped: number;
  errors: number;
};

async function reconcileLead(opts: {
  lead: LeadRow;
  client: ClientRow;
  dryRun: boolean;
  skipSideEffects: boolean;
}): Promise<{ status: "booked" | "canceled" | "no_change" | "skipped" | "error"; error?: string }> {
  const { lead, client, dryRun, skipSideEffects } = opts;
  const source = APPOINTMENT_SOURCE.BACKFILL;

  let result: GHLReconcileResult | CalendlyReconcileResult;

  try {
    if (client.provider === "GHL") {
      if (!client.ghlPrivateKey || !client.ghlLocationId || !lead.ghlContactId) {
        return { status: "skipped" };
      }

      if (lead.ghlAppointmentId) {
        result = await reconcileGHLAppointmentById(lead.id, lead.ghlAppointmentId, {
          source,
          dryRun,
          skipSideEffects,
        });
      } else {
        result = await reconcileGHLAppointmentForLead(lead.id, {
          source,
          dryRun,
          skipSideEffects,
        });
      }
    } else {
      // Calendly
      if (!client.calendlyAccessToken || !client.calendlyOrganizationUri || !lead.email) {
        return { status: "skipped" };
      }

      if (lead.calendlyScheduledEventUri) {
        result = await reconcileCalendlyBookingByUri(lead.id, lead.calendlyScheduledEventUri, {
          source,
          dryRun,
          skipSideEffects,
        });
      } else {
        result = await reconcileCalendlyBookingForLead(lead.id, {
          source,
          dryRun,
          skipSideEffects,
        });
      }
    }

    switch (result.status) {
      case "booked":
        return { status: "booked" };
      case "canceled":
        return { status: "canceled" };
      case "no_change":
      case "no_appointments":
      case "no_events":
        return { status: "no_change" };
      case "skipped":
        return { status: "skipped" };
      case "error":
        return { status: "error", error: result.error };
    }
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

  // Get all clients with provider credentials
  const clients = await prisma.client.findMany({
    where: args.clientId
      ? { id: args.clientId }
      : {
          OR: [
            {
              ghlPrivateKey: { not: null },
              ghlLocationId: { not: null },
            },
            {
              calendlyAccessToken: { not: null },
              calendlyOrganizationUri: { not: null },
            },
          ],
        },
    select: {
      id: true,
      name: true,
      ghlLocationId: true,
      ghlPrivateKey: true,
      calendlyAccessToken: true,
      calendlyOrganizationUri: true,
      settings: {
        select: {
          meetingBookingProvider: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const eligibleClients: ClientRow[] = clients
    .filter((c) => (c.ghlLocationId && c.ghlPrivateKey) || (c.calendlyAccessToken && c.calendlyOrganizationUri))
    .map((c) => ({
      id: c.id,
      name: c.name,
      ghlLocationId: c.ghlLocationId,
      ghlPrivateKey: c.ghlPrivateKey,
      calendlyAccessToken: c.calendlyAccessToken,
      calendlyOrganizationUri: c.calendlyOrganizationUri,
      provider: c.settings?.meetingBookingProvider ?? "GHL",
    }));

  console.log(
    `[Backfill Appointments] Starting (dryRun=${args.dryRun}) for ${eligibleClients.length}/${clients.length} clients ` +
      `(pageSize=${args.pageSize}, leadConcurrency=${args.leadConcurrency}, clientConcurrency=${args.clientConcurrency}, staleDays=${args.staleDays})`
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

  const totals: BackfillResult = { scanned: 0, booked: 0, canceled: 0, noChange: 0, skipped: 0, errors: 0 };
  const staleCutoff = new Date(Date.now() - args.staleDays * 24 * 60 * 60 * 1000);

  await mapWithConcurrency(eligibleClients, args.clientConcurrency, async (client) => {
    const clientState = state[client.id] || {};
    let lastId = args.resume ? clientState.lastLeadId : undefined;

    const clientTotals: BackfillResult = { scanned: 0, booked: 0, canceled: 0, noChange: 0, skipped: 0, errors: 0 };
    console.log(`[Backfill] Client ${client.name} (${client.id}) starting${lastId ? ` (resume after ${lastId})` : ""}`);

    // Build provider-specific query conditions
    const providerWhere = client.provider === "GHL" ? { ghlContactId: { not: null } } : { email: { not: null } };

    while (true) {
      const take = await reserveLeads(args.pageSize);
      if (take <= 0) break;

      const leads = await prisma.lead.findMany({
        where: {
          clientId: client.id,
          ...(lastId ? { id: { gt: lastId } } : {}),
          // Must have inbound replies (not cold outbound)
          lastInboundAt: { not: null },
          // Eligibility criteria
          OR: [
            // Never checked
            { appointmentLastCheckedAt: null },
            // Stale
            { appointmentLastCheckedAt: { lt: staleCutoff } },
            // Has booking evidence but missing status
            {
              appointmentStatus: null,
              OR: [
                { ghlAppointmentId: { not: null } },
                { calendlyInviteeUri: { not: null } },
                { calendlyScheduledEventUri: { not: null } },
              ],
            },
          ],
          ...providerWhere,
        },
        orderBy: { id: "asc" },
        take,
        select: {
          id: true,
          email: true,
          ghlContactId: true,
          ghlAppointmentId: true,
          calendlyScheduledEventUri: true,
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
        return reconcileLead({
          lead,
          client,
          dryRun: args.dryRun,
          skipSideEffects: args.skipSideEffects,
        });
      });

      for (const r of results) {
        switch (r.status) {
          case "booked":
            clientTotals.booked++;
            totals.booked++;
            break;
          case "canceled":
            clientTotals.canceled++;
            totals.canceled++;
            break;
          case "no_change":
            clientTotals.noChange++;
            totals.noChange++;
            break;
          case "skipped":
            clientTotals.skipped++;
            totals.skipped++;
            break;
          case "error":
            clientTotals.errors++;
            totals.errors++;
            break;
        }
      }

      state[client.id] = { lastLeadId: lastId };
      await queueWriteState();

      console.log(
        `[Backfill] Client ${client.name} progress: scanned=${clientTotals.scanned} booked=${clientTotals.booked} canceled=${clientTotals.canceled} noChange=${clientTotals.noChange} skipped=${clientTotals.skipped} errors=${clientTotals.errors}`
      );
    }

    console.log(
      `[Backfill] Client ${client.name} done: scanned=${clientTotals.scanned} booked=${clientTotals.booked} canceled=${clientTotals.canceled} noChange=${clientTotals.noChange} skipped=${clientTotals.skipped} errors=${clientTotals.errors}`
    );
  });

  console.log(
    `[Backfill Appointments] Done: scanned=${totals.scanned} booked=${totals.booked} canceled=${totals.canceled} noChange=${totals.noChange} skipped=${totals.skipped} errors=${totals.errors}`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Backfill Appointments] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
