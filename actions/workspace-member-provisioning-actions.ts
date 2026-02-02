"use server";

import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient, resolveSupabaseUserIdByEmail } from "@/lib/supabase/admin";
import { requireClientAdminAccess } from "@/lib/workspace-access";
import { sendResendEmail } from "@/lib/resend-email";
import { getPublicAppUrl } from "@/lib/app-url";
import {
  buildLoginEmailText,
  generateTemporaryPassword,
  getWorkspaceEmailConfig,
  hasResendConfig,
  isValidEmail,
  normalizeEmail,
} from "@/lib/user-provisioning-helpers";
import { ClientMemberRole, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

export type WorkspaceMemberProvisionRole = "SETTER" | "INBOX_MANAGER";

export type WorkspaceMemberProvisionResult = {
  success: boolean;
  userExisted?: boolean;
  membershipCreated?: boolean;
  emailSent?: boolean;
  userId?: string;
  error?: string;
};

export type WorkspaceMemberProvisionDeps = {
  requireClientAdminAccess: (clientId: string) => Promise<{ userId: string; userEmail: string | null }>;
  resolveSupabaseUserIdByEmail: (email: string) => Promise<string | null>;
  createSupabaseAdminClient: () => ReturnType<typeof createSupabaseAdminClient>;
  sendResendEmail: typeof sendResendEmail;
  getPublicAppUrl: typeof getPublicAppUrl;
  getWorkspaceEmailConfig: typeof getWorkspaceEmailConfig;
  createClientMember: (args: {
    clientId: string;
    userId: string;
    role: ClientMemberRole;
  }) => Promise<{ created: boolean }>;
};

function resolveRole(role: WorkspaceMemberProvisionRole): ClientMemberRole | null {
  if (role === "SETTER") return ClientMemberRole.SETTER;
  if (role === "INBOX_MANAGER") return ClientMemberRole.INBOX_MANAGER;
  return null;
}

export async function provisionWorkspaceMemberCore(
  deps: WorkspaceMemberProvisionDeps,
  clientId: string,
  input: { email: string; role: WorkspaceMemberProvisionRole }
): Promise<WorkspaceMemberProvisionResult> {
  try {
    await deps.requireClientAdminAccess(clientId);

    const role = resolveRole(input.role);
    if (!role) {
      return { success: false, error: "Role must be SETTER or INBOX_MANAGER" };
    }

    const email = normalizeEmail(input.email || "");
    if (!isValidEmail(email)) {
      return { success: false, error: "Invalid email address" };
    }

    const existingUserId = await deps.resolveSupabaseUserIdByEmail(email);
    let userId = existingUserId;
    let emailSent = false;
    let userExisted = Boolean(existingUserId);
    let generatedPassword: string | null = null;
    let emailConfig: Awaited<ReturnType<typeof getWorkspaceEmailConfig>> | null = null;

    if (!userId) {
      emailConfig = await deps.getWorkspaceEmailConfig(clientId);
      if (!hasResendConfig(emailConfig)) {
        return { success: false, error: "Resend is not configured for this workspace" };
      }

      generatedPassword = generateTemporaryPassword();
      if (generatedPassword.length < 6) {
        return { success: false, error: "Password must be at least 6 characters" };
      }

      const supabase = deps.createSupabaseAdminClient();
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: generatedPassword,
        email_confirm: true,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      userId = data.user?.id ?? null;
      if (!userId) {
        return { success: false, error: "Failed to create user" };
      }
      userExisted = false;
    }

    if (!userId) {
      return { success: false, error: "Failed to resolve user" };
    }

    const membershipResult = await deps.createClientMember({
      clientId,
      userId,
      role,
    });

    if (!existingUserId && generatedPassword) {
      emailConfig = emailConfig ?? (await deps.getWorkspaceEmailConfig(clientId));
      const brand = (emailConfig.brandName || emailConfig.workspaceName || "ZRG Dashboard").trim();
      const emailResult = await deps.sendResendEmail({
        apiKey: emailConfig.resendApiKey ?? undefined,
        fromEmail: emailConfig.resendFromEmail ?? undefined,
        to: [email],
        subject: `${brand} Inbox Login`,
        text: buildLoginEmailText({
          appUrl: deps.getPublicAppUrl(),
          brand,
          email,
          password: generatedPassword,
        }),
      });

      if (!emailResult.success) {
        return {
          success: false,
          userId,
          userExisted,
          membershipCreated: membershipResult.created,
          emailSent: false,
          error: emailResult.error || "Email failed",
        };
      }

      emailSent = true;
    }

    return {
      success: true,
      userId,
      userExisted,
      membershipCreated: membershipResult.created,
      emailSent,
    };
  } catch (error) {
    console.error("[Workspace Member Provisioning] Failed:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to provision member" };
  }
}

const defaultDeps: WorkspaceMemberProvisionDeps = {
  requireClientAdminAccess,
  resolveSupabaseUserIdByEmail,
  createSupabaseAdminClient,
  sendResendEmail,
  getPublicAppUrl,
  getWorkspaceEmailConfig,
  createClientMember: async ({ clientId, userId, role }) => {
    try {
      await prisma.clientMember.create({
        data: { clientId, userId, role },
      });
      return { created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { created: false };
      }
      throw error;
    }
  },
};

export async function provisionWorkspaceMember(
  clientId: string,
  input: { email: string; role: WorkspaceMemberProvisionRole }
): Promise<WorkspaceMemberProvisionResult> {
  const result = await provisionWorkspaceMemberCore(defaultDeps, clientId, input);
  if (result.success) {
    revalidatePath("/");
  }
  return result;
}

// --- List workspace members (SETTER / INBOX_MANAGER) ---

import { getSupabaseUserEmailById } from "@/lib/supabase/admin";

export type WorkspaceMemberSummary = {
  userId: string;
  email: string;
  role: "SETTER" | "INBOX_MANAGER";
  createdAt: string;
};

export type ListWorkspaceMembersResult = {
  success: boolean;
  members?: WorkspaceMemberSummary[];
  error?: string;
};

export async function listWorkspaceMembers(clientId: string): Promise<ListWorkspaceMembersResult> {
  try {
    await requireClientAdminAccess(clientId);

    const rows = await prisma.clientMember.findMany({
      where: { clientId, role: { in: [ClientMemberRole.SETTER, ClientMemberRole.INBOX_MANAGER] } },
      select: { userId: true, role: true, createdAt: true },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });

    const members: WorkspaceMemberSummary[] = [];

    for (const row of rows) {
      const email = await getSupabaseUserEmailById(row.userId);
      if (!email) continue;
      members.push({
        userId: row.userId,
        email,
        role: row.role as "SETTER" | "INBOX_MANAGER",
        createdAt: row.createdAt.toISOString(),
      });
    }

    return { success: true, members };
  } catch (error) {
    console.error("[Workspace Members] Failed to list:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to list members" };
  }
}

export async function removeWorkspaceMember(
  clientId: string,
  userId: string,
  role: WorkspaceMemberProvisionRole
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);

    const prismaRole = resolveRole(role);
    if (!prismaRole) {
      return { success: false, error: "Invalid role" };
    }

    await prisma.clientMember.deleteMany({
      where: { clientId, userId, role: prismaRole },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[Workspace Members] Failed to remove:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to remove member" };
  }
}
