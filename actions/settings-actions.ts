"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface UserSettingsData {
  id: string;
  userId: string;
  aiPersonaName: string | null;
  aiTone: string | null;
  aiGreeting: string | null;
  aiSignature: string | null;
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
 * Get user settings (or create defaults if none exist)
 */
export async function getUserSettings(): Promise<{
  success: boolean;
  data?: UserSettingsData;
  error?: string;
}> {
  try {
    // Try to find existing settings
    let settings = await prisma.userSettings.findUnique({
      where: { userId: "default" },
    });

    // Create default settings if none exist
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          userId: "default",
          aiTone: "friendly-professional",
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

    return { success: true, data: settings };
  } catch (error) {
    console.error("Failed to fetch user settings:", error);
    return { success: false, error: "Failed to fetch settings" };
  }
}

/**
 * Update user settings
 */
export async function updateUserSettings(
  data: Partial<UserSettingsData>
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.userSettings.upsert({
      where: { userId: "default" },
      update: {
        aiPersonaName: data.aiPersonaName,
        aiTone: data.aiTone,
        aiGreeting: data.aiGreeting,
        aiSignature: data.aiSignature,
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
        userId: "default",
        aiPersonaName: data.aiPersonaName,
        aiTone: data.aiTone ?? "friendly-professional",
        aiGreeting: data.aiGreeting,
        aiSignature: data.aiSignature,
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
    console.error("Failed to update user settings:", error);
    return { success: false, error: "Failed to update settings" };
  }
}

/**
 * Update AI signature
 */
export async function updateAISignature(signature: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    await prisma.userSettings.upsert({
      where: { userId: "default" },
      update: { aiSignature: signature },
      create: {
        userId: "default",
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
 * Update AI personality
 */
export async function updateAIPersonality(data: {
  name?: string;
  tone?: string;
  greeting?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.userSettings.upsert({
      where: { userId: "default" },
      update: {
        aiPersonaName: data.name,
        aiTone: data.tone,
        aiGreeting: data.greeting,
      },
      create: {
        userId: "default",
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
 * Update automation rules
 */
export async function updateAutomationRules(data: {
  autoApproveMeetings?: boolean;
  flagUncertainReplies?: boolean;
  pauseForOOO?: boolean;
  autoBlacklist?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.userSettings.upsert({
      where: { userId: "default" },
      update: data,
      create: {
        userId: "default",
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

