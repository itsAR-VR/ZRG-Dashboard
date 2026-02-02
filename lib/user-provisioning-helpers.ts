import "server-only";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type WorkspaceEmailConfig = {
  workspaceName: string;
  brandName: string | null;
  resendApiKey: string | null;
  resendFromEmail: string | null;
};

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  if (!value) return false;
  if (value.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function generateTemporaryPassword(): string {
  return `Zrg!${randomBytes(12).toString("base64url")}`;
}

export function buildLoginEmailText(opts: { appUrl: string; brand: string; email: string; password: string }): string {
  return [
    `Your ${opts.brand} inbox account is ready.`,
    "",
    `Login: ${opts.appUrl}/auth/login`,
    `Email: ${opts.email}`,
    `Temporary password: ${opts.password}`,
    "",
    "After signing in, you can change your password using “Forgot password”.",
    "Use the same email/password for the mobile app when it’s available.",
  ].join("\n");
}

export async function getWorkspaceEmailConfig(clientId: string): Promise<WorkspaceEmailConfig> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      name: true,
      resendApiKey: true,
      resendFromEmail: true,
      settings: { select: { brandName: true } },
    },
  });
  if (!client) throw new Error("Workspace not found");
  return {
    workspaceName: client.name,
    brandName: client.settings?.brandName ?? null,
    resendApiKey: client.resendApiKey ?? null,
    resendFromEmail: client.resendFromEmail ?? null,
  };
}

export function hasResendConfig(config: WorkspaceEmailConfig): boolean {
  const apiKey = (config.resendApiKey ?? process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (config.resendFromEmail ?? process.env.RESEND_FROM_EMAIL ?? "").trim();
  return Boolean(apiKey && fromEmail);
}
