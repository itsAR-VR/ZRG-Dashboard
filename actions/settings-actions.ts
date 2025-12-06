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
  autoApproveMeetings: boolean;
  flagUncertainReplies: boolean;
  pauseForOOO: boolean;
  autoBlacklist: boolean;
  emailDigest: boolean;
  slackAlerts: boolean;
  timezone: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
}

/**
 * Get workspace settings (or return null if no workspace selected)
 * @param clientId - Workspace/client ID
 */
export async function getUserSettings(clientId?: string | null): Promise<{
  success: boolean;
  data?: UserSettingsData;
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
          autoApproveMeetings: true,
          flagUncertainReplies: true,
          pauseForOOO: true,
          autoBlacklist: true,
          emailDigest: true,
          slackAlerts: true,
          timezone: "America/Los_Angeles",
          workStartTime: "09:00",
          workEndTime: "17:00",
        },
      };
    }

    // Try to find existing settings for this workspace
    let settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
    });

    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.workspaceSettings.create({
        data: {
          clientId,
          aiTone: "friendly-professional",
          aiGoals: null,
          autoApproveMeetings: true,
          flagUncertainReplies: true,
          pauseForOOO: true,
          autoBlacklist: true,
          emailDigest: true,
          slackAlerts: true,
          workStartTime: "09:00",
          workEndTime: "17:00",
        },
      });
    }

    return {
      success: true,
      data: {
        ...settings,
        clientId: settings.clientId,
      },
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
        autoApproveMeetings: data.autoApproveMeetings,
        flagUncertainReplies: data.flagUncertainReplies,
        pauseForOOO: data.pauseForOOO,
        autoBlacklist: data.autoBlacklist,
        emailDigest: data.emailDigest,
        slackAlerts: data.slackAlerts,
        timezone: data.timezone,
        workStartTime: data.workStartTime,
        workEndTime: data.workEndTime,
      },
      create: {
        clientId,
        aiPersonaName: data.aiPersonaName,
        aiTone: data.aiTone ?? "friendly-professional",
        aiGreeting: data.aiGreeting,
        aiSignature: data.aiSignature,
        aiGoals: data.aiGoals,
        autoApproveMeetings: data.autoApproveMeetings ?? true,
        flagUncertainReplies: data.flagUncertainReplies ?? true,
        pauseForOOO: data.pauseForOOO ?? true,
        autoBlacklist: data.autoBlacklist ?? true,
        emailDigest: data.emailDigest ?? true,
        slackAlerts: data.slackAlerts ?? true,
        timezone: data.timezone,
        workStartTime: data.workStartTime ?? "09:00",
        workEndTime: data.workEndTime ?? "17:00",
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
