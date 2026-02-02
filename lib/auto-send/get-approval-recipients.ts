import "server-only";

import { prisma } from "@/lib/prisma";

export type SlackApprovalRecipient = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  email?: string;
};

export function normalizeSlackApprovalRecipients(value: unknown): SlackApprovalRecipient[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SlackApprovalRecipient[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const displayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
    if (!id || !displayName) continue;
    if (seen.has(id)) continue;
    const email = typeof raw.email === "string" && raw.email.trim() ? raw.email.trim() : undefined;
    const avatarUrl = typeof raw.avatarUrl === "string" && raw.avatarUrl.trim() ? raw.avatarUrl.trim() : undefined;

    out.push({
      id,
      displayName,
      ...(email ? { email } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    });
    seen.add(id);
  }

  return out;
}

export async function getConfiguredApprovalRecipients(clientId: string): Promise<SlackApprovalRecipient[]> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { slackAutoSendApprovalRecipients: true },
  });

  return normalizeSlackApprovalRecipients(settings?.slackAutoSendApprovalRecipients ?? null);
}

export async function getSlackAutoSendApprovalConfig(clientId: string): Promise<{
  token: string | null;
  recipients: SlackApprovalRecipient[];
  skipReason?: "no_token" | "no_recipients";
}> {
  const [client, recipients] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { slackBotToken: true } }),
    getConfiguredApprovalRecipients(clientId),
  ]);

  const token = (client?.slackBotToken || "").trim() || null;
  if (!token) {
    return { token: null, recipients, skipReason: "no_token" };
  }
  if (!recipients.length) {
    return { token, recipients, skipReason: "no_recipients" };
  }

  return { token, recipients };
}
