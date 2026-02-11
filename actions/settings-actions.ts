"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { applyAirtableModeToDefaultSequences } from "@/actions/followup-sequence-actions";
import { computeWorkspaceFollowUpsPausedUntil } from "@/lib/workspace-followups-pause";
import { requireAuthUser, requireClientAccess, requireClientAdminAccess, requireLeadAccessById } from "@/lib/workspace-access";
import { requireWorkspaceCapabilities } from "@/lib/workspace-capabilities";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  extractKnowledgeRawTextFromFile,
  extractKnowledgeRawTextFromText,
  summarizeKnowledgeRawTextToNotes,
} from "@/lib/knowledge-asset-extraction";
import { crawl4aiExtractMarkdown } from "@/lib/crawl4ai";
import { withAiTelemetrySourceIfUnset } from "@/lib/ai/telemetry-context";
import { validateAutoSendCustomSchedule } from "@/lib/auto-send-schedule";
import { buildKnowledgeAssetUpdateData, isPrivateNetworkHostname } from "@/lib/knowledge-asset-update";
import { resolveKnowledgeAssetContextSource } from "@/lib/knowledge-asset-context";
import { MeetingBookingProvider, Prisma } from "@prisma/client";

export interface UserSettingsData {
  id: string;
  clientId: string;
  brandName: string | null;
  brandLogoUrl: string | null;
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
  messagePerformanceWeeklyEnabled: boolean;
  // Draft Generation Model Settings (workspace-level, admin-gated updates)
  draftGenerationModel: string | null;
  draftGenerationReasoningEffort: string | null;
  // Email Draft Verification (Step 3) Model Settings (workspace-level, admin-gated updates)
  emailDraftVerificationModel: string | null;
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
  autoSendSkipHumanReview: boolean;
  autoSendScheduleMode: "ALWAYS" | "BUSINESS_HOURS" | "CUSTOM" | null;
  autoSendCustomSchedule: Record<string, unknown> | null;
  // Calendar Settings
  calendarSlotsToShow: number | null;
  calendarLookAheadDays: number | null;
  calendarHealthEnabled: boolean;
  calendarHealthMinSlots: number;
  // EmailBison first-touch availability_slot injection controls (Phase 55/61)
  emailBisonFirstTouchAvailabilitySlotEnabled: boolean;
  emailBisonAvailabilitySlotTemplate: string | null;
  emailBisonAvailabilitySlotIncludeWeekends: boolean;
  emailBisonAvailabilitySlotCount: number;
  emailBisonAvailabilitySlotPreferWithinDays: number;
  // GHL Meeting Booking Settings
  ghlDefaultCalendarId: string | null;
  ghlDirectBookCalendarId: string | null;
  ghlAssignedUserId: string | null;
  autoBookMeetings: boolean;
  meetingDurationMinutes: number;
  meetingTitle: string | null;
  meetingBookingProvider: "ghl" | "calendly";
  calendlyEventTypeLink: string | null;
  calendlyEventTypeUri: string | null;
  calendlyDirectBookEventTypeLink: string | null;
  calendlyDirectBookEventTypeUri: string | null;
}

export interface KnowledgeAssetData {
  id: string;
  name: string;
  type: "file" | "text" | "url";
  fileUrl: string | null;
  rawContent: string | null;
  textContent: string | null;
  aiContextMode: "notes" | "raw";
  originalFileName: string | null;
  mimeType: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  publicUrl: string | null;
  type: "calendly" | "hubspot" | "ghl" | "unknown";
  isDefault: boolean;
  createdAt: Date;
}

async function requireSettingsWriteAccess(clientId: string): Promise<void> {
  const { capabilities } = await requireWorkspaceCapabilities(clientId);
  if (!capabilities.canEditSettings) {
    throw new Error("Unauthorized");
  }
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
          brandName: null,
          brandLogoUrl: null,
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
          messagePerformanceWeeklyEnabled: false,
          draftGenerationModel: "gpt-5.1",
          draftGenerationReasoningEffort: "medium",
          emailDraftVerificationModel: "gpt-5.2",
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
          autoSendSkipHumanReview: false,
          autoSendScheduleMode: "ALWAYS",
          autoSendCustomSchedule: null,
          calendarSlotsToShow: 3,
          calendarLookAheadDays: 28,
          calendarHealthEnabled: true,
          calendarHealthMinSlots: 10,
          emailBisonFirstTouchAvailabilitySlotEnabled: true,
          emailBisonAvailabilitySlotTemplate: null,
          emailBisonAvailabilitySlotIncludeWeekends: false,
          emailBisonAvailabilitySlotCount: 2,
          emailBisonAvailabilitySlotPreferWithinDays: 5,
          ghlDefaultCalendarId: null,
          ghlDirectBookCalendarId: null,
          ghlAssignedUserId: null,
          autoBookMeetings: false,
          meetingDurationMinutes: 30,
          meetingTitle: "Intro to {companyName}",
          meetingBookingProvider: "ghl",
          calendlyEventTypeLink: null,
          calendlyEventTypeUri: null,
          calendlyDirectBookEventTypeLink: null,
          calendlyDirectBookEventTypeUri: null,
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
      const created = await prisma.workspaceSettings.create({
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
          autoSendSkipHumanReview: false,
          autoSendScheduleMode: "ALWAYS",
          autoSendCustomSchedule: Prisma.JsonNull,
          calendarHealthEnabled: true,
          calendarHealthMinSlots: 10,
        },
      });
      settings = { ...created, knowledgeAssets: [] };
    }

    const knowledgeAssets: KnowledgeAssetData[] = settings.knowledgeAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type as "file" | "text" | "url",
      fileUrl: asset.fileUrl,
      rawContent: asset.rawContent,
      textContent: asset.textContent,
      aiContextMode: asset.aiContextMode === "raw" ? "raw" : "notes",
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    }));

    return {
      success: true,
      data: {
        id: settings.id,
        clientId: settings.clientId,
        brandName: settings.brandName,
        brandLogoUrl: settings.brandLogoUrl,
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
        messagePerformanceWeeklyEnabled: settings.messagePerformanceWeeklyEnabled ?? false,
        draftGenerationModel: settings.draftGenerationModel ?? "gpt-5.1",
        draftGenerationReasoningEffort: settings.draftGenerationReasoningEffort ?? "medium",
        emailDraftVerificationModel: settings.emailDraftVerificationModel ?? "gpt-5.2",
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
        autoSendSkipHumanReview: settings.autoSendSkipHumanReview,
        autoSendScheduleMode: settings.autoSendScheduleMode ?? "ALWAYS",
        autoSendCustomSchedule: (settings.autoSendCustomSchedule as Record<string, unknown> | null) ?? null,
        calendarSlotsToShow: settings.calendarSlotsToShow,
        calendarLookAheadDays: settings.calendarLookAheadDays,
        calendarHealthEnabled: settings.calendarHealthEnabled,
        calendarHealthMinSlots: settings.calendarHealthMinSlots,
        emailBisonFirstTouchAvailabilitySlotEnabled: settings.emailBisonFirstTouchAvailabilitySlotEnabled,
        emailBisonAvailabilitySlotTemplate: settings.emailBisonAvailabilitySlotTemplate,
        emailBisonAvailabilitySlotIncludeWeekends: settings.emailBisonAvailabilitySlotIncludeWeekends,
        emailBisonAvailabilitySlotCount: settings.emailBisonAvailabilitySlotCount,
        emailBisonAvailabilitySlotPreferWithinDays: settings.emailBisonAvailabilitySlotPreferWithinDays,
        ghlDefaultCalendarId: settings.ghlDefaultCalendarId,
        ghlDirectBookCalendarId: settings.ghlDirectBookCalendarId,
        ghlAssignedUserId: settings.ghlAssignedUserId,
        autoBookMeetings: settings.autoBookMeetings,
        meetingDurationMinutes: settings.meetingDurationMinutes,
        meetingTitle: settings.meetingTitle,
        meetingBookingProvider:
          settings.meetingBookingProvider === MeetingBookingProvider.CALENDLY ? "calendly" : "ghl",
        calendlyEventTypeLink: settings.calendlyEventTypeLink,
        calendlyEventTypeUri: settings.calendlyEventTypeUri,
        calendlyDirectBookEventTypeLink: settings.calendlyDirectBookEventTypeLink,
        calendlyDirectBookEventTypeUri: settings.calendlyDirectBookEventTypeUri,
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

    const toNullableJson = (value: Record<string, unknown> | null | undefined) =>
      value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue | undefined);

    const wantsInsightsUpdate =
      data.insightsChatModel !== undefined ||
      data.insightsChatReasoningEffort !== undefined ||
      data.insightsChatEnableCampaignChanges !== undefined ||
      data.insightsChatEnableExperimentWrites !== undefined ||
      data.insightsChatEnableFollowupPauses !== undefined ||
      data.messagePerformanceWeeklyEnabled !== undefined;
    const wantsDraftGenerationUpdate =
      data.draftGenerationModel !== undefined ||
      data.draftGenerationReasoningEffort !== undefined;
    const wantsEmailDraftVerificationUpdate =
      data.emailDraftVerificationModel !== undefined;
    const wantsNotificationUpdate =
      data.notificationEmails !== undefined ||
      data.notificationPhones !== undefined ||
      data.notificationSlackChannelIds !== undefined ||
      data.notificationSentimentRules !== undefined ||
      data.notificationDailyDigestTime !== undefined;
    const wantsEmailBisonAvailabilitySlotUpdate =
      data.emailBisonFirstTouchAvailabilitySlotEnabled !== undefined ||
      data.emailBisonAvailabilitySlotTemplate !== undefined ||
      data.emailBisonAvailabilitySlotIncludeWeekends !== undefined ||
      data.emailBisonAvailabilitySlotCount !== undefined ||
      data.emailBisonAvailabilitySlotPreferWithinDays !== undefined;
    const wantsScheduleUpdate =
      data.autoSendSkipHumanReview !== undefined ||
      data.autoSendScheduleMode !== undefined ||
      data.autoSendCustomSchedule !== undefined;
    const wantsCalendarHealthUpdate =
      data.calendarHealthEnabled !== undefined ||
      data.calendarHealthMinSlots !== undefined;
    const wantsBrandingUpdate =
      data.brandName !== undefined ||
      data.brandLogoUrl !== undefined;

    let normalizedCustomSchedule = data.autoSendCustomSchedule;
    const normalizedCalendarHealthMinSlots =
      typeof data.calendarHealthMinSlots === "number" && Number.isFinite(data.calendarHealthMinSlots)
        ? Math.max(0, Math.min(500, Math.floor(data.calendarHealthMinSlots)))
        : undefined;

    if (wantsInsightsUpdate || wantsDraftGenerationUpdate || wantsEmailDraftVerificationUpdate || wantsNotificationUpdate) {
      await requireClientAdminAccess(clientId);
    }
    if (wantsEmailBisonAvailabilitySlotUpdate) {
      await requireClientAdminAccess(clientId);
    }
    if (wantsScheduleUpdate) {
      await requireClientAdminAccess(clientId);
      if (data.autoSendCustomSchedule !== undefined && data.autoSendCustomSchedule !== null) {
        const validation = validateAutoSendCustomSchedule(data.autoSendCustomSchedule);
        if (!validation.ok) {
          return { success: false, error: validation.error };
        }
        normalizedCustomSchedule = validation.value as unknown as Record<string, unknown>;
      }
    }
    if (wantsCalendarHealthUpdate) {
      await requireClientAdminAccess(clientId);
    }
    if (wantsBrandingUpdate) {
      await requireClientAdminAccess(clientId);
    }

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: {
        brandName: data.brandName,
        brandLogoUrl: data.brandLogoUrl,
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
        messagePerformanceWeeklyEnabled: data.messagePerformanceWeeklyEnabled,
        draftGenerationModel: data.draftGenerationModel,
        draftGenerationReasoningEffort: data.draftGenerationReasoningEffort,
        emailDraftVerificationModel: data.emailDraftVerificationModel,
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
        autoSendSkipHumanReview: data.autoSendSkipHumanReview,
        autoSendScheduleMode: data.autoSendScheduleMode as any,
        autoSendCustomSchedule: toNullableJson(normalizedCustomSchedule),
        calendarSlotsToShow: data.calendarSlotsToShow,
        calendarLookAheadDays: data.calendarLookAheadDays,
        calendarHealthEnabled: data.calendarHealthEnabled,
        calendarHealthMinSlots: normalizedCalendarHealthMinSlots,
        emailBisonFirstTouchAvailabilitySlotEnabled: data.emailBisonFirstTouchAvailabilitySlotEnabled,
        emailBisonAvailabilitySlotTemplate: data.emailBisonAvailabilitySlotTemplate,
        emailBisonAvailabilitySlotIncludeWeekends: data.emailBisonAvailabilitySlotIncludeWeekends,
        emailBisonAvailabilitySlotCount: data.emailBisonAvailabilitySlotCount,
        emailBisonAvailabilitySlotPreferWithinDays: data.emailBisonAvailabilitySlotPreferWithinDays,
        ghlDefaultCalendarId: data.ghlDefaultCalendarId,
        ghlDirectBookCalendarId: data.ghlDirectBookCalendarId,
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
        calendlyDirectBookEventTypeLink: data.calendlyDirectBookEventTypeLink,
        calendlyDirectBookEventTypeUri: data.calendlyDirectBookEventTypeUri,
      },
      create: {
        clientId,
        brandName: data.brandName,
        brandLogoUrl: data.brandLogoUrl,
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
        messagePerformanceWeeklyEnabled: data.messagePerformanceWeeklyEnabled ?? false,
        draftGenerationModel: data.draftGenerationModel,
        draftGenerationReasoningEffort: data.draftGenerationReasoningEffort,
        emailDraftVerificationModel: data.emailDraftVerificationModel,
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
        autoSendSkipHumanReview: data.autoSendSkipHumanReview ?? false,
        autoSendScheduleMode: (data.autoSendScheduleMode as any) ?? "ALWAYS",
        autoSendCustomSchedule: toNullableJson(normalizedCustomSchedule) ?? Prisma.JsonNull,
        calendarSlotsToShow: data.calendarSlotsToShow ?? 3,
        calendarLookAheadDays: data.calendarLookAheadDays ?? 28,
        calendarHealthEnabled: data.calendarHealthEnabled ?? true,
        calendarHealthMinSlots: normalizedCalendarHealthMinSlots ?? 10,
        emailBisonFirstTouchAvailabilitySlotEnabled: data.emailBisonFirstTouchAvailabilitySlotEnabled ?? true,
        emailBisonAvailabilitySlotTemplate: data.emailBisonAvailabilitySlotTemplate ?? null,
        emailBisonAvailabilitySlotIncludeWeekends: data.emailBisonAvailabilitySlotIncludeWeekends ?? false,
        emailBisonAvailabilitySlotCount: data.emailBisonAvailabilitySlotCount ?? 2,
        emailBisonAvailabilitySlotPreferWithinDays: data.emailBisonAvailabilitySlotPreferWithinDays ?? 5,
        ghlDefaultCalendarId: data.ghlDefaultCalendarId,
        ghlDirectBookCalendarId: data.ghlDirectBookCalendarId,
        ghlAssignedUserId: data.ghlAssignedUserId,
        autoBookMeetings: data.autoBookMeetings ?? false,
        meetingDurationMinutes: data.meetingDurationMinutes ?? 30,
        meetingTitle: data.meetingTitle ?? "Intro to {companyName}",
        meetingBookingProvider:
          data.meetingBookingProvider === "calendly" ? MeetingBookingProvider.CALENDLY : MeetingBookingProvider.GHL,
        calendlyEventTypeLink: data.calendlyEventTypeLink,
        calendlyEventTypeUri: data.calendlyEventTypeUri,
        calendlyDirectBookEventTypeLink: data.calendlyDirectBookEventTypeLink,
        calendlyDirectBookEventTypeUri: data.calendlyDirectBookEventTypeUri,
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
    await requireSettingsWriteAccess(clientId);

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
    await requireSettingsWriteAccess(clientId);

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
    await requireSettingsWriteAccess(clientId);

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
    await requireSettingsWriteAccess(clientId);

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

export type KnowledgeAssetRevisionRecord = {
  id: string;
  knowledgeAssetId: string;
  name: string;
  type: string;
  rawContent: string | null;
  textContent: string | null;
  aiContextMode: string | null;
  action: string;
  createdAt: Date;
  createdByEmail: string | null;
};

async function recordKnowledgeAssetRevision(opts: {
  clientId: string;
  workspaceSettingsId: string;
  asset: {
    id: string;
    name: string;
    type: string;
    fileUrl: string | null;
    rawContent: string | null;
    textContent: string | null;
    aiContextMode: string | null;
  };
  action: string;
  createdByUserId: string | null;
  createdByEmail: string | null;
  proposalId?: string | null;
}) {
  await prisma.knowledgeAssetRevision.create({
    data: {
      clientId: opts.clientId,
      workspaceSettingsId: opts.workspaceSettingsId,
      knowledgeAssetId: opts.asset.id,
      proposalId: opts.proposalId ?? null,
      name: opts.asset.name,
      type: opts.asset.type,
      fileUrl: opts.asset.fileUrl,
      rawContent: opts.asset.rawContent,
      textContent: opts.asset.textContent,
      aiContextMode: opts.asset.aiContextMode,
      action: opts.action,
      createdByUserId: opts.createdByUserId ?? null,
      createdByEmail: opts.createdByEmail ?? null,
    },
  });
}

/**
 * Add a knowledge asset (text snippet or URL)
 */
export async function addKnowledgeAsset(
  clientId: string | null | undefined,
  data: {
    name: string;
    type: "text" | "url";
    textContent: string;
    rawContent?: string | null;
    aiContextMode?: "notes" | "raw";
  }
): Promise<{ success: boolean; assetId?: string; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireSettingsWriteAccess(clientId);
    const user = await requireAuthUser();

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
        rawContent: data.rawContent ?? data.textContent,
        textContent: data.textContent,
        aiContextMode: data.aiContextMode === "raw" ? "raw" : "notes",
      },
    });

    await recordKnowledgeAssetRevision({
      clientId,
      workspaceSettingsId: settings.id,
      asset: {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        fileUrl: asset.fileUrl,
        rawContent: asset.rawContent,
        textContent: asset.textContent,
        aiContextMode: asset.aiContextMode,
      },
      action: "CREATE",
      createdByUserId: user.id,
      createdByEmail: user.email ?? null,
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
    rawContent?: string | null;
    textContent?: string | null; // Extracted notes (if already processed)
    aiContextMode?: "notes" | "raw";
  }
): Promise<{ success: boolean; assetId?: string; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireSettingsWriteAccess(clientId);
    const user = await requireAuthUser();

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
        rawContent: data.rawContent ?? null,
        textContent: data.textContent,
        aiContextMode: data.aiContextMode === "raw" ? "raw" : "notes",
      },
    });

    await recordKnowledgeAssetRevision({
      clientId,
      workspaceSettingsId: settings.id,
      asset: {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        fileUrl: asset.fileUrl,
        rawContent: asset.rawContent,
        textContent: asset.textContent,
        aiContextMode: asset.aiContextMode,
      },
      action: "CREATE",
      createdByUserId: user.id,
      createdByEmail: user.email ?? null,
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

async function ensureSupabaseStorageBucketExists(
  bucket: string,
  opts?: {
    isPublic?: boolean;
  }
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const storageAny: any = supabase.storage as any;

  // If the SDK supports listing, use it to short-circuit.
  if (typeof storageAny.listBuckets === "function") {
    const { data, error } = await storageAny.listBuckets();
    if (!error && Array.isArray(data) && data.some((b: any) => b?.name === bucket)) return;
  }

  if (typeof storageAny.createBucket !== "function") return;

  const { error } = await storageAny.createBucket(bucket, { public: opts?.isPublic === true });
  if (!error) return;
  const msg = String((error as any)?.message ?? "");
  // Ignore "already exists" / conflict-style responses.
  if (/already exists/i.test(msg) || (error as any)?.statusCode === 409) return;
  throw error;
}

function isAllowedWorkspaceBrandLogoMimeType(mimeType: string): boolean {
  const value = (mimeType || "").toLowerCase();
  return value === "image/png" || value === "image/jpeg" || value === "image/jpg" || value === "image/webp";
}

function hasAllowedImageMagicBytes(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true;
  }

  return false;
}

function normalizeBrandLogoUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  let normalized = value.trim();
  if (!normalized) return null;
  normalized = normalized.replace(/\\/g, "/");

  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("public/")) normalized = normalized.slice("public".length);
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  return normalized === "/" ? null : normalized;
}

function extractSupabasePublicObjectPath(publicUrl: string, bucket: string): string | null {
  const projectUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!projectUrl) return null;

  try {
    const url = new URL(publicUrl);
    const project = new URL(projectUrl);
    if (url.origin !== project.origin) return null;

    const prefix = `/storage/v1/object/public/${bucket}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const objectPath = decodeURIComponent(url.pathname.slice(prefix.length));
    return objectPath || null;
  } catch {
    return null;
  }
}

export async function uploadWorkspaceBrandLogo(
  formData: FormData
): Promise<{ success: boolean; brandLogoUrl?: string; error?: string }> {
  try {
    const clientIdRaw = formData.get("clientId");
    const fileRaw = formData.get("file");

    const clientId = typeof clientIdRaw === "string" ? clientIdRaw : "";
    const file = fileRaw instanceof File ? fileRaw : null;

    if (!clientId) return { success: false, error: "No workspace selected" };
    if (!file) return { success: false, error: "Missing logo file" };

    await requireClientAdminAccess(clientId);

    const maxBytes = Math.max(
      1,
      Number.parseInt(process.env.WORKSPACE_BRAND_LOGO_MAX_BYTES || "5242880", 10) || 5_242_880
    ); // 5MB

    if (file.size > maxBytes) {
      return { success: false, error: `Logo file is too large (max ${(maxBytes / (1024 * 1024)).toFixed(0)}MB)` };
    }

    const mimeType = (file.type || "application/octet-stream").toLowerCase();
    if (!isAllowedWorkspaceBrandLogoMimeType(mimeType)) {
      return { success: false, error: "Unsupported logo format. Use PNG, JPG, or WebP." };
    }

    const supabase = createSupabaseAdminClient();
    const bucket = process.env.SUPABASE_WORKSPACE_BRAND_ASSETS_BUCKET || "workspace-brand-assets";
    const safeName = sanitizeStorageFilename(file.name || "logo");
    const uploadPath = `${clientId}/${crypto.randomUUID()}-${safeName}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!hasAllowedImageMagicBytes(bytes)) {
      return { success: false, error: "File does not appear to be a valid image. Use PNG, JPG, or WebP." };
    }

    try {
      await ensureSupabaseStorageBucketExists(bucket, { isPublic: true });
    } catch (ensureError) {
      console.warn("[WorkspaceBrandLogo] Storage bucket ensure failed (continuing):", ensureError);
    }

    const attemptUpload = async (): Promise<void> => {
      const { error: uploadError } = await supabase.storage.from(bucket).upload(uploadPath, bytes, {
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
        await ensureSupabaseStorageBucketExists(bucket, { isPublic: true });
        await attemptUpload();
      } else {
        throw uploadError;
      }
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(uploadPath);
    const normalizedPublicUrl = normalizeBrandLogoUrl(publicUrl);
    if (!normalizedPublicUrl) {
      return { success: false, error: "Failed to resolve public logo URL" };
    }

    const existingSettings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: { brandLogoUrl: true },
    });

    const previousPath =
      existingSettings?.brandLogoUrl ? extractSupabasePublicObjectPath(existingSettings.brandLogoUrl, bucket) : null;
    if (previousPath && previousPath !== uploadPath) {
      const { error: removeError } = await supabase.storage.from(bucket).remove([previousPath]);
      if (removeError) {
        console.warn("[WorkspaceBrandLogo] Failed to remove previous logo object:", removeError);
      }
    }

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: { brandLogoUrl: normalizedPublicUrl },
      create: { clientId, brandLogoUrl: normalizedPublicUrl },
    });

    revalidatePath("/");
    return { success: true, brandLogoUrl: normalizedPublicUrl };
  } catch (error) {
    console.error("Failed to upload workspace brand logo:", error);
    return { success: false, error: "Failed to upload workspace logo" };
  }
}

function detectDocxMimeType(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".docx");
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

    await requireSettingsWriteAccess(clientId);
    const user = await requireAuthUser();

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

    const rawContent = await extractKnowledgeRawTextFromFile({
      clientId,
      filename: file.name || "uploaded_file",
      mimeType,
      bytes,
      fallbackText,
    });
    const textContent = await summarizeKnowledgeRawTextToNotes({
      clientId,
      sourceLabel: `${file.name || "uploaded_file"} (${mimeType || "unknown"})`,
      rawText: rawContent,
    });

    const created = await prisma.knowledgeAsset.create({
      data: {
        workspaceSettingsId: settings.id,
        name,
        type: "file",
        fileUrl,
        originalFileName: file.name || null,
        mimeType: mimeType || null,
        rawContent: rawContent || null,
        textContent: textContent || null,
        aiContextMode: "notes",
      },
    });

    await recordKnowledgeAssetRevision({
      clientId,
      workspaceSettingsId: settings.id,
      asset: {
        id: created.id,
        name: created.name,
        type: created.type,
        fileUrl: created.fileUrl,
        rawContent: created.rawContent,
        textContent: created.textContent,
        aiContextMode: created.aiContextMode,
      },
      action: "CREATE",
      createdByUserId: user.id,
      createdByEmail: user.email ?? null,
    });

    revalidatePath("/");
      return {
        success: true,
        asset: {
          id: created.id,
          name: created.name,
          type: created.type as KnowledgeAssetData["type"],
          fileUrl: created.fileUrl,
          rawContent: created.rawContent,
          textContent: created.textContent,
          aiContextMode: created.aiContextMode === "raw" ? "raw" : "notes",
          originalFileName: created.originalFileName,
          mimeType: created.mimeType,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
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

    await requireSettingsWriteAccess(clientId);
    const user = await requireAuthUser();

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
        rawContent: null,
        textContent: null,
        aiContextMode: "notes",
      },
    });

    let updated = created;
    let warning: string | undefined;

    try {
      const crawl = await crawl4aiExtractMarkdown(url);
      const markdown =
        crawl.markdown.length > 180_000 ? `${crawl.markdown.slice(0, 180_000)}\n\n[TRUNCATED]` : crawl.markdown;

      const raw = await extractKnowledgeRawTextFromText({
        sourceLabel: url,
        text: markdown,
      });

      const notes = await summarizeKnowledgeRawTextToNotes({
        clientId,
        sourceLabel: url,
        rawText: raw,
      });

      updated = await prisma.knowledgeAsset.update({
        where: { id: created.id },
        data: {
          rawContent: raw || null,
          textContent: notes || null,
        },
      });
    } catch (ingestError) {
      console.warn("[KnowledgeAssets] Website ingestion failed (asset created; retry available):", ingestError);
      warning = "Website saved, but extraction failed. You can retry scraping later.";
    }

    await recordKnowledgeAssetRevision({
      clientId,
      workspaceSettingsId: settings.id,
      asset: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        fileUrl: updated.fileUrl,
        rawContent: updated.rawContent,
        textContent: updated.textContent,
        aiContextMode: updated.aiContextMode,
      },
      action: "CREATE",
      createdByUserId: user.id,
      createdByEmail: user.email ?? null,
    });

    revalidatePath("/");
      return {
        success: true,
        warning,
        asset: {
          id: updated.id,
          name: updated.name,
          type: updated.type as KnowledgeAssetData["type"],
          fileUrl: updated.fileUrl,
          rawContent: updated.rawContent,
          textContent: updated.textContent,
          aiContextMode: updated.aiContextMode === "raw" ? "raw" : "notes",
          originalFileName: updated.originalFileName,
          mimeType: updated.mimeType,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
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
          rawContent: true,
          textContent: true,
          aiContextMode: true,
          originalFileName: true,
          mimeType: true,
          createdAt: true,
          workspaceSettings: { select: { clientId: true } },
        },
      });
      if (!asset) return { success: false, error: "Asset not found" };
      if (asset.type !== "url") return { success: false, error: "Not a website asset" };

    await requireSettingsWriteAccess(asset.workspaceSettings.clientId);
    const user = await requireAuthUser();

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

    const raw = await extractKnowledgeRawTextFromText({
      sourceLabel: url,
      text: markdown,
    });

    const notes = await summarizeKnowledgeRawTextToNotes({
      clientId: asset.workspaceSettings.clientId,
      sourceLabel: url,
      rawText: raw,
    });

    const updated = await prisma.knowledgeAsset.update({
      where: { id: asset.id },
      data: {
        rawContent: raw || null,
        textContent: notes || null,
      },
    });

    await recordKnowledgeAssetRevision({
      clientId: asset.workspaceSettings.clientId,
      workspaceSettingsId: updated.workspaceSettingsId,
      asset: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        fileUrl: updated.fileUrl,
        rawContent: updated.rawContent,
        textContent: updated.textContent,
        aiContextMode: updated.aiContextMode,
      },
      action: "UPDATE",
      createdByUserId: user.id,
      createdByEmail: user.email ?? null,
    });

    revalidatePath("/");
      return {
        success: true,
        asset: {
          id: updated.id,
          name: updated.name,
          type: updated.type as KnowledgeAssetData["type"],
          fileUrl: updated.fileUrl,
          rawContent: updated.rawContent,
          textContent: updated.textContent,
          aiContextMode: updated.aiContextMode === "raw" ? "raw" : "notes",
          originalFileName: updated.originalFileName,
          mimeType: updated.mimeType,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
      };
    } catch (error) {
      console.error("Failed to retry website knowledge asset ingestion:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to retry website asset" };
    }
  });
}

/**
 * Update editable fields for a knowledge asset.
 * - All types: name + textContent
 * - URL assets only: source URL (fileUrl)
 */
export async function updateKnowledgeAsset(
  assetId: string,
  data: {
    name?: string;
    rawContent?: string | null;
    textContent?: string | null;
    fileUrl?: string | null;
    aiContextMode?: "notes" | "raw";
  }
): Promise<{ success: boolean; asset?: KnowledgeAssetData; error?: string }> {
  try {
    const asset = await prisma.knowledgeAsset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        name: true,
        type: true,
        fileUrl: true,
        rawContent: true,
        textContent: true,
        aiContextMode: true,
        originalFileName: true,
        mimeType: true,
        createdAt: true,
        updatedAt: true,
        workspaceSettingsId: true,
        workspaceSettings: { select: { clientId: true } },
      },
    });
    if (!asset) return { success: false, error: "Asset not found" };

    await requireSettingsWriteAccess(asset.workspaceSettings.clientId);
    const user = await requireAuthUser();

    const { updateData, error } = buildKnowledgeAssetUpdateData(asset.type as KnowledgeAssetData["type"], data);
    if (error) return { success: false, error };

    if (Object.keys(updateData).length === 0) {
      return {
        success: true,
        asset: {
          id: asset.id,
          name: asset.name,
          type: asset.type as KnowledgeAssetData["type"],
          fileUrl: asset.fileUrl,
          rawContent: asset.rawContent,
          textContent: asset.textContent,
          aiContextMode: asset.aiContextMode === "raw" ? "raw" : "notes",
          originalFileName: asset.originalFileName,
          mimeType: asset.mimeType,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        },
      };
    }

    const updated = await prisma.knowledgeAsset.update({
      where: { id: assetId },
      data: updateData,
    });

    await recordKnowledgeAssetRevision({
      clientId: asset.workspaceSettings.clientId,
      workspaceSettingsId: asset.workspaceSettingsId,
      asset: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        fileUrl: updated.fileUrl,
        rawContent: updated.rawContent,
        textContent: updated.textContent,
        aiContextMode: updated.aiContextMode,
      },
      action: "UPDATE",
      createdByUserId: user.id,
      createdByEmail: user.email ?? null,
    });

    revalidatePath("/");
    return {
      success: true,
      asset: {
        id: updated.id,
        name: updated.name,
        type: updated.type as KnowledgeAssetData["type"],
        fileUrl: updated.fileUrl,
        rawContent: updated.rawContent,
        textContent: updated.textContent,
        aiContextMode: updated.aiContextMode === "raw" ? "raw" : "notes",
        originalFileName: updated.originalFileName,
        mimeType: updated.mimeType,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    };
  } catch (error) {
    console.error("Failed to update knowledge asset:", error);
    return { success: false, error: "Failed to update asset" };
  }
}

/**
 * Update extracted text content for a knowledge asset
 */
export async function updateAssetTextContent(
  assetId: string,
  textContent: string
): Promise<{ success: boolean; error?: string }> {
  const result = await updateKnowledgeAsset(assetId, { textContent });
  return { success: result.success, error: result.error };
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
    await requireSettingsWriteAccess(asset.workspaceSettings.clientId);

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

export async function getKnowledgeAssetRevisions(
  clientId: string | null | undefined,
  assetId: string
): Promise<{ success: boolean; data?: KnowledgeAssetRevisionRecord[]; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAdminAccess(clientId);

    const revisions = await prisma.knowledgeAssetRevision.findMany({
      where: { clientId, knowledgeAssetId: assetId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        knowledgeAssetId: true,
        name: true,
        type: true,
        rawContent: true,
        textContent: true,
        aiContextMode: true,
        action: true,
        createdAt: true,
        createdByEmail: true,
      },
    });

    return { success: true, data: revisions };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load asset history" };
  }
}

export async function rollbackKnowledgeAssetRevision(
  clientId: string | null | undefined,
  revisionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAdminAccess(clientId);

    const revision = await prisma.knowledgeAssetRevision.findFirst({
      where: { id: revisionId, clientId },
      select: {
        knowledgeAssetId: true,
        name: true,
        type: true,
        fileUrl: true,
        rawContent: true,
        textContent: true,
        aiContextMode: true,
        workspaceSettingsId: true,
      },
    });
    if (!revision) return { success: false, error: "Revision not found" };

    const updated = await prisma.knowledgeAsset.update({
      where: { id: revision.knowledgeAssetId },
      data: {
        name: revision.name,
        rawContent: revision.rawContent,
        textContent: revision.textContent,
        aiContextMode: revision.aiContextMode === "raw" ? "raw" : "notes",
      },
    });

    await recordKnowledgeAssetRevision({
      clientId,
      workspaceSettingsId: revision.workspaceSettingsId,
      asset: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        fileUrl: updated.fileUrl,
        rawContent: updated.rawContent,
        textContent: updated.textContent,
        aiContextMode: updated.aiContextMode,
      },
      action: "ROLLBACK",
      createdByUserId: userId,
      createdByEmail: userEmail ?? null,
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to rollback asset" };
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
            rawContent: true,
            textContent: true,
            aiContextMode: true,
          },
        },
      },
    });

    if (!settings) return [];

    return settings.knowledgeAssets
      .map((asset) => {
        const selected = resolveKnowledgeAssetContextSource({
          rawContent: asset.rawContent,
          textContent: asset.textContent,
          aiContextMode: asset.aiContextMode as "notes" | "raw" | null,
        });
        return {
          name: asset.name,
          content: selected.content,
        };
      })
      .filter((asset) => Boolean(asset.content))
      .map((asset) => ({
        name: asset.name,
        content: asset.content,
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
      publicUrl: link.publicUrl,
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
        preferredCalendarLink: { select: { name: true, url: true, publicUrl: true } },
        client: {
          select: {
            calendarLinks: {
              where: { isDefault: true },
              take: 1,
              select: { name: true, url: true, publicUrl: true },
            },
          },
        },
      },
    });

    if (!lead) return { success: false, error: "Lead not found" };

    const link = lead.preferredCalendarLink || lead.client.calendarLinks[0] || null;
    const publicUrl = (link?.publicUrl || "").trim();
    const url = (link?.url || "").trim();
    const resolvedUrl = publicUrl || url || null;
    if (!resolvedUrl) return { success: false, error: "No calendar link configured" };

    return { success: true, url: resolvedUrl, name: link.name || null };
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
    publicUrl?: string | null;
    setAsDefault?: boolean;
  }
): Promise<{ success: boolean; linkId?: string; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }
    await requireSettingsWriteAccess(clientId);

    // Auto-detect calendar type
    const type = detectCalendarType(data.url);
    const publicUrl = (data.publicUrl || "").trim() || null;

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
        publicUrl,
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
 * Update an existing calendar link (name/url/publicUrl).
 * Note: default selection is handled by setDefaultCalendarLink().
 */
export async function updateCalendarLink(
  calendarLinkId: string,
  data: {
    name?: string;
    url?: string;
    publicUrl?: string | null;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!calendarLinkId) return { success: false, error: "Missing calendarLinkId" };

    const existing = await prisma.calendarLink.findUnique({
      where: { id: calendarLinkId },
      select: { id: true, clientId: true, url: true },
    });
    if (!existing) return { success: false, error: "Calendar link not found" };
    await requireSettingsWriteAccess(existing.clientId);

    const nextUrl = data.url?.trim();
    const nextType = nextUrl ? detectCalendarType(nextUrl) : undefined;
    const nextPublicUrl =
      data.publicUrl === undefined ? undefined : (data.publicUrl || "").trim() || null;

    await prisma.calendarLink.update({
      where: { id: calendarLinkId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(nextUrl !== undefined ? { url: nextUrl, type: nextType } : {}),
        ...(nextPublicUrl !== undefined ? { publicUrl: nextPublicUrl } : {}),
      },
    });

    // Ensure availability cache refreshes promptly after calendar link changes.
    await prisma.workspaceAvailabilityCache
      .updateMany({
        where: { clientId: existing.clientId },
        data: { staleAt: new Date(0) },
      })
      .catch(() => undefined);

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update calendar link:", error);
    return { success: false, error: "Failed to update calendar link" };
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
    await requireSettingsWriteAccess(link.clientId);

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
    await requireSettingsWriteAccess(clientId);

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
