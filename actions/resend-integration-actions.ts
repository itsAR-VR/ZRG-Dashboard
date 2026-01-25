"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAdminAccess } from "@/lib/workspace-access";

function maskApiKey(key: string): { masked: string; last4: string | null } {
  const trimmed = key.trim();
  if (!trimmed) return { masked: "", last4: null };
  const last4 = trimmed.length >= 4 ? trimmed.slice(-4) : trimmed;
  return { masked: `••••••••••••${last4}`, last4 };
}

function isValidEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export async function getResendConfigStatus(clientId: string): Promise<{
  success: boolean;
  configured?: boolean;
  maskedApiKey?: string | null;
  apiKeyLast4?: string | null;
  fromEmail?: string | null;
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { resendApiKey: true, resendFromEmail: true },
    });

    const apiKey = (client?.resendApiKey || "").trim();
    const fromEmail = (client?.resendFromEmail || "").trim();
    const configured = Boolean(apiKey && fromEmail);

    if (!apiKey) {
      return { success: true, configured: false, maskedApiKey: null, apiKeyLast4: null, fromEmail: fromEmail || null };
    }

    const masked = maskApiKey(apiKey);
    return {
      success: true,
      configured,
      maskedApiKey: masked.masked,
      apiKeyLast4: masked.last4,
      fromEmail: fromEmail || null,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load Resend status" };
  }
}

export async function updateResendConfig(
  clientId: string,
  opts: { apiKey?: string | null; fromEmail?: string | null }
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);

    const data: { resendApiKey?: string | null; resendFromEmail?: string | null } = {};

    if (opts.apiKey !== undefined) {
      const apiKey = (opts.apiKey || "").trim();
      data.resendApiKey = apiKey || null;
    }

    if (opts.fromEmail !== undefined) {
      const fromEmail = (opts.fromEmail || "").trim();
      if (fromEmail && !isValidEmailAddress(fromEmail)) {
        return { success: false, error: "Invalid from email" };
      }
      data.resendFromEmail = fromEmail || null;
    }

    if (Object.keys(data).length === 0) return { success: true };

    await prisma.client.update({ where: { id: clientId }, data });

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to update Resend config" };
  }
}
