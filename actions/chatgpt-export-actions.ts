"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAccess } from "@/lib/workspace-access";
import { revalidatePath } from "next/cache";
import {
  DEFAULT_CHATGPT_EXPORT_OPTIONS,
  normalizeChatgptExportOptions,
  parseChatgptExportOptionsJson,
  serializeChatgptExportOptions,
  type ChatgptExportOptions,
} from "@/lib/chatgpt-export";

export async function getChatgptExportDefaults(
  clientId: string | null | undefined
): Promise<{ success: boolean; data?: { options: ChatgptExportOptions; isSaved: boolean }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };

    await requireClientAccess(clientId);

    const settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: { chatgptExportDefaults: true },
    });

    const parsed = parseChatgptExportOptionsJson(settings?.chatgptExportDefaults || null);
    if (!parsed) {
      return { success: true, data: { options: DEFAULT_CHATGPT_EXPORT_OPTIONS, isSaved: false } };
    }

    return { success: true, data: { options: parsed, isSaved: true } };
  } catch (error) {
    console.error("[ChatGPTExportDefaults] Failed to load:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to load export defaults" };
  }
}

export async function setChatgptExportDefaults(
  clientId: string | null | undefined,
  options: unknown
): Promise<{ success: boolean; data?: { options: ChatgptExportOptions }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };

    await requireClientAccess(clientId);

    const normalized = normalizeChatgptExportOptions(options);

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      update: {
        chatgptExportDefaults: serializeChatgptExportOptions(normalized),
      },
      create: {
        clientId,
        chatgptExportDefaults: serializeChatgptExportOptions(normalized),
      },
    });

    revalidatePath("/");
    return { success: true, data: { options: normalized } };
  } catch (error) {
    console.error("[ChatGPTExportDefaults] Failed to save:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to save export defaults" };
  }
}

