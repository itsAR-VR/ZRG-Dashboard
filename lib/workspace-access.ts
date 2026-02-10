import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseAuthError } from "@/lib/supabase/error-utils";
import { ClientMemberRole } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string | null;
};

const DEFAULT_SUPER_ADMIN_EMAILS = ["ar@soramedia.co", "abdur@zeroriskgrowth.com"];

function parseAllowlist(value: string | undefined | null): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getSuperAdminEmails(): string[] {
  const env = parseAllowlist(process.env.SUPER_ADMIN_EMAILS);
  return env.length > 0 ? env : DEFAULT_SUPER_ADMIN_EMAILS;
}

function getSuperAdminUserIds(): string[] {
  return parseAllowlist(process.env.SUPER_ADMIN_USER_IDS);
}

export function isTrueSuperAdminUser(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  const email = (user.email || "").trim().toLowerCase();
  const userId = (user.id || "").trim().toLowerCase();
  if (!email && !userId) return false;
  const emailAllowlist = getSuperAdminEmails();
  const idAllowlist = getSuperAdminUserIds();
  if (email && emailAllowlist.includes(email)) return true;
  if (userId && idAllowlist.includes(userId)) return true;
  return false;
}

export async function requireAuthUser(): Promise<AuthUser> {
  const supabase = await createSupabaseClient();

  try {
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      throw new Error("Not authenticated");
    }

    return { id: user.id, email: user.email ?? null };
  } catch (error) {
    // Avoid leaking Supabase auth errors (e.g. refresh_token_not_found) into logs as unhandled exceptions.
    if (isSupabaseAuthError(error)) {
      throw new Error("Not authenticated");
    }

    throw error instanceof Error ? error : new Error("Not authenticated");
  }
}

export async function requireSuperAdminUser(): Promise<{ userId: string; userEmail: string | null }> {
  const user = await requireAuthUser();
  if (!isTrueSuperAdminUser(user)) {
    throw new Error("Unauthorized: Super admin required");
  }
  return { userId: user.id, userEmail: user.email ?? null };
}

export async function getAccessibleClientIdsForUser(userId: string, userEmail?: string | null): Promise<string[]> {
  if (isTrueSuperAdminUser({ id: userId, email: userEmail ?? null })) {
    const all = await prisma.client.findMany({ select: { id: true } });
    return all.map((row) => row.id);
  }
  const [owned, member] = await Promise.all([
    prisma.client.findMany({
      where: { userId },
      select: { id: true },
    }),
    prisma.clientMember.findMany({
      where: { userId },
      select: { clientId: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const row of owned) ids.add(row.id);
  for (const row of member) ids.add(row.clientId);
  return Array.from(ids);
}

export async function requireClientAccess(clientId: string): Promise<{ userId: string; userEmail: string | null }> {
  const user = await requireAuthUser();
  if (isTrueSuperAdminUser(user)) {
    return { userId: user.id, userEmail: user.email };
  }
  const accessible = await getAccessibleClientIdsForUser(user.id, user.email);
  if (!accessible.includes(clientId)) {
    throw new Error("Unauthorized");
  }
  return { userId: user.id, userEmail: user.email };
}

export async function requireClientAdminAccess(clientId: string): Promise<{ userId: string; userEmail: string | null }> {
  const user = await requireAuthUser();
  if (isTrueSuperAdminUser(user)) {
    return { userId: user.id, userEmail: user.email };
  }

  const [client, adminMembership] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: { userId: true },
    }),
    prisma.clientMember.findFirst({
      where: { clientId, userId: user.id, role: ClientMemberRole.ADMIN },
      select: { id: true },
    }),
  ]);

  if (!client) throw new Error("Workspace not found");
  if (client.userId !== user.id && !adminMembership) throw new Error("Unauthorized");

  return { userId: user.id, userEmail: user.email };
}

export async function resolveClientScope(clientId?: string | null): Promise<{
  userId: string;
  clientIds: string[];
}> {
  const user = await requireAuthUser();
  const accessible = await getAccessibleClientIdsForUser(user.id, user.email);

  if (clientId) {
    if (!accessible.includes(clientId)) throw new Error("Unauthorized");
    return { userId: user.id, clientIds: [clientId] };
  }

  return { userId: user.id, clientIds: accessible };
}

export async function isGlobalAdminUser(userId: string, userEmail?: string | null): Promise<boolean> {
  return isTrueSuperAdminUser({ id: userId, email: userEmail ?? null });
}

export async function requireLeadAccessById(leadId: string): Promise<{ userId: string; clientId: string }> {
  const user = await requireAuthUser();
  const [lead, accessible] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { clientId: true },
    }),
    getAccessibleClientIdsForUser(user.id, user.email),
  ]);

  if (!lead) throw new Error("Lead not found");
  if (!accessible.includes(lead.clientId)) throw new Error("Unauthorized");
  return { userId: user.id, clientId: lead.clientId };
}

/**
 * Role type including OWNER (for workspace owners who aren't in ClientMember)
 */
export type UserRole = ClientMemberRole | "OWNER";

/**
 * Role precedence for determining effective role (higher = more permissive).
 * OWNER and ADMIN have same precedence since both have full access.
 */
const ROLE_PRECEDENCE: Record<UserRole, number> = {
  OWNER: 4,
  ADMIN: 4,
  INBOX_MANAGER: 3,
  SETTER: 1,
  CLIENT_PORTAL: 0,
};

/**
 * Get the user's effective role for a specific workspace.
 *
 * Returns "OWNER" if user owns the workspace.
 * If user has multiple ClientMember roles (possible due to unique constraint on [clientId, userId, role]),
 * returns the highest-precedence role.
 *
 * @returns The user's effective role, or null if no access
 */
export async function getUserRoleForClient(
  userId: string,
  clientId: string
): Promise<UserRole | null> {
  // Check if user is the workspace owner
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { userId: true },
  });

  if (client?.userId === userId) {
    return "OWNER";
  }

  // Get all memberships for this user+workspace (could be multiple roles)
  const memberships = await prisma.clientMember.findMany({
    where: { clientId, userId },
    select: { role: true },
  });

  if (memberships.length === 0) {
    return null;
  }

  // Return highest-precedence role
  let bestRole: UserRole = memberships[0].role;
  for (const membership of memberships) {
    if (ROLE_PRECEDENCE[membership.role] > ROLE_PRECEDENCE[bestRole]) {
      bestRole = membership.role;
    }
  }

  return bestRole;
}

/**
 * Check if a role should see only assigned leads (SETTER) or all leads (others).
 */
export function isSetterRole(role: UserRole | null): boolean {
  return role === "SETTER";
}
