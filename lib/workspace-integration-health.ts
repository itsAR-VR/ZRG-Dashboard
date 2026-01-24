/**
 * Workspace integration health management.
 * Persists integration status (e.g., Unipile disconnected) and sends deduped notifications to admins.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { sendSlackNotification } from "@/lib/slack-notifications";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type UnipileConnectionStatus = "CONNECTED" | "DISCONNECTED" | "UNKNOWN";

interface UpdateUnipileHealthOpts {
  clientId: string;
  isDisconnected: boolean;
  errorDetail?: string;
}

/**
 * Update Unipile connection health for a workspace.
 * - If disconnected: sets status, error fields, and sends Slack notification (1/day max)
 * - If connected: clears disconnected state
 */
export async function updateUnipileConnectionHealth(opts: UpdateUnipileHealthOpts): Promise<void> {
  const { clientId, isDisconnected, errorDetail } = opts;

  if (isDisconnected) {
    // Mark as disconnected
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        name: true,
        unipileConnectionStatus: true,
        unipileDisconnectedAt: true,
        unipileLastNotifiedAt: true,
        settings: { select: { slackAlerts: true } },
      },
    });

    if (!client) return;

    const now = new Date();
    const wasAlreadyDisconnected = client.unipileConnectionStatus === "DISCONNECTED";
    const lastNotified = client.unipileLastNotifiedAt?.getTime() ?? 0;
    const shouldNotify = !wasAlreadyDisconnected || now.getTime() - lastNotified > ONE_DAY_MS;

    // Update health fields
    await prisma.client.update({
      where: { id: clientId },
      data: {
        unipileConnectionStatus: "DISCONNECTED",
        unipileDisconnectedAt: wasAlreadyDisconnected ? undefined : now,
        unipileLastErrorAt: now,
        unipileLastErrorMessage: errorDetail ?? "Account disconnected",
        ...(shouldNotify ? { unipileLastNotifiedAt: now } : {}),
      },
    });

    // Send Slack notification (deduped to 1/day)
    if (shouldNotify && client.settings?.slackAlerts !== false) {
      console.log(`[Unipile Health] Sending disconnect notification for workspace ${client.name} (${clientId})`);
      await sendSlackNotification({
        text: `🚨 *LinkedIn Integration Disconnected*\n\n*Workspace:* ${client.name}\n*Error:* ${errorDetail || "Account disconnected"}\n\n*Action:* Please visit Settings > Integrations to reconnect your LinkedIn account.`,
      }).catch((err) => {
        console.error(`[Unipile Health] Failed to send Slack notification for ${clientId}:`, err);
      });
    } else if (wasAlreadyDisconnected) {
      console.log(`[Unipile Health] Skipping notification for ${clientId} - already notified within 24h`);
    }
  } else {
    // Mark as connected (clear disconnected state) only when we need to.
    const updated = await prisma.client.updateMany({
      where: { id: clientId, unipileConnectionStatus: { not: "CONNECTED" } },
      data: {
        unipileConnectionStatus: "CONNECTED",
        unipileDisconnectedAt: null,
        // Keep last error fields for debugging context
      },
    });

    if (updated.count > 0) {
      console.log(`[Unipile Health] Workspace ${clientId} reconnected`);
    }
  }
}

/**
 * Check if a workspace's Unipile account is marked as disconnected.
 */
export async function isUnipileDisconnected(clientId: string): Promise<boolean> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { unipileConnectionStatus: true },
  });

  return client?.unipileConnectionStatus === "DISCONNECTED";
}
