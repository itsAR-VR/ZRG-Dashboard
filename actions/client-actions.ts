"use server";

import { prisma } from "@/lib/prisma";
import { ClientMemberRole, EmailIntegrationProvider, Prisma } from "@prisma/client";
import { requireAuthUser, getAccessibleClientIdsForUser, isGlobalAdminUser, requireClientAdminAccess } from "@/lib/workspace-access";
import { revalidatePath } from "next/cache";
import { ensureDefaultSequencesIncludeLinkedInStepsForClient } from "@/lib/followup-sequence-linkedin";
import { resolveEmailIntegrationProvider } from "@/lib/email-integration";

export interface ClientData {
  name: string;
  ghlLocationId: string;
  ghlPrivateKey: string;
  emailProvider?: EmailIntegrationProvider | null;
  emailBisonApiKey?: string;
  emailBisonWorkspaceId?: string;
  emailBisonBaseHostId?: string | null;
  smartLeadApiKey?: string;
  smartLeadWebhookSecret?: string;
  instantlyApiKey?: string;
  instantlyWebhookSecret?: string;
  unipileAccountId?: string;
  calendlyAccessToken?: string;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim();
}

function normalizeEmailBisonWorkspaceId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim().replace(/^#\s*/, "");
}

function normalizeOptionalId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function validateEmailBisonWorkspaceId(value: string | undefined): string | null {
  const normalized = normalizeEmailBisonWorkspaceId(value);
  if (normalized === undefined) return null;
  if (normalized === "") return null;
  if (!/^\d+$/.test(normalized)) return "EmailBison Workspace ID must be a numeric value";
  return null;
}

function parseEmailProvider(value: unknown): EmailIntegrationProvider | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (value === EmailIntegrationProvider.EMAILBISON) return EmailIntegrationProvider.EMAILBISON;
  if (value === EmailIntegrationProvider.SMARTLEAD) return EmailIntegrationProvider.SMARTLEAD;
  if (value === EmailIntegrationProvider.INSTANTLY) return EmailIntegrationProvider.INSTANTLY;
  return undefined;
}

function hasValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function assertProviderRequirements(
  provider: EmailIntegrationProvider,
  snapshot: {
    smartLeadApiKey: string | null;
    smartLeadWebhookSecret: string | null;
    instantlyApiKey: string | null;
    instantlyWebhookSecret: string | null;
  }
) {
  if (provider === EmailIntegrationProvider.SMARTLEAD) {
    if (!hasValue(snapshot.smartLeadApiKey)) {
      throw new Error("SmartLead API key is required when emailProvider is SMARTLEAD");
    }
    if (!hasValue(snapshot.smartLeadWebhookSecret)) {
      throw new Error("SmartLead webhook secret is required when emailProvider is SMARTLEAD");
    }
  }

  if (provider === EmailIntegrationProvider.INSTANTLY) {
    if (!hasValue(snapshot.instantlyApiKey)) {
      throw new Error("Instantly API key is required when emailProvider is INSTANTLY");
    }
    if (!hasValue(snapshot.instantlyWebhookSecret)) {
      throw new Error("Instantly webhook secret is required when emailProvider is INSTANTLY");
    }
  }
}

/**
 * Fetch all GHL clients/workspaces owned by the current user
 */
export async function getClients() {
  try {
    const user = await requireAuthUser();
    const clientIds = await getAccessibleClientIdsForUser(user.id);
    if (clientIds.length === 0) return { success: true, data: [] };

    const [clients, adminMemberships] = await Promise.all([
      prisma.client.findMany({
        where: { id: { in: clientIds } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          userId: true,
          ghlLocationId: true,
          ghlPrivateKey: true,
          emailProvider: true,
          emailBisonApiKey: true,
          emailBisonWorkspaceId: true,
          emailBisonBaseHostId: true,
          smartLeadApiKey: true,
          smartLeadWebhookSecret: true,
          instantlyApiKey: true,
          instantlyWebhookSecret: true,
          unipileAccountId: true,
          unipileConnectionStatus: true,
          calendlyAccessToken: true,
          calendlyWebhookSubscriptionUri: true,
          createdAt: true,
          settings: {
            select: {
              brandName: true,
              brandLogoUrl: true,
            },
          },
          calendarLinks: {
            where: { isDefault: true },
            select: { id: true },
            take: 1,
          },
          _count: {
            select: { leads: true },
          },
        },
      }),
      prisma.clientMember.findMany({
        where: { userId: user.id, clientId: { in: clientIds }, role: ClientMemberRole.ADMIN },
        select: { clientId: true },
      }),
    ]);
    const adminClientIds = new Set(adminMemberships.map((row) => row.clientId));

    const withHealth = clients.map((client) => {
      const {
        calendarLinks,
        calendlyAccessToken,
        calendlyWebhookSubscriptionUri,
        ghlPrivateKey,
        emailBisonApiKey,
        smartLeadApiKey,
        smartLeadWebhookSecret,
        instantlyApiKey,
        instantlyWebhookSecret,
        settings,
        userId,
        ...rest
      } = client;

      const hasGhlLocationId = Boolean((client.ghlLocationId ?? "").trim());
      const hasGhlPrivateKey = Boolean((ghlPrivateKey ?? "").trim());
      const hasGhlIntegration = hasGhlLocationId && hasGhlPrivateKey;
      const isWorkspaceAdmin = userId === user.id || adminClientIds.has(client.id);
      return {
        ...rest,
        hasDefaultCalendarLink: calendarLinks.length > 0,
        hasCalendlyAccessToken: !!calendlyAccessToken,
        hasCalendlyWebhookSubscription: !!calendlyWebhookSubscriptionUri,
        hasGhlLocationId,
        hasGhlPrivateKey,
        hasGhlIntegration,
        hasEmailBisonApiKey: !!emailBisonApiKey,
        hasSmartLeadApiKey: !!smartLeadApiKey,
        hasSmartLeadWebhookSecret: !!smartLeadWebhookSecret,
        hasInstantlyApiKey: !!instantlyApiKey,
        hasInstantlyWebhookSecret: !!instantlyWebhookSecret,
        brandName: settings?.brandName ?? null,
        brandLogoUrl: settings?.brandLogoUrl ?? null,
        hasConnectedAccounts: Boolean(
          hasGhlIntegration ||
            !!calendlyAccessToken ||
            !!emailBisonApiKey ||
            !!smartLeadApiKey ||
            !!smartLeadWebhookSecret ||
            !!instantlyApiKey ||
            !!instantlyWebhookSecret ||
            (client.unipileAccountId ?? "").trim()
        ),
        unipileConnectionStatus: client.unipileConnectionStatus,
        isWorkspaceAdmin,
      };
    });
    return { success: true, data: withHealth };
  } catch (error) {
    console.error("Failed to fetch clients:", error);
    return { success: false, error: "Failed to fetch clients" };
  }
}

/**
 * Create a new GHL client/workspace for the current user
 */
export async function createClient(data: ClientData) {
  try {
    const user = await requireAuthUser();
    const isAdmin = await isGlobalAdminUser(user.id);
    if (!isAdmin) return { success: false, error: "Unauthorized" };

    const name = data.name?.trim();
    const ghlLocationId = data.ghlLocationId?.trim();
    const ghlPrivateKey = data.ghlPrivateKey?.trim();
    const emailProviderRaw = (data as unknown as { emailProvider?: unknown }).emailProvider;
    const emailProviderInput = parseEmailProvider(emailProviderRaw);
    const emailBisonApiKey = normalizeOptionalString(data.emailBisonApiKey);
    const emailBisonWorkspaceId = normalizeEmailBisonWorkspaceId(data.emailBisonWorkspaceId);
    const emailBisonBaseHostId = normalizeOptionalId(data.emailBisonBaseHostId);
    const smartLeadApiKey = normalizeOptionalString(data.smartLeadApiKey);
    const smartLeadWebhookSecret = normalizeOptionalString(data.smartLeadWebhookSecret);
    const instantlyApiKey = normalizeOptionalString(data.instantlyApiKey);
    const instantlyWebhookSecret = normalizeOptionalString(data.instantlyWebhookSecret);
    const unipileAccountId = normalizeOptionalString(data.unipileAccountId);
    const calendlyAccessToken = normalizeOptionalString(data.calendlyAccessToken);

    // Validate required fields
    if (!name || !ghlLocationId || !ghlPrivateKey) {
      return { success: false, error: "Missing required fields" };
    }

    if (emailProviderRaw !== undefined && emailProviderInput === undefined) {
      return { success: false, error: "Invalid emailProvider value" };
    }

    const workspaceIdError = validateEmailBisonWorkspaceId(emailBisonWorkspaceId);
    if (workspaceIdError) {
      return { success: false, error: workspaceIdError };
    }

    // Check if location ID already exists
    const existing = await prisma.client.findUnique({
      where: { ghlLocationId },
    });

    if (existing) {
      return { success: false, error: "A workspace with this Location ID already exists" };
    }

    let resolvedProvider: EmailIntegrationProvider | null;
    try {
      resolvedProvider = resolveEmailIntegrationProvider({
        emailProvider: emailProviderInput ?? undefined,
        emailBisonApiKey,
        emailBisonWorkspaceId,
        smartLeadApiKey,
        smartLeadWebhookSecret,
        instantlyApiKey,
        instantlyWebhookSecret,
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Invalid email integration configuration",
      };
    }

    if (resolvedProvider === EmailIntegrationProvider.SMARTLEAD || resolvedProvider === EmailIntegrationProvider.INSTANTLY) {
      try {
        assertProviderRequirements(resolvedProvider, {
          smartLeadApiKey: smartLeadApiKey || null,
          smartLeadWebhookSecret: smartLeadWebhookSecret || null,
          instantlyApiKey: instantlyApiKey || null,
          instantlyWebhookSecret: instantlyWebhookSecret || null,
        });
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Invalid email integration configuration" };
      }
    }

    if (resolvedProvider === EmailIntegrationProvider.EMAILBISON && emailBisonWorkspaceId) {
      const existingWithWorkspaceId = await prisma.client.findUnique({
        where: { emailBisonWorkspaceId },
      });
      if (existingWithWorkspaceId) {
        return { success: false, error: "A workspace with this EmailBison Workspace ID already exists" };
      }
    }

    if (resolvedProvider === EmailIntegrationProvider.EMAILBISON && emailBisonBaseHostId) {
      const exists = await prisma.emailBisonBaseHost.findUnique({
        where: { id: emailBisonBaseHostId },
        select: { id: true },
      });
      if (!exists) {
        return { success: false, error: "Selected EmailBison base host not found" };
      }
    }

    const emailBisonBaseHostConnect =
      resolvedProvider === EmailIntegrationProvider.EMAILBISON && emailBisonBaseHostId
        ? { emailBisonBaseHost: { connect: { id: emailBisonBaseHostId } } }
        : {};

    // Create the client/workspace with userId
    const client = await prisma.client.create({
      data: {
        name,
        ghlLocationId,
        ghlPrivateKey,
        emailProvider: resolvedProvider,
        emailBisonApiKey: resolvedProvider === EmailIntegrationProvider.EMAILBISON ? (emailBisonApiKey || null) : null,
        emailBisonWorkspaceId: resolvedProvider === EmailIntegrationProvider.EMAILBISON ? (emailBisonWorkspaceId || null) : null,
        smartLeadApiKey: resolvedProvider === EmailIntegrationProvider.SMARTLEAD ? (smartLeadApiKey || null) : null,
        smartLeadWebhookSecret: resolvedProvider === EmailIntegrationProvider.SMARTLEAD ? (smartLeadWebhookSecret || null) : null,
        instantlyApiKey: resolvedProvider === EmailIntegrationProvider.INSTANTLY ? (instantlyApiKey || null) : null,
        instantlyWebhookSecret: resolvedProvider === EmailIntegrationProvider.INSTANTLY ? (instantlyWebhookSecret || null) : null,
        ...emailBisonBaseHostConnect,
        unipileAccountId: unipileAccountId || null,
        calendlyAccessToken: calendlyAccessToken || null,
        userId: user.id, // Workspace owner (admin)
      },
    });

    // Create default workspace settings
    await prisma.workspaceSettings.create({
      data: {
        clientId: client.id,
      },
    });

    revalidatePath("/");
    return { success: true, data: client };
  } catch (error) {
    console.error("Failed to create client:", error);
    return { success: false, error: "Failed to create workspace" };
  }
}

/**
 * Update an existing client/workspace (only if owned by current user)
 */
export async function updateClient(id: string, data: Partial<ClientData>) {
  try {
    await requireClientAdminAccess(id);
    const client = await prisma.client.findFirst({ where: { id } });
    if (!client) return { success: false, error: "Workspace not found" };

    const name = normalizeOptionalString(data.name);
    const ghlLocationId = normalizeOptionalString(data.ghlLocationId);
    const ghlPrivateKey = normalizeOptionalString(data.ghlPrivateKey);
    const emailProviderRaw = (data as unknown as { emailProvider?: unknown }).emailProvider;
    const emailProviderInput = parseEmailProvider(emailProviderRaw);
    const emailBisonApiKey = normalizeOptionalString(data.emailBisonApiKey);
    const emailBisonWorkspaceId = normalizeEmailBisonWorkspaceId(data.emailBisonWorkspaceId);
    const emailBisonBaseHostId = normalizeOptionalId(data.emailBisonBaseHostId);
    const smartLeadApiKey = normalizeOptionalString(data.smartLeadApiKey);
    const smartLeadWebhookSecret = normalizeOptionalString(data.smartLeadWebhookSecret);
    const instantlyApiKey = normalizeOptionalString(data.instantlyApiKey);
    const instantlyWebhookSecret = normalizeOptionalString(data.instantlyWebhookSecret);
    const unipileAccountId = normalizeOptionalString(data.unipileAccountId);
    const calendlyAccessToken = normalizeOptionalString(data.calendlyAccessToken);

    if (name !== undefined && !name) return { success: false, error: "Workspace name cannot be empty" };
    if (ghlLocationId !== undefined && !ghlLocationId) return { success: false, error: "GHL Location ID cannot be empty" };
    if (ghlPrivateKey !== undefined && !ghlPrivateKey) return { success: false, error: "GHL Private Integration Key cannot be empty" };

    if (emailProviderRaw !== undefined && emailProviderInput === undefined) {
      return { success: false, error: "Invalid emailProvider value" };
    }

    const workspaceIdError = validateEmailBisonWorkspaceId(emailBisonWorkspaceId);
    if (workspaceIdError) {
      return { success: false, error: workspaceIdError };
    }

    // If ghlLocationId is being changed, check for uniqueness
    if (ghlLocationId !== undefined && ghlLocationId !== client.ghlLocationId) {
      const existingWithLocationId = await prisma.client.findUnique({
        where: { ghlLocationId },
      });
      if (existingWithLocationId) {
        return { success: false, error: "A workspace with this Location ID already exists" };
      }
    }

    // Build update data, only including fields that are provided
    const updateData: Prisma.ClientUpdateInput = {};
    if (name !== undefined) updateData.name = name;
    if (ghlLocationId !== undefined) updateData.ghlLocationId = ghlLocationId;
    if (ghlPrivateKey !== undefined) updateData.ghlPrivateKey = ghlPrivateKey;
    if (data.unipileAccountId !== undefined) updateData.unipileAccountId = unipileAccountId || null;
    if (data.calendlyAccessToken !== undefined) {
      updateData.calendlyAccessToken = calendlyAccessToken || null;
      if (!calendlyAccessToken) {
        updateData.calendlyUserUri = null;
        updateData.calendlyOrganizationUri = null;
        updateData.calendlyWebhookSubscriptionUri = null;
        updateData.calendlyWebhookSigningKey = null;
      }
    }

    const emailIntegrationTouched =
      (data as unknown as Record<string, unknown>).emailProvider !== undefined ||
      data.emailBisonApiKey !== undefined ||
      data.emailBisonWorkspaceId !== undefined ||
      (data as unknown as Record<string, unknown>).emailBisonBaseHostId !== undefined ||
      data.smartLeadApiKey !== undefined ||
      data.smartLeadWebhookSecret !== undefined ||
      data.instantlyApiKey !== undefined ||
      data.instantlyWebhookSecret !== undefined;

    if (emailIntegrationTouched) {
      // Explicitly clear all providers.
      if ((data as unknown as Record<string, unknown>).emailProvider === null) {
        updateData.emailProvider = null;
        updateData.emailBisonApiKey = null;
        updateData.emailBisonWorkspaceId = null;
        updateData.emailBisonBaseHost = { disconnect: true };
        updateData.smartLeadApiKey = null;
        updateData.smartLeadWebhookSecret = null;
        updateData.instantlyApiKey = null;
        updateData.instantlyWebhookSecret = null;
      } else {
        const nextSnapshot = {
          emailProvider: emailProviderInput ?? client.emailProvider ?? null,
          emailBisonApiKey: data.emailBisonApiKey !== undefined ? (emailBisonApiKey || null) : client.emailBisonApiKey,
          emailBisonWorkspaceId:
            data.emailBisonWorkspaceId !== undefined ? (emailBisonWorkspaceId || null) : client.emailBisonWorkspaceId,
          smartLeadApiKey: data.smartLeadApiKey !== undefined ? (smartLeadApiKey || null) : client.smartLeadApiKey,
          smartLeadWebhookSecret:
            data.smartLeadWebhookSecret !== undefined ? (smartLeadWebhookSecret || null) : client.smartLeadWebhookSecret,
          instantlyApiKey: data.instantlyApiKey !== undefined ? (instantlyApiKey || null) : client.instantlyApiKey,
          instantlyWebhookSecret:
            data.instantlyWebhookSecret !== undefined ? (instantlyWebhookSecret || null) : client.instantlyWebhookSecret,
        };

        let resolvedProvider: EmailIntegrationProvider | null;
        try {
          resolvedProvider = resolveEmailIntegrationProvider(nextSnapshot);
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : "Invalid email integration configuration" };
        }

        updateData.emailProvider = resolvedProvider;

        if (resolvedProvider === EmailIntegrationProvider.SMARTLEAD || resolvedProvider === EmailIntegrationProvider.INSTANTLY) {
          try {
            assertProviderRequirements(resolvedProvider, {
              smartLeadApiKey: nextSnapshot.smartLeadApiKey || null,
              smartLeadWebhookSecret: nextSnapshot.smartLeadWebhookSecret || null,
              instantlyApiKey: nextSnapshot.instantlyApiKey || null,
              instantlyWebhookSecret: nextSnapshot.instantlyWebhookSecret || null,
            });
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : "Invalid email integration configuration" };
          }
        }

        if (resolvedProvider === EmailIntegrationProvider.EMAILBISON) {
          // If emailBisonWorkspaceId is being changed, check for uniqueness
          if (
            emailBisonWorkspaceId !== undefined &&
            emailBisonWorkspaceId !== (client.emailBisonWorkspaceId || "") &&
            emailBisonWorkspaceId !== ""
          ) {
            const existingWithWorkspaceId = await prisma.client.findUnique({
              where: { emailBisonWorkspaceId },
            });
            if (existingWithWorkspaceId) {
              return { success: false, error: "A workspace with this EmailBison Workspace ID already exists" };
            }
          }

          if (data.emailBisonApiKey !== undefined) updateData.emailBisonApiKey = emailBisonApiKey || null;
          if (data.emailBisonWorkspaceId !== undefined) updateData.emailBisonWorkspaceId = emailBisonWorkspaceId || null;
          if ((data as unknown as Record<string, unknown>).emailBisonBaseHostId !== undefined) {
            if (emailBisonBaseHostId) {
              const exists = await prisma.emailBisonBaseHost.findUnique({
                where: { id: emailBisonBaseHostId },
                select: { id: true },
              });
              if (!exists) {
                return { success: false, error: "Selected EmailBison base host not found" };
              }
              updateData.emailBisonBaseHost = { connect: { id: emailBisonBaseHostId } };
            } else {
              updateData.emailBisonBaseHost = { disconnect: true };
            }
          }
          updateData.smartLeadApiKey = null;
          updateData.smartLeadWebhookSecret = null;
          updateData.instantlyApiKey = null;
          updateData.instantlyWebhookSecret = null;
        } else if (resolvedProvider === EmailIntegrationProvider.SMARTLEAD) {
          updateData.emailBisonApiKey = null;
          updateData.emailBisonWorkspaceId = null;
          updateData.emailBisonBaseHost = { disconnect: true };
          if (data.smartLeadApiKey !== undefined) updateData.smartLeadApiKey = smartLeadApiKey || null;
          if (data.smartLeadWebhookSecret !== undefined) updateData.smartLeadWebhookSecret = smartLeadWebhookSecret || null;
          updateData.instantlyApiKey = null;
          updateData.instantlyWebhookSecret = null;
        } else if (resolvedProvider === EmailIntegrationProvider.INSTANTLY) {
          updateData.emailBisonApiKey = null;
          updateData.emailBisonWorkspaceId = null;
          updateData.emailBisonBaseHost = { disconnect: true };
          updateData.smartLeadApiKey = null;
          updateData.smartLeadWebhookSecret = null;
          if (data.instantlyApiKey !== undefined) updateData.instantlyApiKey = instantlyApiKey || null;
          if (data.instantlyWebhookSecret !== undefined) updateData.instantlyWebhookSecret = instantlyWebhookSecret || null;
        } else {
          updateData.emailBisonApiKey = null;
          updateData.emailBisonWorkspaceId = null;
          updateData.emailBisonBaseHost = { disconnect: true };
          updateData.smartLeadApiKey = null;
          updateData.smartLeadWebhookSecret = null;
          updateData.instantlyApiKey = null;
          updateData.instantlyWebhookSecret = null;
        }
      }
    }

    const updatedClient = await prisma.client.update({
      where: { id },
      data: updateData,
    });

    // If LinkedIn is newly configured, auto-augment default follow-up sequences to include LinkedIn steps.
    if (data.unipileAccountId !== undefined) {
      const before = client.unipileAccountId?.trim() || "";
      const after = unipileAccountId?.trim() || "";
      if (!before && !!after) {
        await ensureDefaultSequencesIncludeLinkedInStepsForClient({ prisma, clientId: id });
      }
    }

    revalidatePath("/");
    return { success: true, data: updatedClient };
  } catch (error) {
    console.error("Failed to update client:", error);
    return { success: false, error: "Failed to update workspace" };
  }
}

/**
 * Delete a GHL client/workspace by ID (only if owned by current user)
 */
export async function deleteClient(id: string) {
  try {
    await requireClientAdminAccess(id);

    await prisma.client.delete({
      where: { id },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete client:", error);
    return { success: false, error: "Failed to delete workspace" };
  }
}

/**
 * Get a single client by Location ID (used by webhook - no auth check)
 */
export async function getClientByLocationId(locationId: string) {
  try {
    const client = await prisma.client.findUnique({
      where: { ghlLocationId: locationId },
    });
    return client;
  } catch (error) {
    console.error("Failed to fetch client by location ID:", error);
    return null;
  }
}
