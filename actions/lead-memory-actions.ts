"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { LeadMemorySource } from "@prisma/client";
import { computeLeadMemoryExpiryDate } from "@/lib/lead-memory-context";
import { requireClientAdminAccess, requireLeadAccessById, getUserRoleForClient } from "@/lib/workspace-access";

export type LeadMemoryEntryInput = {
  leadId: string;
  category: string;
  content: string;
  source?: LeadMemorySource;
  expiresAt?: Date | null;
};

function normalizeCategory(value: string | null | undefined): string {
  const raw = (value || "").trim();
  return raw || "Note";
}

function normalizeContent(value: string | null | undefined): string {
  return (value || "").trim();
}

export async function createLeadMemoryEntry(
  input: LeadMemoryEntryInput
): Promise<{ success: boolean; entryId?: string; error?: string }> {
  try {
    if (!input.leadId) return { success: false, error: "Missing lead" };
    const content = normalizeContent(input.content);
    if (!content) return { success: false, error: "Missing content" };

    const lead = await prisma.lead.findUnique({
      where: { id: input.leadId },
      select: { id: true, clientId: true },
    });
    if (!lead) return { success: false, error: "Lead not found" };

    const { userId, userEmail } = await requireClientAdminAccess(lead.clientId);
    const expiresAt = input.expiresAt ?? computeLeadMemoryExpiryDate(new Date());

    const entry = await prisma.leadMemoryEntry.create({
      data: {
        leadId: lead.id,
        clientId: lead.clientId,
        category: normalizeCategory(input.category),
        content,
        source: input.source ?? LeadMemorySource.MANUAL,
        createdByUserId: userId,
        createdByEmail: userEmail || null,
        expiresAt,
      },
      select: { id: true },
    });

    revalidatePath("/");
    return { success: true, entryId: entry.id };
  } catch (error) {
    console.error("Failed to create lead memory entry:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to create memory entry" };
  }
}

export async function updateLeadMemoryEntry(
  entryId: string,
  updates: { category?: string; content?: string; expiresAt?: Date | null }
): Promise<{ success: boolean; error?: string }> {
  try {
    const entry = await prisma.leadMemoryEntry.findUnique({
      where: { id: entryId },
      select: { id: true, clientId: true },
    });
    if (!entry) return { success: false, error: "Entry not found" };

    await requireClientAdminAccess(entry.clientId);

    const data: Record<string, unknown> = {};
    if (typeof updates.category === "string") data.category = normalizeCategory(updates.category);
    if (typeof updates.content === "string") data.content = normalizeContent(updates.content);
    if (typeof updates.expiresAt !== "undefined") data.expiresAt = updates.expiresAt;

    await prisma.leadMemoryEntry.update({ where: { id: entryId }, data });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to update lead memory entry:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to update memory entry" };
  }
}

export async function expireLeadMemoryEntry(
  entryId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const entry = await prisma.leadMemoryEntry.findUnique({
      where: { id: entryId },
      select: { id: true, clientId: true },
    });
    if (!entry) return { success: false, error: "Entry not found" };

    await requireClientAdminAccess(entry.clientId);
    await prisma.leadMemoryEntry.update({ where: { id: entryId }, data: { expiresAt: new Date() } });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to expire lead memory entry:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to expire memory entry" };
  }
}

export async function deleteLeadMemoryEntry(
  entryId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const entry = await prisma.leadMemoryEntry.findUnique({
      where: { id: entryId },
      select: { id: true, clientId: true },
    });
    if (!entry) return { success: false, error: "Entry not found" };

    await requireClientAdminAccess(entry.clientId);
    await prisma.leadMemoryEntry.delete({ where: { id: entryId } });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to delete lead memory entry:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to delete memory entry" };
  }
}

export async function listLeadMemoryEntries(
  leadId: string
): Promise<{ success: boolean; entries?: Array<{ id: string; category: string; content: string; expiresAt: string | null }>; error?: string }> {
  try {
    const { userId, clientId } = await requireLeadAccessById(leadId);
    const role = await getUserRoleForClient(userId, clientId);
    const isAdmin = role === "ADMIN" || role === "OWNER";

    const entries = await prisma.leadMemoryEntry.findMany({
      where: {
        leadId,
        clientId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, category: true, content: true, expiresAt: true },
      take: 50,
    });

    const output = entries.map((entry) => ({
      id: entry.id,
      category: entry.category,
      content: isAdmin ? entry.content : entry.content.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]").replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]"),
      expiresAt: entry.expiresAt ? entry.expiresAt.toISOString() : null,
    }));

    return { success: true, entries: output };
  } catch (error) {
    console.error("Failed to list lead memory entries:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to list memory entries" };
  }
}
