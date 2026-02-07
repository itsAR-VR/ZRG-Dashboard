"use server";

import { prisma } from "@/lib/prisma";
import { isTrueSuperAdminUser, requireAuthUser } from "@/lib/workspace-access";

export type AutoSendRevisionRolloutSettings = {
  autoSendRevisionEnabled: boolean;
  globallyDisabled: boolean;
};

function isAutoSendRevisionGloballyDisabled(): boolean {
  return process.env.AUTO_SEND_REVISION_DISABLED === "1";
}

async function requireTrueSuperAdmin(): Promise<void> {
  const user = await requireAuthUser();
  if (!isTrueSuperAdminUser(user)) {
    throw new Error("Unauthorized");
  }
}

export async function getAutoSendRevisionRolloutSettings(
  clientId: string | null | undefined
): Promise<{ success: boolean; data?: AutoSendRevisionRolloutSettings; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    const settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: { autoSendRevisionEnabled: true },
    });

    return {
      success: true,
      data: {
        autoSendRevisionEnabled: Boolean(settings?.autoSendRevisionEnabled),
        globallyDisabled: isAutoSendRevisionGloballyDisabled(),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load settings" };
  }
}

export async function updateAutoSendRevisionRolloutSettings(
  clientId: string | null | undefined,
  patch: Partial<Pick<AutoSendRevisionRolloutSettings, "autoSendRevisionEnabled">>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      create: {
        clientId,
        autoSendRevisionEnabled: Boolean(patch.autoSendRevisionEnabled ?? false),
      },
      update: {
        ...(patch.autoSendRevisionEnabled !== undefined
          ? { autoSendRevisionEnabled: Boolean(patch.autoSendRevisionEnabled) }
          : {}),
      },
      select: { id: true },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to update settings" };
  }
}

