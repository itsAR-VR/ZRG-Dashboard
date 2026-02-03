/**
 * Appointment Reconciliation Runner (Phase 28d)
 *
 * Shared logic for running reconciliation in batches across workspaces.
 * Used by both the cron endpoint and CLI backfill scripts.
 *
 * Lead eligibility heuristic (tunable):
 * - Hot leads: active non-post-booking sequences (appointmentLastCheckedAt null or older than hot cutoff)
 * - Warm leads: inbound replies + stale/backfill conditions (appointmentLastCheckedAt older than cutoff)
 * - Missing provider IDs but sentiment indicates meeting requested/booked
 * - appointmentBookedAt present but missing timing/status
 */

import { prisma } from "@/lib/prisma";
import type { MeetingBookingProvider, Prisma } from "@prisma/client";
import {
  reconcileGHLAppointmentForLead,
  reconcileGHLAppointmentById,
  type GHLReconcileResult,
  type GHLReconcileOptions,
} from "@/lib/ghl-appointment-reconcile";
import {
  reconcileCalendlyBookingForLead,
  reconcileCalendlyBookingByUri,
  type CalendlyReconcileResult,
  type CalendlyReconcileOptions,
} from "@/lib/calendly-appointment-reconcile";
import { APPOINTMENT_SOURCE, type AppointmentSource } from "@/lib/meeting-lifecycle";

// Default limits
const DEFAULT_WORKSPACE_LIMIT = 10;
const DEFAULT_LEADS_PER_WORKSPACE = 50;
const DEFAULT_STALE_DAYS = 7; // Re-check leads not checked in 7 days
const DEFAULT_HOT_MINUTES = 1; // Re-check hot leads within N minutes

// Circuit breaker thresholds (Phase 57d)
const DEFAULT_CIRCUIT_BREAKER_ERROR_RATE = 0.5; // 50% error rate triggers circuit breaker
const DEFAULT_CIRCUIT_BREAKER_MIN_CHECKS = 5; // Don't trip on small batches

function getCircuitBreakerErrorRate(): number {
  const parsed = Number.parseFloat(process.env.RECONCILE_CIRCUIT_BREAKER_ERROR_RATE || "");
  if (!Number.isFinite(parsed)) return DEFAULT_CIRCUIT_BREAKER_ERROR_RATE;
  return Math.min(1, Math.max(0, parsed));
}

function getCircuitBreakerMinChecks(): number {
  const parsed = Number.parseInt(process.env.RECONCILE_CIRCUIT_BREAKER_MIN_CHECKS || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CIRCUIT_BREAKER_MIN_CHECKS;
  return Math.max(1, Math.trunc(parsed));
}

export function getReconcileHotMinutes(): number {
  const parsed = Number.parseInt(process.env.RECONCILE_HOT_MINUTES || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HOT_MINUTES;
  return Math.max(1, Math.trunc(parsed));
}

export function getHotCutoff(now: Date, hotMinutes?: number): Date {
  const minutes = hotMinutes ?? getReconcileHotMinutes();
  return new Date(now.getTime() - minutes * 60 * 1000);
}

export function buildProviderEligibilityWhere(provider: MeetingBookingProvider): Prisma.LeadWhereInput {
  if (provider === "GHL") {
    return {
      OR: [
        { ghlContactId: { not: null } },
        { email: { not: null } },
        { ghlAppointmentId: { not: null } },
      ],
    };
  }

  return { email: { not: null } };
}

export function buildHotLeadWhere(opts: {
  clientId: string;
  provider: MeetingBookingProvider;
  hotCutoff: Date;
  excludeIds?: string[];
}): Prisma.LeadWhereInput {
  const conditions: Prisma.LeadWhereInput[] = [
    { clientId: opts.clientId },
    buildProviderEligibilityWhere(opts.provider),
    {
      followUpInstances: {
        some: {
          status: "active",
          sequence: { triggerOn: { not: "meeting_selected" } },
        },
      },
    },
    {
      OR: [
        { appointmentLastCheckedAt: null },
        { appointmentLastCheckedAt: { lt: opts.hotCutoff } },
      ],
    },
  ];

  if (opts.excludeIds && opts.excludeIds.length > 0) {
    conditions.push({ id: { notIn: opts.excludeIds } });
  }

  return { AND: conditions };
}

export function buildWarmLeadWhere(opts: {
  clientId: string;
  provider: MeetingBookingProvider;
  staleCutoff: Date;
  excludeIds?: string[];
}): Prisma.LeadWhereInput {
  const conditions: Prisma.LeadWhereInput[] = [
    { clientId: opts.clientId },
    buildProviderEligibilityWhere(opts.provider),
    { lastInboundAt: { not: null } },
    {
      OR: [
        { appointmentLastCheckedAt: null },
        { appointmentLastCheckedAt: { lt: opts.staleCutoff } },
        {
          appointmentStatus: null,
          OR: [
            { ghlAppointmentId: { not: null } },
            { calendlyInviteeUri: { not: null } },
            { calendlyScheduledEventUri: { not: null } },
          ],
        },
      ],
    },
  ];

  if (opts.excludeIds && opts.excludeIds.length > 0) {
    conditions.push({ id: { notIn: opts.excludeIds } });
  }

  return { AND: conditions };
}

export interface ReconcileRunnerOptions {
  /** Max workspaces to process per run */
  workspaceLimit?: number;
  /** Max leads per workspace per run */
  leadsPerWorkspace?: number;
  /** Days before a lead is considered "stale" for re-reconciliation */
  staleDays?: number;
  /** Source to record on reconciled leads */
  source?: AppointmentSource;
  /** Dry run - don't write to database */
  dryRun?: boolean;
  /** Skip follow-up side effects */
  skipSideEffects?: boolean;
  /** Only process a specific client ID */
  clientId?: string;
}

export interface ReconcileRunnerResult {
  workspacesProcessed: number;
  leadsChecked: number;
  bookedFound: number;
  canceledFound: number;
  noChange: number;
  skipped: number;
  errors: number;
  /** Circuit breaker tripped when error rate exceeds threshold (Phase 57d) */
  circuitBroken?: boolean;
  byProvider: {
    ghl: { checked: number; booked: number; canceled: number; errors: number };
    calendly: { checked: number; booked: number; canceled: number; errors: number };
  };
}

/**
 * Get eligible workspaces for reconciliation.
 * Returns workspaces that have provider credentials configured.
 */
async function getEligibleWorkspaces(opts: ReconcileRunnerOptions): Promise<
  Array<{
    id: string;
    provider: MeetingBookingProvider;
    ghlLocationId: string | null;
    ghlPrivateKey: string | null;
    calendlyAccessToken: string | null;
    calendlyOrganizationUri: string | null;
  }>
> {
  const limit = opts.workspaceLimit ?? DEFAULT_WORKSPACE_LIMIT;

  const where = opts.clientId ? { id: opts.clientId } : {};

  const clients = await prisma.client.findMany({
    where: {
      ...where,
      OR: [
        // GHL credentials
        {
          ghlPrivateKey: { not: null },
          ghlLocationId: { not: null },
        },
        // Calendly credentials
        {
          calendlyAccessToken: { not: null },
          calendlyOrganizationUri: { not: null },
        },
      ],
    },
    select: {
      id: true,
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
    take: limit,
  });

  return clients.map((c) => ({
    id: c.id,
    provider: c.settings?.meetingBookingProvider ?? "GHL",
    ghlLocationId: c.ghlLocationId,
    ghlPrivateKey: c.ghlPrivateKey,
    calendlyAccessToken: c.calendlyAccessToken,
    calendlyOrganizationUri: c.calendlyOrganizationUri,
  }));
}

/**
 * Get eligible leads for reconciliation in a workspace.
 *
 * Eligibility criteria:
 * 1. Has at least one inbound reply (not just cold outbound)
 * 2. Either:
 *    - Never checked before (appointmentLastCheckedAt is null)
 *    - Checked more than `staleDays` ago
 *    - Has booking evidence but missing status
 */
async function getHotLeads(
  clientId: string,
  provider: MeetingBookingProvider,
  limit: number
): Promise<Array<{ id: string; ghlContactId: string | null; email: string | null; ghlAppointmentId: string | null; calendlyScheduledEventUri: string | null }>> {
  const hotCutoff = getHotCutoff(new Date(), getReconcileHotMinutes());

  const leads = await prisma.lead.findMany({
    where: buildHotLeadWhere({ clientId, provider, hotCutoff }),
    select: {
      id: true,
      ghlContactId: true,
      email: true,
      ghlAppointmentId: true,
      calendlyScheduledEventUri: true,
    },
    orderBy: [{ appointmentLastCheckedAt: "asc" }],
    take: limit,
  });

  return leads;
}

async function getWarmLeads(
  clientId: string,
  provider: MeetingBookingProvider,
  opts: ReconcileRunnerOptions,
  limit: number,
  excludeIds: string[]
): Promise<Array<{ id: string; ghlContactId: string | null; email: string | null; ghlAppointmentId: string | null; calendlyScheduledEventUri: string | null }>> {
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const staleCutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    where: buildWarmLeadWhere({
      clientId,
      provider,
      staleCutoff,
      excludeIds,
    }),
    select: {
      id: true,
      ghlContactId: true,
      email: true,
      ghlAppointmentId: true,
      calendlyScheduledEventUri: true,
    },
    orderBy: [{ appointmentLastCheckedAt: "asc" }],
    take: limit,
  });

  return leads;
}

/**
 * Run reconciliation for a single workspace.
 */
async function reconcileWorkspace(
  workspace: Awaited<ReturnType<typeof getEligibleWorkspaces>>[0],
  opts: ReconcileRunnerOptions
): Promise<{
  leadsChecked: number;
  booked: number;
  canceled: number;
  noChange: number;
  skipped: number;
  errors: number;
}> {
  const provider = workspace.provider;
  const source = opts.source ?? APPOINTMENT_SOURCE.RECONCILE_CRON;

  const limit = opts.leadsPerWorkspace ?? DEFAULT_LEADS_PER_WORKSPACE;
  const hotLeads = await getHotLeads(workspace.id, provider, limit);
  const hotIds = hotLeads.map((lead) => lead.id);
  const remaining = Math.max(0, limit - hotLeads.length);
  const warmLeads = remaining > 0 ? await getWarmLeads(workspace.id, provider, opts, remaining, hotIds) : [];
  const leads = [...hotLeads, ...warmLeads];

  const counters = {
    leadsChecked: 0,
    booked: 0,
    canceled: 0,
    noChange: 0,
    skipped: 0,
    errors: 0,
  };

  for (const lead of leads) {
    counters.leadsChecked++;

    let result: GHLReconcileResult | CalendlyReconcileResult;

    if (provider === "GHL") {
      // If we have an existing appointment ID, use direct lookup
      if (lead.ghlAppointmentId) {
        result = await reconcileGHLAppointmentById(lead.id, lead.ghlAppointmentId, {
          source,
          dryRun: opts.dryRun,
          skipSideEffects: opts.skipSideEffects,
        } satisfies GHLReconcileOptions);
      } else {
        result = await reconcileGHLAppointmentForLead(lead.id, {
          source,
          dryRun: opts.dryRun,
          skipSideEffects: opts.skipSideEffects,
        } satisfies GHLReconcileOptions);
      }
    } else {
      // Calendly
      if (lead.calendlyScheduledEventUri) {
        result = await reconcileCalendlyBookingByUri(lead.id, lead.calendlyScheduledEventUri, {
          source,
          dryRun: opts.dryRun,
          skipSideEffects: opts.skipSideEffects,
        } satisfies CalendlyReconcileOptions);
      } else {
        result = await reconcileCalendlyBookingForLead(lead.id, {
          source,
          dryRun: opts.dryRun,
          skipSideEffects: opts.skipSideEffects,
        } satisfies CalendlyReconcileOptions);
      }
    }

    switch (result.status) {
      case "booked":
        counters.booked++;
        break;
      case "canceled":
        counters.canceled++;
        break;
      case "no_change":
      case "no_appointments":
      case "no_events":
        counters.noChange++;
        break;
      case "skipped":
        counters.skipped++;
        break;
      case "error":
        counters.errors++;
        break;
    }
  }

  return counters;
}

/**
 * Main entry point for running reconciliation across workspaces.
 */
export async function runAppointmentReconciliation(
  opts: ReconcileRunnerOptions = {}
): Promise<ReconcileRunnerResult> {
  const workspaces = await getEligibleWorkspaces(opts);

  const result: ReconcileRunnerResult = {
    workspacesProcessed: 0,
    leadsChecked: 0,
    bookedFound: 0,
    canceledFound: 0,
    noChange: 0,
    skipped: 0,
    errors: 0,
    byProvider: {
      ghl: { checked: 0, booked: 0, canceled: 0, errors: 0 },
      calendly: { checked: 0, booked: 0, canceled: 0, errors: 0 },
    },
  };

  for (const workspace of workspaces) {
    try {
      const wsResult = await reconcileWorkspace(workspace, opts);

      result.workspacesProcessed++;
      result.leadsChecked += wsResult.leadsChecked;
      result.bookedFound += wsResult.booked;
      result.canceledFound += wsResult.canceled;
      result.noChange += wsResult.noChange;
      result.skipped += wsResult.skipped;
      result.errors += wsResult.errors;

      // Track by provider
      const providerKey = workspace.provider === "GHL" ? "ghl" : "calendly";
      result.byProvider[providerKey].checked += wsResult.leadsChecked;
      result.byProvider[providerKey].booked += wsResult.booked;
      result.byProvider[providerKey].canceled += wsResult.canceled;
      result.byProvider[providerKey].errors += wsResult.errors;

      // Phase 57d: Circuit breaker — exit early if error rate is too high
      const errorRate = result.errors / Math.max(1, result.leadsChecked);
      const circuitBreakerRate = getCircuitBreakerErrorRate();
      const circuitBreakerMinChecks = getCircuitBreakerMinChecks();
      if (
        result.leadsChecked >= circuitBreakerMinChecks &&
        errorRate >= circuitBreakerRate
      ) {
        console.warn("[Reconcile Runner] Circuit breaker tripped", {
          errorRate: (errorRate * 100).toFixed(1) + "%",
          leadsChecked: result.leadsChecked,
          errors: result.errors,
          threshold: (circuitBreakerRate * 100) + "%",
          minChecks: circuitBreakerMinChecks,
        });
        result.circuitBroken = true;
        return result;
      }
    } catch (error) {
      console.error(`[Reconcile Runner] Error processing workspace ${workspace.id}:`, error);
      result.errors++;
    }
  }

  return result;
}

/**
 * Run reconciliation for a specific lead by ID.
 * Useful for manual reconciliation or on-demand checks.
 */
export async function reconcileSingleLead(
  leadId: string,
  opts: { dryRun?: boolean; skipSideEffects?: boolean } = {}
): Promise<GHLReconcileResult | CalendlyReconcileResult | { leadId: string; status: "error"; error: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      ghlContactId: true,
      email: true,
      ghlAppointmentId: true,
      calendlyScheduledEventUri: true,
      client: {
        select: {
          ghlPrivateKey: true,
          ghlLocationId: true,
          calendlyAccessToken: true,
          calendlyOrganizationUri: true,
          settings: {
            select: {
              meetingBookingProvider: true,
            },
          },
        },
      },
    },
  });

  if (!lead) {
    return { leadId, status: "error", error: "Lead not found" };
  }

  const provider = lead.client.settings?.meetingBookingProvider ?? "GHL";

  if (provider === "GHL") {
    if (!lead.client.ghlPrivateKey || !lead.client.ghlLocationId) {
      return { leadId, status: "error", error: "No GHL credentials configured" };
    }

    if (lead.ghlAppointmentId) {
      return reconcileGHLAppointmentById(leadId, lead.ghlAppointmentId, {
        source: APPOINTMENT_SOURCE.MANUAL,
        dryRun: opts.dryRun,
        skipSideEffects: opts.skipSideEffects,
      });
    }
    return reconcileGHLAppointmentForLead(leadId, {
      source: APPOINTMENT_SOURCE.MANUAL,
      dryRun: opts.dryRun,
      skipSideEffects: opts.skipSideEffects,
    });
  }

  // Calendly
  if (!lead.client.calendlyAccessToken || !lead.client.calendlyOrganizationUri) {
    return { leadId, status: "error", error: "No Calendly credentials configured" };
  }
  if (!lead.email) {
    return { leadId, status: "error", error: "No email address" };
  }

  if (lead.calendlyScheduledEventUri) {
    return reconcileCalendlyBookingByUri(leadId, lead.calendlyScheduledEventUri, {
      source: APPOINTMENT_SOURCE.MANUAL,
      dryRun: opts.dryRun,
      skipSideEffects: opts.skipSideEffects,
    });
  }
  return reconcileCalendlyBookingForLead(leadId, {
    source: APPOINTMENT_SOURCE.MANUAL,
    dryRun: opts.dryRun,
    skipSideEffects: opts.skipSideEffects,
  });
}
