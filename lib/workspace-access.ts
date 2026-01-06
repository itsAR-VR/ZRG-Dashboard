import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { ClientMemberRole } from "@prisma/client";

export type AuthUser = {
  id: string;
  email: string | null;
};

export async function requireAuthUser(): Promise<AuthUser> {
  const supabase = await createSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Not authenticated");
  }

  return { id: user.id, email: user.email ?? null };
}

export async function getAccessibleClientIdsForUser(userId: string): Promise<string[]> {
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

export async function requireClientAccess(clientId: string): Promise<{ userId: string }> {
  const user = await requireAuthUser();
  const accessible = await getAccessibleClientIdsForUser(user.id);
  if (!accessible.includes(clientId)) {
    throw new Error("Unauthorized");
  }
  return { userId: user.id };
}

export async function requireClientAdminAccess(clientId: string): Promise<{ userId: string }> {
  const user = await requireAuthUser();

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

  return { userId: user.id };
}

export async function resolveClientScope(clientId?: string | null): Promise<{
  userId: string;
  clientIds: string[];
}> {
  const user = await requireAuthUser();
  const accessible = await getAccessibleClientIdsForUser(user.id);

  if (clientId) {
    if (!accessible.includes(clientId)) throw new Error("Unauthorized");
    return { userId: user.id, clientIds: [clientId] };
  }

  return { userId: user.id, clientIds: accessible };
}

export async function isGlobalAdminUser(userId: string): Promise<boolean> {
  const [ownedCount, adminCount] = await Promise.all([
    prisma.client.count({ where: { userId } }),
    prisma.clientMember.count({ where: { userId, role: ClientMemberRole.ADMIN } }),
  ]);
  return ownedCount > 0 || adminCount > 0;
}

export async function requireLeadAccessById(leadId: string): Promise<{ userId: string; clientId: string }> {
  const user = await requireAuthUser();
  const [lead, accessible] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { clientId: true },
    }),
    getAccessibleClientIdsForUser(user.id),
  ]);

  if (!lead) throw new Error("Lead not found");
  if (!accessible.includes(lead.clientId)) throw new Error("Unauthorized");
  return { userId: user.id, clientId: lead.clientId };
}
