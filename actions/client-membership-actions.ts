"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAdminAccess } from "@/lib/workspace-access";
import { getSupabaseUserEmailById, resolveSupabaseUserIdByEmail } from "@/lib/supabase/admin";
import { ClientMemberRole } from "@prisma/client";
import { revalidatePath } from "next/cache";

function parseEmailList(raw: string): string[] {
  const emails = raw
    .split(/[\n,;]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(emails));
}

export async function getClientAssignments(clientId: string): Promise<{
  success: boolean;
  data?: { setters: string[]; inboxManagers: string[] };
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const members = await prisma.clientMember.findMany({
      where: { clientId, role: { in: [ClientMemberRole.SETTER, ClientMemberRole.INBOX_MANAGER] } },
      select: { userId: true, role: true },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });

    const uniqueUserIds = Array.from(new Set(members.map((m) => m.userId)));
    const emails = await Promise.all(uniqueUserIds.map((id) => getSupabaseUserEmailById(id)));
    const emailByUserId = new Map<string, string>();
    for (let i = 0; i < uniqueUserIds.length; i += 1) {
      const email = emails[i];
      if (email) emailByUserId.set(uniqueUserIds[i], email);
    }

    const setters: string[] = [];
    const inboxManagers: string[] = [];

    for (const m of members) {
      const email = emailByUserId.get(m.userId);
      if (!email) continue;
      if (m.role === ClientMemberRole.SETTER) setters.push(email);
      if (m.role === ClientMemberRole.INBOX_MANAGER) inboxManagers.push(email);
    }

    return { success: true, data: { setters, inboxManagers } };
  } catch (error) {
    console.error("[Client Assignments] Failed to fetch:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch assignments" };
  }
}

export async function setClientAssignments(
  clientId: string,
  input: { setterEmailsRaw: string; inboxManagerEmailsRaw: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);

    const setterEmails = parseEmailList(input.setterEmailsRaw || "");
    const inboxManagerEmails = parseEmailList(input.inboxManagerEmailsRaw || "");

    const missing: string[] = [];
    const setterUserIds: string[] = [];
    const inboxManagerUserIds: string[] = [];

    for (const email of setterEmails) {
      const userId = await resolveSupabaseUserIdByEmail(email);
      if (!userId) missing.push(email);
      else setterUserIds.push(userId);
    }

    for (const email of inboxManagerEmails) {
      const userId = await resolveSupabaseUserIdByEmail(email);
      if (!userId) missing.push(email);
      else inboxManagerUserIds.push(userId);
    }

    if (missing.length > 0) {
      return { success: false, error: `User(s) not found: ${missing.join(", ")}` };
    }

    await prisma.$transaction(async (tx) => {
      await tx.clientMember.deleteMany({
        where: { clientId, role: { in: [ClientMemberRole.SETTER, ClientMemberRole.INBOX_MANAGER] } },
      });

      const rows = [
        ...setterUserIds.map((userId) => ({ clientId, userId, role: ClientMemberRole.SETTER })),
        ...inboxManagerUserIds.map((userId) => ({ clientId, userId, role: ClientMemberRole.INBOX_MANAGER })),
      ];

      if (rows.length > 0) {
        await tx.clientMember.createMany({ data: rows, skipDuplicates: true });
      }
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[Client Assignments] Failed to set:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to update assignments" };
  }
}

