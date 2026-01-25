"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { applyAirtableModeToDefaultSequences } from "@/actions/followup-sequence-actions";
import { computeWorkspaceFollowUpsPausedUntil } from "@/lib/workspace-followups-pause";
import { requireClientAccess, requireClientAdminAccess, requireLeadAccessById } from "@/lib/workspace-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractKnowledgeNotesFromFile, extractKnowledgeNotesFromText } from "@/lib/knowledge-asset-extraction";
import { crawl4aiExtractMarkdown } from "@/lib/crawl4ai";
import { withAiTelemetrySourceIfUnset } from "@/lib/ai/telemetry-context";
import { isIP } from "node:net";
import { MeetingBookingProvider } from "@prisma/client";

export interface UserSettingsData {
  id: string;
  clientId: string;
  aiPersonaName: string | null;
  aiTone: string | null;
  aiGreeting: string | null;  // Email greeting template
  aiSmsGreeting: string | null;  // SMS greeting template (falls back to aiGreeting if null)
  aiSignature: string | null;
  aiGoals: string | null;
  idealCustomerProfile: string | null;  // ICP for lead scoring (Phase 33)
  // Campaign Assistant (workspace-level, admin-gated updates)
  insightsChatModel: string | null;
  insightsChatReasoningEffort: string | null;
  insightsChatEnableCampaignChanges: boolean;
  insightsChatEnableExperimentWrites: boolean;
  insightsChatEnableFollowupPauses: boolean;
  // Draft Generation Model Settings (workspace-level, admin-gated updates)
  draftGenerationModel: string | null;
  draftGenerationReasoningEffort: string | null;
  // AI Context Fields
  serviceDescription: string | null;
  qualificationQuestions: string | null; // JSON array
  // Company/Outreach Context (for follow-up templates)
  companyName: string | null;
  targetResult: string | null; // e.g., "growing your client base"
  // Automation Rules
  autoApproveMeetings: boolean;
  flagUncertainReplies: boolean;
  pauseForOOO: boolean;
  followUpsPausedUntil: Date | null;
  autoBlacklist: boolean;
  autoFollowUpsOnReply: boolean;
  airtableMode: boolean;
  emailDigest: boolean;
  slackAlerts: boolean;
  notificationEmails: string[];
  notificationPhones: string[];
  notificationSlackChannelIds: string[];
  notificationSentimentRules: Record<string, unknown> | null;
  notificationDailyDigestTime: string | null;
  timezone: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  // Calendar Settings
  calendarSlotsToShow: number | null;
  calendarLookAheadDays: number | null;
  // GHL Meeting Booking Settings
  ghlDefaultCalendarId: string | null;
  ghlAssignedUserId: string | null;
  autoBookMeetings: boolean;
  meetingDurationMinutes: number;
  meetingTitle: string | null;
  meetingBookingProvider: "ghl" | "calendly";
  calendlyEventTypeLink: string | null;
  calendlyEventTypeUri: string | null;
}

export interface KnowledgeAssetData {
  id: string;
  name: string;
  type: "file" | "text" | "url";
  fileUrl: string | null;
  textContent: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  createdAt: Date;
}

export interface QualificationQuestion {
  id: string;
  question: string;
  required: boolean;
}

export interface CalendarLinkData {
  id: string;
  name: string;
  url: string;
  type: "calendly" | "hubspot" | "ghl" | "unknown";
  isDefault: boolean;
  createdAt: Date;
}

/**
 * Get workspace settings (or return null if no workspace selected)
 * @param clientId - Workspace/client ID
 */
export async function getUserSettings(clientId?: string | null): Promise<{
  success: boolean;
  data?: UserSettingsData;
  knowledgeAssets?: KnowledgeAssetData[];
  error?: string;
}> {
  try {
    if (!clientId) {
      // Return default settings when no workspace is selected
      return {
        success: true,
        data: {
          id: "default",
          clientId: "default",
          aiPersonaName: null,
          aiTone: "friendly-professional",
          aiGreeting: "Hi {firstName},",
          aiSmsGreeting: "Hi {firstName},",
          aiSignature: null,
          aiGoals: null,
          idealCustomerProfile: null,
          insightsChatModel: "gpt-5-mini",
          insightsChatReasoningEffort: "medium",
          insightsChatEnableCampaignChanges: false,
          insightsChatEnableExperimentWrites: false,
          insightsChatEnableFollowupPauses: false,
          draftGenerationModel: "gpt-5.1",
          draftGenerationReasoningEffort: "medium",
          serviceDescription: null,
          qualificationQuestions: null,
          companyName: null,
          targetResult: null,
          autoApproveMeetings: true,
          flagUncertainReplies: true,
          pauseForOOO: true,
          followUpsPausedUntil: null,
          autoBlacklist: true,
          autoFollowUpsOnReply: false,
          airtableMode: false,
          emailDigest: true,
          slackAlerts: true,
          notificationEmails: [],
          notificationPhones: [],
          notificationSlackChannelIds: [],
          notificationSentimentRules: null,
          notificationDailyDigestTime: "09:00",
          timezone: "America/New_York",
          workStartTime: "09:00",
          workEndTime: "17:00",
          calendarSlotsToShow: 3,
          calendarLookAheadDays: 28,
          ghlDefaultCalendarId: null,
          ghlAssignedUserId: null,
          autoBookMeetings: false,
          meetingDurationMinutes: 30,
          meetingTitle: "Intro to {companyName}",
          meetingBookingProvider: "ghl",
          calendlyEventTypeLink: null,
          calendlyEventTypeUri: null,
        },
        knowledgeAssets: [],
      };
    }

    await requireClientAccess(clientId);

    // Try to find existing settings for this workspace
    let settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      include: {
        knowledgeAssets: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.workspaceSettings.create({
        data: {
          clientId,
          aiTone: "friendly-professional",
          aiGoals: null,
          serviceDescription: null,
          qualificationQuestions: null,
          autoApproveMeetings: true,
          flagUncertainReplies: true,
          pauseForOOO: true,
          followUpsPausedUntil: null,
          autoBlacklist: true,
          autoFollowUpsOnReply: false,
          emailDigest: true,
          slackAlerts: true,
          timezone: "America/New_York",
          workStartTime: "09:00",
          workEndTime: "17:00",
        },
        include: {
          knowledgeAssets: true,
        },
      });
    }

    const knowledgeAssets: KnowledgeAssetData[] = settings.knowledgeAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type as "file" | "text" | "url",
      fileUrl: asset.fileUrl,
      textContent: asset.textContent,
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      createdAt: asset.createdAt,
    }));

    return {
      success: true,
      data: {
        id: settings.id,
        clientId: settings.clientId,
        aiPersonaName: settings.aiPersonaName,
        aiTone: settings.aiTone,
        aiGreeting: settings.aiGreeting,
        aiSmsGreeting: settings.aiSmsGreeting,
        aiSignature: settings.aiSignature,
        aiGoals: settings.aiGoals,
        idealCustomerProfile: settings.idealCustomerProfile,
        insightsChatModel: settings.insightsChatModel ?? "gpt-5-mini",
        insightsChatReasoningEffort: settings.insightsChatReasoningEffort ?? "medium",
        insightsChatEnableCampaignChanges: settings.insightsChatEnableCampaignChanges ?? false,
        insightsChatEnableExperimentWrites: settings.insightsChatEnableExperimentWrites ?? false,
        insightsChatEnableFollowupPauses: settings.insightsChatEnableFollowupPauses ?? false,
        draftGenerationModel: settings.draftGenerationModel ?? "gpt-5.1",
        draftGenerationReasoningEffort: settings.draftGenerationReasoningEffort ?? "medium",
        serviceDescription: settings.serviceDescription,
        qualificationQuestions: settings.qualificationQuestions,
        companyName: settings.companyName,
        targetResult: settings.targetResult,
        autoApproveMeetings: settings.autoApproveMeetings,
        flagUncertainReplies: settings.flagUncertainReplies,
        pauseForOOO: settings.pauseForOOO,
        followUpsPausedUntil: settings.followUpsPausedUntil,
        autoBlacklist: settings.autoBlacklist,
        autoFollowUpsOnReply: settings.autoFollowUpsOnReply,
        airtableMode: settings.airtableMode,
        emailDigest: settings.emailDigest,
        slackAlerts: settings.slackAlerts,
        notificationEmails: settings.notificationEmails ?? [],
        notificationPhones: settings.notificationPhones ?? [],
        notificationSlackChannelIds: settings.notificationSlackChannelIds ?? [],
        notificationSentimentRules:
          settings.notificationSentimentRules && typeof settings.notificationSentimentRules === "object"
            ? (settings.notificationSentimentRules as Record<string, unknown>)
            : null,
        notificationDailyDigestTime: settings.notificationDailyDigestTime ?? "09:00",
        timezone: settings.timezone,
        workStartTime: settings.workStartTime,
        workEndTime: settings.workEndTime,
        calendarSlotsToShow: settings.calendarSlotsToShow,
        calendarLookAheadDays: settings.calendarLookAheadDays,
        ghlDefaultCalendarId: settings.ghlDefaultCalendarId,
        ghlAssignedUserId: settings.ghlAssignedUserId,
        autoBookMeetings: settings.autoBookMeetings,
        meetingDurationMinutes: settings.meetingDurationMinutes,
        meetingTitle: settings.meetingTitle,
        meetingBookingProvider:
          settings.meetingBookingProvider === MeetingBookingProvider.CALENDLY ? "calendly" : "ghl",
        calendlyEventTypeLink: settings.calendlyEventTypeLink,
        calendlyEventTypeUri: settings.calendlyEventTypeUri,
      },
      knowledgeAssets,
    };
  } catch (error) {
    console.error("Failed to fetch workspace settings:", error);
    return { success: false, error: "Failed to fetch settings" };
  }
}

/**
 * Update workspace settings
 * @param clientId - Workspace/client ID
 * @param data - Settings data to update
 */
export async function updateUserSettings(
  clientId: string | null | undefined,
  data: Partial<UserSettingsData>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    const wantsInsightsUpdate =
      data.insightsChatModel !== undefined ||
      data.insightsChatReasoningEffort !== undefined ||
      data.insightsChatEnableCampaignChanges !== undefined ||
      data.insightsChatEnableExperimentWrites !== undefined ||
      data.insightsChatEnableFollowupPauses !== undefined;
    const wantsDraftGenerationUpdate =
      data.draftGenerationModel !== undefined ||
      data.draftGenerationReasoningEffort !== undefined;
    const wantsNotificationUpdate =
      data.notificationEmails !== undefined ||
      data.notificationPhones !== undefined ||
      data.notificationSlackChannelIds !== undefined ||
      data.notificationSentimentRules !== undefined ||
      data.notificationDailyDigestTime !== undefined;
    if (wantsInsightsUpdate || wantsDraftGenerationUpdate || wantsNotificationUpdate) {
      await requireClientAdminAccess(clientId);
    }

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: {
        aiPersonaName: data.aiPersonaName,
        aiTone: data.aiTone,
        aiGreeting: data.aiGreeting,
        aiSmsGreeting: data.aiSmsGreeting,
        aiSignature: data.aiSignature,
        aiGoals: data.aiGoals,
        insightsChatModel: data.insightsChatModel,
        insightsChatReasoningEffort: data.insightsChatReasoningEffort,
        insightsChatEnableCampaignChanges: data.insightsChatEnableCampaignChanges,
        insightsChatEnableExperimentWrites: data.insightsChatEnableExperimentWrites,
        insightsChatEnableFollowupPauses: data.insightsChatEnableFollowupPauses,
        draftGenerationModel: data.draftGenerationModel,
        draftGenerationReasoningEffort: data.draftGenerationReasoningEffort,
        serviceDescription: data.serviceDescription,
        qualificationQuestions: data.qualificationQuestions,
        companyName: data.companyName,
        targetResult: data.targetResult,
        autoApproveMeetings: data.autoApproveMeetings,
        flagUncertainReplies: data.flagUncertainReplies,
        pauseForOOO: data.pauseForOOO,
        followUpsPausedUntil: data.followUpsPausedUntil,
        autoBlacklist: data.autoBlacklist,
        autoFollowUpsOnReply: data.autoFollowUpsOnReply,
        airtableMode: data.airtableMode,
        emailDigest: data.emailDigest,
        slackAlerts: data.slackAlerts,
        notificationEmails: data.notificationEmails,
        notificationPhones: data.notificationPhones,
        notificationSlackChannelIds: data.notificationSlackChannelIds,
        notificationSentimentRules: data.notificationSentimentRules as any,
        notificationDailyDigestTime: data.notificationDailyDigestTime,
        timezone: data.timezone,
        workStartTime: data.workStartTime,
        workEndTime: data.workEndTime,
        calendarSlotsToShow: data.calendarSlotsToShow,
        calendarLookAheadDays: data.calendarLookAheadDays,
        ghlDefaultCalendarId: data.ghlDefaultCalendarId,
        ghlAssignedUserId: data.ghlAssignedUserId,
        autoBookMeetings: data.autoBookMeetings,
        meetingDurationMinutes: data.meetingDurationMinutes,
        meetingTitle: data.meetingTitle,
        meetingBookingProvider:
          data.meetingBookingProvider === "calendly"
            ? MeetingBookingProvider.CALENDLY
            : data.meetingBookingProvider === "ghl"
              ? MeetingBookingProvider.GHL
              : undefined,
        calendlyEventTypeLink: data.calendlyEventTypeLink,
        calendlyEventTypeUri: data.calendlyEventTypeUri,
      },
      create: {
        clientId,
        aiPersonaName: data.aiPersonaName,
        aiTone: data.aiTone ?? "friendly-professional",
        aiGreeting: data.aiGreeting,
        aiSmsGreeting: data.aiSmsGreeting,
        aiSignature: data.aiSignature,
        aiGoals: data.aiGoals,
        insightsChatModel: data.insightsChatModel,
        insightsChatReasoningEffort: data.insightsChatReasoningEffort,
        insightsChatEnableCampaignChanges: data.insightsChatEnableCampaignChanges ?? false,
        insightsChatEnableExperimentWrites: data.insightsChatEnableExperimentWrites ?? false,
        insightsChatEnableFollowupPauses: data.insightsChatEnableFollowupPauses ?? false,
        draftGenerationModel: data.draftGenerationModel,
        draftGenerationReasoningEffort: data.draftGenerationReasoningEffort,
        serviceDescription: data.serviceDescription,
        qualificationQuestions: data.qualificationQuestions,
        companyName: data.companyName,
        targetResult: data.targetResult,
        autoApproveMeetings: data.autoApproveMeetings ?? true,
        flagUncertainReplies: data.flagUncertainReplies ?? true,
        pauseForOOO: data.pauseForOOO ?? true,
        followUpsPausedUntil: data.followUpsPausedUntil ?? null,
        autoBlacklist: data.autoBlacklist ?? true,
        autoFollowUpsOnReply: data.autoFollowUpsOnReply ?? false,
        airtableMode: data.airtableMode ?? false,
        emailDigest: data.emailDigest ?? true,
        slackAlerts: data.slackAlerts ?? true,
        notificationEmails: data.notificationEmails ?? [],
        notificationPhones: data.notificationPhones ?? [],
        notificationSlackChannelIds: data.notificationSlackChannelIds ?? [],
        notificationSentimentRules: (data.notificationSentimentRules as any) ?? undefined,
        notificationDailyDigestTime: data.notificationDailyDigestTime ?? "09:00",
        timezone: data.timezone,
        workStartTime: data.workStartTime ?? "09:00",
        workEndTime: data.workEndTime ?? "17:00",
        calendarSlotsToShow: data.calendarSlotsToShow ?? 3,
        calendarLookAheadDays: data.calendarLookAheadDays ?? 28,
        ghlDefaultCalendarId: data.ghlDefaultCalendarId,
        ghlAssignedUserId: data.ghlAssignedUserId,
        autoBookMeetings: data.autoBookMeetings ?? false,
        meetingDurationMinutes: data.meetingDurationMinutes ?? 30,
        meetingTitle: data.meetingTitle ?? "Intro to {companyName}",
        meetingBookingProvider:
          data.meetingBookingProvider === "calendly" ? MeetingBookingProvider.CALENDLY : MeetingBookingProvider.GHL,
        calendlyEventTypeLink: data.calendlyEventTypeLink,
        calendlyEventTypeUri: data.calendlyEventTypeUri,
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update workspace settings:", error);
    return { success: false, error: "Failed to update settings" };
  }
}

/**
 * Update AI signature for a workspace
 */
export async function updateAISignature(
  clientId: string | null | undefined,
  signature: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: { aiSignature: signature },
      create: {
        clientId,
        aiSignature: signature,
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update AI signature:", error);
    return { success: false, error: "Failed to update signature" };
  }
}

/**
 * Update AI personality for a workspace
 */
export async function updateAIPersonality(
  clientId: string | null | undefined,
  data: {
    name?: string;
    tone?: string;
    greeting?: string;
    idealCustomerProfile?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: {
        aiPersonaName: data.name,
        aiTone: data.tone,
        aiGreeting: data.greeting,
        idealCustomerProfile: data.idealCustomerProfile,
      },
      create: {
        clientId,
        aiPersonaName: data.name,
        aiTone: data.tone ?? "friendly-professional",
        aiGreeting: data.greeting,
        idealCustomerProfile: data.idealCustomerProfile,
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update AI personality:", error);
    return { success: false, error: "Failed to update personality" };
  }
}

/**
 * Update automation rules for a workspace
 */
export async function updateAutomationRules(
  clientId: string | null | undefined,
  data: {
    autoApproveMeetings?: boolean;
    flagUncertainReplies?: boolean;
    pauseForOOO?: boolean;
    autoBlacklist?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: data,
      create: {
        clientId,
        ...data,
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update automation rules:", error);
    return { success: false, error: "Failed to update rules" };
  }
}

export async function setAirtableMode(
  clientId: string | null | undefined,
  enabled: boolean
): Promise<{ success: boolean; updatedSequences?: number; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAdminAccess(clientId);

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: { airtableMode: enabled },
      create: { clientId, airtableMode: enabled },
    });

    const applyResult = await applyAirtableModeToDefaultSequences({ clientId, enabled });
    if (!applyResult.success) {
      return { success: false, error: applyResult.error || "Failed to apply Airtable Mode" };
    }

    revalidatePath("/");
    return { success: true, updatedSequences: applyResult.updated ?? 0 };
  } catch (error) {
    console.error("Failed to set Airtable Mode:", error);
    return { success: false, error: "Failed to update Airtable Mode" };
  }
}

export async function getAutoFollowUpsOnReply(
  clientId: string | null | undefined
): Promise<{ success: boolean; enabled?: boolean; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    const settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: { autoFollowUpsOnReply: true },
    });

    return { success: true, enabled: settings?.autoFollowUpsOnReply === true };
  } catch (error) {
    console.error("Failed to get auto-followups-on-reply setting:", error);
    return { success: false, error: "Failed to load auto follow-up setting" };
  }
}

export async function setAutoFollowUpsOnReply(
  clientId: string | null | undefined,
  enabled: boolean
): Promise<{ success: boolean; enabled?: boolean; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: { autoFollowUpsOnReply: enabled },
      create: { clientId, autoFollowUpsOnReply: enabled },
    });

    revalidatePath("/");
    return { success: true, enabled };
  } catch (error) {
    console.error("Failed to set auto-followups-on-reply setting:", error);
    return { success: false, error: "Failed to update auto follow-up setting" };
  }
}

export async function pauseWorkspaceFollowUps(
  clientId: string | null | undefined,
  days: number
): Promise<{ success: boolean; pausedUntil?: Date; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAccess(clientId);
    if (!Number.isFinite(days)) return { success: false, error: "Invalid number of days" };

    const daysInt = Math.floor(days);
    if (daysInt < 1) return { success: false, error: "Days must be at least 1" };
    const clampedDays = Math.min(daysInt, 365);

    const settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: { timezone: true },
    });

    const pausedUntil = computeWorkspaceFollowUpsPausedUntil({
      days: clampedDays,
      timeZone: settings?.timezone,
    });

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: { followUpsPausedUntil: pausedUntil },
      create: { clientId, followUpsPausedUntil: pausedUntil },
    });

    // Prevent follow-ups from becoming overdue during the pause window.
    // (We keep instances active; cron will not process them until the pause lifts.)
    await prisma.followUpInstance.updateMany({
      where: {
        status: "active",
        lead: { clientId },
        OR: [{ nextStepDue: null }, { nextStepDue: { lt: pausedUntil } }],
      },
      data: { nextStepDue: pausedUntil },
    });

    revalidatePath("/");
    return { success: true, pausedUntil };
  } catch (error) {
    console.error("Failed to pause workspace follow-ups:", error);
    return { success: false, error: "Failed to pause follow-ups" };
  }
}

export async function resumeWorkspaceFollowUps(
  clientId: string | null | undefined
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAccess(clientId);

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: { followUpsPausedUntil: null },
      create: { clientId, followUpsPausedUntil: null },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to resume workspace follow-ups:", error);
    return { success: false, error: "Failed to resume follow-ups" };
  }
}

// =============================================================================
// Knowledge Asset Management
// =============================================================================

/**
 * Add a knowledge asset (text snippet or URL)
 */
export async function addKnowledgeAsset(
  clientId: string | null | undefined,
  data: {
    name: string;
    type: "text" | "url";
    textContent: string;
  }
): Promise<{ success: boolean; assetId?: string; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    // Ensure settings exist
    const settings = await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: {},
      create: { clientId },
    });

    const asset = await prisma.knowledgeAsset.create({
      data: {
        workspaceSettingsId: settings.id,
        name: data.name,
        type: data.type,
        textContent: data.textContent,
      },
    });

    revalidatePath("/");
    return { success: true, assetId: asset.id };
  } catch (error) {
    console.error("Failed to add knowledge asset:", error);
    return { success: false, error: "Failed to add asset" };
  }
}

/**
 * Add a file-based knowledge asset
 */
export async function addFileKnowledgeAsset(
  clientId: string | null | undefined,
  data: {
    name: string;
    fileUrl: string;
    originalFileName: string;
    mimeType: string;
    textContent?: string; // Extracted text (if already processed)
  }
): Promise<{ success: boolean; assetId?: string; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    // Ensure settings exist
    const settings = await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: {},
      create: { clientId },
    });

    const asset = await prisma.knowledgeAsset.create({
      data: {
        workspaceSettingsId: settings.id,
        name: data.name,
        type: "file",
        fileUrl: data.fileUrl,
        originalFileName: data.originalFileName,
        mimeType: data.mimeType,
        textContent: data.textContent,
      },
    });

    revalidatePath("/");
    return { success: true, assetId: asset.id };
  } catch (error) {
    console.error("Failed to add file knowledge asset:", error);
    return { success: false, error: "Failed to add file asset" };
  }
}

function sanitizeStorageFilename(input: string): string {
  const name = (input || "file").trim();
  // Prevent path traversal / odd characters in object paths.
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
}

function isSupabaseBucketNotFound(error: unknown): boolean {
  const anyErr = error as any;
  const status = anyErr?.statusCode ?? anyErr?.status ?? anyErr?.code;
  const msg = String(anyErr?.message ?? "");
  return status === 404 || /bucket not found/i.test(msg);
}

async function ensureSupabaseStorageBucketExists(bucket: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const storageAny: any = supabase.storage as any;

  // If the SDK supports listing, use it to short-circuit.
  if (typeof storageAny.listBuckets === "function") {
    const { data, error } = await storageAny.listBuckets();
    if (!error && Array.isArray(data) && data.some((b: any) => b?.name === bucket)) return;
  }

  if (typeof storageAny.createBucket !== "function") return;

  // Default private bucket (safer for uploaded documents). We store an internal reference, not a public URL.
  const { error } = await storageAny.createBucket(bucket, { public: false });
  if (!error) return;
  const msg = String((error as any)?.message ?? "");
  // Ignore "already exists" / conflict-style responses.
  if (/already exists/i.test(msg) || (error as any)?.statusCode === 409) return;
  throw error;
}

function detectDocxMimeType(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".docx");
}

function isPrivateNetworkHostname(hostname: string): boolean {
  const host = (hostname || "").toLowerCase();
  if (!host) return true;
  if (host === "localhost") return true;
  if (host.endsWith(".local")) return true;
  if (host === "0.0.0.0") return true;

  const ipKind = isIP(host);
  if (ipKind === 4) {
    const [a, b] = host.split(".").map((p) => Number.parseInt(p, 10));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  if (ipKind === 6) {
    if (host === "::1") return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique local
    if (host.startsWith("fe80")) return true; // link-local
  }

  return false;
}

/**
 * Upload a file to Knowledge Assets and extract high-signal notes for AI.
 * Uses `gpt-5-mini` (low reasoning) for OCR/extraction.
 */
export async function uploadKnowledgeAssetFile(
  formData: FormData
): Promise<{ success: boolean; asset?: KnowledgeAssetData; error?: string }> {
  return withAiTelemetrySourceIfUnset("action:settings.upload_knowledge_asset_file", async () => {
    try {
      const clientIdRaw = formData.get("clientId");
      const nameRaw = formData.get("name");
      const fileRaw = formData.get("file");

    const clientId = typeof clientIdRaw === "string" ? clientIdRaw : "";
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    const file = fileRaw instanceof File ? fileRaw : null;

    if (!clientId) return { success: false, error: "No workspace selected" };
    if (!name) return { success: false, error: "Missing asset name" };
    if (!file) return { success: false, error: "Missing file" };

    await requireClientAccess(clientId);

    const maxBytes = Math.max(1, Number.parseInt(process.env.KNOWLEDGE_ASSET_MAX_BYTES || "12582912", 10) || 12_582_912); // 12MB
    if (file.size > maxBytes) {
      return { success: false, error: `File too large (max ${(maxBytes / (1024 * 1024)).toFixed(0)}MB)` };
    }

    // Ensure settings exist
    const settings = await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: {},
      create: { clientId },
    });

    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = (file.type || "application/octet-stream").toLowerCase();

    // Upload to Supabase Storage (best-effort; extraction can still succeed without it).
    let fileUrl: string | null = null;
    let uploadPath: string | null = null;
    try {
      const supabase = createSupabaseAdminClient();
      const bucket = process.env.SUPABASE_KNOWLEDGE_ASSETS_BUCKET || "knowledge-assets";
      const safeName = sanitizeStorageFilename(file.name);
      uploadPath = `${clientId}/${crypto.randomUUID()}-${safeName}`;

      // Ensure bucket exists (best-effort) and retry once on a bucket-missing response.
      try {
        await ensureSupabaseStorageBucketExists(bucket);
      } catch (ensureError) {
        console.warn("[KnowledgeAssets] Storage bucket ensure failed (continuing):", ensureError);
      }

      const attemptUpload = async (): Promise<void> => {
        const { error: uploadError } = await supabase.storage.from(bucket).upload(uploadPath!, bytes, {
          contentType: mimeType,
          upsert: false,
          cacheControl: "3600",
        });
        if (uploadError) throw uploadError;
      };

      try {
        await attemptUpload();
      } catch (uploadError) {
        if (isSupabaseBucketNotFound(uploadError)) {
          await ensureSupabaseStorageBucketExists(bucket);
          await attemptUpload();
        } else {
          throw uploadError;
        }
      }

      // Store an internal reference (bucket/path) rather than a public URL.
      fileUrl = `supabase-storage://${bucket}/${uploadPath}`;
    } catch (storageError) {
      console.warn("[KnowledgeAssets] Storage upload failed (continuing):", storageError);
    }

    // DOCX: extract locally, then summarize to notes via gpt-5-mini (low).
    let fallbackText: string | null = null;
    if (detectDocxMimeType(file)) {
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: bytes });
        fallbackText = (result?.value || "").trim() || null;
      } catch (docxError) {
        console.error("[KnowledgeAssets] DOCX extraction failed (will fallback):", docxError);
      }
    }

    const textContent = await extractKnowledgeNotesFromFile({
      clientId,
      filename: file.name || "uploaded_file",
      mimeType,
      bytes,
      fallbackText,
    });

    const created = await prisma.knowledgeAsset.create({
      data: {
        workspaceSettingsId: settings.id,
        name,
        type: "file",
        fileUrl,
        originalFileName: file.name || null,
        mimeType: mimeType || null,
        textContent: textContent || null,
      },
    });

    revalidatePath("/");
      return {
        success: true,
        asset: {
          id: created.id,
          name: created.name,
          type: created.type as KnowledgeAssetData["type"],
          fileUrl: created.fileUrl,
          textContent: created.textContent,
          originalFileName: created.originalFileName,
          mimeType: created.mimeType,
          createdAt: created.createdAt,
        },
      };
    } catch (error) {
      console.error("Failed to upload knowledge asset file:", error);
      return { success: false, error: "Failed to upload file asset" };
    }
  });
}

/**
 * Add a website knowledge asset by crawling the URL via crawl4ai and summarizing to AI-ready notes.
 */
export async function addWebsiteKnowledgeAsset(
  formData: FormData
): Promise<{ success: boolean; asset?: KnowledgeAssetData; warning?: string; error?: string }> {
  return withAiTelemetrySourceIfUnset("action:settings.add_website_knowledge_asset", async () => {
    try {
      const clientIdRaw = formData.get("clientId");
      const nameRaw = formData.get("name");
      const urlRaw = formData.get("url");

    const clientId = typeof clientIdRaw === "string" ? clientIdRaw : "";
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    const url = typeof urlRaw === "string" ? urlRaw.trim() : "";

    if (!clientId) return { success: false, error: "No workspace selected" };
    if (!name) return { success: false, error: "Missing asset name" };
    if (!url) return { success: false, error: "Missing URL" };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { success: false, error: "Invalid URL" };
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { success: false, error: "Only http(s) URLs are supported" };
    }

    if (isPrivateNetworkHostname(parsed.hostname)) {
      return { success: false, error: "URL hostname is not allowed" };
    }

    await requireClientAccess(clientId);

    const settings = await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: {},
      create: { clientId },
    });

    const created = await prisma.knowledgeAsset.create({
      data: {
        workspaceSettingsId: settings.id,
        name,
        type: "url",
        fileUrl: url,
        textContent: null,
      },
    });

    let updated = created;
    let warning: string | undefined;

    try {
      const crawl = await crawl4aiExtractMarkdown(url);
      const markdown =
        crawl.markdown.length > 180_000 ? `${crawl.markdown.slice(0, 180_000)}\n\n[TRUNCATED]` : crawl.markdown;

      const notes = await extractKnowledgeNotesFromText({
        clientId,
        sourceLabel: url,
        text: markdown,
      });

      updated = await prisma.knowledgeAsset.update({
        where: { id: created.id },
        data: { textContent: notes || null },
      });
    } catch (ingestError) {
      console.warn("[KnowledgeAssets] Website ingestion failed (asset created; retry available):", ingestError);
      warning = "Website saved, but extraction failed. You can retry scraping later.";
    }

    revalidatePath("/");
      return {
        success: true,
        warning,
        asset: {
          id: updated.id,
          name: updated.name,
          type: updated.type as KnowledgeAssetData["type"],
          fileUrl: updated.fileUrl,
          textContent: updated.textContent,
          originalFileName: updated.originalFileName,
          mimeType: updated.mimeType,
          createdAt: updated.createdAt,
        },
      };
    } catch (error) {
      console.error("Failed to add website knowledge asset:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to add website asset" };
    }
  });
}

export async function retryWebsiteKnowledgeAssetIngestion(
  assetId: string
): Promise<{ success: boolean; asset?: KnowledgeAssetData; error?: string }> {
  return withAiTelemetrySourceIfUnset("action:settings.retry_website_knowledge_asset_ingestion", async () => {
    try {
      const asset = await prisma.knowledgeAsset.findUnique({
        where: { id: assetId },
        select: {
          id: true,
          name: true,
          type: true,
          fileUrl: true,
          textContent: true,
          originalFileName: true,
          mimeType: true,
          createdAt: true,
          workspaceSettings: { select: { clientId: true } },
        },
      });
      if (!asset) return { success: false, error: "Asset not found" };
      if (asset.type !== "url") return { success: false, error: "Not a website asset" };

    await requireClientAccess(asset.workspaceSettings.clientId);

    const url = (asset.fileUrl || "").trim();
    if (!url) return { success: false, error: "Missing URL" };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { success: false, error: "Invalid URL" };
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { success: false, error: "Only http(s) URLs are supported" };
    }
    if (isPrivateNetworkHostname(parsed.hostname)) {
      return { success: false, error: "URL hostname is not allowed" };
    }

    const crawl = await crawl4aiExtractMarkdown(url);
    const markdown = crawl.markdown.length > 180_000 ? `${crawl.markdown.slice(0, 180_000)}\n\n[TRUNCATED]` : crawl.markdown;

    const notes = await extractKnowledgeNotesFromText({
      clientId: asset.workspaceSettings.clientId,
      sourceLabel: url,
      text: markdown,
    });

    const updated = await prisma.knowledgeAsset.update({
      where: { id: asset.id },
      data: { textContent: notes || null },
    });

    revalidatePath("/");
      return {
        success: true,
        asset: {
          id: updated.id,
          name: updated.name,
          type: updated.type as KnowledgeAssetData["type"],
          fileUrl: updated.fileUrl,
          textContent: updated.textContent,
          originalFileName: updated.originalFileName,
          mimeType: updated.mimeType,
          createdAt: updated.createdAt,
        },
      };
    } catch (error) {
      console.error("Failed to retry website knowledge asset ingestion:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to retry website asset" };
    }
  });
}

/**
 * Update extracted text content for a knowledge asset
 */
export async function updateAssetTextContent(
  assetId: string,
  textContent: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const asset = await prisma.knowledgeAsset.findUnique({
      where: { id: assetId },
      select: { id: true, workspaceSettings: { select: { clientId: true } } },
    });
    if (!asset) return { success: false, error: "Asset not found" };
    await requireClientAccess(asset.workspaceSettings.clientId);

    await prisma.knowledgeAsset.update({
      where: { id: assetId },
      data: { textContent },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update asset text content:", error);
    return { success: false, error: "Failed to update asset" };
  }
}

/**
 * Delete a knowledge asset
 */
export async function deleteKnowledgeAsset(
  assetId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const asset = await prisma.knowledgeAsset.findUnique({
      where: { id: assetId },
      select: { id: true, workspaceSettings: { select: { clientId: true } } },
    });
    if (!asset) return { success: false, error: "Asset not found" };
    await requireClientAccess(asset.workspaceSettings.clientId);

    await prisma.knowledgeAsset.delete({
      where: { id: assetId },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete knowledge asset:", error);
    return { success: false, error: "Failed to delete asset" };
  }
}

/**
 * Get all knowledge assets for a workspace (with their text content)
 */
export async function getKnowledgeAssetsForAI(
  clientId: string
): Promise<{ name: string; content: string }[]> {
  try {
    await requireClientAccess(clientId);
    const settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      include: {
        knowledgeAssets: {
          select: {
            name: true,
            textContent: true,
          },
        },
      },
    });

    if (!settings) return [];

    return settings.knowledgeAssets
      .filter((asset) => asset.textContent)
      .map((asset) => ({
        name: asset.name,
        content: asset.textContent!,
      }));
  } catch (error) {
    console.error("Failed to get knowledge assets:", error);
    return [];
  }
}

// =============================================================================
// Calendar Link Management
// =============================================================================

/**
 * Detect calendar type from URL
 */
function detectCalendarType(url: string): CalendarLinkData["type"] {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes("calendly.com")) {
    return "calendly";
  }
  if (lowerUrl.includes("meetings.hubspot.com") || lowerUrl.includes("hubspot.com/meetings")) {
    return "hubspot";
  }
  if (
    lowerUrl.includes("leadconnectorhq.com") ||
    lowerUrl.includes("gohighlevel.com") ||
    lowerUrl.includes("msgsndr.com") ||
    lowerUrl.includes(".highlevel.") ||
    // GHL widget booking links can be hosted on custom domains
    lowerUrl.includes("/widget/booking/") ||
    lowerUrl.includes("/widget/bookings/")
  ) {
    return "ghl";
  }
  return "unknown";
}

/**
 * Get all calendar links for a workspace
 */
export async function getCalendarLinks(
  clientId: string | null | undefined
): Promise<{ success: boolean; data?: CalendarLinkData[]; error?: string }> {
  try {
    if (!clientId) {
      return { success: true, data: [] };
    }
    await requireClientAccess(clientId);

    const links = await prisma.calendarLink.findMany({
      where: { clientId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    const formattedLinks: CalendarLinkData[] = links.map((link) => ({
      id: link.id,
      name: link.name,
      url: link.url,
      type: link.type as CalendarLinkData["type"],
      isDefault: link.isDefault,
      createdAt: link.createdAt,
    }));

    return { success: true, data: formattedLinks };
  } catch (error) {
    console.error("Failed to get calendar links:", error);
    return { success: false, error: "Failed to fetch calendar links" };
  }
}

/**
 * Resolve the calendar link URL to use for a lead (lead override or workspace default).
 */
export async function getCalendarLinkForLead(
  leadId: string
): Promise<{ success: boolean; url?: string | null; name?: string | null; error?: string }> {
  try {
    if (!leadId) return { success: false, error: "Missing leadId" };
    await requireLeadAccessById(leadId);

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        preferredCalendarLink: { select: { name: true, url: true } },
        client: {
          select: {
            calendarLinks: {
              where: { isDefault: true },
              take: 1,
              select: { name: true, url: true },
            },
          },
        },
      },
    });

    if (!lead) return { success: false, error: "Lead not found" };

    const link = lead.preferredCalendarLink || lead.client.calendarLinks[0] || null;
    if (!link?.url) return { success: false, error: "No calendar link configured" };

    return { success: true, url: link.url, name: link.name || null };
  } catch (error) {
    console.error("Failed to resolve calendar link for lead:", error);
    return { success: false, error: "Failed to resolve calendar link" };
  }
}

/**
 * Add a new calendar link
 */
export async function addCalendarLink(
  clientId: string | null | undefined,
  data: {
    name: string;
    url: string;
    setAsDefault?: boolean;
  }
): Promise<{ success: boolean; linkId?: string; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    // Auto-detect calendar type
    const type = detectCalendarType(data.url);

    // Check if this is the first link (make it default)
    const existingCount = await prisma.calendarLink.count({
      where: { clientId },
    });
    const shouldBeDefault = data.setAsDefault || existingCount === 0;

    // If setting as default, unset existing default
    if (shouldBeDefault) {
      await prisma.calendarLink.updateMany({
        where: { clientId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const link = await prisma.calendarLink.create({
      data: {
        clientId,
        name: data.name,
        url: data.url,
        type,
        isDefault: shouldBeDefault,
      },
    });

    // Ensure availability cache refreshes promptly after calendar link changes.
    await prisma.workspaceAvailabilityCache
      .updateMany({
        where: { clientId },
        data: { staleAt: new Date(0) },
      })
      .catch(() => undefined);

    revalidatePath("/");
    return { success: true, linkId: link.id };
  } catch (error) {
    console.error("Failed to add calendar link:", error);
    return { success: false, error: "Failed to add calendar link" };
  }
}

/**
 * Delete a calendar link
 */
export async function deleteCalendarLink(
  calendarLinkId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const link = await prisma.calendarLink.findUnique({
      where: { id: calendarLinkId },
    });

    if (!link) {
      return { success: false, error: "Calendar link not found" };
    }
    await requireClientAccess(link.clientId);

    await prisma.calendarLink.delete({
      where: { id: calendarLinkId },
    });

    // If this was the default, set another one as default
    if (link.isDefault) {
      const nextLink = await prisma.calendarLink.findFirst({
        where: { clientId: link.clientId },
        orderBy: { createdAt: "asc" },
      });
      if (nextLink) {
        await prisma.calendarLink.update({
          where: { id: nextLink.id },
          data: { isDefault: true },
        });
      }
    }

    // Ensure availability cache refreshes promptly after calendar link changes.
    await prisma.workspaceAvailabilityCache
      .updateMany({
        where: { clientId: link.clientId },
        data: { staleAt: new Date(0) },
      })
      .catch(() => undefined);

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete calendar link:", error);
    return { success: false, error: "Failed to delete calendar link" };
  }
}

/**
 * Set a calendar link as the default
 */
export async function setDefaultCalendarLink(
  clientId: string | null | undefined,
  calendarLinkId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireClientAccess(clientId);

    const link = await prisma.calendarLink.findUnique({
      where: { id: calendarLinkId },
      select: { clientId: true },
    });
    if (!link) return { success: false, error: "Calendar link not found" };
    if (link.clientId !== clientId) return { success: false, error: "Calendar link does not belong to this workspace" };

    // Unset current default
    await prisma.calendarLink.updateMany({
      where: { clientId, isDefault: true },
      data: { isDefault: false },
    });

    // Set new default
    await prisma.calendarLink.update({
      where: { id: calendarLinkId },
      data: { isDefault: true },
    });

    // Ensure availability cache refreshes promptly after calendar link changes.
    await prisma.workspaceAvailabilityCache
      .updateMany({
        where: { clientId },
        data: { staleAt: new Date(0) },
      })
      .catch(() => undefined);

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to set default calendar link:", error);
    return { success: false, error: "Failed to set default calendar" };
  }
}
