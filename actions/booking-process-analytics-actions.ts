"use server";

/**
 * Booking Process Analytics Actions (Phase 36f)
 *
 * Analytics queries for booking process effectiveness.
 * Uses wave-based progress tracking from Phase 36.
 */

import { prisma } from "@/lib/prisma";
import { requireClientAccess } from "@/lib/workspace-access";
import { isMeetingBooked } from "@/lib/meeting-booking-provider";

export interface BookingProcessMetrics {
  bookingProcessId: string;
  bookingProcessName: string;
  leadsProcessed: number;
  leadsBooked: number;
  bookingRate: number; // 0-1
  avgOutboundsToBook: number; // Sum of all channel outbound counts for booked leads
  dropoffByWave: Record<number, number>; // { 1: 50, 2: 30, 3: 10 }
}

export interface BookingProcessAnalyticsResult {
  success: boolean;
  data?: BookingProcessMetrics[];
  error?: string;
}

interface DateRangeFilter {
  start: Date;
  end: Date;
}

/**
 * Get booking process metrics for a workspace.
 */
export async function getBookingProcessMetrics(params: {
  clientId: string;
  bookingProcessId?: string;
  campaignId?: string;
  dateRange?: DateRangeFilter;
}): Promise<BookingProcessAnalyticsResult> {
  try {
    const { clientId, bookingProcessId, campaignId, dateRange } = params;

    await requireClientAccess(clientId);

    // Get all booking progress records with associated lead and process info
    const progressRecords = await prisma.leadCampaignBookingProgress.findMany({
      where: {
        emailCampaign: { clientId },
        ...(bookingProcessId && { activeBookingProcessId: bookingProcessId }),
        ...(campaignId && { emailCampaignId: campaignId }),
        activeBookingProcessId: { not: null },
        ...(dateRange && {
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        }),
      },
      include: {
        lead: {
          select: {
            id: true,
            status: true,
            ghlAppointmentId: true,
            calendlyInviteeUri: true,
            calendlyScheduledEventUri: true,
            appointmentStatus: true,
            client: {
              select: {
                settings: {
                  select: { meetingBookingProvider: true },
                },
              },
            },
          },
        },
        activeBookingProcess: {
          select: { id: true, name: true },
        },
      },
    });

    // Group by booking process
    const byProcess = new Map<
      string,
      {
        name: string;
        records: typeof progressRecords;
      }
    >();

    for (const record of progressRecords) {
      const processId = record.activeBookingProcessId!;
      const processName = record.activeBookingProcess?.name ?? "Unknown";

      if (!byProcess.has(processId)) {
        byProcess.set(processId, { name: processName, records: [] });
      }
      byProcess.get(processId)!.records.push(record);
    }

    // Calculate metrics for each process
    const metrics: BookingProcessMetrics[] = [];

    for (const [processId, { name, records }] of byProcess) {
      const leadsProcessed = records.length;

      // Determine booked leads using isMeetingBooked or status
      const bookedRecords = records.filter((r) => {
        const lead = r.lead;
        if (!lead) return false;

        // Check status first
        if (lead.status === "meeting-booked") return true;

        // Fall back to isMeetingBooked check
        const settings = lead.client?.settings;
        if (!settings) return false;

        return isMeetingBooked(
          {
            ghlAppointmentId: lead.ghlAppointmentId,
            calendlyInviteeUri: lead.calendlyInviteeUri,
            calendlyScheduledEventUri: lead.calendlyScheduledEventUri,
            appointmentStatus: lead.appointmentStatus,
          },
          { meetingBookingProvider: settings.meetingBookingProvider }
        );
      });

      const leadsBooked = bookedRecords.length;

      // Calculate avg outbounds to book (sum all channel counts)
      const totalOutbounds = bookedRecords.reduce((sum, r) => {
        return (
          sum +
          r.emailOutboundCount +
          r.smsOutboundCount +
          r.linkedinOutboundCount
        );
      }, 0);
      const avgOutboundsToBook =
        leadsBooked > 0 ? totalOutbounds / leadsBooked : 0;

      // Calculate drop-off by wave for non-booked leads
      const dropoffByWave: Record<number, number> = {};
      const nonBookedRecords = records.filter((r) => {
        const lead = r.lead;
        if (!lead) return true; // Count as non-booked if no lead data

        if (lead.status === "meeting-booked") return false;

        const settings = lead.client?.settings;
        if (!settings) return true;

        return !isMeetingBooked(
          {
            ghlAppointmentId: lead.ghlAppointmentId,
            calendlyInviteeUri: lead.calendlyInviteeUri,
            calendlyScheduledEventUri: lead.calendlyScheduledEventUri,
            appointmentStatus: lead.appointmentStatus,
          },
          { meetingBookingProvider: settings.meetingBookingProvider }
        );
      });

      for (const record of nonBookedRecords) {
        const wave = record.currentWave || 1;
        dropoffByWave[wave] = (dropoffByWave[wave] ?? 0) + 1;
      }

      metrics.push({
        bookingProcessId: processId,
        bookingProcessName: name,
        leadsProcessed,
        leadsBooked,
        bookingRate: leadsProcessed > 0 ? leadsBooked / leadsProcessed : 0,
        avgOutboundsToBook,
        dropoffByWave,
      });
    }

    // Sort by booking rate descending
    metrics.sort((a, b) => b.bookingRate - a.bookingRate);

    return { success: true, data: metrics };
  } catch (error) {
    console.error("[BookingAnalytics] Failed to get metrics:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get metrics",
    };
  }
}

/**
 * Compare booking processes for A/B testing.
 */
export async function compareBookingProcesses(params: {
  clientId: string;
  processIds: string[];
  dateRange?: DateRangeFilter;
}): Promise<{
  success: boolean;
  data?: {
    processes: BookingProcessMetrics[];
    comparison: {
      bestBookingRate: { id: string; name: string; rate: number } | null;
      bestAvgOutbounds: { id: string; name: string; avg: number } | null;
    };
  };
  error?: string;
}> {
  try {
    const { clientId, processIds, dateRange } = params;

    await requireClientAccess(clientId);

    // Get metrics for specified processes
    const metricsResult = await getBookingProcessMetrics({
      clientId,
      dateRange,
    });

    if (!metricsResult.success || !metricsResult.data) {
      return { success: false, error: metricsResult.error };
    }

    // Filter to requested process IDs
    const filteredMetrics = metricsResult.data.filter((m) =>
      processIds.includes(m.bookingProcessId)
    );

    // Find best performers
    let bestBookingRate: { id: string; name: string; rate: number } | null =
      null;
    let bestAvgOutbounds: { id: string; name: string; avg: number } | null =
      null;

    for (const m of filteredMetrics) {
      // Only consider processes with at least some leads
      if (m.leadsProcessed < 5) continue;

      if (!bestBookingRate || m.bookingRate > bestBookingRate.rate) {
        bestBookingRate = {
          id: m.bookingProcessId,
          name: m.bookingProcessName,
          rate: m.bookingRate,
        };
      }

      // Lower avg outbounds is better (fewer messages to book)
      if (
        m.leadsBooked > 0 &&
        (!bestAvgOutbounds || m.avgOutboundsToBook < bestAvgOutbounds.avg)
      ) {
        bestAvgOutbounds = {
          id: m.bookingProcessId,
          name: m.bookingProcessName,
          avg: m.avgOutboundsToBook,
        };
      }
    }

    return {
      success: true,
      data: {
        processes: filteredMetrics,
        comparison: {
          bestBookingRate,
          bestAvgOutbounds,
        },
      },
    };
  } catch (error) {
    console.error("[BookingAnalytics] Failed to compare processes:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to compare",
    };
  }
}

/**
 * Get summary stats for booking processes in a workspace.
 */
export async function getBookingProcessSummary(params: {
  clientId: string;
}): Promise<{
  success: boolean;
  data?: {
    totalProcesses: number;
    totalLeadsTracked: number;
    totalBooked: number;
    overallBookingRate: number;
  };
  error?: string;
}> {
  try {
    const { clientId } = params;

    await requireClientAccess(clientId);

    // Count processes
    const totalProcesses = await prisma.bookingProcess.count({
      where: { clientId },
    });

    // Get aggregate stats from progress records
    const progressStats = await prisma.leadCampaignBookingProgress.aggregate({
      where: {
        emailCampaign: { clientId },
        activeBookingProcessId: { not: null },
      },
      _count: { id: true },
    });

    const totalLeadsTracked = progressStats._count.id;

    // Count booked leads (via status)
    const bookedCount = await prisma.lead.count({
      where: {
        clientId,
        status: "meeting-booked",
        bookingProgress: {
          some: {
            activeBookingProcessId: { not: null },
          },
        },
      },
    });

    return {
      success: true,
      data: {
        totalProcesses,
        totalLeadsTracked,
        totalBooked: bookedCount,
        overallBookingRate:
          totalLeadsTracked > 0 ? bookedCount / totalLeadsTracked : 0,
      },
    };
  } catch (error) {
    console.error("[BookingAnalytics] Failed to get summary:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get summary",
    };
  }
}
