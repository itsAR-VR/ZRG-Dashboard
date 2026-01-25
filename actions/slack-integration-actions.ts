"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAdminAccess } from "@/lib/workspace-access";
import { slackAuthTest, slackListConversations, type SlackConversation } from "@/lib/slack-bot";

function maskToken(token: string): { masked: string; last4: string | null } {
  const trimmed = token.trim();
  if (!trimmed) return { masked: "", last4: null };
  const last4 = trimmed.length >= 4 ? trimmed.slice(-4) : trimmed;
  return { masked: `••••••••••••${last4}`, last4 };
}

export async function getSlackBotTokenStatus(clientId: string): Promise<{
  success: boolean;
  configured?: boolean;
  masked?: string | null;
  last4?: string | null;
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { slackBotToken: true },
    });

    const token = (client?.slackBotToken || "").trim();
    if (!token) return { success: true, configured: false, masked: null, last4: null };

    const masked = maskToken(token);
    return { success: true, configured: true, masked: masked.masked, last4: masked.last4 };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load Slack status" };
  }
}

export async function updateSlackBotToken(
  clientId: string,
  token: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);

    const normalized = (token || "").trim();
    if (!normalized) {
      await prisma.client.update({
        where: { id: clientId },
        data: { slackBotToken: null },
      });
      return { success: true };
    }

    // Validate token against Slack API before saving.
    const auth = await slackAuthTest(normalized);
    if (!auth.success) return { success: false, error: auth.error || "Slack token validation failed" };

    await prisma.client.update({
      where: { id: clientId },
      data: { slackBotToken: normalized },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to update Slack token" };
  }
}

export async function listSlackChannelsForWorkspace(clientId: string): Promise<{
  success: boolean;
  channels?: Array<Pick<SlackConversation, "id" | "name" | "is_private" | "is_member">>;
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { slackBotToken: true },
    });
    const token = (client?.slackBotToken || "").trim();
    if (!token) return { success: false, error: "Slack bot token not configured" };

    const result = await slackListConversations({ token, types: ["public_channel", "private_channel"] });
    if (!result.success) return { success: false, error: result.error || "Failed to list Slack channels" };

    const channels =
      result.channels
        ?.filter((c) => c?.id && c?.name)
        .map((c) => ({
          id: c.id,
          name: c.name,
          is_private: c.is_private,
          is_member: c.is_member,
        })) ?? [];

    channels.sort((a, b) => a.name.localeCompare(b.name));

    return { success: true, channels };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to list Slack channels" };
  }
}

