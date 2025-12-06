"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface UserSettingsData {
  id: string;
  clientId: string;
  aiPersonaName: string | null;
  aiTone: string | null;
  aiGreeting: string | null;
  aiSignature: string | null;
  aiGoals: string | null;
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
  autoBlacklist: boolean;
  emailDigest: boolean;
  slackAlerts: boolean;
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
          aiSignature: null,
          aiGoals: null,
          serviceDescription: null,
          qualificationQuestions: null,
          companyName: null,
          targetResult: null,
          autoApproveMeetings: true,
          flagUncertainReplies: true,
          pauseForOOO: true,
          autoBlacklist: true,
          emailDigest: true,
          slackAlerts: true,
          timezone: "America/Los_Angeles",
          workStartTime: "09:00",
          workEndTime: "17:00",
          calendarSlotsToShow: 3,
          calendarLookAheadDays: 28,
          ghlDefaultCalendarId: null,
          ghlAssignedUserId: null,
          autoBookMeetings: false,
          meetingDurationMinutes: 30,
          meetingTitle: "Intro to {companyName}",
        },
        knowledgeAssets: [],
      };
    }

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
          autoBlacklist: true,
          emailDigest: true,
          slackAlerts: true,
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
        aiSignature: settings.aiSignature,
        aiGoals: settings.aiGoals,
        serviceDescription: settings.serviceDescription,
        qualificationQuestions: settings.qualificationQuestions,
        companyName: settings.companyName,
        targetResult: settings.targetResult,
        autoApproveMeetings: settings.autoApproveMeetings,
        flagUncertainReplies: settings.flagUncertainReplies,
        pauseForOOO: settings.pauseForOOO,
        autoBlacklist: settings.autoBlacklist,
        emailDigest: settings.emailDigest,
        slackAlerts: settings.slackAlerts,
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

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: {
        aiPersonaName: data.aiPersonaName,
        aiTone: data.aiTone,
        aiGreeting: data.aiGreeting,
        aiSignature: data.aiSignature,
        aiGoals: data.aiGoals,
        serviceDescription: data.serviceDescription,
        qualificationQuestions: data.qualificationQuestions,
        companyName: data.companyName,
        targetResult: data.targetResult,
        autoApproveMeetings: data.autoApproveMeetings,
        flagUncertainReplies: data.flagUncertainReplies,
        pauseForOOO: data.pauseForOOO,
        autoBlacklist: data.autoBlacklist,
        emailDigest: data.emailDigest,
        slackAlerts: data.slackAlerts,
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
      },
      create: {
        clientId,
        aiPersonaName: data.aiPersonaName,
        aiTone: data.aiTone ?? "friendly-professional",
        aiGreeting: data.aiGreeting,
        aiSignature: data.aiSignature,
        aiGoals: data.aiGoals,
        serviceDescription: data.serviceDescription,
        qualificationQuestions: data.qualificationQuestions,
        companyName: data.companyName,
        targetResult: data.targetResult,
        autoApproveMeetings: data.autoApproveMeetings ?? true,
        flagUncertainReplies: data.flagUncertainReplies ?? true,
        pauseForOOO: data.pauseForOOO ?? true,
        autoBlacklist: data.autoBlacklist ?? true,
        emailDigest: data.emailDigest ?? true,
        slackAlerts: data.slackAlerts ?? true,
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
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) {
      return { success: false, error: "No workspace selected" };
    }

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: {
        aiPersonaName: data.name,
        aiTone: data.tone,
        aiGreeting: data.greeting,
      },
      create: {
        clientId,
        aiPersonaName: data.name,
        aiTone: data.tone ?? "friendly-professional",
        aiGreeting: data.greeting,
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

/**
 * Update extracted text content for a knowledge asset
 */
export async function updateAssetTextContent(
  assetId: string,
  textContent: string
): Promise<{ success: boolean; error?: string }> {
  try {
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
    lowerUrl.includes(".highlevel.")
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

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to set default calendar link:", error);
    return { success: false, error: "Failed to set default calendar" };
  }
}
