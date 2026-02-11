"use server";

import { EmailIntegrationProvider } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { fetchEmailBisonReplies, resolveEmailBisonBaseUrl } from "@/lib/emailbison-api";
import { pickEmailBisonReplyUuidForDeepLink } from "@/lib/emailbison-deeplink";
import { resolveEmailIntegrationProvider } from "@/lib/email-integration";
import { requireLeadAccessById } from "@/lib/workspace-access";

export async function resolveEmailBisonReplyUrlForLead(leadId: string): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  try {
    await requireLeadAccessById(leadId);

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        emailBisonLeadId: true,
        client: {
          select: {
            emailProvider: true,
            emailBisonApiKey: true,
            emailBisonWorkspaceId: true,
            smartLeadApiKey: true,
            smartLeadWebhookSecret: true,
            instantlyApiKey: true,
            instantlyWebhookSecret: true,
            emailBisonBaseHost: { select: { host: true } },
          },
        },
      },
    });

    if (!lead) return { success: false, error: "Lead not found" };

    const client = lead.client;
    if (!client) return { success: false, error: "Workspace not found" };

    let provider: EmailIntegrationProvider | null;
    try {
      provider = resolveEmailIntegrationProvider(client);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Invalid email integration configuration",
      };
    }

    if (provider !== EmailIntegrationProvider.EMAILBISON) {
      return { success: false, error: "This workspace is not configured for EmailBison" };
    }

    const apiKey = typeof client.emailBisonApiKey === "string" ? client.emailBisonApiKey.trim() : "";
    if (!apiKey) {
      return { success: false, error: "EmailBison API key is missing. Configure it in Settings → Integrations." };
    }

    const bisonLeadId = typeof lead.emailBisonLeadId === "string" ? lead.emailBisonLeadId.trim() : "";
    if (!bisonLeadId) {
      return { success: false, error: "This lead is not linked to EmailBison" };
    }

    const baseHost = client.emailBisonBaseHost?.host ?? null;

    const [repliesResult, preferredReplyMessage] = await Promise.all([
      fetchEmailBisonReplies(apiKey, bisonLeadId, { baseHost }),
      prisma.message.findFirst({
        where: {
          leadId,
          channel: "email",
          emailBisonReplyId: { not: null },
          NOT: [
            { emailBisonReplyId: { startsWith: "smartlead:" } },
            { emailBisonReplyId: { startsWith: "instantly:" } },
          ],
        },
        orderBy: { sentAt: "desc" },
        select: { emailBisonReplyId: true },
      }),
    ]);

    if (!repliesResult.success) {
      return { success: false, error: repliesResult.error || "Failed to fetch EmailBison replies" };
    }

    const preferredReplyId =
      typeof preferredReplyMessage?.emailBisonReplyId === "string" ? preferredReplyMessage.emailBisonReplyId.trim() : null;
    const uuid = pickEmailBisonReplyUuidForDeepLink({
      replies: repliesResult.data ?? [],
      preferredReplyId,
    });

    if (!uuid) return { success: false, error: "No EmailBison reply UUID found for this lead" };

    const baseOrigin = resolveEmailBisonBaseUrl(baseHost);
    const url = `${baseOrigin}/inbox/replies/${encodeURIComponent(uuid)}`;
    return { success: true, url };
  } catch (error) {
    console.error("[EmailBison] Failed to resolve deep link:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to resolve EmailBison link" };
  }
}

