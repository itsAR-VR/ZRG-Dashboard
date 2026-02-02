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

function parseSequenceEmailList(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export async function getClientAssignments(clientId: string): Promise<{
  success: boolean;
  data?: {
    setters: string[];
    inboxManagers: string[];
    roundRobinEnabled: boolean;
    roundRobinEmailOnly: boolean;
    roundRobinSequence: string[];
  };
  error?: string;
}> {
  try {
    await requireClientAdminAccess(clientId);

    const [members, settings] = await Promise.all([
      prisma.clientMember.findMany({
        where: { clientId, role: { in: [ClientMemberRole.SETTER, ClientMemberRole.INBOX_MANAGER] } },
        select: { userId: true, role: true },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      }),
      prisma.workspaceSettings.findUnique({
        where: { clientId },
        select: {
          roundRobinEnabled: true,
          roundRobinEmailOnly: true,
          roundRobinSetterSequence: true,
        },
      }),
    ]);

    const sequenceUserIds = settings?.roundRobinSetterSequence ?? [];
    const uniqueUserIds = Array.from(new Set([...members.map((m) => m.userId), ...sequenceUserIds]));
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

    const roundRobinSequence = sequenceUserIds
      .map((userId) => emailByUserId.get(userId) ?? null)
      .filter((email): email is string => Boolean(email));

    return {
      success: true,
      data: {
        setters,
        inboxManagers,
        roundRobinEnabled: Boolean(settings?.roundRobinEnabled),
        roundRobinEmailOnly: Boolean(settings?.roundRobinEmailOnly),
        roundRobinSequence,
      },
    };
  } catch (error) {
    console.error("[Client Assignments] Failed to fetch:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch assignments" };
  }
}

export async function setClientAssignments(
  clientId: string,
  input: {
    setterEmailsRaw: string;
    inboxManagerEmailsRaw: string;
    roundRobinEnabled: boolean;
    roundRobinEmailOnly: boolean;
    roundRobinSequenceRaw: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);

    const setterEmails = parseEmailList(input.setterEmailsRaw || "");
    const inboxManagerEmails = parseEmailList(input.inboxManagerEmailsRaw || "");
    const roundRobinSequenceEmails = parseSequenceEmailList(input.roundRobinSequenceRaw || "");

    const invalidSequenceEmails = roundRobinSequenceEmails.filter((email) => !setterEmails.includes(email));
    if (invalidSequenceEmails.length > 0) {
      return {
        success: false,
        error: `Round robin sequence email(s) must be included in setter list: ${invalidSequenceEmails.join(", ")}`,
      };
    }

    const missing: string[] = [];

    const uniqueEmailsToResolve = new Set<string>([...setterEmails, ...inboxManagerEmails, ...roundRobinSequenceEmails]);
    const userIdByEmail = new Map<string, string>();

    for (const email of uniqueEmailsToResolve) {
      const userId = await resolveSupabaseUserIdByEmail(email);
      if (!userId) missing.push(email);
      else userIdByEmail.set(email, userId);
    }

    if (missing.length > 0) {
      return { success: false, error: `User(s) not found: ${missing.join(", ")}` };
    }

    const setterUserIds: string[] = setterEmails.map((email) => userIdByEmail.get(email)!);
    const inboxManagerUserIds: string[] = inboxManagerEmails.map((email) => userIdByEmail.get(email)!);
    const roundRobinSequenceUserIds: string[] = roundRobinSequenceEmails.map((email) => userIdByEmail.get(email)!);

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

      const existingSettings = await tx.workspaceSettings.findUnique({
        where: { clientId },
        select: { roundRobinSetterSequence: true },
      });

      const previousSequence = existingSettings?.roundRobinSetterSequence ?? [];
      const sequenceChanged = !arraysEqual(previousSequence, roundRobinSequenceUserIds);

      if (existingSettings) {
        await tx.workspaceSettings.update({
          where: { clientId },
          data: {
            roundRobinEnabled: input.roundRobinEnabled,
            roundRobinEmailOnly: input.roundRobinEmailOnly,
            roundRobinSetterSequence: roundRobinSequenceUserIds,
            ...(sequenceChanged ? { roundRobinLastSetterIndex: -1 } : {}),
          },
        });
      } else {
        await tx.workspaceSettings.create({
          data: {
            clientId,
            roundRobinEnabled: input.roundRobinEnabled,
            roundRobinEmailOnly: input.roundRobinEmailOnly,
            roundRobinSetterSequence: roundRobinSequenceUserIds,
            roundRobinLastSetterIndex: -1,
          },
        });
      }
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[Client Assignments] Failed to set:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to update assignments" };
  }
}
