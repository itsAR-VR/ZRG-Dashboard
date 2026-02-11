"use server";

import { prisma } from "@/lib/prisma";
import { fetchEmailBisonCampaigns } from "@/lib/emailbison-api";
import { fetchSmartLeadCampaigns } from "@/lib/smartlead-api";
import { fetchInstantlyCampaigns } from "@/lib/instantly-api";
import { revalidatePath } from "next/cache";
import { requireClientAdminAccess, requireLeadAccessById, resolveClientScope } from "@/lib/workspace-access";
import { CampaignResponseMode, EmailIntegrationProvider, Prisma } from "@prisma/client";
import { resolveEmailIntegrationProvider } from "@/lib/email-integration";
import { validateAutoSendCustomSchedule } from "@/lib/auto-send-schedule";

interface EmailCampaignData {
  id: string;
  bisonCampaignId: string;
  name: string;
  clientId: string;
  clientName: string;
  leadCount: number;
  responseMode: CampaignResponseMode;
  autoSendConfidenceThreshold: number;
  autoSendSkipHumanReview: boolean | null;
  // Phase 47l: Auto-send delay window
  autoSendDelayMinSeconds: number;
  autoSendDelayMaxSeconds: number;
  autoSendScheduleMode: "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM" | null;
  autoSendCustomSchedule: Record<string, unknown> | null;
  bookingProcessId: string | null;
  bookingProcessName: string | null;
  // AI Persona assignment (Phase 39)
  aiPersonaId: string | null;
  aiPersonaName: string | null;
  createdAt: Date;
}

export async function getEmailCampaigns(clientId?: string): Promise<{
  success: boolean;
  data?: EmailCampaignData[];
  error?: string;
}> {
  try {
    const scope = await resolveClientScope(clientId ?? null);
    if (scope.clientIds.length === 0) return { success: true, data: [] };
    const campaigns = await prisma.emailCampaign.findMany({
      where: { clientId: { in: scope.clientIds } },
      include: {
        client: {
          select: { name: true },
        },
        bookingProcess: {
          select: { id: true, name: true },
        },
        aiPersona: {
          select: { id: true, name: true },
        },
        _count: {
          select: { leads: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const formatted: EmailCampaignData[] = campaigns.map((c) => ({
      id: c.id,
      bisonCampaignId: c.bisonCampaignId,
      name: c.name,
      clientId: c.clientId,
      clientName: c.client.name,
      leadCount: c._count.leads,
      responseMode: c.responseMode,
      autoSendConfidenceThreshold: c.autoSendConfidenceThreshold,
      autoSendSkipHumanReview: c.autoSendSkipHumanReview,
      autoSendDelayMinSeconds: c.autoSendDelayMinSeconds,
      autoSendDelayMaxSeconds: c.autoSendDelayMaxSeconds,
      autoSendScheduleMode: c.autoSendScheduleMode ?? null,
      autoSendCustomSchedule: (c.autoSendCustomSchedule as Record<string, unknown> | null) ?? null,
      bookingProcessId: c.bookingProcess?.id ?? null,
      bookingProcessName: c.bookingProcess?.name ?? null,
      aiPersonaId: c.aiPersona?.id ?? null,
      aiPersonaName: c.aiPersona?.name ?? null,
      createdAt: c.createdAt,
    }));

    return { success: true, data: formatted };
  } catch (error) {
    console.error("[EmailCampaign] Failed to fetch campaigns:", error);
    return { success: false, error: "Failed to fetch email campaigns" };
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Clamp delay seconds to sane bounds: 0..3600 (0-60 minutes)
 */
function clampDelaySeconds(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 3600) return 3600;
  return Math.floor(value);
}

export async function updateEmailCampaignConfig(
  emailCampaignId: string,
  opts: {
    responseMode?: CampaignResponseMode;
    autoSendConfidenceThreshold?: number;
    autoSendSkipHumanReview?: boolean | null;
    autoSendDelayMinSeconds?: number;
    autoSendDelayMaxSeconds?: number;
    autoSendScheduleMode?: "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM" | null;
    autoSendCustomSchedule?: Record<string, unknown> | null;
  }
): Promise<{
  success: boolean;
  data?: {
    responseMode: CampaignResponseMode;
    autoSendConfidenceThreshold: number;
    autoSendSkipHumanReview: boolean | null;
    autoSendDelayMinSeconds: number;
    autoSendDelayMaxSeconds: number;
    autoSendScheduleMode: "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM" | null;
    autoSendCustomSchedule: Record<string, unknown> | null;
  };
  error?: string;
}> {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: emailCampaignId },
      select: { clientId: true },
    });
    if (!campaign) return { success: false, error: "Email campaign not found" };

    await requireClientAdminAccess(campaign.clientId);

    const data: Prisma.EmailCampaignUpdateInput = {};
    let normalizedCustomSchedule: Record<string, unknown> | null | undefined = opts.autoSendCustomSchedule;

    if (opts.autoSendCustomSchedule !== undefined && opts.autoSendCustomSchedule !== null) {
      const validation = validateAutoSendCustomSchedule(opts.autoSendCustomSchedule);
      if (!validation.ok) {
        return { success: false, error: validation.error };
      }
      normalizedCustomSchedule = validation.value as unknown as Record<string, unknown>;
    }

    if (opts.responseMode) data.responseMode = opts.responseMode;

    if (opts.autoSendConfidenceThreshold !== undefined) {
      const normalized = clamp01(Number(opts.autoSendConfidenceThreshold));
      data.autoSendConfidenceThreshold = normalized;
    }

    if (opts.autoSendSkipHumanReview !== undefined) {
      data.autoSendSkipHumanReview = opts.autoSendSkipHumanReview;
    }

    // Phase 47l: Handle delay settings
    if (opts.autoSendDelayMinSeconds !== undefined || opts.autoSendDelayMaxSeconds !== undefined) {
      // Get current values to apply validation
      const current = await prisma.emailCampaign.findUnique({
        where: { id: emailCampaignId },
        select: { autoSendDelayMinSeconds: true, autoSendDelayMaxSeconds: true },
      });

      let minSec = opts.autoSendDelayMinSeconds !== undefined
        ? clampDelaySeconds(opts.autoSendDelayMinSeconds)
        : (current?.autoSendDelayMinSeconds ?? 180);
      let maxSec = opts.autoSendDelayMaxSeconds !== undefined
        ? clampDelaySeconds(opts.autoSendDelayMaxSeconds)
        : (current?.autoSendDelayMaxSeconds ?? 420);

      // Ensure max >= min
      if (maxSec < minSec) {
        maxSec = minSec;
      }

      data.autoSendDelayMinSeconds = minSec;
      data.autoSendDelayMaxSeconds = maxSec;
    }

    if (opts.autoSendScheduleMode !== undefined) {
      data.autoSendScheduleMode = opts.autoSendScheduleMode;
    }
    if (opts.autoSendCustomSchedule !== undefined) {
      data.autoSendCustomSchedule =
        normalizedCustomSchedule === null
          ? Prisma.JsonNull
          : (normalizedCustomSchedule as Prisma.InputJsonValue);
    }

    const updated = await prisma.emailCampaign.update({
      where: { id: emailCampaignId },
      data,
      select: {
        responseMode: true,
        autoSendConfidenceThreshold: true,
        autoSendSkipHumanReview: true,
        autoSendDelayMinSeconds: true,
        autoSendDelayMaxSeconds: true,
        autoSendScheduleMode: true,
        autoSendCustomSchedule: true,
      },
    });

    revalidatePath("/");

    return {
      success: true,
      data: {
        responseMode: updated.responseMode,
        autoSendConfidenceThreshold: updated.autoSendConfidenceThreshold,
        autoSendSkipHumanReview: updated.autoSendSkipHumanReview,
        autoSendDelayMinSeconds: updated.autoSendDelayMinSeconds,
        autoSendDelayMaxSeconds: updated.autoSendDelayMaxSeconds,
        autoSendScheduleMode: updated.autoSendScheduleMode ?? null,
        autoSendCustomSchedule: (updated.autoSendCustomSchedule as Record<string, unknown> | null) ?? null,
      },
    };
  } catch (error) {
    console.error("[EmailCampaign] Failed to update config:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update email campaign config",
    };
  }
}

export async function syncEmailCampaignsFromEmailBison(clientId: string): Promise<{
  success: boolean;
  synced?: number;
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        emailProvider: true,
        emailBisonApiKey: true,
        emailBisonWorkspaceId: true,
        emailBisonBaseHost: { select: { host: true } },
        smartLeadApiKey: true,
        smartLeadWebhookSecret: true,
        instantlyApiKey: true,
        instantlyWebhookSecret: true,
      },
    });

    if (!client) return { success: false, error: "Client not found" };

    let provider: EmailIntegrationProvider | null;
    try {
      provider = resolveEmailIntegrationProvider(client);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Invalid email integration configuration" };
    }

    if (provider !== EmailIntegrationProvider.EMAILBISON) {
      return { success: false, error: "Client is not configured for EmailBison" };
    }

    if (!client.emailBisonApiKey) return { success: false, error: "Client missing EmailBison credentials" };

    console.log("[EmailCampaign] Sync email campaigns start:", {
      clientId,
      provider: "EMAILBISON",
      hasApiKey: true,
    });

    const campaignsResult = await fetchEmailBisonCampaigns(client.emailBisonApiKey, {
      baseHost: client.emailBisonBaseHost?.host ?? null,
    });

    if (!campaignsResult.success || !campaignsResult.data) {
      console.warn("[EmailCampaign] Sync email campaigns failed:", {
        clientId,
        provider: "EMAILBISON",
        error: campaignsResult.error || "Failed to fetch EmailBison campaigns",
      });
      return { success: false, error: campaignsResult.error || "Failed to fetch EmailBison campaigns" };
    }

    let synced = 0;
    for (const campaign of campaignsResult.data) {
      await prisma.emailCampaign.upsert({
        where: {
          clientId_bisonCampaignId: {
            clientId: client.id,
            bisonCampaignId: campaign.id,
          },
        },
        create: {
          clientId: client.id,
          bisonCampaignId: campaign.id,
          name: campaign.name,
        },
        update: {
          name: campaign.name,
        },
      });
      synced++;
    }

    console.log("[EmailCampaign] Sync email campaigns complete:", {
      clientId,
      provider: "EMAILBISON",
      synced,
    });

    revalidatePath("/");
    revalidatePath("/settings");

    return { success: true, synced };
  } catch (error) {
    console.error("[EmailCampaign] Failed to sync campaigns:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function syncEmailCampaignsFromSmartLead(clientId: string): Promise<{
  success: boolean;
  synced?: number;
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        emailProvider: true,
        smartLeadApiKey: true,
        smartLeadWebhookSecret: true,
        emailBisonApiKey: true,
        emailBisonWorkspaceId: true,
        instantlyApiKey: true,
        instantlyWebhookSecret: true,
      },
    });

    if (!client) return { success: false, error: "Client not found" };

    let provider: EmailIntegrationProvider | null;
    try {
      provider = resolveEmailIntegrationProvider(client);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Invalid email integration configuration" };
    }

    if (provider !== EmailIntegrationProvider.SMARTLEAD) {
      return { success: false, error: "Client is not configured for SmartLead" };
    }

    if (!client.smartLeadApiKey) return { success: false, error: "Client missing SmartLead credentials" };

    const campaignsResult = await fetchSmartLeadCampaigns(client.smartLeadApiKey);
    if (!campaignsResult.success || !campaignsResult.data) {
      return { success: false, error: campaignsResult.error || "Failed to fetch SmartLead campaigns" };
    }

    let synced = 0;
    for (const campaign of campaignsResult.data) {
      await prisma.emailCampaign.upsert({
        where: {
          clientId_bisonCampaignId: {
            clientId: client.id,
            bisonCampaignId: campaign.id,
          },
        },
        create: {
          clientId: client.id,
          bisonCampaignId: campaign.id,
          name: campaign.name,
        },
        update: {
          name: campaign.name,
        },
      });
      synced++;
    }

    revalidatePath("/");
    revalidatePath("/settings");
    return { success: true, synced };
  } catch (error) {
    console.error("[EmailCampaign] Failed to sync SmartLead campaigns:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function syncEmailCampaignsFromInstantly(clientId: string): Promise<{
  success: boolean;
  synced?: number;
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        emailProvider: true,
        instantlyApiKey: true,
        instantlyWebhookSecret: true,
        emailBisonApiKey: true,
        emailBisonWorkspaceId: true,
        smartLeadApiKey: true,
        smartLeadWebhookSecret: true,
      },
    });

    if (!client) return { success: false, error: "Client not found" };

    let provider: EmailIntegrationProvider | null;
    try {
      provider = resolveEmailIntegrationProvider(client);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Invalid email integration configuration" };
    }

    if (provider !== EmailIntegrationProvider.INSTANTLY) {
      return { success: false, error: "Client is not configured for Instantly" };
    }

    if (!client.instantlyApiKey) return { success: false, error: "Client missing Instantly credentials" };

    const campaignsResult = await fetchInstantlyCampaigns(client.instantlyApiKey, { limit: 100 });
    if (!campaignsResult.success || !campaignsResult.data) {
      return { success: false, error: campaignsResult.error || "Failed to fetch Instantly campaigns" };
    }

    let synced = 0;
    for (const campaign of campaignsResult.data) {
      await prisma.emailCampaign.upsert({
        where: {
          clientId_bisonCampaignId: {
            clientId: client.id,
            bisonCampaignId: campaign.id,
          },
        },
        create: {
          clientId: client.id,
          bisonCampaignId: campaign.id,
          name: campaign.name,
        },
        update: {
          name: campaign.name,
        },
      });
      synced++;
    }

    revalidatePath("/");
    revalidatePath("/settings");
    return { success: true, synced };
  } catch (error) {
    console.error("[EmailCampaign] Failed to sync Instantly campaigns:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function linkLeadToEmailCampaign(
  leadId: string,
  emailCampaignId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const { clientId } = await requireLeadAccessById(leadId);
    if (emailCampaignId) {
      const campaign = await prisma.emailCampaign.findUnique({
        where: { id: emailCampaignId },
        select: { clientId: true },
      });
      if (!campaign) return { success: false, error: "Email campaign not found" };
      if (campaign.clientId !== clientId) return { success: false, error: "Email campaign does not belong to this workspace" };
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { emailCampaignId },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[EmailCampaign] Failed to link lead:", error);
    return { success: false, error: "Failed to link lead to email campaign" };
  }
}

// ----------------------------------------------------------------------------
// Booking Process Assignment (Phase 36)
// ----------------------------------------------------------------------------

export async function assignBookingProcessToCampaign(
  emailCampaignId: string,
  bookingProcessId: string | null
): Promise<{
  success: boolean;
  data?: { bookingProcessId: string | null; bookingProcessName: string | null };
  error?: string;
}> {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: emailCampaignId },
      select: { clientId: true },
    });

    if (!campaign) {
      return { success: false, error: "Email campaign not found" };
    }

    await requireClientAdminAccess(campaign.clientId);

    // Validate booking process belongs to same client
    if (bookingProcessId) {
      const bookingProcess = await prisma.bookingProcess.findUnique({
        where: { id: bookingProcessId },
        select: { id: true, name: true, clientId: true },
      });

      if (!bookingProcess) {
        return { success: false, error: "Booking process not found" };
      }

      if (bookingProcess.clientId !== campaign.clientId) {
        return { success: false, error: "Booking process does not belong to this workspace" };
      }

      await prisma.emailCampaign.update({
        where: { id: emailCampaignId },
        data: { bookingProcessId },
      });

      revalidatePath("/");

      return {
        success: true,
        data: {
          bookingProcessId: bookingProcess.id,
          bookingProcessName: bookingProcess.name,
        },
      };
    }

    // Unassign booking process
    await prisma.emailCampaign.update({
      where: { id: emailCampaignId },
      data: { bookingProcessId: null },
    });

    revalidatePath("/");

    return {
      success: true,
      data: {
        bookingProcessId: null,
        bookingProcessName: null,
      },
    };
  } catch (error) {
    console.error("[EmailCampaign] Failed to assign booking process:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to assign booking process",
    };
  }
}

// ----------------------------------------------------------------------------
// AI Persona Assignment (Phase 39)
// ----------------------------------------------------------------------------

export async function assignPersonaToCampaign(
  emailCampaignId: string,
  personaId: string | null
): Promise<{
  success: boolean;
  data?: { aiPersonaId: string | null; aiPersonaName: string | null };
  error?: string;
}> {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: emailCampaignId },
      select: { clientId: true },
    });

    if (!campaign) {
      return { success: false, error: "Email campaign not found" };
    }

    await requireClientAdminAccess(campaign.clientId);

    // Validate persona belongs to same client
    if (personaId) {
      const persona = await prisma.aiPersona.findUnique({
        where: { id: personaId },
        select: { id: true, name: true, clientId: true },
      });

      if (!persona) {
        return { success: false, error: "AI persona not found" };
      }

      if (persona.clientId !== campaign.clientId) {
        return { success: false, error: "AI persona does not belong to this workspace" };
      }

      await prisma.emailCampaign.update({
        where: { id: emailCampaignId },
        data: { aiPersonaId: personaId },
      });

      revalidatePath("/");

      return {
        success: true,
        data: {
          aiPersonaId: persona.id,
          aiPersonaName: persona.name,
        },
      };
    }

    // Unassign persona (revert to workspace default)
    await prisma.emailCampaign.update({
      where: { id: emailCampaignId },
      data: { aiPersonaId: null },
    });

    revalidatePath("/");

    return {
      success: true,
      data: {
        aiPersonaId: null,
        aiPersonaName: null,
      },
    };
  } catch (error) {
    console.error("[EmailCampaign] Failed to assign persona:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to assign AI persona",
    };
  }
}
