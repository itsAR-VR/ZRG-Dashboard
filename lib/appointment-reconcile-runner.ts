/**
 * Appointment Reconciliation Runner (Phase 28d)
 *
 * Shared logic for running reconciliation in batches across workspaces.
 * Used by both the cron endpoint and CLI backfill scripts.
 *
 * Lead eligibility heuristic (tunable):
 * - Has inbound replies (not just cold outbound)
 * - Missing provider IDs but sentiment indicates meeting requested/booked
 * - appointmentLastCheckedAt older than cutoff (stale)
 * - appointmentBookedAt present but missing timing/status
 */

import { prisma } from "@/lib/prisma";
import type { MeetingBookingProvider } from "@prisma/client";
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
async function getEligibleLeads(
  clientId: string,
  provider: MeetingBookingProvider,
  opts: ReconcileRunnerOptions
): Promise<Array<{ id: string; ghlContactId: string | null; email: string | null; ghlAppointmentId: string | null; calendlyScheduledEventUri: string | null }>> {
  const limit = opts.leadsPerWorkspace ?? DEFAULT_LEADS_PER_WORKSPACE;
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  const staleCutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

  // Base criteria for both providers
  const baseWhere = {
    clientId,
    // Must have at least one inbound reply
    lastInboundAt: { not: null },
    OR: [
      // Never checked
      { appointmentLastCheckedAt: null },
      // Stale (checked more than X days ago)
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
  };

  // Add provider-specific requirements
  const providerWhere =
    provider === "GHL"
      ? { ghlContactId: { not: null } }
      : { email: { not: null } };

  const leads = await prisma.lead.findMany({
    where: {
      ...baseWhere,
      ...providerWhere,
    },
    select: {
      id: true,
      ghlContactId: true,
      email: true,
      ghlAppointmentId: true,
      calendlyScheduledEventUri: true,
    },
    orderBy: [
      // Prioritize leads never checked
      { appointmentLastCheckedAt: "asc" },
    ],
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

  const leads = await getEligibleLeads(workspace.id, provider, opts);

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
    if (!lead.ghlContactId) {
      return { leadId, status: "error", error: "No ghlContactId" };
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
