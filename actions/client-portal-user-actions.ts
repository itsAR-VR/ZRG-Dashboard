"use server";

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient, getSupabaseUserEmailById, getSupabaseUserEmailsByIds, resolveSupabaseUserIdByEmail } from "@/lib/supabase/admin";
import { requireClientAdminAccess } from "@/lib/workspace-access";
import { sendResendEmail } from "@/lib/resend-email";
import { getPublicAppUrl } from "@/lib/app-url";
import { ClientMemberRole, Prisma } from "@prisma/client";

export type ClientPortalUserSummary = {
  userId: string;
  email: string | null;
  createdAt: string;
};

type EmailConfig = {
  workspaceName: string;
  brandName: string | null;
  resendApiKey: string | null;
  resendFromEmail: string | null;
};

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  if (!value) return false;
  if (value.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function generateTemporaryPassword(): string {
  return `Zrg!${randomBytes(12).toString("base64url")}`;
}

function buildLoginEmailText(opts: { appUrl: string; brand: string; email: string; password: string }): string {
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

async function getWorkspaceEmailConfig(clientId: string): Promise<EmailConfig> {
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

function hasResendConfig(config: EmailConfig): boolean {
  const apiKey = (config.resendApiKey ?? process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (config.resendFromEmail ?? process.env.RESEND_FROM_EMAIL ?? "").trim();
  return Boolean(apiKey && fromEmail);
}

export async function listClientPortalUsers(clientId: string): Promise<{
  success: boolean;
  users?: ClientPortalUserSummary[];
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const members = await prisma.clientMember.findMany({
      where: { clientId, role: ClientMemberRole.CLIENT_PORTAL },
      select: { userId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const emailsById = await getSupabaseUserEmailsByIds(members.map((m) => m.userId));

    const users = members.map((member) => ({
      userId: member.userId,
      email: emailsById.get(member.userId) ?? null,
      createdAt: member.createdAt.toISOString(),
    }));

    return { success: true, users };
  } catch (error) {
    console.error("[Client Portal] Failed to list users:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to load users" };
  }
}

export async function createClientPortalUser(
  clientId: string,
  input: { email: string; password?: string | null; resetPassword?: boolean }
): Promise<{ success: boolean; userId?: string; membershipCreated?: boolean; emailSent?: boolean; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);

    const email = normalizeEmail(input.email || "");
    if (!isValidEmail(email)) {
      return { success: false, error: "Invalid email address" };
    }

    const emailConfig = await getWorkspaceEmailConfig(clientId);
    if (!hasResendConfig(emailConfig)) {
      return { success: false, error: "Resend is not configured for this workspace" };
    }

    const password = (input.password || "").trim() || generateTemporaryPassword();
    if (password.length < 6) {
      return { success: false, error: "Password must be at least 6 characters" };
    }

    const existingUserId = await resolveSupabaseUserIdByEmail(email);
    const supabase = createSupabaseAdminClient();

    let userId = existingUserId;
    if (!userId) {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) {
        return { success: false, error: error.message };
      }
      userId = data.user?.id ?? null;
      if (!userId) {
        return { success: false, error: "Failed to create user" };
      }
    } else if (input.resetPassword) {
      const { error } = await supabase.auth.admin.updateUserById(userId, { password });
      if (error) {
        return { success: false, error: error.message };
      }
    } else {
      return { success: false, error: "User already exists; use reset password to send new login details" };
    }

    let membershipCreated = false;
    try {
      await prisma.clientMember.create({
        data: { clientId, userId, role: ClientMemberRole.CLIENT_PORTAL },
      });
      membershipCreated = true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
        throw error;
      }
    }

    const brand = (emailConfig.brandName || emailConfig.workspaceName || "ZRG Dashboard").trim();
    const emailResult = await sendResendEmail({
      apiKey: emailConfig.resendApiKey ?? undefined,
      fromEmail: emailConfig.resendFromEmail ?? undefined,
      to: [email],
      subject: `${brand} Inbox Login`,
      text: buildLoginEmailText({
        appUrl: getPublicAppUrl(),
        brand,
        email,
        password,
      }),
    });

    if (!emailResult.success) {
      return { success: false, userId, membershipCreated, emailSent: false, error: emailResult.error || "Email failed" };
    }

    return { success: true, userId, membershipCreated, emailSent: true };
  } catch (error) {
    console.error("[Client Portal] Failed to create user:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to create user" };
  }
}

export async function resetClientPortalPassword(
  clientId: string,
  userId: string
): Promise<{ success: boolean; emailSent?: boolean; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);

    const membership = await prisma.clientMember.findFirst({
      where: { clientId, userId, role: ClientMemberRole.CLIENT_PORTAL },
      select: { id: true },
    });
    if (!membership) {
      return { success: false, error: "Client portal membership not found" };
    }

    const email = await getSupabaseUserEmailById(userId);
    if (!email) {
      return { success: false, error: "User email not found" };
    }

    const emailConfig = await getWorkspaceEmailConfig(clientId);
    if (!hasResendConfig(emailConfig)) {
      return { success: false, error: "Resend is not configured for this workspace" };
    }

    const password = generateTemporaryPassword();
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.auth.admin.updateUserById(userId, { password });
    if (error) {
      return { success: false, error: error.message };
    }

    const brand = (emailConfig.brandName || emailConfig.workspaceName || "ZRG Dashboard").trim();
    const emailResult = await sendResendEmail({
      apiKey: emailConfig.resendApiKey ?? undefined,
      fromEmail: emailConfig.resendFromEmail ?? undefined,
      to: [email],
      subject: `${brand} Inbox Login (Password Reset)`,
      text: buildLoginEmailText({
        appUrl: getPublicAppUrl(),
        brand,
        email,
        password,
      }),
    });

    if (!emailResult.success) {
      return { success: false, emailSent: false, error: emailResult.error || "Email failed" };
    }

    return { success: true, emailSent: true };
  } catch (error) {
    console.error("[Client Portal] Failed to reset password:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to reset password" };
  }
}

export async function removeClientPortalAccess(
  clientId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);

    await prisma.clientMember.deleteMany({
      where: { clientId, userId, role: ClientMemberRole.CLIENT_PORTAL },
    });

    return { success: true };
  } catch (error) {
    console.error("[Client Portal] Failed to remove access:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to remove access" };
  }
}
