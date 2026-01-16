"use server";

import { prisma } from "@/lib/prisma";
import { requireClientAccess, requireClientAdminAccess } from "@/lib/workspace-access";
import { coerceInsightsChatModel, coerceInsightsChatReasoningEffort } from "@/lib/insights-chat/config";
import { resolveInsightsWindow, buildInsightScopeKey, formatInsightsWindowLabel } from "@/lib/insights-chat/window";
import { selectThreadsForInsightPack, type InsightCampaignScope } from "@/lib/insights-chat/thread-selection";
import { extractConversationInsightForLead, type ConversationInsight } from "@/lib/insights-chat/thread-extractor";
import { synthesizeInsightContextPack } from "@/lib/insights-chat/pack-synthesis";
import { answerInsightsChatQuestion } from "@/lib/insights-chat/chat-answer";
import { buildFastContextPackMarkdown, getFastSeedMaxThreads, getFastSeedMinThreads, selectFastSeedThreads } from "@/lib/insights-chat/fast-seed";
import { buildInsightThreadIndex } from "@/lib/insights-chat/thread-index";
import { getAnalytics, getEmailCampaignAnalytics } from "@/actions/analytics-actions";
import { withAiTelemetrySourceIfUnset } from "@/lib/ai/telemetry-context";
import { formatOpenAiErrorSummary, isRetryableOpenAiError } from "@/lib/ai/openai-error-utils";
import type { InsightThreadCitation, InsightThreadIndexItem } from "@/lib/insights-chat/citations";
import type { SelectedInsightThread } from "@/lib/insights-chat/thread-selection";
import type {
  ConversationInsightOutcome,
  InsightChatAuditAction,
  InsightChatRole,
  InsightContextPackStatus,
  InsightsWindowPreset,
} from "@prisma/client";
import { revalidatePath } from "next/cache";

type InsightChatSessionListItem = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  createdByEmail: string | null;
  deletedAt: Date | null;
  lastMessagePreview: string | null;
};

type InsightChatMessagePublic = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: InsightThreadCitation[] | null;
  authorUserId: string | null;
  authorEmail: string | null;
  createdAt: Date;
  contextPackId: string | null;
};

export type InsightContextPackPublic = {
  id: string;
  sessionId: string;
  status: InsightContextPackStatus;
  model: string;
  reasoningEffort: string;
  seedAssistantMessageId: string | null;
  windowPreset: InsightsWindowPreset;
  windowFrom: Date;
  windowTo: Date;
  allCampaigns: boolean;
  campaignCap: number | null;
  selectedCampaignIds: string[];
  effectiveCampaignIds: string[];
  targetThreadsTotal: number;
  processedThreads: number;
  lastError: string | null;
  computedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function roleToPublic(role: InsightChatRole): InsightChatMessagePublic["role"] {
  if (role === "ASSISTANT") return "assistant";
  if (role === "SYSTEM") return "system";
  return "user";
}

function summarizeContentForPreview(content: string, maxLen = 140): string {
  const cleaned = (content || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLen - 1))}…`;
}

function parseOptionalDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function coerceSelectedInsightThreadsMeta(value: unknown): SelectedInsightThread[] {
  const meta = Array.isArray(value) ? (value as any[]) : [];
  return meta
    .map((row) => {
      const leadId = typeof row?.leadId === "string" ? row.leadId : null;
      if (!leadId) return null;
      const outcome = typeof row?.outcome === "string" ? row.outcome : null;
      const exampleType = row?.exampleType === "positive" || row?.exampleType === "negative" ? row.exampleType : null;
      const selectionBucket = typeof row?.selectionBucket === "string" ? row.selectionBucket : null;
      return {
        leadId,
        emailCampaignId: typeof row?.emailCampaignId === "string" ? row.emailCampaignId : null,
        outcome: (outcome || "UNKNOWN") as any,
        exampleType: (exampleType || "positive") as any,
        selectionBucket: (selectionBucket || "unknown") as any,
      };
    })
    .filter(Boolean) as SelectedInsightThread[];
}

async function getInsightsRuntimeConfig(clientId: string): Promise<{
  model: ReturnType<typeof coerceInsightsChatModel>;
  reasoning: ReturnType<typeof coerceInsightsChatReasoningEffort>["api"];
  reasoningStored: ReturnType<typeof coerceInsightsChatReasoningEffort>["stored"];
}> {
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { insightsChatModel: true, insightsChatReasoningEffort: true },
  });

  const model = coerceInsightsChatModel(settings?.insightsChatModel);
  const effort = coerceInsightsChatReasoningEffort({ model, storedValue: settings?.insightsChatReasoningEffort });
  return { model, reasoning: effort.api, reasoningStored: effort.stored };
}

async function recordAuditEvent(opts: {
  clientId: string;
  userId: string;
  userEmail: string | null;
  action: InsightChatAuditAction;
  sessionId?: string | null;
  contextPackId?: string | null;
  details?: unknown;
}): Promise<void> {
  try {
    await prisma.insightChatAuditEvent.create({
      data: {
        clientId: opts.clientId,
        userId: opts.userId,
        userEmail: opts.userEmail,
        action: opts.action,
        sessionId: opts.sessionId || null,
        contextPackId: opts.contextPackId || null,
        details: (opts.details ?? null) as any,
      },
    });
  } catch (error) {
    console.error("[InsightsChat] Failed to record audit event:", error);
  }
}

export async function getInsightsChatUserPreference(clientId: string | null | undefined): Promise<{
  success: boolean;
  data?: { windowPreset: InsightsWindowPreset; customStart: Date | null; customEnd: Date | null; campaignCap: number; isSaved: boolean };
  error?: string;
}> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId } = await requireClientAccess(clientId);

    const pref = await prisma.insightChatUserPreference.findUnique({
      where: { clientId_userId: { clientId, userId } },
      select: { windowPreset: true, windowFrom: true, windowTo: true, campaignCap: true },
    });

    if (!pref) {
      return {
        success: true,
        data: {
          windowPreset: "D7",
          customStart: null,
          customEnd: null,
          campaignCap: 10,
          isSaved: false,
        },
      };
    }

    return {
      success: true,
      data: {
        windowPreset: pref.windowPreset,
        customStart: pref.windowFrom,
        customEnd: pref.windowTo,
        campaignCap: pref.campaignCap,
        isSaved: true,
      },
    };
  } catch (error) {
    console.error("[InsightsChat] Failed to load preferences:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to load preferences" };
  }
}

export async function setInsightsChatUserPreference(
  clientId: string | null | undefined,
  data: {
    windowPreset?: InsightsWindowPreset;
    customStart?: string | Date | null;
    customEnd?: string | Date | null;
    campaignCap?: number;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId } = await requireClientAccess(clientId);

    const windowPreset = data.windowPreset ?? undefined;
    const windowFrom = data.customStart !== undefined ? parseOptionalDate(data.customStart) : undefined;
    const windowTo = data.customEnd !== undefined ? parseOptionalDate(data.customEnd) : undefined;
    const campaignCap =
      data.campaignCap !== undefined ? Math.max(1, Math.min(50, Math.trunc(Number(data.campaignCap) || 10))) : undefined;

    await prisma.insightChatUserPreference.upsert({
      where: { clientId_userId: { clientId, userId } },
      update: {
        windowPreset,
        windowFrom,
        windowTo,
        campaignCap,
      },
      create: {
        clientId,
        userId,
        windowPreset: windowPreset ?? "D7",
        windowFrom: windowFrom ?? null,
        windowTo: windowTo ?? null,
        campaignCap: campaignCap ?? 10,
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[InsightsChat] Failed to save preferences:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to save preferences" };
  }
}

export async function listInsightChatSessions(
  clientId: string | null | undefined,
  opts?: { includeDeleted?: boolean }
): Promise<{ success: boolean; data?: { sessions: InsightChatSessionListItem[] }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId } = await requireClientAccess(clientId);

    const includeDeleted = Boolean(opts?.includeDeleted);
    if (includeDeleted) {
      await requireClientAdminAccess(clientId);
    }

    const sessions = await prisma.insightChatSession.findMany({
      where: {
        clientId,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        createdByUserId: true,
        createdByEmail: true,
        deletedAt: true,
        messages: {
          select: { content: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    return {
      success: true,
      data: {
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          createdByUserId: s.createdByUserId,
          createdByEmail: s.createdByEmail,
          deletedAt: s.deletedAt,
          lastMessagePreview: s.messages[0]?.content ? summarizeContentForPreview(s.messages[0].content) : null,
        })),
      },
    };
  } catch (error) {
    console.error("[InsightsChat] Failed to list sessions:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to list sessions" };
  }
}

export async function getInsightChatMessages(
  clientId: string | null | undefined,
  sessionId: string
): Promise<{ success: boolean; data?: { messages: InsightChatMessagePublic[] }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAccess(clientId);

    const session = await prisma.insightChatSession.findUnique({
      where: { id: sessionId },
      select: { id: true, clientId: true, deletedAt: true },
    });
    if (!session || session.clientId !== clientId) return { success: false, error: "Session not found" };

    if (session.deletedAt) {
      await requireClientAdminAccess(clientId);
    }

    const messages = await prisma.insightChatMessage.findMany({
      where: { clientId, sessionId },
      select: {
        id: true,
        role: true,
        content: true,
        citations: true,
        authorUserId: true,
        authorEmail: true,
        createdAt: true,
        contextPackId: true,
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    return {
      success: true,
      data: {
        messages: messages.map((m) => ({
          id: m.id,
          role: roleToPublic(m.role),
          content: m.content,
          citations: (m.citations as any) ?? null,
          authorUserId: m.authorUserId,
          authorEmail: m.authorEmail,
          createdAt: m.createdAt,
          contextPackId: m.contextPackId,
        })),
      },
    };
  } catch (error) {
    console.error("[InsightsChat] Failed to load messages:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to load messages" };
  }
}

export async function createInsightChatSession(
  clientId: string | null | undefined,
  title?: string | null
): Promise<{ success: boolean; data?: { sessionId: string }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAccess(clientId);

    const session = await prisma.insightChatSession.create({
      data: {
        clientId,
        title: (title || "").trim() || "Insights Session",
        createdByUserId: userId,
        createdByEmail: userEmail,
      },
      select: { id: true },
    });

    await recordAuditEvent({ clientId, userId, userEmail, action: "SESSION_CREATED", sessionId: session.id });
    revalidatePath("/");
    return { success: true, data: { sessionId: session.id } };
  } catch (error) {
    console.error("[InsightsChat] Failed to create session:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to create session" };
  }
}

export async function deleteInsightChatSession(
  clientId: string | null | undefined,
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAdminAccess(clientId);

    await prisma.insightChatSession.update({
      where: { id: sessionId },
      data: {
        deletedAt: new Date(),
        deletedByUserId: userId,
        deleteReason: null,
      },
    });

    await recordAuditEvent({ clientId, userId, userEmail, action: "SESSION_DELETED", sessionId });
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[InsightsChat] Failed to delete session:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to delete session" };
  }
}

export async function restoreInsightChatSession(
  clientId: string | null | undefined,
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAdminAccess(clientId);

    await prisma.insightChatSession.update({
      where: { id: sessionId },
      data: {
        deletedAt: null,
        deletedByUserId: null,
        deleteReason: null,
      },
    });

    await recordAuditEvent({ clientId, userId, userEmail, action: "SESSION_RESTORED", sessionId });
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[InsightsChat] Failed to restore session:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to restore session" };
  }
}

function normalizeCampaignIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((v) => (v || "").trim()).filter(Boolean)));
}

async function createOrResetContextPack(opts: {
  clientId: string;
  sessionId: string;
  userId: string;
  userEmail: string | null;
  windowPreset: InsightsWindowPreset;
  windowFrom: Date | null;
  windowTo: Date | null;
  selectedCampaignIds: string[];
  allCampaigns: boolean;
  campaignCap: number | null;
  model?: string | null;
  reasoningEffort?: string | null;
  auditAction: "CONTEXT_PACK_CREATED" | "CONTEXT_PACK_RECOMPUTED";
}): Promise<{ packId: string }> {
  const resolved = resolveInsightsWindow({
    preset: opts.windowPreset,
    windowFrom: opts.windowFrom,
    windowTo: opts.windowTo,
  });

  const selectedCampaignIds = opts.allCampaigns ? [] : normalizeCampaignIds(opts.selectedCampaignIds);
  const campaignCap = opts.allCampaigns
    ? Math.max(1, Math.min(50, Math.trunc(Number(opts.campaignCap ?? 10) || 10)))
    : null;

  const scopeKey = buildInsightScopeKey({
    window: resolved,
    campaignIds: selectedCampaignIds,
    allCampaigns: opts.allCampaigns,
    campaignCap,
  });

  const existing = await prisma.insightContextPack.findUnique({
    where: { sessionId_scopeKey: { sessionId: opts.sessionId, scopeKey } },
    select: { id: true, deletedAt: true },
  });
  if (existing?.deletedAt) {
    throw new Error("This context pack was deleted. Ask an admin to restore it.");
  }

  const runtime = await getInsightsRuntimeConfig(opts.clientId);
  const effectiveModel = opts.model ? coerceInsightsChatModel(opts.model) : runtime.model;
  const effectiveEffort = coerceInsightsChatReasoningEffort({
    model: effectiveModel,
    storedValue: opts.reasoningEffort ?? runtime.reasoningStored,
  }).stored;

  const shouldResetSeedAnswer = opts.auditAction === "CONTEXT_PACK_CREATED";

  const created = await prisma.insightContextPack.upsert({
    where: { sessionId_scopeKey: { sessionId: opts.sessionId, scopeKey } },
    create: {
      clientId: opts.clientId,
      sessionId: opts.sessionId,
      scopeKey,
      status: "PENDING",
      windowPreset: resolved.preset,
      windowFrom: resolved.from,
      windowTo: resolved.to,
      allCampaigns: opts.allCampaigns,
      campaignCap,
      selectedCampaignIds,
      effectiveCampaignIds: [],
      targetThreadsTotal: 0,
      processedThreads: 0,
      selectedLeadIds: [],
      processedLeadIds: [],
      selectedLeadsMeta: null,
      metricsSnapshot: null,
      synthesis: null,
      seedAssistantMessageId: null,
      model: effectiveModel,
      reasoningEffort: effectiveEffort,
      lastError: null,
      computedAt: null,
      computedByUserId: opts.userId,
      computedByEmail: opts.userEmail,
    },
    update: {
      status: "PENDING",
      windowPreset: resolved.preset,
      windowFrom: resolved.from,
      windowTo: resolved.to,
      allCampaigns: opts.allCampaigns,
      campaignCap,
      selectedCampaignIds,
      effectiveCampaignIds: [],
      targetThreadsTotal: 0,
      processedThreads: 0,
      selectedLeadIds: [],
      processedLeadIds: [],
      selectedLeadsMeta: null,
      metricsSnapshot: null,
      synthesis: null,
      ...(shouldResetSeedAnswer ? { seedAssistantMessageId: null } : {}),
      model: effectiveModel,
      reasoningEffort: effectiveEffort,
      lastError: null,
      computedAt: null,
      computedByUserId: opts.userId,
      computedByEmail: opts.userEmail,
    },
    select: { id: true },
  });

  await recordAuditEvent({
    clientId: opts.clientId,
    userId: opts.userId,
    action: opts.auditAction,
    sessionId: opts.sessionId,
    contextPackId: created.id,
    userEmail: opts.userEmail,
    details: {
      windowPreset: resolved.preset,
      windowFrom: resolved.from.toISOString(),
      windowTo: resolved.to.toISOString(),
      selectedCampaignIds,
      allCampaigns: opts.allCampaigns,
      campaignCap,
      model: effectiveModel,
      reasoningEffort: effectiveEffort,
    },
  });

  return { packId: created.id };
}

function toPublicPack(pack: {
  id: string;
  sessionId: string;
  status: InsightContextPackStatus;
  model: string;
  reasoningEffort: string;
  seedAssistantMessageId?: string | null;
  windowPreset: InsightsWindowPreset;
  windowFrom: Date;
  windowTo: Date;
  allCampaigns: boolean;
  campaignCap: number | null;
  selectedCampaignIds: string[];
  effectiveCampaignIds: string[];
  targetThreadsTotal: number;
  processedThreads: number;
  lastError: string | null;
  computedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): InsightContextPackPublic {
  return {
    id: pack.id,
    sessionId: pack.sessionId,
    status: pack.status,
    model: pack.model,
    reasoningEffort: pack.reasoningEffort,
    seedAssistantMessageId: pack.seedAssistantMessageId ?? null,
    windowPreset: pack.windowPreset,
    windowFrom: pack.windowFrom,
    windowTo: pack.windowTo,
    allCampaigns: pack.allCampaigns,
    campaignCap: pack.campaignCap,
    selectedCampaignIds: pack.selectedCampaignIds,
    effectiveCampaignIds: pack.effectiveCampaignIds,
    targetThreadsTotal: pack.targetThreadsTotal,
    processedThreads: pack.processedThreads,
    lastError: pack.lastError,
    computedAt: pack.computedAt,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
    deletedAt: pack.deletedAt,
  };
}

export async function startInsightsChatSeedQuestion(opts: {
  clientId: string | null | undefined;
  sessionId?: string | null;
  question: string;
  title?: string | null;
  windowPreset: InsightsWindowPreset;
  windowFrom?: string | Date | null;
  windowTo?: string | Date | null;
  campaignIds?: string[] | null;
  allCampaigns?: boolean | null;
  campaignCap?: number | null;
  model?: string | null;
  reasoningEffort?: string | null;
}): Promise<{
  success: boolean;
  data?: { sessionId: string; contextPackId: string; userMessageId: string };
  error?: string;
}> {
  try {
    const clientId = opts.clientId;
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAccess(clientId);

    const question = (opts.question || "").trim();
    if (!question) return { success: false, error: "Question is empty" };

    const existingSession = opts.sessionId
      ? await prisma.insightChatSession.findUnique({
          where: { id: opts.sessionId },
          select: { id: true, clientId: true, deletedAt: true, seedQuestion: true },
        })
      : null;

    if (existingSession && existingSession.clientId !== clientId) return { success: false, error: "Session not found" };
    if (existingSession?.deletedAt) return { success: false, error: "Session is deleted" };

    if (existingSession?.seedQuestion && existingSession.seedQuestion.trim() !== question) {
      return { success: false, error: "This session already has a seed question. Ask a follow-up instead." };
    }

    const sessionId = existingSession?.id
      ? existingSession.id
      : (
          await prisma.insightChatSession.create({
            data: {
              clientId,
              title: (opts.title || "").trim() || summarizeContentForPreview(question, 64) || "Insights Session",
              seedQuestion: question,
              createdByUserId: userId,
              createdByEmail: userEmail,
            },
            select: { id: true },
          })
        ).id;

    if (existingSession?.id && !existingSession.seedQuestion) {
      await prisma.insightChatSession.update({
        where: { id: existingSession.id },
        data: {
          seedQuestion: question,
          title: (opts.title || "").trim() || summarizeContentForPreview(question, 64) || undefined,
        },
      });
    }

    if (!existingSession) {
      await recordAuditEvent({ clientId, userId, userEmail, action: "SESSION_CREATED", sessionId });
    }

    const allCampaigns = Boolean(opts.allCampaigns);
    const campaignIds = Array.isArray(opts.campaignIds) ? opts.campaignIds : [];
    const campaignCap = opts.campaignCap !== null && opts.campaignCap !== undefined ? Number(opts.campaignCap) : null;

    const { packId } = await createOrResetContextPack({
      clientId,
      sessionId,
      userId,
      windowPreset: opts.windowPreset,
      windowFrom: parseOptionalDate(opts.windowFrom),
      windowTo: parseOptionalDate(opts.windowTo),
      selectedCampaignIds: allCampaigns ? [] : campaignIds,
      allCampaigns,
      campaignCap,
      model: opts.model ?? null,
      reasoningEffort: opts.reasoningEffort ?? null,
      userEmail,
      auditAction: "CONTEXT_PACK_CREATED",
    });

    const userMessage = await prisma.insightChatMessage.create({
      data: {
        clientId,
        sessionId,
        role: "USER",
        content: question,
        authorUserId: userId,
        authorEmail: userEmail,
        contextPackId: packId,
      },
      select: { id: true },
    });

    await recordAuditEvent({
      clientId,
      userId,
      action: "MESSAGE_CREATED",
      sessionId,
      contextPackId: packId,
      userEmail,
      details: { role: "USER" },
    });

    revalidatePath("/");
    return { success: true, data: { sessionId, contextPackId: packId, userMessageId: userMessage.id } };
  } catch (error) {
    console.error("[InsightsChat] Failed to start seed question:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to start question" };
  }
}

async function buildAnalyticsSnapshot(opts: {
  clientId: string;
  campaignIds: string[];
  windowFrom: Date;
  windowTo: Date;
}): Promise<unknown> {
  if (opts.campaignIds.length > 0) {
    const res = await getEmailCampaignAnalytics({
      clientId: opts.clientId,
      from: opts.windowFrom.toISOString(),
      to: opts.windowTo.toISOString(),
    });
    if (!res.success || !res.data) return { type: "email_campaigns", error: res.error || "Failed to load analytics" };
    const campaigns = res.data.campaigns.filter((c) => opts.campaignIds.includes(c.id));
    return { type: "email_campaigns", campaigns, weeklyReport: res.data.weeklyReport };
  }

  const overall = await getAnalytics(opts.clientId);
  if (!overall.success || !overall.data) return { type: "workspace", error: overall.error || "Failed to load analytics" };
  return { type: "workspace", data: overall.data };
}

export async function getLatestInsightContextPack(
  clientId: string | null | undefined,
  sessionId: string
): Promise<{ success: boolean; data?: { pack: InsightContextPackPublic | null }; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAccess(clientId);

    const pack = await prisma.insightContextPack.findFirst({
      where: { clientId, sessionId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        sessionId: true,
        status: true,
        model: true,
        reasoningEffort: true,
        windowPreset: true,
        allCampaigns: true,
        campaignCap: true,
        windowFrom: true,
        windowTo: true,
        selectedCampaignIds: true,
        effectiveCampaignIds: true,
        targetThreadsTotal: true,
        processedThreads: true,
        lastError: true,
        computedAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });

    return { success: true, data: { pack: pack ? toPublicPack(pack) : null } };
  } catch (error) {
    console.error("[InsightsChat] Failed to load latest pack:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to load context pack" };
  }
}

export async function recomputeInsightContextPack(opts: {
  clientId: string | null | undefined;
  sessionId: string;
  windowPreset: InsightsWindowPreset;
  windowFrom?: string | Date | null;
  windowTo?: string | Date | null;
  campaignIds?: string[] | null;
  allCampaigns?: boolean | null;
  campaignCap?: number | null;
  model?: string | null;
  reasoningEffort?: string | null;
}): Promise<{ success: boolean; data?: { contextPackId: string }; error?: string }> {
  return withAiTelemetrySourceIfUnset("action:insights_chat.recompute_context_pack", async () => {
    try {
      const clientId = opts.clientId;
      if (!clientId) return { success: false, error: "No workspace selected" };
      const { userId, userEmail } = await requireClientAccess(clientId);

    const session = await prisma.insightChatSession.findUnique({
      where: { id: opts.sessionId },
      select: { id: true, clientId: true, deletedAt: true, seedQuestion: true },
    });
    if (!session || session.clientId !== clientId) return { success: false, error: "Session not found" };
    if (session.deletedAt) return { success: false, error: "Session is deleted" };

    const seedQuestion =
      session.seedQuestion ||
      (
        await prisma.insightChatMessage.findFirst({
          where: { clientId, sessionId: session.id, role: "USER" },
          select: { content: true },
          orderBy: { createdAt: "asc" },
        })
      )?.content ||
      null;
    if (!seedQuestion?.trim()) return { success: false, error: "Seed question not found" };

    const allCampaigns = Boolean(opts.allCampaigns);
    const campaignIds = Array.isArray(opts.campaignIds) ? opts.campaignIds : [];
    const campaignCap = opts.campaignCap !== null && opts.campaignCap !== undefined ? Number(opts.campaignCap) : null;

    const { packId } = await createOrResetContextPack({
      clientId,
      sessionId: session.id,
      userId,
      windowPreset: opts.windowPreset,
      windowFrom: parseOptionalDate(opts.windowFrom),
      windowTo: parseOptionalDate(opts.windowTo),
      selectedCampaignIds: allCampaigns ? [] : campaignIds,
      allCampaigns,
      campaignCap,
      model: opts.model ?? null,
      reasoningEffort: opts.reasoningEffort ?? null,
      userEmail,
      auditAction: "CONTEXT_PACK_RECOMPUTED",
    });

    revalidatePath("/");
      return { success: true, data: { contextPackId: packId } };
    } catch (error) {
      console.error("[InsightsChat] Failed to recompute pack:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to recompute pack" };
    }
  });
}

export async function deleteInsightContextPack(
  clientId: string | null | undefined,
  contextPackId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAdminAccess(clientId);

    const pack = await prisma.insightContextPack.update({
      where: { id: contextPackId },
      data: {
        deletedAt: new Date(),
        deletedByUserId: userId,
      },
      select: { sessionId: true },
    });

    await recordAuditEvent({
      clientId,
      userId,
      userEmail,
      action: "CONTEXT_PACK_DELETED",
      sessionId: pack.sessionId,
      contextPackId,
      details: { op: "delete" },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[InsightsChat] Failed to delete pack:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to delete pack" };
  }
}

export async function restoreInsightContextPack(
  clientId: string | null | undefined,
  contextPackId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    const { userId, userEmail } = await requireClientAdminAccess(clientId);

    const pack = await prisma.insightContextPack.update({
      where: { id: contextPackId },
      data: {
        deletedAt: null,
        deletedByUserId: null,
      },
      select: { sessionId: true },
    });

    await recordAuditEvent({
      clientId,
      userId,
      userEmail,
      action: "CONTEXT_PACK_DELETED",
      sessionId: pack.sessionId,
      contextPackId,
      details: { op: "restore" },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[InsightsChat] Failed to restore pack:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to restore pack" };
  }
}

export async function runInsightContextPackStep(opts: {
  clientId: string | null | undefined;
  contextPackId: string;
  maxThreadsToProcess?: number;
}): Promise<{ success: boolean; data?: { pack: InsightContextPackPublic }; error?: string }> {
  return withAiTelemetrySourceIfUnset("action:insights_chat.run_context_pack_step", async () => {
    try {
      const clientId = opts.clientId;
      if (!clientId) return { success: false, error: "No workspace selected" };
      const { userId, userEmail } = await requireClientAccess(clientId);

      const pack = await prisma.insightContextPack.findUnique({
      where: { id: opts.contextPackId },
      select: {
        id: true,
        clientId: true,
        sessionId: true,
        status: true,
        windowPreset: true,
        allCampaigns: true,
        campaignCap: true,
        windowFrom: true,
        windowTo: true,
        selectedCampaignIds: true,
        effectiveCampaignIds: true,
        targetThreadsTotal: true,
        processedThreads: true,
        selectedLeadIds: true,
        processedLeadIds: true,
        selectedLeadsMeta: true,
        metricsSnapshot: true,
        synthesis: true,
        model: true,
        reasoningEffort: true,
        lastError: true,
        seedAssistantMessageId: true,
        computedAt: true,
        computedByUserId: true,
        computedByEmail: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        session: { select: { deletedAt: true, seedQuestion: true } },
      },
    });

      if (!pack || pack.clientId !== clientId) return { success: false, error: "Context pack not found" };
      if (pack.deletedAt) {
        await requireClientAdminAccess(clientId);
        return {
          success: true,
          data: {
            pack: toPublicPack({
              id: pack.id,
              sessionId: pack.sessionId,
              status: pack.status,
              model: pack.model,
              reasoningEffort: pack.reasoningEffort,
              windowPreset: pack.windowPreset,
              windowFrom: pack.windowFrom,
              windowTo: pack.windowTo,
              allCampaigns: pack.allCampaigns,
              campaignCap: pack.campaignCap,
              selectedCampaignIds: pack.selectedCampaignIds,
              effectiveCampaignIds: pack.effectiveCampaignIds,
              targetThreadsTotal: pack.targetThreadsTotal,
              processedThreads: pack.processedThreads,
              lastError: pack.lastError,
              computedAt: pack.computedAt,
              createdAt: pack.createdAt,
              updatedAt: pack.updatedAt,
              deletedAt: pack.deletedAt,
            }),
          },
        };
      }
      if (pack.session.deletedAt) return { success: false, error: "Session is deleted" };

    if (pack.status === "COMPLETE" || pack.status === "FAILED") {
      return { success: true, data: { pack: toPublicPack(pack) } };
    }

    const model = coerceInsightsChatModel(pack.model);
    const effort = coerceInsightsChatReasoningEffort({ model, storedValue: pack.reasoningEffort });

    const isUninitialized = pack.targetThreadsTotal === 0 || pack.selectedLeadIds.length === 0;
    if (isUninitialized) {
      const campaignScope: InsightCampaignScope = pack.allCampaigns
        ? { mode: "all", cap: pack.campaignCap ?? 10 }
        : pack.selectedCampaignIds.length
          ? { mode: "selected", campaignIds: pack.selectedCampaignIds }
          : { mode: "workspace" };

      const selection = await selectThreadsForInsightPack({
        clientId,
        from: pack.windowFrom,
        to: pack.windowTo,
        campaignScope,
      });

      const threads = selection.threads;
      if (threads.length === 0) {
        const updated = await prisma.insightContextPack.update({
          where: { id: pack.id },
          data: {
            status: "FAILED",
            lastError: "No threads found for this window/campaign scope.",
          },
          select: {
            id: true,
            sessionId: true,
            status: true,
            model: true,
            reasoningEffort: true,
            windowPreset: true,
            windowFrom: true,
            windowTo: true,
            allCampaigns: true,
            campaignCap: true,
            selectedCampaignIds: true,
            effectiveCampaignIds: true,
            targetThreadsTotal: true,
            processedThreads: true,
            lastError: true,
            computedAt: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
          },
        });
        return { success: true, data: { pack: toPublicPack(updated) } };
      }

      const analyticsSnapshot = await buildAnalyticsSnapshot({
        clientId,
        campaignIds: selection.campaignIds,
        windowFrom: pack.windowFrom,
        windowTo: pack.windowTo,
      });

      const updated = await prisma.insightContextPack.update({
        where: { id: pack.id },
        data: {
          status: "RUNNING",
          effectiveCampaignIds: selection.campaignIds,
          targetThreadsTotal: threads.length,
          processedThreads: 0,
          selectedLeadIds: threads.map((t) => t.leadId),
          processedLeadIds: [],
          selectedLeadsMeta: threads as any,
          metricsSnapshot: analyticsSnapshot as any,
          synthesis: null,
          lastError: null,
          computedAt: null,
        },
        select: {
          id: true,
          sessionId: true,
          status: true,
          model: true,
          reasoningEffort: true,
          windowPreset: true,
          windowFrom: true,
          windowTo: true,
          allCampaigns: true,
          campaignCap: true,
          selectedCampaignIds: true,
          effectiveCampaignIds: true,
          targetThreadsTotal: true,
          processedThreads: true,
          lastError: true,
          computedAt: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });

      return { success: true, data: { pack: toPublicPack(updated) } };
    }

    if (pack.processedLeadIds.length < pack.selectedLeadIds.length) {
      const selectedMeta = Array.isArray(pack.selectedLeadsMeta) ? (pack.selectedLeadsMeta as any[]) : [];
      const outcomeByLeadId = new Map<string, ConversationInsightOutcome>();
      const metaByLeadId = new Map<string, any>();
      for (const row of selectedMeta) {
        const leadId = typeof row?.leadId === "string" ? row.leadId : null;
        const outcome = typeof row?.outcome === "string" ? row.outcome : null;
        if (leadId) metaByLeadId.set(leadId, row);
        if (leadId && outcome) outcomeByLeadId.set(leadId, outcome as ConversationInsightOutcome);
      }

      const processed = new Set(pack.processedLeadIds);
      const remaining = pack.selectedLeadIds.filter((id) => !processed.has(id));
      const batchSize = Math.max(1, Math.min(10, Math.trunc(Number(opts.maxThreadsToProcess ?? 3) || 3)));
      const batch = remaining.slice(0, batchSize);

      const results = await Promise.allSettled(
        batch.map(async (leadId) => {
          const outcome = outcomeByLeadId.get(leadId) ?? "UNKNOWN";

          const existing = await prisma.leadConversationInsight.findUnique({
            where: { leadId },
            select: { id: true },
          });
          if (existing) return { leadId, ok: true } as const;

          const extracted = await extractConversationInsightForLead({
            clientId,
            leadId,
            outcome,
            model,
            reasoningEffort: effort.api,
          });

          await prisma.leadConversationInsight.upsert({
            where: { leadId },
            create: {
              leadId,
              outcome,
              insight: extracted.insight as any,
              model,
              reasoningEffort: effort.stored,
              source: "chat_pack",
              computedAt: new Date(),
              computedByUserId: pack.computedByUserId ?? null,
              computedByEmail: pack.computedByEmail ?? null,
            },
            update: {
              outcome,
              insight: extracted.insight as any,
              model,
              reasoningEffort: effort.stored,
              source: "chat_pack",
              computedAt: new Date(),
              computedByUserId: pack.computedByUserId ?? null,
              computedByEmail: pack.computedByEmail ?? null,
            },
          });

          return { leadId, ok: true } as const;
        })
      );

      const nextProcessedLeadIds = Array.from(new Set([...pack.processedLeadIds, ...batch]));
      const nextMeta = selectedMeta.map((row) => {
        const leadId = typeof row?.leadId === "string" ? row.leadId : null;
        if (!leadId) return row;
        if (!batch.includes(leadId)) return row;
        const res = results[batch.indexOf(leadId)];
        if (res && res.status === "rejected") {
          return { ...row, processed: true, error: res.reason instanceof Error ? res.reason.message : String(res.reason) };
        }
        return { ...row, processed: true };
      });

      const updated = await prisma.insightContextPack.update({
        where: { id: pack.id },
        data: {
          status: "RUNNING",
          processedLeadIds: nextProcessedLeadIds,
          processedThreads: nextProcessedLeadIds.length,
          selectedLeadsMeta: nextMeta as any,
        },
        select: {
          id: true,
          sessionId: true,
          status: true,
          model: true,
          reasoningEffort: true,
          seedAssistantMessageId: true,
          windowPreset: true,
          windowFrom: true,
          windowTo: true,
          allCampaigns: true,
          campaignCap: true,
          selectedCampaignIds: true,
          effectiveCampaignIds: true,
          targetThreadsTotal: true,
          processedThreads: true,
          lastError: true,
          computedAt: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });

      let seedAssistantMessageIdOverride: string | null = null;
      try {
        if (!pack.seedAssistantMessageId) {
          const minThreads = getFastSeedMinThreads(pack.targetThreadsTotal);
          if (nextProcessedLeadIds.length >= minThreads) {
            const seedQuestion = (pack.session.seedQuestion || "").trim();
            if (seedQuestion) {
              const insights = await prisma.leadConversationInsight.findMany({
                where: { leadId: { in: nextProcessedLeadIds } },
                select: { leadId: true, insight: true },
              });
              const insightByLeadId = new Map<string, ConversationInsight>();
              for (const row of insights) insightByLeadId.set(row.leadId, row.insight as any as ConversationInsight);

              const threads = selectFastSeedThreads({
                processedLeadIds: nextProcessedLeadIds,
                selectedLeadsMeta: nextMeta,
                insightByLeadId,
                maxThreads: Math.min(getFastSeedMaxThreads(), nextProcessedLeadIds.length),
              });

              if (threads.length >= 5) {
                const windowLabel = formatInsightsWindowLabel({
                  preset: pack.windowPreset,
                  from: pack.windowFrom,
                  to: pack.windowTo,
                });
                const campaignLabel = pack.allCampaigns
                  ? `All campaigns (cap ${pack.campaignCap ?? 10})`
                  : pack.effectiveCampaignIds.length
                    ? `Selected campaigns (${pack.effectiveCampaignIds.length})`
                    : "Workspace (no campaign filter)";

                const fastPackMarkdown = buildFastContextPackMarkdown({
                  windowLabel,
                  campaignContextLabel: campaignLabel,
                  processedThreads: nextProcessedLeadIds.length,
                  targetThreadsTotal: pack.targetThreadsTotal,
                  threads,
                });

                const fastThreadIndex: InsightThreadIndexItem[] = threads.map((t, idx) => ({
                  ref: `T${String(idx + 1).padStart(3, "0")}`,
                  leadId: t.leadId,
                  outcome: t.outcome,
                  exampleType: "positive",
                  selectionBucket: "fast_seed",
                  emailCampaignId: null,
                  campaignName: null,
                  leadLabel: `lead ${t.leadId}`,
                  summary: String(t.insight.summary || "").trim().slice(0, 380) || "No extracted summary available.",
                }));

                const answer = await answerInsightsChatQuestion({
                  clientId,
                  sessionId: pack.sessionId,
                  question: seedQuestion,
                  windowLabel,
                  campaignContextLabel: campaignLabel,
                  analyticsSnapshot: pack.metricsSnapshot,
                  contextPackMarkdown: fastPackMarkdown,
                  threadIndex: fastThreadIndex,
                  recentMessages: [],
                  model,
                  reasoningEffort: effort.api,
                });

                const assistantMessage = await prisma.insightChatMessage.create({
                  data: {
                    clientId,
                    sessionId: pack.sessionId,
                    role: "ASSISTANT",
                    content: `**Fast answer (partial pack)**\n\n${answer.answer}`.trim(),
                    citations: answer.citations as any,
                    authorUserId: null,
                    authorEmail: null,
                    contextPackId: pack.id,
                  },
                  select: { id: true },
                });

                seedAssistantMessageIdOverride = assistantMessage.id;

                await prisma.insightContextPack.update({
                  where: { id: pack.id },
                  data: { seedAssistantMessageId: assistantMessage.id },
                });

                await recordAuditEvent({
                  clientId,
                  userId,
                  userEmail,
                  action: "MESSAGE_CREATED",
                  sessionId: pack.sessionId,
                  contextPackId: pack.id,
                  details: { role: "ASSISTANT", seed: true, fast: true },
                });
              }
            }
          }
        }
      } catch (error) {
        // Best-effort: keep pack building even if the fast-answer generation fails.
        console.warn("[InsightsChat] Fast seed answer generation failed:", error);
      }

      return {
        success: true,
        data: { pack: toPublicPack(seedAssistantMessageIdOverride ? { ...updated, seedAssistantMessageId: seedAssistantMessageIdOverride } : updated) },
      };
    }

    if (pack.synthesis) {
      const updated = await prisma.insightContextPack.update({
        where: { id: pack.id },
        data: { status: "COMPLETE" },
        select: {
          id: true,
          sessionId: true,
          status: true,
          model: true,
          reasoningEffort: true,
          windowPreset: true,
          windowFrom: true,
          windowTo: true,
          allCampaigns: true,
          campaignCap: true,
          selectedCampaignIds: true,
          effectiveCampaignIds: true,
          targetThreadsTotal: true,
          processedThreads: true,
          lastError: true,
          computedAt: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });
      return { success: true, data: { pack: toPublicPack(updated) } };
    }

    const seedQuestion = (pack.session.seedQuestion || "").trim();
    if (!seedQuestion) {
      const updated = await prisma.insightContextPack.update({
        where: { id: pack.id },
        data: { status: "FAILED", lastError: "Missing seed question for this session." },
        select: {
          id: true,
          sessionId: true,
          status: true,
          model: true,
          reasoningEffort: true,
          windowPreset: true,
          windowFrom: true,
          windowTo: true,
          allCampaigns: true,
          campaignCap: true,
          selectedCampaignIds: true,
          effectiveCampaignIds: true,
          targetThreadsTotal: true,
          processedThreads: true,
          lastError: true,
          computedAt: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });
      return { success: true, data: { pack: toPublicPack(updated) } };
    }

    const insights = await prisma.leadConversationInsight.findMany({
      where: { leadId: { in: pack.selectedLeadIds } },
      select: { leadId: true, insight: true },
    });
    const insightByLeadId = new Map<string, ConversationInsight>();
    for (const row of insights) {
      insightByLeadId.set(row.leadId, row.insight as any as ConversationInsight);
    }

    const selectedMeta = Array.isArray(pack.selectedLeadsMeta) ? (pack.selectedLeadsMeta as any[]) : [];
    const outcomeByLeadId = new Map<string, ConversationInsightOutcome>();
    for (const row of selectedMeta) {
      const leadId = typeof row?.leadId === "string" ? row.leadId : null;
      const outcome = typeof row?.outcome === "string" ? row.outcome : null;
      if (leadId && outcome) outcomeByLeadId.set(leadId, outcome as ConversationInsightOutcome);
    }

    const threadsForSynthesis = pack.selectedLeadIds
      .map((leadId) => {
        const insight = insightByLeadId.get(leadId);
        if (!insight) return null;
        return { leadId, outcome: outcomeByLeadId.get(leadId) ?? "UNKNOWN", insight };
      })
      .filter(Boolean) as Array<{ leadId: string; outcome: ConversationInsightOutcome; insight: ConversationInsight }>;

    const windowLabel = formatInsightsWindowLabel({
      preset: pack.windowPreset,
      from: pack.windowFrom,
      to: pack.windowTo,
    });

    const isInSynthesisStage = pack.processedLeadIds.length >= pack.selectedLeadIds.length && !pack.synthesis;
    if (isInSynthesisStage && pack.lastError && Date.now() - pack.updatedAt.getTime() < 30_000) {
      // Avoid hammering the synthesis step in tight polling loops after transient failures.
      // Cron (and/or a later manual retry) will pick this up again.
      return { success: true, data: { pack: toPublicPack(pack) } };
    }

      try {
      const synthesis = await synthesizeInsightContextPack({
        clientId,
        seedQuestion,
        windowLabel,
        campaignIds: pack.effectiveCampaignIds,
        analyticsSnapshot: pack.metricsSnapshot,
        threads: threadsForSynthesis,
        model,
        reasoningEffort: effort.api,
      });

      const updated = await prisma.insightContextPack.update({
        where: { id: pack.id },
        data: {
          status: "COMPLETE",
          synthesis: synthesis.synthesis as any,
          computedAt: new Date(),
          lastError: null,
        },
        select: {
          id: true,
          sessionId: true,
          status: true,
          model: true,
          reasoningEffort: true,
          windowPreset: true,
          windowFrom: true,
          windowTo: true,
          allCampaigns: true,
          campaignCap: true,
          selectedCampaignIds: true,
          effectiveCampaignIds: true,
          targetThreadsTotal: true,
          processedThreads: true,
          lastError: true,
          computedAt: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });

      return { success: true, data: { pack: toPublicPack(updated) } };
    } catch (error) {
      const msg = formatOpenAiErrorSummary(error);
      const status: InsightContextPackStatus = isRetryableOpenAiError(error) ? "RUNNING" : "FAILED";
      const updated = await prisma.insightContextPack.update({
        where: { id: pack.id },
        data: {
          status,
          lastError: msg,
        },
        select: {
          id: true,
          sessionId: true,
          status: true,
          model: true,
          reasoningEffort: true,
          windowPreset: true,
          windowFrom: true,
          windowTo: true,
          allCampaigns: true,
          campaignCap: true,
          selectedCampaignIds: true,
          effectiveCampaignIds: true,
          targetThreadsTotal: true,
          processedThreads: true,
          lastError: true,
          computedAt: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      });
      return { success: true, data: { pack: toPublicPack(updated) } };
    }
    } catch (error) {
      console.error("[InsightsChat] Failed to run context pack step:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to run context pack step" };
    }
  });
}

export async function finalizeInsightsChatSeedAnswer(opts: {
  clientId: string | null | undefined;
  sessionId: string;
  contextPackId: string;
  userMessageId: string;
  model?: string | null;
  reasoningEffort?: string | null;
}): Promise<{ success: boolean; data?: { assistantMessageId: string; answer: string }; error?: string }> {
  return withAiTelemetrySourceIfUnset("action:insights_chat.finalize_seed_answer", async () => {
    try {
      const clientId = opts.clientId;
      if (!clientId) return { success: false, error: "No workspace selected" };
      const { userId, userEmail } = await requireClientAccess(clientId);

      const [pack, userMsg] = await Promise.all([
      prisma.insightContextPack.findUnique({
        where: { id: opts.contextPackId },
        select: {
          id: true,
          clientId: true,
          sessionId: true,
          status: true,
          model: true,
          reasoningEffort: true,
          windowPreset: true,
          allCampaigns: true,
          campaignCap: true,
          windowFrom: true,
          windowTo: true,
          selectedCampaignIds: true,
          effectiveCampaignIds: true,
          selectedLeadsMeta: true,
          metricsSnapshot: true,
          synthesis: true,
          seedAssistantMessageId: true,
          computedAt: true,
        },
      }),
      prisma.insightChatMessage.findUnique({
        where: { id: opts.userMessageId },
        select: { id: true, content: true, sessionId: true },
      }),
    ]);

    if (!pack || pack.clientId !== clientId || pack.sessionId !== opts.sessionId) return { success: false, error: "Context pack not found" };
    const synthesisObj = pack.synthesis as any;
    const packMarkdown = typeof synthesisObj?.pack_markdown === "string" ? synthesisObj.pack_markdown : null;
    if (pack.status !== "COMPLETE" || !packMarkdown) return { success: false, error: "Context pack is not ready" };
    if (!userMsg || userMsg.sessionId !== opts.sessionId) return { success: false, error: "Seed message not found" };

      const latestCompute = await prisma.insightChatAuditEvent.findFirst({
        where: { clientId, contextPackId: pack.id, action: { in: ["CONTEXT_PACK_CREATED", "CONTEXT_PACK_RECOMPUTED"] } },
        select: { action: true },
        orderBy: { createdAt: "desc" },
      });

      const existingSeed = pack.seedAssistantMessageId
        ? await prisma.insightChatMessage.findUnique({
            where: { id: pack.seedAssistantMessageId },
            select: { id: true, content: true, createdAt: true, sessionId: true },
          })
        : null;

      if (existingSeed && existingSeed.sessionId === opts.sessionId) {
        // Recompute should not automatically replace the existing answer.
        if (latestCompute?.action === "CONTEXT_PACK_RECOMPUTED") {
          return { success: true, data: { assistantMessageId: existingSeed.id, answer: existingSeed.content } };
        }
        // If we already have an answer created after the full pack was computed, return it.
        if (pack.computedAt && existingSeed.createdAt >= pack.computedAt) {
          return { success: true, data: { assistantMessageId: existingSeed.id, answer: existingSeed.content } };
        }
      }

    const model = coerceInsightsChatModel(opts.model ?? pack.model);
    const effort = coerceInsightsChatReasoningEffort({ model, storedValue: opts.reasoningEffort ?? pack.reasoningEffort });

    const windowLabel = formatInsightsWindowLabel({
      preset: pack.windowPreset,
      from: pack.windowFrom,
      to: pack.windowTo,
    });
    const campaignLabel = pack.allCampaigns
      ? `All campaigns (cap ${pack.campaignCap ?? 10})`
      : pack.effectiveCampaignIds.length
        ? `Selected campaigns (${pack.effectiveCampaignIds.length})`
        : "Workspace (no campaign filter)";

    const cleanedMeta = coerceSelectedInsightThreadsMeta(pack.selectedLeadsMeta);
    const threadIndex = await buildInsightThreadIndex({ clientId, selectedMeta: cleanedMeta });

    const answer = await answerInsightsChatQuestion({
      clientId,
      sessionId: opts.sessionId,
      question: userMsg.content,
      windowLabel,
      campaignContextLabel: campaignLabel,
      analyticsSnapshot: pack.metricsSnapshot,
      contextPackMarkdown: packMarkdown,
      threadIndex,
      recentMessages: [],
      model,
      reasoningEffort: effort.api,
    });

      const isUpgradeFromFast = Boolean(
        existingSeed &&
          existingSeed.sessionId === opts.sessionId &&
          pack.computedAt &&
          existingSeed.createdAt < pack.computedAt &&
          latestCompute?.action !== "CONTEXT_PACK_RECOMPUTED"
      );

    const assistantMessage = await prisma.insightChatMessage.create({
      data: {
        clientId,
        sessionId: opts.sessionId,
        role: "ASSISTANT",
        content: `${isUpgradeFromFast ? "**Full answer (pack complete)**\n\n" : ""}${answer.answer}`.trim(),
        citations: answer.citations as any,
        authorUserId: null,
        authorEmail: null,
        contextPackId: pack.id,
      },
      select: { id: true },
    });

    await prisma.insightContextPack.update({
      where: { id: pack.id },
      data: { seedAssistantMessageId: assistantMessage.id },
    });

    await recordAuditEvent({
      clientId,
      userId,
      userEmail,
      action: "MESSAGE_CREATED",
      sessionId: opts.sessionId,
      contextPackId: pack.id,
      details: { role: "ASSISTANT", seed: true },
    });

    revalidatePath("/");
      return { success: true, data: { assistantMessageId: assistantMessage.id, answer: answer.answer } };
    } catch (error) {
      console.error("[InsightsChat] Failed to finalize seed answer:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to finalize answer" };
    }
  });
}

export async function regenerateInsightsChatSeedAnswer(opts: {
  clientId: string | null | undefined;
  sessionId: string;
  model?: string | null;
  reasoningEffort?: string | null;
}): Promise<{ success: boolean; data?: { assistantMessageId: string; answer: string }; error?: string }> {
  return withAiTelemetrySourceIfUnset("action:insights_chat.regenerate_seed_answer", async () => {
    try {
      const clientId = opts.clientId;
      if (!clientId) return { success: false, error: "No workspace selected" };
      const { userId, userEmail } = await requireClientAccess(clientId);

      const session = await prisma.insightChatSession.findUnique({
        where: { id: opts.sessionId },
        select: { id: true, clientId: true, deletedAt: true, seedQuestion: true },
      });
      if (!session || session.clientId !== clientId) return { success: false, error: "Session not found" };
      if (session.deletedAt) return { success: false, error: "Session is deleted" };

      const pack = await prisma.insightContextPack.findFirst({
        where: { clientId, sessionId: session.id, status: "COMPLETE", deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          clientId: true,
          sessionId: true,
          status: true,
          model: true,
          reasoningEffort: true,
          windowPreset: true,
          allCampaigns: true,
          campaignCap: true,
          windowFrom: true,
          windowTo: true,
          effectiveCampaignIds: true,
          selectedLeadsMeta: true,
          metricsSnapshot: true,
          synthesis: true,
        },
      });

      const synthesisObj = pack?.synthesis as any;
      const packMarkdown = typeof synthesisObj?.pack_markdown === "string" ? synthesisObj.pack_markdown : null;
      if (!pack || !packMarkdown) return { success: false, error: "Context pack is not ready" };

      const seedQuestion =
        (session.seedQuestion || "").trim() ||
        (
          await prisma.insightChatMessage.findFirst({
            where: { clientId, sessionId: session.id, role: "USER" },
            select: { content: true },
            orderBy: { createdAt: "asc" },
          })
        )?.content ||
        null;
      if (!seedQuestion?.trim()) return { success: false, error: "Seed question not found" };

      const model = coerceInsightsChatModel(opts.model ?? pack.model);
      const effort = coerceInsightsChatReasoningEffort({ model, storedValue: opts.reasoningEffort ?? pack.reasoningEffort });
      const windowLabel = formatInsightsWindowLabel({
        preset: pack.windowPreset,
        from: pack.windowFrom,
        to: pack.windowTo,
      });
      const campaignLabel = pack.allCampaigns
        ? `All campaigns (cap ${pack.campaignCap ?? 10})`
        : pack.effectiveCampaignIds.length
          ? `Selected campaigns (${pack.effectiveCampaignIds.length})`
          : "Workspace (no campaign filter)";

      const cleanedMeta = coerceSelectedInsightThreadsMeta(pack.selectedLeadsMeta);
      const threadIndex = await buildInsightThreadIndex({ clientId, selectedMeta: cleanedMeta });

      const answer = await answerInsightsChatQuestion({
        clientId,
        sessionId: session.id,
        question: seedQuestion,
        windowLabel,
        campaignContextLabel: campaignLabel,
        analyticsSnapshot: pack.metricsSnapshot,
        contextPackMarkdown: packMarkdown,
        threadIndex,
        recentMessages: [],
        model,
        reasoningEffort: effort.api,
      });

      const assistantMessage = await prisma.insightChatMessage.create({
        data: {
          clientId,
          sessionId: session.id,
          role: "ASSISTANT",
          content: answer.answer,
          citations: answer.citations as any,
          authorUserId: null,
          authorEmail: null,
          contextPackId: pack.id,
        },
        select: { id: true },
      });

      await prisma.insightContextPack.update({
        where: { id: pack.id },
        data: { seedAssistantMessageId: assistantMessage.id },
      });

      await recordAuditEvent({
        clientId,
        userId,
        userEmail,
        action: "MESSAGE_CREATED",
        sessionId: session.id,
        contextPackId: pack.id,
        details: { role: "ASSISTANT", seed: true, regenerate: true },
      });

      revalidatePath("/");
      return { success: true, data: { assistantMessageId: assistantMessage.id, answer: answer.answer } };
    } catch (error) {
      console.error("[InsightsChat] Failed to regenerate seed answer:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to regenerate answer" };
    }
  });
}

export async function sendInsightsChatMessage(opts: {
  clientId: string | null | undefined;
  sessionId: string;
  content: string;
  model?: string | null;
  reasoningEffort?: string | null;
}): Promise<{
  success: boolean;
  data?: {
    userMessage: { id: string; createdAt: Date };
    assistantMessage: { id: string; createdAt: Date; content: string; citations: InsightThreadCitation[] | null };
  };
  error?: string;
}> {
  return withAiTelemetrySourceIfUnset("action:insights_chat.send_message", async () => {
    try {
      const clientId = opts.clientId;
      if (!clientId) return { success: false, error: "No workspace selected" };
      const { userId, userEmail } = await requireClientAccess(clientId);

    const content = (opts.content || "").trim();
    if (!content) return { success: false, error: "Message is empty" };

    const session = await prisma.insightChatSession.findUnique({
      where: { id: opts.sessionId },
      select: { id: true, clientId: true, deletedAt: true },
    });
    if (!session || session.clientId !== clientId) return { success: false, error: "Session not found" };
    if (session.deletedAt) return { success: false, error: "Session is deleted" };

    const pack = await prisma.insightContextPack.findFirst({
      where: { clientId, sessionId: session.id, status: "COMPLETE", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        model: true,
        reasoningEffort: true,
        windowPreset: true,
        allCampaigns: true,
        campaignCap: true,
        windowFrom: true,
        windowTo: true,
        effectiveCampaignIds: true,
        selectedLeadsMeta: true,
        metricsSnapshot: true,
        synthesis: true,
      },
    });
    const synthesisObj = pack?.synthesis as any;
    const packMarkdown = typeof synthesisObj?.pack_markdown === "string" ? synthesisObj.pack_markdown : null;
    if (!pack || !packMarkdown) return { success: false, error: "Context pack is not ready" };

    const userMessage = await prisma.insightChatMessage.create({
      data: {
        clientId,
        sessionId: session.id,
        role: "USER",
        content,
        authorUserId: userId,
        authorEmail: userEmail,
        contextPackId: pack.id,
      },
      select: { id: true, createdAt: true },
    });

    const recent = await prisma.insightChatMessage.findMany({
      where: { clientId, sessionId: session.id },
      select: { role: true, content: true },
      orderBy: { createdAt: "desc" },
      take: 16,
    });

    const model = coerceInsightsChatModel(opts.model ?? pack.model);
    const effort = coerceInsightsChatReasoningEffort({ model, storedValue: opts.reasoningEffort ?? pack.reasoningEffort });
    const windowLabel = formatInsightsWindowLabel({
      preset: pack.windowPreset,
      from: pack.windowFrom,
      to: pack.windowTo,
    });
    const campaignLabel = pack.allCampaigns
      ? `All campaigns (cap ${pack.campaignCap ?? 10})`
      : pack.effectiveCampaignIds.length
        ? `Selected campaigns (${pack.effectiveCampaignIds.length})`
        : "Workspace (no campaign filter)";

    const cleanedMeta = coerceSelectedInsightThreadsMeta(pack.selectedLeadsMeta);
    const threadIndex = await buildInsightThreadIndex({ clientId, selectedMeta: cleanedMeta });

    const answer = await answerInsightsChatQuestion({
      clientId,
      sessionId: session.id,
      question: content,
      windowLabel,
      campaignContextLabel: campaignLabel,
      analyticsSnapshot: pack.metricsSnapshot,
      contextPackMarkdown: packMarkdown,
      threadIndex,
      recentMessages: recent
        .reverse()
        .map((m) => ({ role: roleToPublic(m.role), content: m.content }))
        .filter((m) => m.role === "user" || m.role === "assistant") as Array<{ role: "user" | "assistant"; content: string }>,
      model,
      reasoningEffort: effort.api,
    });

    const assistantMessage = await prisma.insightChatMessage.create({
      data: {
        clientId,
        sessionId: session.id,
        role: "ASSISTANT",
        content: answer.answer,
        citations: answer.citations as any,
        authorUserId: null,
        authorEmail: null,
        contextPackId: pack.id,
      },
      select: { id: true, createdAt: true },
    });

    await recordAuditEvent({
      clientId,
      userId,
      action: "MESSAGE_CREATED",
      sessionId: session.id,
      contextPackId: pack.id,
      userEmail,
      details: { role: "USER/ASSISTANT" },
    });

    revalidatePath("/");
      return {
        success: true,
        data: {
          userMessage: { id: userMessage.id, createdAt: userMessage.createdAt },
          assistantMessage: {
            id: assistantMessage.id,
            createdAt: assistantMessage.createdAt,
            content: answer.answer,
            citations: answer.citations,
          },
        },
      };
    } catch (error) {
      console.error("[InsightsChat] Failed to send message:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to send message" };
    }
  });
}

export async function regenerateInsightsChatFollowupAnswer(opts: {
  clientId: string | null | undefined;
  sessionId: string;
  userMessageId: string;
  model?: string | null;
  reasoningEffort?: string | null;
}): Promise<{
  success: boolean;
  data?: { assistantMessage: { id: string; createdAt: Date; content: string; citations: InsightThreadCitation[] | null } };
  error?: string;
}> {
  return withAiTelemetrySourceIfUnset("action:insights_chat.regenerate_followup_answer", async () => {
    try {
      const clientId = opts.clientId;
      if (!clientId) return { success: false, error: "No workspace selected" };
      const { userId, userEmail } = await requireClientAccess(clientId);

      const session = await prisma.insightChatSession.findUnique({
        where: { id: opts.sessionId },
        select: { id: true, clientId: true, deletedAt: true },
      });
      if (!session || session.clientId !== clientId) return { success: false, error: "Session not found" };
      if (session.deletedAt) return { success: false, error: "Session is deleted" };

      const [pack, userMsg] = await Promise.all([
        prisma.insightContextPack.findFirst({
          where: { clientId, sessionId: session.id, status: "COMPLETE", deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            model: true,
            reasoningEffort: true,
            windowPreset: true,
            allCampaigns: true,
            campaignCap: true,
            windowFrom: true,
            windowTo: true,
            effectiveCampaignIds: true,
            selectedLeadsMeta: true,
            metricsSnapshot: true,
            synthesis: true,
          },
        }),
        prisma.insightChatMessage.findUnique({
          where: { id: opts.userMessageId },
          select: { id: true, sessionId: true, role: true, content: true },
        }),
      ]);

      const synthesisObj = pack?.synthesis as any;
      const packMarkdown = typeof synthesisObj?.pack_markdown === "string" ? synthesisObj.pack_markdown : null;
      if (!pack || !packMarkdown) return { success: false, error: "Context pack is not ready" };
      if (!userMsg || userMsg.sessionId !== session.id || userMsg.role !== "USER") return { success: false, error: "Message not found" };

      const recent = await prisma.insightChatMessage.findMany({
        where: { clientId, sessionId: session.id },
        select: { role: true, content: true },
        orderBy: { createdAt: "desc" },
        take: 16,
      });

      const model = coerceInsightsChatModel(opts.model ?? pack.model);
      const effort = coerceInsightsChatReasoningEffort({
        model,
        storedValue: opts.reasoningEffort ?? pack.reasoningEffort,
      });
      const windowLabel = formatInsightsWindowLabel({
        preset: pack.windowPreset,
        from: pack.windowFrom,
        to: pack.windowTo,
      });
      const campaignLabel = pack.allCampaigns
        ? `All campaigns (cap ${pack.campaignCap ?? 10})`
        : pack.effectiveCampaignIds.length
          ? `Selected campaigns (${pack.effectiveCampaignIds.length})`
          : "Workspace (no campaign filter)";

      const cleanedMeta = coerceSelectedInsightThreadsMeta(pack.selectedLeadsMeta);
      const threadIndex = await buildInsightThreadIndex({ clientId, selectedMeta: cleanedMeta });

      const answer = await answerInsightsChatQuestion({
        clientId,
        sessionId: session.id,
        question: userMsg.content,
        windowLabel,
        campaignContextLabel: campaignLabel,
        analyticsSnapshot: pack.metricsSnapshot,
        contextPackMarkdown: packMarkdown,
        threadIndex,
        recentMessages: recent
          .reverse()
          .map((m) => ({ role: roleToPublic(m.role), content: m.content }))
          .filter((m) => m.role === "user" || m.role === "assistant") as Array<{ role: "user" | "assistant"; content: string }>,
        model,
        reasoningEffort: effort.api,
      });

      const assistantMessage = await prisma.insightChatMessage.create({
        data: {
          clientId,
          sessionId: session.id,
          role: "ASSISTANT",
          content: answer.answer,
          citations: answer.citations as any,
          authorUserId: null,
          authorEmail: null,
          contextPackId: pack.id,
        },
        select: { id: true, createdAt: true },
      });

      await recordAuditEvent({
        clientId,
        userId,
        userEmail,
        action: "MESSAGE_CREATED",
        sessionId: session.id,
        contextPackId: pack.id,
        details: { role: "ASSISTANT", regenerate: true, basedOnUserMessageId: userMsg.id },
      });

      revalidatePath("/");
      return {
        success: true,
        data: { assistantMessage: { id: assistantMessage.id, createdAt: assistantMessage.createdAt, content: answer.answer, citations: answer.citations } },
      };
    } catch (error) {
      console.error("[InsightsChat] Failed to regenerate follow-up answer:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to regenerate answer" };
    }
  });
}
