/**
 * Appointment Mismatch Reporting (Phase 28e)
 *
 * Detects discrepancies between AI sentiment and provider-backed booking evidence.
 * Produces a report for operator review and optionally auto-corrects mismatches.
 *
 * Mismatch Types:
 * 1. sentiment_booked_no_evidence - Lead has "Meeting Booked" sentiment but no provider IDs
 * 2. evidence_exists_not_booked - Provider IDs exist but lead status is not "meeting-booked"
 * 3. canceled_but_booked_status - Appointment is canceled but lead status is still "meeting-booked"
 */

import { prisma } from "@/lib/prisma";
import { APPOINTMENT_STATUS } from "@/lib/meeting-lifecycle";

export interface MismatchRecord {
  leadId: string;
  clientId: string;
  mismatchType: "sentiment_booked_no_evidence" | "evidence_exists_not_booked" | "canceled_but_booked_status";
  // Triage fields (no PII)
  leadStatus: string;
  sentimentTag: string | null;
  appointmentStatus: string | null;
  ghlAppointmentId: string | null;
  calendlyInviteeUri: string | null;
  calendlyScheduledEventUri: string | null;
  lastInboundAt: Date | null;
  lastMessageAt: Date | null;
  lastMessageDirection: string | null;
  appointmentLastCheckedAt: Date | null;
}

export interface MismatchReport {
  generatedAt: Date;
  totalMismatches: number;
  byType: {
    sentiment_booked_no_evidence: number;
    evidence_exists_not_booked: number;
    canceled_but_booked_status: number;
  };
  mismatches: MismatchRecord[];
}

export interface GenerateMismatchReportOptions {
  /** Filter to a specific client/workspace */
  clientId?: string;
  /** Max records per mismatch type */
  limitPerType?: number;
}

/**
 * Generate a mismatch report for operator review.
 */
export async function generateMismatchReport(
  opts: GenerateMismatchReportOptions = {}
): Promise<MismatchReport> {
  const limitPerType = opts.limitPerType ?? 100;
  const baseWhere = opts.clientId ? { clientId: opts.clientId } : {};

  const report: MismatchReport = {
    generatedAt: new Date(),
    totalMismatches: 0,
    byType: {
      sentiment_booked_no_evidence: 0,
      evidence_exists_not_booked: 0,
      canceled_but_booked_status: 0,
    },
    mismatches: [],
  };

  // Type 1: Sentiment says "Meeting Booked" but no provider evidence
  const sentimentBookedNoEvidence = await prisma.lead.findMany({
    where: {
      ...baseWhere,
      sentimentTag: "Meeting Booked",
      ghlAppointmentId: null,
      calendlyInviteeUri: null,
      calendlyScheduledEventUri: null,
    },
    select: {
      id: true,
      clientId: true,
      status: true,
      sentimentTag: true,
      appointmentStatus: true,
      ghlAppointmentId: true,
      calendlyInviteeUri: true,
      calendlyScheduledEventUri: true,
      lastInboundAt: true,
      lastMessageAt: true,
      lastMessageDirection: true,
      appointmentLastCheckedAt: true,
    },
    take: limitPerType,
  });

  for (const lead of sentimentBookedNoEvidence) {
    report.mismatches.push({
      leadId: lead.id,
      clientId: lead.clientId,
      mismatchType: "sentiment_booked_no_evidence",
      leadStatus: lead.status,
      sentimentTag: lead.sentimentTag,
      appointmentStatus: lead.appointmentStatus,
      ghlAppointmentId: lead.ghlAppointmentId,
      calendlyInviteeUri: lead.calendlyInviteeUri,
      calendlyScheduledEventUri: lead.calendlyScheduledEventUri,
      lastInboundAt: lead.lastInboundAt,
      lastMessageAt: lead.lastMessageAt,
      lastMessageDirection: lead.lastMessageDirection,
      appointmentLastCheckedAt: lead.appointmentLastCheckedAt,
    });
    report.byType.sentiment_booked_no_evidence++;
  }

  // Type 2: Provider evidence exists but lead is not marked as meeting-booked
  const evidenceExistsNotBooked = await prisma.lead.findMany({
    where: {
      ...baseWhere,
      status: { not: "meeting-booked" },
      appointmentStatus: { not: APPOINTMENT_STATUS.CANCELED },
      OR: [
        { ghlAppointmentId: { not: null } },
        { calendlyInviteeUri: { not: null } },
        { calendlyScheduledEventUri: { not: null } },
      ],
    },
    select: {
      id: true,
      clientId: true,
      status: true,
      sentimentTag: true,
      appointmentStatus: true,
      ghlAppointmentId: true,
      calendlyInviteeUri: true,
      calendlyScheduledEventUri: true,
      lastInboundAt: true,
      lastMessageAt: true,
      lastMessageDirection: true,
      appointmentLastCheckedAt: true,
    },
    take: limitPerType,
  });

  for (const lead of evidenceExistsNotBooked) {
    report.mismatches.push({
      leadId: lead.id,
      clientId: lead.clientId,
      mismatchType: "evidence_exists_not_booked",
      leadStatus: lead.status,
      sentimentTag: lead.sentimentTag,
      appointmentStatus: lead.appointmentStatus,
      ghlAppointmentId: lead.ghlAppointmentId,
      calendlyInviteeUri: lead.calendlyInviteeUri,
      calendlyScheduledEventUri: lead.calendlyScheduledEventUri,
      lastInboundAt: lead.lastInboundAt,
      lastMessageAt: lead.lastMessageAt,
      lastMessageDirection: lead.lastMessageDirection,
      appointmentLastCheckedAt: lead.appointmentLastCheckedAt,
    });
    report.byType.evidence_exists_not_booked++;
  }

  // Type 3: Appointment is canceled but lead status is still meeting-booked
  const canceledButBookedStatus = await prisma.lead.findMany({
    where: {
      ...baseWhere,
      status: "meeting-booked",
      appointmentStatus: APPOINTMENT_STATUS.CANCELED,
    },
    select: {
      id: true,
      clientId: true,
      status: true,
      sentimentTag: true,
      appointmentStatus: true,
      ghlAppointmentId: true,
      calendlyInviteeUri: true,
      calendlyScheduledEventUri: true,
      lastInboundAt: true,
      lastMessageAt: true,
      lastMessageDirection: true,
      appointmentLastCheckedAt: true,
    },
    take: limitPerType,
  });

  for (const lead of canceledButBookedStatus) {
    report.mismatches.push({
      leadId: lead.id,
      clientId: lead.clientId,
      mismatchType: "canceled_but_booked_status",
      leadStatus: lead.status,
      sentimentTag: lead.sentimentTag,
      appointmentStatus: lead.appointmentStatus,
      ghlAppointmentId: lead.ghlAppointmentId,
      calendlyInviteeUri: lead.calendlyInviteeUri,
      calendlyScheduledEventUri: lead.calendlyScheduledEventUri,
      lastInboundAt: lead.lastInboundAt,
      lastMessageAt: lead.lastMessageAt,
      lastMessageDirection: lead.lastMessageDirection,
      appointmentLastCheckedAt: lead.appointmentLastCheckedAt,
    });
    report.byType.canceled_but_booked_status++;
  }

  report.totalMismatches = report.mismatches.length;

  return report;
}

export interface AutoCorrectMismatchesResult {
  corrected: number;
  byType: {
    sentiment_booked_no_evidence: number;
    evidence_exists_not_booked: number;
    canceled_but_booked_status: number;
  };
  errors: number;
}

/**
 * Auto-correct mismatches by applying the authority rules:
 * - Provider evidence wins over sentiment
 * - "Meeting Booked" sentiment without evidence → downgrade to "Meeting Requested"
 * - Evidence exists but not booked → update to meeting-booked
 * - Canceled appointment with booked status → revert to qualified
 */
export async function autoCorrectMismatches(
  opts: GenerateMismatchReportOptions = {}
): Promise<AutoCorrectMismatchesResult> {
  const result: AutoCorrectMismatchesResult = {
    corrected: 0,
    byType: {
      sentiment_booked_no_evidence: 0,
      evidence_exists_not_booked: 0,
      canceled_but_booked_status: 0,
    },
    errors: 0,
  };

  const report = await generateMismatchReport(opts);

  for (const mismatch of report.mismatches) {
    try {
      switch (mismatch.mismatchType) {
        case "sentiment_booked_no_evidence":
          // Downgrade sentiment from "Meeting Booked" to "Meeting Requested"
          await prisma.lead.update({
            where: { id: mismatch.leadId },
            data: {
              sentimentTag: "Meeting Requested",
              status: "meeting-requested",
            },
          });
          result.byType.sentiment_booked_no_evidence++;
          result.corrected++;
          break;

        case "evidence_exists_not_booked":
          // Upgrade lead to meeting-booked
          await prisma.lead.update({
            where: { id: mismatch.leadId },
            data: {
              status: "meeting-booked",
              sentimentTag: "Meeting Booked",
            },
          });
          result.byType.evidence_exists_not_booked++;
          result.corrected++;
          break;

        case "canceled_but_booked_status":
          // Revert to qualified status
          await prisma.lead.update({
            where: { id: mismatch.leadId },
            data: {
              status: "qualified",
              // Keep sentimentTag as-is (operator can manually adjust if needed)
            },
          });
          result.byType.canceled_but_booked_status++;
          result.corrected++;
          break;
      }
    } catch (error) {
      console.error(`[Mismatch Auto-Correct] Error correcting lead ${mismatch.leadId}:`, error);
      result.errors++;
    }
  }

  return result;
}

/**
 * Get summary counts of mismatches without fetching full records.
 */
export async function getMismatchCounts(
  opts: GenerateMismatchReportOptions = {}
): Promise<MismatchReport["byType"]> {
  const baseWhere = opts.clientId ? { clientId: opts.clientId } : {};

  const [sentimentBookedNoEvidence, evidenceExistsNotBooked, canceledButBookedStatus] = await Promise.all([
    prisma.lead.count({
      where: {
        ...baseWhere,
        sentimentTag: "Meeting Booked",
        ghlAppointmentId: null,
        calendlyInviteeUri: null,
        calendlyScheduledEventUri: null,
      },
    }),
    prisma.lead.count({
      where: {
        ...baseWhere,
        status: { not: "meeting-booked" },
        appointmentStatus: { not: APPOINTMENT_STATUS.CANCELED },
        OR: [
          { ghlAppointmentId: { not: null } },
          { calendlyInviteeUri: { not: null } },
          { calendlyScheduledEventUri: { not: null } },
        ],
      },
    }),
    prisma.lead.count({
      where: {
        ...baseWhere,
        status: "meeting-booked",
        appointmentStatus: APPOINTMENT_STATUS.CANCELED,
      },
    }),
  ]);

  return {
    sentiment_booked_no_evidence: sentimentBookedNoEvidence,
    evidence_exists_not_booked: evidenceExistsNotBooked,
    canceled_but_booked_status: canceledButBookedStatus,
  };
}
