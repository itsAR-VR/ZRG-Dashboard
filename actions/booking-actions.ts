"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  createGHLAppointment,
  createGHLContact,
  getGHLCalendars,
  getGHLUsers,
  testGHLConnection,
  type GHLCalendar,
  type GHLUser,
  type GHLAppointment,
} from "@/lib/ghl-api";

// Re-export types for use in components
export type { GHLCalendar, GHLUser, GHLAppointment };

// =============================================================================
// Types
// =============================================================================

export interface BookingResult {
  success: boolean;
  appointmentId?: string;
  appointment?: GHLAppointment;
  error?: string;
}

export interface OfferedSlot {
  datetime: string;  // ISO format
  label: string;     // Human-readable (e.g., "3pm EST on Thursday")
  offeredAt: string; // When this slot was offered
}

// =============================================================================
// Auto-Book Logic
// =============================================================================

/**
 * Check if auto-booking is enabled for a lead
 * Logic:
 * - workspace ON + lead ON = true
 * - workspace ON + lead OFF = false (lead opted out)
 * - workspace OFF + lead ON = true (lead opted in)
 * - workspace OFF + lead OFF = false
 */
export async function shouldAutoBook(leadId: string): Promise<{
  shouldBook: boolean;
  reason?: string;
}> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!lead) {
      return { shouldBook: false, reason: "Lead not found" };
    }

    // Check if lead already has an appointment booked
    if (lead.ghlAppointmentId) {
      return { shouldBook: false, reason: "Lead already has an appointment booked" };
    }

    const workspaceEnabled = lead.client.settings?.autoBookMeetings ?? false;
    const leadEnabled = lead.autoBookMeetingsEnabled ?? true;

    // Auto-book if lead toggle is ON (regardless of workspace setting)
    // This allows leads to opt-in even when workspace default is off
    if (leadEnabled) {
      return { shouldBook: true };
    }

    return { shouldBook: false, reason: "Auto-booking disabled for this lead" };
  } catch (error) {
    console.error("Error checking auto-book status:", error);
    return { shouldBook: false, reason: "Error checking auto-book status" };
  }
}

/**
 * Update lead's auto-book setting
 */
export async function updateLeadAutoBookSetting(
  leadId: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { autoBookMeetingsEnabled: enabled },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update lead auto-book setting:", error);
    return { success: false, error: "Failed to update setting" };
  }
}

/**
 * When workspace auto-book is enabled, set all leads in that workspace to enabled
 */
export async function setWorkspaceAutoBookEnabled(
  clientId: string,
  enabled: boolean
): Promise<{ success: boolean; updatedCount: number; error?: string }> {
  try {
    // Update workspace setting
    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: { autoBookMeetings: enabled },
      create: {
        clientId,
        autoBookMeetings: enabled,
      },
    });

    // If enabling, set all leads to enabled (they can individually opt-out later)
    if (enabled) {
      const result = await prisma.lead.updateMany({
        where: { clientId },
        data: { autoBookMeetingsEnabled: true },
      });

      revalidatePath("/");
      return { success: true, updatedCount: result.count };
    }

    revalidatePath("/");
    return { success: true, updatedCount: 0 };
  } catch (error) {
    console.error("Failed to update workspace auto-book setting:", error);
    return { success: false, updatedCount: 0, error: "Failed to update setting" };
  }
}

// =============================================================================
// Slot Management
// =============================================================================

/**
 * Store offered slots on a lead for tracking
 */
export async function storeOfferedSlots(
  leadId: string,
  slots: OfferedSlot[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { offeredSlots: JSON.stringify(slots) },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to store offered slots:", error);
    return { success: false, error: "Failed to store offered slots" };
  }
}

/**
 * Get offered slots for a lead
 */
export async function getOfferedSlots(leadId: string): Promise<OfferedSlot[]> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { offeredSlots: true },
    });

    if (!lead?.offeredSlots) return [];

    return JSON.parse(lead.offeredSlots) as OfferedSlot[];
  } catch (error) {
    console.error("Failed to get offered slots:", error);
    return [];
  }
}

/**
 * Clear offered slots after booking
 */
export async function clearOfferedSlots(leadId: string): Promise<void> {
  try {
    await prisma.lead.update({
      where: { id: leadId },
      data: { offeredSlots: null },
    });
  } catch {
    console.error("Failed to clear offered slots");
  }
}

// =============================================================================
// GHL Settings Helpers
// =============================================================================

/**
 * Fetch GHL calendars for a workspace (for settings dropdown)
 */
export async function fetchGHLCalendarsForWorkspace(
  clientId: string
): Promise<{ success: boolean; calendars?: GHLCalendar[]; error?: string }> {
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client?.ghlLocationId || !client?.ghlPrivateKey) {
      return { success: false, error: "GHL credentials not configured" };
    }

    const result = await getGHLCalendars(client.ghlLocationId, client.ghlPrivateKey);

    if (result.success && result.data) {
      return { success: true, calendars: result.data.calendars };
    }

    return { success: false, error: result.error || "Failed to fetch calendars" };
  } catch (error) {
    console.error("Failed to fetch GHL calendars:", error);
    return { success: false, error: "Failed to fetch calendars" };
  }
}

/**
 * Fetch GHL users/team members for a workspace (for settings dropdown)
 */
export async function fetchGHLUsersForWorkspace(
  clientId: string
): Promise<{ success: boolean; users?: GHLUser[]; error?: string }> {
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client?.ghlLocationId || !client?.ghlPrivateKey) {
      return { success: false, error: "GHL credentials not configured" };
    }

    const result = await getGHLUsers(client.ghlLocationId, client.ghlPrivateKey);

    if (result.success && result.data) {
      return { success: true, users: result.data.users };
    }

    return { success: false, error: result.error || "Failed to fetch users" };
  } catch (error) {
    console.error("Failed to fetch GHL users:", error);
    return { success: false, error: "Failed to fetch users" };
  }
}

/**
 * Test GHL connection for a workspace
 */
export async function testGHLConnectionForWorkspace(
  clientId: string
): Promise<{ success: boolean; calendarCount?: number; error?: string }> {
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client?.ghlLocationId || !client?.ghlPrivateKey) {
      return { success: false, error: "GHL credentials not configured" };
    }

    const result = await testGHLConnection(client.ghlLocationId, client.ghlPrivateKey);

    if (result.success && result.data) {
      return { success: true, calendarCount: result.data.calendarCount };
    }

    return { success: false, error: result.error || "Connection test failed" };
  } catch (error) {
    console.error("Failed to test GHL connection:", error);
    return { success: false, error: "Connection test failed" };
  }
}

// =============================================================================
// Main Booking Function
// =============================================================================

/**
 * Book a meeting on GHL for a lead
 * 
 * @param leadId - The lead to book for
 * @param selectedSlot - The ISO datetime of the selected slot
 * @param calendarIdOverride - Optional calendar ID override (uses workspace default if not provided)
 */
export async function bookMeetingOnGHL(
  leadId: string,
  selectedSlot: string,
  calendarIdOverride?: string
): Promise<BookingResult> {
  try {
    // Get lead with client and settings
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        client: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    // Check if lead already has an appointment
    if (lead.ghlAppointmentId) {
      return { success: false, error: "Lead already has an appointment booked" };
    }

    const client = lead.client;
    const settings = client.settings;

    // Validate GHL credentials
    if (!client.ghlLocationId || !client.ghlPrivateKey) {
      return { success: false, error: "GHL credentials not configured for this workspace" };
    }

    // Get calendar ID
    const calendarId = calendarIdOverride || settings?.ghlDefaultCalendarId;
    if (!calendarId) {
      return { success: false, error: "No GHL calendar configured" };
    }

    // Get or create GHL contact
    let ghlContactId = lead.ghlContactId;

    if (!ghlContactId) {
      // Create contact in GHL
      const contactResult = await createGHLContact(
        {
          locationId: client.ghlLocationId,
          firstName: lead.firstName || undefined,
          lastName: lead.lastName || undefined,
          email: lead.email || undefined,
          phone: lead.phone || undefined,
          source: "zrg-dashboard",
        },
        client.ghlPrivateKey
      );

      if (!contactResult.success || !contactResult.data?.contact?.id) {
        return { success: false, error: "Failed to create contact in GHL" };
      }

      ghlContactId = contactResult.data.contact.id;

      // Update lead with GHL contact ID
      await prisma.lead.update({
        where: { id: leadId },
        data: { ghlContactId },
      });
    }

    // Calculate end time based on meeting duration
    const durationMinutes = settings?.meetingDurationMinutes || 30;
    const startTime = new Date(selectedSlot);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

    // Generate meeting title
    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Lead";
    const companyName = settings?.companyName || client.name;
    let title = settings?.meetingTitle || "Intro to {companyName}";
    title = title
      .replace("{companyName}", companyName)
      .replace("{leadName}", leadName)
      .replace("{firstName}", lead.firstName || "");

    // Create appointment in GHL
    const appointmentResult = await createGHLAppointment(
      {
        calendarId,
        locationId: client.ghlLocationId,
        contactId: ghlContactId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        title,
        appointmentStatus: "confirmed",
        assignedUserId: settings?.ghlAssignedUserId || undefined,
        notes: `Booked via ZRG Dashboard\nLead ID: ${leadId}`,
      },
      client.ghlPrivateKey
    );

    if (!appointmentResult.success || !appointmentResult.data?.id) {
      return { success: false, error: appointmentResult.error || "Failed to create appointment in GHL" };
    }

    // Update lead with appointment info
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        ghlAppointmentId: appointmentResult.data.id,
        appointmentBookedAt: new Date(),
        bookedSlot: selectedSlot,
        status: "meeting-booked",
        offeredSlots: null, // Clear offered slots
      },
    });

    revalidatePath("/");

    return {
      success: true,
      appointmentId: appointmentResult.data.id,
      appointment: appointmentResult.data,
    };
  } catch (error) {
    console.error("Failed to book meeting on GHL:", error);
    return { success: false, error: "Failed to book meeting" };
  }
}

/**
 * Get booking status for a lead
 */
export async function getLeadBookingStatus(leadId: string): Promise<{
  hasAppointment: boolean;
  appointmentId?: string;
  bookedAt?: Date;
  bookedSlot?: string;
}> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        ghlAppointmentId: true,
        appointmentBookedAt: true,
        bookedSlot: true,
      },
    });

    return {
      hasAppointment: !!lead?.ghlAppointmentId,
      appointmentId: lead?.ghlAppointmentId || undefined,
      bookedAt: lead?.appointmentBookedAt || undefined,
      bookedSlot: lead?.bookedSlot || undefined,
    };
  } catch (error) {
    console.error("Failed to get booking status:", error);
    return { hasAppointment: false };
  }
}

/**
 * Check if workspace has GHL booking configured
 */
export async function isGHLBookingConfigured(clientId: string): Promise<boolean> {
  try {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { settings: true },
    });

    return !!(
      client?.ghlLocationId &&
      client?.ghlPrivateKey &&
      client?.settings?.ghlDefaultCalendarId
    );
  } catch {
    return false;
  }
}

