"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAccess, requireClientAdminAccess } from "@/lib/workspace-access";
import { getPublicAppUrl } from "@/lib/app-url";
import {
  createCalendlyWebhookSubscription,
  deleteCalendlyWebhookSubscription,
  getCalendlyUserMe,
  getCalendlyWebhookSubscription,
} from "@/lib/calendly-api";

export async function getCalendlyIntegrationStatusForWorkspace(clientId: string): Promise<{
  success: boolean;
  data?: {
    hasAccessToken: boolean;
    hasWebhookSubscription: boolean;
    organizationUri: string | null;
    userUri: string | null;
  };
  error?: string;
}> {
  try {
    await requireClientAccess(clientId);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        calendlyAccessToken: true,
        calendlyWebhookSubscriptionUri: true,
        calendlyOrganizationUri: true,
        calendlyUserUri: true,
      },
    });
    if (!client) return { success: false, error: "Workspace not found" };

    return {
      success: true,
      data: {
        hasAccessToken: !!client.calendlyAccessToken,
        hasWebhookSubscription: !!client.calendlyWebhookSubscriptionUri,
        organizationUri: client.calendlyOrganizationUri,
        userUri: client.calendlyUserUri,
      },
    };
  } catch (error) {
    console.error("[Calendly] Failed to get integration status:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to get Calendly status" };
  }
}

export async function testCalendlyConnectionForWorkspace(clientId: string): Promise<{
  success: boolean;
  data?: {
    userUri: string;
    organizationUri: string;
    name: string | null;
    email: string | null;
    timezone: string | null;
  };
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { calendlyAccessToken: true },
    });
    if (!client) return { success: false, error: "Workspace not found" };
    if (!client.calendlyAccessToken) return { success: false, error: "Calendly access token not configured for this workspace" };

    const me = await getCalendlyUserMe(client.calendlyAccessToken);
    if (!me.success) return { success: false, error: me.error };

    await prisma.client.update({
      where: { id: clientId },
      data: {
        calendlyUserUri: me.data.userUri,
        calendlyOrganizationUri: me.data.organizationUri,
      },
    });

    return { success: true, data: me.data };
  } catch (error) {
    console.error("[Calendly] Connection test failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Calendly connection test failed" };
  }
}

export async function ensureCalendlyWebhookSubscriptionForWorkspace(clientId: string): Promise<{
  success: boolean;
  data?: {
    webhookUrl: string;
    subscriptionUri: string;
    hasSigningKey: boolean;
  };
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        calendlyAccessToken: true,
        calendlyOrganizationUri: true,
        calendlyUserUri: true,
        calendlyWebhookSubscriptionUri: true,
        calendlyWebhookSigningKey: true,
      },
    });
    if (!client) return { success: false, error: "Workspace not found" };
    if (!client.calendlyAccessToken) return { success: false, error: "Calendly access token not configured for this workspace" };

    const baseUrl = getPublicAppUrl();
    const webhookUrl = `${baseUrl}/api/webhooks/calendly/${encodeURIComponent(clientId)}`;

    // Ensure we have organization/user URIs cached.
    const me = await getCalendlyUserMe(client.calendlyAccessToken);
    if (!me.success) return { success: false, error: me.error };

    let subscriptionUri: string | null = client.calendlyWebhookSubscriptionUri;
    let signingKey: string | null = client.calendlyWebhookSigningKey;

    // If we have an existing subscription, validate it. If invalid/out-of-date, delete and recreate.
    if (subscriptionUri) {
      const existing = await getCalendlyWebhookSubscription(client.calendlyAccessToken, subscriptionUri);
      if (existing.success) {
        const callbackMatches =
          typeof existing.data.callback_url === "string" ? existing.data.callback_url === webhookUrl : true;
        const hasInviteeEvents = Array.isArray(existing.data.events)
          ? existing.data.events.includes("invitee.created") && existing.data.events.includes("invitee.canceled")
          : true;
        const orgMatches =
          typeof existing.data.organization === "string" ? existing.data.organization === me.data.organizationUri : true;

        if (!callbackMatches || !hasInviteeEvents || !orgMatches) {
          await deleteCalendlyWebhookSubscription(client.calendlyAccessToken, subscriptionUri).catch(() => undefined);
          subscriptionUri = null;
          signingKey = null;
        } else if (typeof existing.data.signing_key === "string" && existing.data.signing_key.trim()) {
          signingKey = existing.data.signing_key.trim();
        }
      } else {
        // Token rotated or subscription deleted.
        subscriptionUri = null;
        signingKey = null;
      }
    }

    if (!subscriptionUri) {
      const created = await createCalendlyWebhookSubscription(client.calendlyAccessToken, {
        url: webhookUrl,
        events: ["invitee.created", "invitee.canceled"],
        organizationUri: me.data.organizationUri,
        scope: "organization",
      });
      if (!created.success) return { success: false, error: created.error };
      subscriptionUri = created.data.uri;
      if (typeof created.data.signing_key === "string" && created.data.signing_key.trim()) {
        signingKey = created.data.signing_key.trim();
      }
    }

    await prisma.client.update({
      where: { id: clientId },
      data: {
        calendlyUserUri: me.data.userUri,
        calendlyOrganizationUri: me.data.organizationUri,
        calendlyWebhookSubscriptionUri: subscriptionUri,
        calendlyWebhookSigningKey: signingKey,
      },
    });

    return {
      success: true,
      data: {
        webhookUrl,
        subscriptionUri,
        hasSigningKey: !!signingKey,
      },
    };
  } catch (error) {
    console.error("[Calendly] Failed to ensure webhook subscription:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to ensure webhook subscription" };
  }
}

