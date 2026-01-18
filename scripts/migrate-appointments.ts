/**
 * Migrate Lead Appointment Rollups → Appointment Table (Phase 34b)
 *
 * Backfills an initial `Appointment` row per lead from existing Phase 28 lead-level
 * rollup fields, without triggering side effects (follow-ups, sentiment changes, etc.).
 *
 * Run:
 *   npm run migrate:appointments -- --dry-run
 *   npm run migrate:appointments -- --apply
 *   npm run migrate:appointments -- --apply --clientId <workspaceId>
 *   npm run migrate:appointments -- --apply --resume --state-file ./.migrate-appointments.json
 *
 * Env:
 *   DIRECT_URL (preferred) or DATABASE_URL - required
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient, AppointmentStatus, AppointmentSource } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

type Args = {
  clientId?: string;
  dryRun: boolean;
  pageSize: number;
  concurrency: number;
  maxLeads: number;
  resume: boolean;
  stateFile: string;
};

type MigrationState = Record<string, { lastLeadId?: string }>;

type MigrationResult = {
  scanned: number;
  created: number;
  alreadyExists: number;
  skipped: number;
  errors: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    clientId: undefined,
    dryRun: true,
    pageSize: 100,
    concurrency: 10,
    maxLeads: Number.POSITIVE_INFINITY,
    resume: false,
    stateFile: ".migrate-appointments.state.json",
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clientId" || a === "--client-id") args.clientId = argv[++i];
    else if (a === "--dry-run" || a === "--dryRun") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--page-size" || a === "--pageSize") args.pageSize = Number(argv[++i] || "0") || args.pageSize;
    else if (a === "--concurrency") args.concurrency = Number(argv[++i] || "0") || args.concurrency;
    else if (a === "--max-leads" || a === "--maxLeads") {
      const parsed = Number(argv[++i] || "");
      if (Number.isFinite(parsed) && parsed > 0) args.maxLeads = parsed;
    } else if (a === "--resume") args.resume = true;
    else if (a === "--state-file" || a === "--stateFile") args.stateFile = argv[++i] || args.stateFile;
  }

  args.pageSize = Math.max(1, Math.floor(args.pageSize));
  args.concurrency = Math.max(1, Math.floor(args.concurrency));
  return args;
}

async function readState(path: string): Promise<MigrationState> {
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as MigrationState;
  } catch {
    return {};
  }
}

async function writeState(path: string, state: MigrationState): Promise<void> {
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

/**
 * Map Phase 28 string status to Prisma AppointmentStatus enum
 */
function mapStatusToEnum(status: string | null): AppointmentStatus {
  switch (status?.toLowerCase()) {
    case "confirmed":
      return AppointmentStatus.CONFIRMED;
    case "canceled":
    case "cancelled":
      return AppointmentStatus.CANCELED;
    case "rescheduled":
      return AppointmentStatus.RESCHEDULED;
    case "showed":
      return AppointmentStatus.SHOWED;
    case "no_show":
    case "noshow":
      return AppointmentStatus.NO_SHOW;
    default:
      // Default to CONFIRMED for existing bookings without explicit status
      return AppointmentStatus.CONFIRMED;
  }
}

/**
 * Parse bookedSlot as a potential fallback for startAt
 */
function parseBookedSlot(bookedSlot: string | null): Date | null {
  if (!bookedSlot) return null;
  try {
    const d = new Date(bookedSlot);
    if (!isNaN(d.getTime())) return d;
  } catch {
    // Invalid date
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_URL or DATABASE_URL is required");
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

  // Get all clients (or specific one)
  const clients = await prisma.client.findMany({
    where: args.clientId ? { id: args.clientId } : undefined,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  console.log(
    `[Migrate Appointments] Starting (dryRun=${args.dryRun}) for ${clients.length} clients ` +
      `(pageSize=${args.pageSize}, concurrency=${args.concurrency})`
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

  const totals: MigrationResult = { scanned: 0, created: 0, alreadyExists: 0, skipped: 0, errors: 0 };

  for (const client of clients) {
    const clientState = state[client.id] || {};
    let lastId = args.resume ? clientState.lastLeadId : undefined;

    const clientTotals: MigrationResult = { scanned: 0, created: 0, alreadyExists: 0, skipped: 0, errors: 0 };
    console.log(`[Migrate] Client ${client.name} (${client.id}) starting${lastId ? ` (resume after ${lastId})` : ""}`);

    while (true) {
      const take = await reserveLeads(args.pageSize);
      if (take <= 0) break;

      // Find leads with provider evidence (any appointment data)
      const leads = await prisma.lead.findMany({
        where: {
          clientId: client.id,
          ...(lastId ? { id: { gt: lastId } } : {}),
          // Must have at least one provider ID
          OR: [
            { ghlAppointmentId: { not: null } },
            { calendlyInviteeUri: { not: null } },
            { calendlyScheduledEventUri: { not: null } },
          ],
        },
        orderBy: { id: "asc" },
        take,
        select: {
          id: true,
          ghlAppointmentId: true,
          calendlyInviteeUri: true,
          calendlyScheduledEventUri: true,
          appointmentStartAt: true,
          appointmentEndAt: true,
          appointmentStatus: true,
          appointmentCanceledAt: true,
          appointmentProvider: true,
          appointmentSource: true,
          appointmentBookedAt: true,
          bookedSlot: true,
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

      const results = await mapWithConcurrency(leads, args.concurrency, async (lead) => {
        try {
          // Determine provider and idempotency key
          const isGHL = Boolean(lead.ghlAppointmentId);
          const isCalendly = Boolean(lead.calendlyInviteeUri || lead.calendlyScheduledEventUri);

          // Skip if we can't determine provider
          if (!isGHL && !isCalendly) {
            return { status: "skipped" as const };
          }

          // Prefer GHL if both present (shouldn't happen, but handle gracefully)
          const provider = isGHL ? "GHL" : "CALENDLY";

          // Check if appointment already exists (idempotency)
          let existingAppointment;
          if (isGHL && lead.ghlAppointmentId) {
            existingAppointment = await prisma.appointment.findUnique({
              where: { ghlAppointmentId: lead.ghlAppointmentId },
              select: { id: true },
            });
          } else if (lead.calendlyInviteeUri) {
            existingAppointment = await prisma.appointment.findUnique({
              where: { calendlyInviteeUri: lead.calendlyInviteeUri },
              select: { id: true },
            });
          }

          if (existingAppointment) {
            return { status: "already_exists" as const };
          }

          // Determine startAt (with bookedSlot fallback)
          let startAt = lead.appointmentStartAt;
          if (!startAt && lead.bookedSlot) {
            startAt = parseBookedSlot(lead.bookedSlot);
          }

          // Determine status
          const status = mapStatusToEnum(lead.appointmentStatus);

          // Build appointment data
          const appointmentData = {
            leadId: lead.id,
            provider: provider as "GHL" | "CALENDLY",
            ghlAppointmentId: isGHL ? lead.ghlAppointmentId : null,
            calendlyInviteeUri: isCalendly ? lead.calendlyInviteeUri : null,
            calendlyScheduledEventUri: isCalendly ? lead.calendlyScheduledEventUri : null,
            startAt,
            endAt: lead.appointmentEndAt,
            status,
            statusChangedAt: lead.appointmentCanceledAt ?? lead.appointmentBookedAt ?? new Date(),
            canceledAt: status === AppointmentStatus.CANCELED ? (lead.appointmentCanceledAt ?? new Date()) : null,
            source: AppointmentSource.MIGRATION,
          };

          if (args.dryRun) {
            return { status: "created" as const };
          }

          await prisma.appointment.create({
            data: appointmentData,
          });

          return { status: "created" as const };
        } catch (error) {
          // Handle unique constraint violations (race condition or duplicate)
          if (error instanceof Error && error.message.includes("Unique constraint")) {
            return { status: "already_exists" as const };
          }
          console.error(`[Migrate] Error for lead ${lead.id}:`, error instanceof Error ? error.message : error);
          return { status: "error" as const };
        }
      });

      for (const r of results) {
        switch (r.status) {
          case "created":
            clientTotals.created++;
            totals.created++;
            break;
          case "already_exists":
            clientTotals.alreadyExists++;
            totals.alreadyExists++;
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
        `[Migrate] Client ${client.name} progress: scanned=${clientTotals.scanned} created=${clientTotals.created} exists=${clientTotals.alreadyExists} skipped=${clientTotals.skipped} errors=${clientTotals.errors}`
      );
    }

    console.log(
      `[Migrate] Client ${client.name} done: scanned=${clientTotals.scanned} created=${clientTotals.created} exists=${clientTotals.alreadyExists} skipped=${clientTotals.skipped} errors=${clientTotals.errors}`
    );
  }

  console.log(
    `[Migrate Appointments] Done: scanned=${totals.scanned} created=${totals.created} exists=${totals.alreadyExists} skipped=${totals.skipped} errors=${totals.errors}`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Migrate Appointments] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
