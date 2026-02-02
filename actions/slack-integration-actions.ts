"use server";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireClientAdminAccess } from "@/lib/workspace-access";
import { slackAuthTest, slackListConversations, slackListUsers, type SlackConversation } from "@/lib/slack-bot";
import {
  normalizeSlackApprovalRecipients,
  type SlackApprovalRecipient,
} from "@/lib/auto-send/get-approval-recipients";

const SLACK_MEMBERS_CACHE_TTL_MS = 60 * 60 * 1000;

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

export async function refreshSlackMembersCache(clientId: string): Promise<{
  success: boolean;
  members?: SlackApprovalRecipient[];
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

    const result = await slackListUsers({ token });
    if (!result.success || !result.users) {
      return { success: false, error: result.error || "Failed to fetch Slack members" };
    }

    const members: SlackApprovalRecipient[] = result.users
      .map((user) => {
        const displayName = user.profile?.display_name || user.real_name || user.name || user.id;
        return {
          id: user.id,
          displayName,
          avatarUrl: user.profile?.image_48,
          email: user.profile?.email,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      create: {
        clientId,
        slackMembersCacheJson: members as Prisma.InputJsonValue,
        slackMembersCachedAt: new Date(),
      },
      update: {
        slackMembersCacheJson: members as Prisma.InputJsonValue,
        slackMembersCachedAt: new Date(),
      },
    });

    return { success: true, members };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to refresh Slack members" };
  }
}

export async function getSlackMembers(clientId: string): Promise<{
  success: boolean;
  members?: SlackApprovalRecipient[];
  cachedAt?: Date;
  warning?: string;
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: { slackMembersCacheJson: true, slackMembersCachedAt: true },
    });

    const cachedMembers = normalizeSlackApprovalRecipients(settings?.slackMembersCacheJson ?? null);
    const cachedAt = settings?.slackMembersCachedAt ?? null;
    const cacheAge = cachedAt ? Date.now() - cachedAt.getTime() : Infinity;

    if (cachedMembers.length > 0 && cacheAge < SLACK_MEMBERS_CACHE_TTL_MS) {
      return { success: true, members: cachedMembers, cachedAt: cachedAt ?? undefined };
    }

    const refreshed = await refreshSlackMembersCache(clientId);
    if (refreshed.success) {
      return { success: true, members: refreshed.members, cachedAt: new Date() };
    }

    if (cachedMembers.length > 0) {
      return {
        success: true,
        members: cachedMembers,
        cachedAt: cachedAt ?? undefined,
        warning: refreshed.error || "Slack member refresh failed; showing cached results.",
      };
    }

    return { success: false, error: refreshed.error || "Failed to load Slack members" };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load Slack members" };
  }
}

export async function updateSlackApprovalRecipients(
  clientId: string,
  recipients: SlackApprovalRecipient[]
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);

    const normalized = normalizeSlackApprovalRecipients(recipients);
    if (normalized.length > 50) {
      return { success: false, error: "Too many approval recipients (max 50)." };
    }

    await prisma.workspaceSettings.upsert({
      where: { clientId },
      create: {
        clientId,
        slackAutoSendApprovalRecipients: normalized as Prisma.InputJsonValue,
      },
      update: {
        slackAutoSendApprovalRecipients: normalized as Prisma.InputJsonValue,
      },
    });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to update recipients" };
  }
}

export async function getSlackApprovalRecipients(clientId: string): Promise<{
  success: boolean;
  recipients?: SlackApprovalRecipient[];
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const settings = await prisma.workspaceSettings.findUnique({
      where: { clientId },
      select: { slackAutoSendApprovalRecipients: true },
    });

    const recipients = normalizeSlackApprovalRecipients(settings?.slackAutoSendApprovalRecipients ?? null);
    return { success: true, recipients };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load recipients" };
  }
}
