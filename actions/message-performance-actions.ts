"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAccess, requireClientAdminAccess } from "@/lib/workspace-access";
import { MESSAGE_PERFORMANCE_SESSION_TITLE, runMessagePerformanceReportSystem } from "@/lib/message-performance-report";
import { revalidatePath } from "next/cache";
function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

export async function runMessagePerformanceReport(
  clientId: string | null | undefined,
  params?: {
    windowFrom?: string | Date;
    windowTo?: string | Date;
    attributionWindowDays?: number;
    maturityBufferDays?: number;
    includeSynthesis?: boolean;
  }
): Promise<{ success: boolean; packId?: string; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAdminAccess(clientId);

    const windowDays = parsePositiveIntEnv("MESSAGE_PERFORMANCE_WINDOW_DAYS", 30);
    const windowTo = params?.windowTo ? new Date(params.windowTo) : new Date();
    const windowFrom = params?.windowFrom ? new Date(params.windowFrom) : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const includeSynthesis = params?.includeSynthesis ?? true;
    const res = await runMessagePerformanceReportSystem({
      clientId,
      windowFrom,
      windowTo,
      attributionWindowDays: params?.attributionWindowDays,
      maturityBufferDays: params?.maturityBufferDays,
      includeSynthesis,
      computedByUserId: userId,
      computedByEmail: userEmail,
    });

    revalidatePath("/");
    return { success: true, packId: res.packId };
  } catch (error) {
    console.error("[MessagePerformance] Failed to run report:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to run report" };
  }
}

export async function getLatestMessagePerformanceReport(
  clientId: string | null | undefined
): Promise<{
  success: boolean;
  data?: { packId: string; metrics: unknown; stats: unknown; synthesis: unknown; updatedAt: Date };
  error?: string;
}> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAccess(clientId);

    const session = await prisma.insightChatSession.findFirst({
      where: { clientId, title: MESSAGE_PERFORMANCE_SESSION_TITLE, deletedAt: null },
      select: { id: true },
    });
    if (!session) return { success: true, data: undefined };

    const pack = await prisma.insightContextPack.findFirst({
      where: { sessionId: session.id, status: "COMPLETE" },
      orderBy: { computedAt: "desc" },
      select: { id: true, metricsSnapshot: true, synthesis: true, computedAt: true, updatedAt: true },
    });
    if (!pack || !pack.metricsSnapshot || typeof pack.metricsSnapshot !== "object") {
      return { success: true, data: undefined };
    }

    let isAdmin = false;
    try {
      await requireClientAdminAccess(clientId);
      isAdmin = true;
    } catch {
      isAdmin = false;
    }

    const snapshot = pack.metricsSnapshot as any;
    const metrics = snapshot.metrics ?? null;
    const stats = snapshot.stats ?? null;
    if (!isAdmin && snapshot.rows) {
      delete snapshot.rows;
    }

    return {
      success: true,
      data: {
        packId: pack.id,
        metrics,
        stats,
        synthesis: pack.synthesis ?? null,
        updatedAt: pack.computedAt ?? pack.updatedAt,
      },
    };
  } catch (error) {
    console.error("[MessagePerformance] Failed to load report:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to load report" };
  }
}

export async function getMessagePerformanceEvidence(
  clientId: string | null | undefined,
  packId: string
): Promise<{ success: boolean; rows?: unknown; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAdminAccess(clientId);

    const pack = await prisma.insightContextPack.findUnique({
      where: { id: packId },
      select: { metricsSnapshot: true },
    });
    if (!pack?.metricsSnapshot || typeof pack.metricsSnapshot !== "object") {
      return { success: false, error: "No evidence found" };
    }

    const snapshot = pack.metricsSnapshot as any;
    return { success: true, rows: snapshot.rows ?? [] };
  } catch (error) {
    console.error("[MessagePerformance] Failed to load evidence:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to load evidence" };
  }
}
