"use server";

import { prisma } from "@/lib/prisma";
import { isGlobalAdminUser, requireAuthUser, requireClientAdminAccess } from "@/lib/workspace-access";
import net from "node:net";
import { revalidatePath } from "next/cache";

export type EmailBisonBaseHostRow = {
  id: string;
  host: string;
  label: string | null;
};

const DEFAULT_EMAILBISON_BASE_HOSTS: Array<{ host: string; label: string }> = [
  { host: "send.meetinboxxia.com", label: "Inboxxia (default)" },
  { host: "send.foundersclubsend.com", label: "Founders Club Send" },
];

function normalizeHostInput(value: string): string {
  return value.trim().toLowerCase();
}

function parseHostOnly(value: string): string | null {
  const normalized = normalizeHostInput(value);
  if (!normalized) return null;

  // Allow users to paste a full URL, but only persist the hostname.
  const withScheme = normalized.startsWith("http://") || normalized.startsWith("https://")
    ? normalized
    : `https://${normalized}`;

  try {
    const url = new URL(withScheme);
    return url.hostname;
  } catch {
    return null;
  }
}

function validateEmailBisonBaseHost(hostname: string): string | null {
  const host = normalizeHostInput(hostname);
  if (!host) return "Host is required";
  if (host !== hostname.toLowerCase()) return "Host must be lowercase";
  if (host.includes("..")) return "Host is invalid";
  if (!host.includes(".")) return "Host must be a valid hostname";

  // No ports.
  if (host.includes(":")) return "Host must not include a port";

  // No IP literals.
  if (net.isIP(host) !== 0) return "Host must not be an IP address";

  // Avoid obvious local/dev SSRF targets.
  if (host === "localhost" || host.endsWith(".localhost")) return "Host must not be localhost";
  if (host.endsWith(".local")) return "Host must not be a .local hostname";

  return null;
}

async function ensureDefaultBaseHosts(): Promise<void> {
  try {
    await prisma.emailBisonBaseHost.createMany({
      data: DEFAULT_EMAILBISON_BASE_HOSTS.map((row) => ({ host: row.host, label: row.label })),
      skipDuplicates: true,
    });
  } catch (error) {
    // If this fails due to a race or permissions, just continue; listing can still work.
    console.warn("[EmailBisonBaseHost] Failed to seed defaults:", error);
  }
}

export async function getEmailBisonBaseHosts(): Promise<{
  success: boolean;
  data?: EmailBisonBaseHostRow[];
  error?: string;
}> {
  try {
    await requireAuthUser();
    await ensureDefaultBaseHosts();

    const rows = await prisma.emailBisonBaseHost.findMany({
      orderBy: { host: "asc" },
      select: { id: true, host: true, label: true },
    });

    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to load base hosts" };
  }
}

export async function createEmailBisonBaseHost(input: {
  host: string;
  label?: string;
}): Promise<{ success: boolean; data?: EmailBisonBaseHostRow; error?: string }> {
  try {
    const user = await requireAuthUser();
    const isAdmin = await isGlobalAdminUser(user.id);
    if (!isAdmin) return { success: false, error: "Unauthorized" };

    const host = parseHostOnly(input.host);
    if (!host) return { success: false, error: "Invalid host" };
    const validationError = validateEmailBisonBaseHost(host);
    if (validationError) return { success: false, error: validationError };

    const label = typeof input.label === "string" ? input.label.trim() : "";
    const row = await prisma.emailBisonBaseHost.upsert({
      where: { host },
      create: { host, label: label || null },
      update: { label: label || null },
      select: { id: true, host: true, label: true },
    });

    revalidatePath("/settings");
    return { success: true, data: row };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to create base host" };
  }
}

export async function deleteEmailBisonBaseHost(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireAuthUser();
    const isAdmin = await isGlobalAdminUser(user.id);
    if (!isAdmin) return { success: false, error: "Unauthorized" };

    await prisma.emailBisonBaseHost.delete({ where: { id } });
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to delete base host" };
  }
}

export async function setClientEmailBisonBaseHost(
  clientId: string,
  baseHostId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);

    if (baseHostId) {
      const exists = await prisma.emailBisonBaseHost.findUnique({
        where: { id: baseHostId },
        select: { id: true },
      });
      if (!exists) return { success: false, error: "Selected base host not found" };
    }

    await prisma.client.update({
      where: { id: clientId },
      data: baseHostId
        ? { emailBisonBaseHost: { connect: { id: baseHostId } } }
        : { emailBisonBaseHost: { disconnect: true } },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to update base host" };
  }
}
