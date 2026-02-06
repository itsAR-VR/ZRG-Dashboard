"use server";

import { prisma } from "@/lib/prisma";
import { requireAuthUser, isTrueSuperAdminUser } from "@/lib/workspace-access";
import { isLeadContextBundleGloballyDisabled } from "@/lib/lead-context-bundle";
import { Prisma } from "@prisma/client";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export type LeadContextBundleRolloutSettings = {
  leadContextBundleEnabled: boolean;
  followupBookingGateEnabled: boolean;
  leadContextBundleBudgets: unknown | null;
  globallyDisabled: boolean;
};

async function requireTrueSuperAdmin(): Promise<void> {
  const user = await requireAuthUser();
  if (!isTrueSuperAdminUser(user)) {
    throw new Error("Unauthorized");
  }
}

export async function getLeadContextBundleRolloutSettings(
  clientId: string | null | undefined
): Promise<{ success: boolean; data?: LeadContextBundleRolloutSettings; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    const settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: {
        leadContextBundleEnabled: true,
        followupBookingGateEnabled: true,
        leadContextBundleBudgets: true,
      },
    });

    return {
      success: true,
      data: {
        leadContextBundleEnabled: Boolean(settings?.leadContextBundleEnabled),
        followupBookingGateEnabled: Boolean(settings?.followupBookingGateEnabled),
        leadContextBundleBudgets: settings?.leadContextBundleBudgets ?? null,
        globallyDisabled: isLeadContextBundleGloballyDisabled(),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load settings" };
  }
}

export async function updateLeadContextBundleRolloutSettings(
  clientId: string | null | undefined,
  patch: Partial<Pick<LeadContextBundleRolloutSettings, "leadContextBundleEnabled" | "followupBookingGateEnabled" | "leadContextBundleBudgets">>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireTrueSuperAdmin();

    const nextBudgets =
      patch.leadContextBundleBudgets === undefined
        ? undefined
        : patch.leadContextBundleBudgets === null
          ? Prisma.JsonNull
          : isPlainObject(patch.leadContextBundleBudgets)
            ? (patch.leadContextBundleBudgets as Prisma.InputJsonValue)
            : Prisma.JsonNull;

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      create: {
        clientId,
        leadContextBundleEnabled: Boolean(patch.leadContextBundleEnabled ?? false),
        followupBookingGateEnabled: Boolean(patch.followupBookingGateEnabled ?? false),
        ...(patch.leadContextBundleBudgets !== undefined ? { leadContextBundleBudgets: nextBudgets } : {}),
      },
      update: {
        ...(patch.leadContextBundleEnabled !== undefined ? { leadContextBundleEnabled: Boolean(patch.leadContextBundleEnabled) } : {}),
        ...(patch.followupBookingGateEnabled !== undefined
          ? { followupBookingGateEnabled: Boolean(patch.followupBookingGateEnabled) }
          : {}),
        ...(patch.leadContextBundleBudgets !== undefined ? { leadContextBundleBudgets: nextBudgets } : {}),
      },
      select: { id: true },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to update settings" };
  }
}
