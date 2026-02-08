import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPublicAppUrl } from "@/lib/app-url";
import {
  createCalendlyWebhookSubscription,
  deleteCalendlyWebhookSubscription,
  getCalendlyUserMe,
  getCalendlyWebhookSubscription,
} from "@/lib/calendly-api";

function getProvidedSecret(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token) return token;

  const headerSecret =
    request.headers.get("x-admin-secret") ??
    request.headers.get("x-cron-secret");
  if (headerSecret) return headerSecret;

  const url = new URL(request.url);
  return url.searchParams.get("secret") || null;
}

type FixResult = {
  clientId: string;
  clientName: string;
  success: boolean;
  action?: "recreated" | "already_valid" | "skipped";
  error?: string;
  hasSigningKey?: boolean;
};

export async function POST(request: NextRequest) {
  const expectedSecret =
    process.env.ADMIN_ACTIONS_SECRET ??
    process.env.WORKSPACE_PROVISIONING_SECRET ??
    process.env.CRON_SECRET ??
    null;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Server misconfigured: set ADMIN_ACTIONS_SECRET" },
      { status: 500 }
    );
  }

  const providedSecret = getProvidedSecret(request);
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vercelEnv = process.env.VERCEL_ENV;
  const isProduction = vercelEnv ? vercelEnv === "production" : process.env.NODE_ENV === "production";

  // Find all clients with Calendly access tokens but missing signing keys
  const clientsToFix = await prisma.client.findMany({
    where: {
      calendlyAccessToken: { not: null },
      OR: [
        { calendlyWebhookSigningKey: null },
        { calendlyWebhookSigningKey: "" },
      ],
    },
    select: {
      id: true,
      name: true,
      calendlyAccessToken: true,
      calendlyOrganizationUri: true,
      calendlyUserUri: true,
      calendlyWebhookSubscriptionUri: true,
      calendlyWebhookSigningKey: true,
    },
  });

  if (clientsToFix.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No clients need fixing",
      results: [],
    });
  }

  const baseUrl = getPublicAppUrl();
  const results: FixResult[] = [];

  for (const client of clientsToFix) {
    const result: FixResult = {
      clientId: client.id,
      clientName: client.name,
      success: false,
    };

    try {
      if (!client.calendlyAccessToken) {
        result.error = "No access token";
        result.action = "skipped";
        results.push(result);
        continue;
      }

      const webhookUrl = `${baseUrl}/api/webhooks/calendly/${encodeURIComponent(client.id)}`;

      // Get current user info to ensure we have org URI
      const me = await getCalendlyUserMe(client.calendlyAccessToken);
      if (!me.success) {
        result.error = `Failed to get Calendly user: ${me.error}`;
        results.push(result);
        continue;
      }

      let subscriptionUri: string | null = client.calendlyWebhookSubscriptionUri;
      let signingKey: string | null = null;

      // If existing subscription, delete it (we need to recreate to get signing key)
      if (subscriptionUri) {
        // Verify it exists before deleting
        const existing = await getCalendlyWebhookSubscription(
          client.calendlyAccessToken,
          subscriptionUri
        );
        if (existing.success) {
          console.log(`[fix-calendly-webhooks] Deleting existing webhook for ${client.name}`);
          await deleteCalendlyWebhookSubscription(
            client.calendlyAccessToken,
            subscriptionUri
          ).catch(() => undefined);
        }
        subscriptionUri = null;
      }

      // Create new webhook subscription
      console.log(`[fix-calendly-webhooks] Creating new webhook for ${client.name}`);
      const created = await createCalendlyWebhookSubscription(
        client.calendlyAccessToken,
        {
          url: webhookUrl,
          events: ["invitee.created", "invitee.canceled"],
          organizationUri: me.data.organizationUri,
          scope: "organization",
        }
      );

      if (!created.success) {
        result.error = `Failed to create webhook: ${created.error}`;
        results.push(result);
        continue;
      }

      subscriptionUri = created.data.uri;
      if (typeof created.data.signing_key === "string" && created.data.signing_key.trim()) {
        signingKey = created.data.signing_key.trim();
      }

      // Enforce signing key presence in production. If Calendly doesn't return one,
      // delete the subscription to avoid leaving an unverifiable webhook in place.
      if (!signingKey && isProduction) {
        if (subscriptionUri) {
          await deleteCalendlyWebhookSubscription(client.calendlyAccessToken, subscriptionUri).catch(() => undefined);
          subscriptionUri = null;
        }

        await prisma.client.update({
          where: { id: client.id },
          data: {
            calendlyUserUri: me.data.userUri,
            calendlyOrganizationUri: me.data.organizationUri,
            calendlyWebhookSubscriptionUri: null,
            calendlyWebhookSigningKey: null,
          },
        });

        result.error = "Webhook created but Calendly did not return signing key (deleted subscription; cannot enforce verification in production)";
        result.action = "recreated";
        result.hasSigningKey = false;
        results.push(result);
        continue;
      }

      // Update the client record
      await prisma.client.update({
        where: { id: client.id },
        data: {
          calendlyUserUri: me.data.userUri,
          calendlyOrganizationUri: me.data.organizationUri,
          calendlyWebhookSubscriptionUri: subscriptionUri,
          calendlyWebhookSigningKey: signingKey,
        },
      });

      result.success = true;
      result.action = "recreated";
      result.hasSigningKey = !!signingKey;

      if (!signingKey) {
        result.error = "Webhook created but Calendly did not return signing key";
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Unknown error";
    }

    results.push(result);
  }

  const successCount = results.filter((r) => r.success && r.hasSigningKey).length;
  const failCount = results.filter((r) => !r.success).length;
  const noKeyCount = results.filter((r) => r.success && !r.hasSigningKey).length;

  return NextResponse.json({
    ok: failCount === 0 && noKeyCount === 0,
    message: `Fixed ${successCount}/${clientsToFix.length} clients`,
    summary: {
      total: clientsToFix.length,
      success: successCount,
      failed: failCount,
      noSigningKey: noKeyCount,
    },
    results,
  });
}

export async function GET(request: NextRequest) {
  const expectedSecret =
    process.env.ADMIN_ACTIONS_SECRET ??
    process.env.WORKSPACE_PROVISIONING_SECRET ??
    process.env.CRON_SECRET ??
    null;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Server misconfigured: set ADMIN_ACTIONS_SECRET" },
      { status: 500 }
    );
  }

  const providedSecret = getProvidedSecret(request);
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // List clients that need fixing (dry run)
  const clientsToFix = await prisma.client.findMany({
    where: {
      calendlyAccessToken: { not: null },
      OR: [
        { calendlyWebhookSigningKey: null },
        { calendlyWebhookSigningKey: "" },
      ],
    },
    select: {
      id: true,
      name: true,
      calendlyWebhookSubscriptionUri: true,
    },
  });

  return NextResponse.json({
    ok: true,
    message: `${clientsToFix.length} clients need Calendly webhook signing key fix`,
    clients: clientsToFix.map((c) => ({
      id: c.id,
      name: c.name,
      hasExistingWebhook: !!c.calendlyWebhookSubscriptionUri,
    })),
  });
}
