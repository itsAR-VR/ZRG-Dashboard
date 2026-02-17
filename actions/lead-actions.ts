"use server";

import { getPublicAppUrl } from "@/lib/app-url";
import { addToAlternateEmails, emailsMatch, normalizeOptionalEmail, validateEmail } from "@/lib/email-participants";
import { ATTENTION_SENTIMENT_TAGS } from "@/lib/inbox-counts-constants";
import { GLOBAL_SCOPE_USER_ID, INBOX_COUNTS_STALE_MS } from "@/lib/inbox-counts";
import { getAvailableChannels } from "@/lib/lead-matching";
import { prisma } from "@/lib/prisma";
import { redisGetJson, redisSetJson } from "@/lib/redis";
import { toSafeActionError } from "@/lib/safe-action-error";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
import { getSupabaseUserEmailsByIds } from "@/lib/supabase/admin";
import {
  getAccessibleClientIdsForUser,
  getUserRoleForClient,
  isSetterRole,
  requireAuthUser,
  requireClientAdminAccess,
  requireLeadAccessById,
  resolveClientScope,
} from "@/lib/workspace-access";
import { ClientMemberRole, Prisma } from "@prisma/client";

export type Channel = "sms" | "email" | "linkedin";

export interface ConversationData {
  id: string;
  lead: {
    id: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    alternateEmails: string[];
    currentReplierEmail: string | null;
    currentReplierName: string | null;
    currentReplierSince: string | null;
    phone: string | null;
    company: string;
    title: string;
    status: string;
    autoReplyEnabled: boolean;
    autoFollowUpEnabled: boolean;
    autoBookMeetingsEnabled: boolean;
    smsDndActive: boolean;
    smsLastBlockedAt: string | null;
    smsLastBlockedReason: string | null;
    smsConsecutiveBlockedCount: number;
    smsLastSuccessAt: string | null;
    clientId: string;  // For follow-up sequence management
    smsCampaignId: string | null;
    smsCampaignName: string | null;
    // Enrichment data
    linkedinUrl: string | null;
    companyName: string | null;
    companyWebsite: string | null;
    companyState: string | null;
    emailBisonLeadId: string | null;
    enrichmentStatus: string | null;
    followUpBlockedReason: string | null;
    // GHL integration data
    ghlContactId: string | null;
    ghlLocationId: string | null;
    // Lead scoring (Phase 33)
    overallScore: number | null;
    scoredAt: string | null;
    // Lead assignment (Phase 43)
    assignedToUserId: string | null;
    assignedToEmail: string | null;
    assignedAt: string | null;
  };
  channels: Channel[];           // All channels this lead has messages on
  availableChannels: Channel[];  // Channels available based on contact info
  primaryChannel: Channel;       // Most recent/active channel
  classification: string;
  lastMessage: string;
  lastSubject?: string | null;
  lastMessageTime: string;
  hasAiDraft: boolean;
  requiresAttention: boolean;
  sentimentTag: string | null;
  campaignId: string | null;
  emailCampaignId: string | null;
}

/**
 * Map database sentiment tags to UI classification
 */
function mapSentimentToClassification(sentimentTag: string | null): string {
  const mapping: Record<string, string> = {
    "Meeting Booked": "meeting-booked",
    "Meeting Requested": "meeting-requested",
    "Call Requested": "call-requested",
    "Not Interested": "not-interested",
    "Out of Office": "out-of-office",
    "Automated Reply": "automated-reply",
    "Follow Up": "follow-up",
    "Information Requested": "follow-up",
    "Interested": "interested",
    Blacklist: "not-interested",
    Positive: "interested", // Legacy - maps to same as "Interested"
    Neutral: "new",
  };
  return mapping[sentimentTag || ""] || "new";
}

// Sentiment tags that indicate the lead should be treated as disqualified (no AI scoring).
const DISQUALIFIED_SENTIMENT_TAGS = [
  "Blacklist",
  "Opt Out",
  "Opted Out",
  "Unsubscribe",
  "Unsubscribed",
  "Bounced",
  "Bounce",
] as const;

function isAttentionSentimentTag(sentimentTag: string | null): boolean {
  return ATTENTION_SENTIMENT_TAGS.includes((sentimentTag || "") as (typeof ATTENTION_SENTIMENT_TAGS)[number]);
}

function leadRequiresAttention(lead: {
  status: string;
  sentimentTag: string | null;
  lastMessageDirection?: string | null;
}): boolean {
  if (lead.status === "blacklisted") return false;
  if (lead.status === "unqualified") return false;
  if (lead.sentimentTag === "Blacklist") return false;
  if (!isAttentionSentimentTag(lead.sentimentTag)) return false;
  return lead.lastMessageDirection === "inbound";
}

function getFollowUpBlockedReason(lead: {
  followUpInstances?: Array<{ pausedReason: string | null }> | null;
}): string | null {
  const reason = lead.followUpInstances?.[0]?.pausedReason ?? null;
  if (!reason) return null;
  if (!reason.startsWith("missing_")) return null;
  return reason;
}

/**
 * Detect the primary channel from the latest message
 */
function detectPrimaryChannel(
  latestMessage: { channel?: string | null; emailBisonReplyId?: string | null; subject?: string | null; rawHtml?: string | null } | undefined,
  lead: { senderAccountId?: string | null }
): Channel {
  // Use explicit channel field if present
  if (latestMessage?.channel) {
    return latestMessage.channel as Channel;
  }
  // Fall back to heuristic detection for legacy messages
  if (latestMessage?.emailBisonReplyId || latestMessage?.subject || latestMessage?.rawHtml) {
    return "email";
  }
  if (lead.senderAccountId) {
    return "email";
  }
  return "sms";
}

/**
 * Get unique channels from messages
 */
function getChannelsFromMessages(messages: { channel?: string | null }[]): Channel[] {
  const channelSet = new Set<Channel>();
  for (const msg of messages) {
    if (msg.channel) {
      channelSet.add(msg.channel as Channel);
    } else {
      // Legacy messages without channel field default to "sms"
      channelSet.add("sms");
    }
  }
  return Array.from(channelSet);
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!trimmed.includes("<") || !trimmed.includes(">")) return false;
  return /<\/?[a-z][\s\S]*>/i.test(trimmed);
}

function decodeBasicHtmlEntities(input: string): string {
  return input
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

function htmlToPlainTextForDisplay(html: string): string {
  const withoutScripts = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "");

  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n");

  const noTags = withBreaks.replace(/<[^>]+>/g, "");
  const decoded = decodeBasicHtmlEntities(noTags);

  return decoded.replace(/\n{3,}/g, "\n\n").trim();
}

function stripTrailingUrlPunctuation(url: string): string {
  return url.replace(/[),.;:\]\}]+$/g, "");
}

function normalizeUrlCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cleaned = stripTrailingUrlPunctuation(trimmed);
  const withScheme = cleaned.startsWith("http://") || cleaned.startsWith("https://") ? cleaned : cleaned.startsWith("www.") ? `https://${cleaned}` : null;
  if (!withScheme) return null;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractHttpLinksFromEmailHtml(rawHtml: string): Array<{ href: string; label: string }> {
  const html = rawHtml || "";
  if (!html || !/<a\b/i.test(html)) return [];

  // Hard cap: avoid pathological payload sizes in the inbox fetch path.
  const capped = html.length > 80_000 ? html.slice(0, 80_000) : html;

  const out: Array<{ href: string; label: string }> = [];
  const seen = new Set<string>();

  const anchorRegex =
    /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of capped.matchAll(anchorRegex)) {
    const hrefRaw = decodeBasicHtmlEntities(String(match[1] || match[2] || match[3] || ""));
    const normalizedHref = normalizeUrlCandidate(hrefRaw);
    if (!normalizedHref) continue;
    if (seen.has(normalizedHref)) continue;

    const innerRaw = String(match[4] || "");
    const label = decodeBasicHtmlEntities(innerRaw.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    const safeLabel = (label || normalizedHref).slice(0, 120);

    seen.add(normalizedHref);
    out.push({ href: normalizedHref, label: safeLabel });
    if (out.length >= 10) break;
  }

  return out;
}

function enhanceEmailBodyWithLinkTargets(body: string, rawHtml?: string | null): string {
  const base = body || "";
  const links = rawHtml ? extractHttpLinksFromEmailHtml(rawHtml) : [];
  if (links.length === 0) return base;

  const missing = links.filter((l) => !base.includes(l.href));
  if (missing.length === 0) return base;

  const lines = missing.slice(0, 10).map((l) => `- [${l.label}](${l.href})`);
  return `${base.trim() ? base + "\n\n" : ""}Links:\n${lines.join("\n")}`;
}

function toPlainTextIfHtml(input: string | null | undefined): string {
  const value = input ?? "";
  if (!value) return "";
  if (!looksLikeHtml(value)) return value;
  return htmlToPlainTextForDisplay(value);
}

function toUiSender(msg: {
  direction: string;
  source?: string | null;
  sentBy?: string | null;
  sentByUserId?: string | null;
  aiDraftId?: string | null;
}): "lead" | "ai" | "human" {
  if (msg.direction === "inbound") return "lead";

  // Campaign sends are automated by definition.
  if (msg.source === "inboxxia_campaign") return "ai";

  // Explicit attribution from our send paths.
  if (msg.sentBy === "setter" || msg.sentByUserId) return "human";
  if (msg.sentBy === "ai") return "ai";

  // Backstop: drafts without a user are likely automation.
  if (msg.aiDraftId && !msg.sentByUserId) return "ai";

  return "ai";
}

/**
 * Fetch all conversations (leads with messages) for the inbox
 * @param clientId - Optional client ID to filter by workspace
 */
export async function getConversations(clientId?: string | null): Promise<{
  success: boolean;
  data?: ConversationData[];
  error?: string;
}> {
  try {
    const now = new Date();
    const snoozeFilter = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) return { success: true, data: [] };

    const leads = await prisma.lead.findMany({
      where: { clientId: { in: scope.clientIds }, ...snoozeFilter },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            ghlLocationId: true,
          },
        },
        smsCampaign: {
          select: {
            id: true,
            name: true,
          },
        },
        messages: {
          orderBy: { sentAt: "desc" },
          select: {
            id: true,
            body: true,
            subject: true,
            channel: true,
            direction: true,
            emailBisonReplyId: true,
            rawHtml: true,
            sentAt: true,
          },
        },
        aiDrafts: {
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        followUpInstances: {
          where: {
            status: "paused",
            pausedReason: { startsWith: "missing_" },
          },
          select: { pausedReason: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    // Batch fetch setter emails for assigned leads (Phase 43)
    const assignedUserIds = [...new Set(
      leads
        .map((lead) => lead.assignedToUserId)
        .filter((id): id is string => id !== null)
    )];
    const setterEmailMap = assignedUserIds.length > 0
      ? await getSupabaseUserEmailsByIds(assignedUserIds)
      : new Map<string, string | null>();

    const conversations: ConversationData[] = leads.map((lead) => {
      const latestMessage = lead.messages[0];
      const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
      const primaryChannel = detectPrimaryChannel(latestMessage, lead);
      const channels = getChannelsFromMessages(lead.messages);
      const availableChannels = getAvailableChannels({
        phone: lead.phone,
        ghlContactId: lead.ghlContactId,
        email: lead.email,
        linkedinUrl: lead.linkedinUrl,
        linkedinId: lead.linkedinId,
      });
      const campaignId = primaryChannel === "email" ? lead.emailCampaignId ?? lead.campaignId : lead.campaignId;
      const channelDrafts = lead.aiDrafts.filter(
        (draft) => draft.channel === primaryChannel || (!draft.channel && primaryChannel === "sms")
      );

      const followUpBlockedReason = getFollowUpBlockedReason(lead);

      return {
        id: lead.id,
        lead: {
          id: lead.id,
          name: fullName,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          alternateEmails: lead.alternateEmails ?? [],
          currentReplierEmail: lead.currentReplierEmail ?? null,
          currentReplierName: lead.currentReplierName ?? null,
          currentReplierSince: lead.currentReplierSince ? lead.currentReplierSince.toISOString() : null,
          phone: lead.phone,
          company: lead.client.name,
          title: "", // Not stored in current schema
          status: lead.status,
          autoReplyEnabled: lead.autoReplyEnabled,
          autoFollowUpEnabled: lead.autoFollowUpEnabled,
          autoBookMeetingsEnabled: lead.autoBookMeetingsEnabled,
          smsDndActive: lead.smsDndActive,
          smsLastBlockedAt: lead.smsLastBlockedAt ? lead.smsLastBlockedAt.toISOString() : null,
          smsLastBlockedReason: lead.smsLastBlockedReason ?? null,
          smsConsecutiveBlockedCount: lead.smsConsecutiveBlockedCount ?? 0,
          smsLastSuccessAt: lead.smsLastSuccessAt ? lead.smsLastSuccessAt.toISOString() : null,
          clientId: lead.clientId,
          smsCampaignId: lead.smsCampaignId,
          smsCampaignName: lead.smsCampaign?.name ?? null,
          // Enrichment data
          linkedinUrl: lead.linkedinUrl,
          companyName: lead.companyName,
          companyWebsite: lead.companyWebsite,
          companyState: lead.companyState,
          emailBisonLeadId: lead.emailBisonLeadId,
          enrichmentStatus: lead.enrichmentStatus,
          followUpBlockedReason,
          // GHL integration data
          ghlContactId: lead.ghlContactId,
          ghlLocationId: lead.client.ghlLocationId,
          // Lead scoring (Phase 33)
          overallScore: lead.overallScore,
          scoredAt: lead.scoredAt ? lead.scoredAt.toISOString() : null,
          // Lead assignment (Phase 43)
          assignedToUserId: lead.assignedToUserId ?? null,
          assignedToEmail: lead.assignedToUserId
            ? setterEmailMap.get(lead.assignedToUserId) ?? null
            : null,
          assignedAt: lead.assignedAt ? lead.assignedAt.toISOString() : null,
        },
        channels,
        availableChannels,
        primaryChannel,
        classification: mapSentimentToClassification(lead.sentimentTag),
        lastMessage: toPlainTextIfHtml(latestMessage?.body) || "No messages yet",
        lastSubject: latestMessage?.subject || null,
        lastMessageTime: (latestMessage?.sentAt || lead.createdAt).toISOString(), // Use sentAt for actual message time
        // Hide drafts for blacklisted/unqualified leads
        hasAiDraft:
          lead.status !== "blacklisted" &&
          lead.status !== "unqualified" &&
          lead.sentimentTag !== "Blacklist" &&
          channelDrafts.length > 0,
        requiresAttention: leadRequiresAttention(lead),
        sentimentTag: lead.sentimentTag,
        campaignId,
        emailCampaignId: lead.emailCampaignId,
      };
    });

    return { success: true, data: conversations };
  } catch (error) {
    const safe = toSafeActionError(error, { defaultPublicMessage: "Failed to load conversations" });
    if (safe.errorClass === "not_authenticated" || safe.errorClass === "unauthorized") {
      return { success: false, error: safe.publicMessage };
    }

    console.error("Failed to fetch conversations:", {
      debugId: safe.debugId,
      errorClass: safe.errorClass,
    }, error);
    return {
      success: false,
      error: `${safe.publicMessage} (ref: ${safe.debugId})`,
    };
  }
}

/**
 * Get inbox filter counts for sidebar
 * @param clientId - Optional client ID to filter by workspace
 */
export async function getInboxCounts(clientId?: string | null): Promise<{
  allResponses: number;
  requiresAttention: number;
  previouslyRequiredAttention: number;
  awaitingReply: number;
  needsRepair: number;
  aiSent: number;
  aiReview: number;
  total: number;
}> {
  const empty = {
    allResponses: 0,
    requiresAttention: 0,
    previouslyRequiredAttention: 0,
    awaitingReply: 0,
    needsRepair: 0,
    aiSent: 0,
    aiReview: 0,
    total: 0,
  };

  try {
    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) return empty;
    const now = new Date();
    const snoozeFilter = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };

    // Phase 43: SETTER role filtering
    // If a specific clientId is provided and user is SETTER, only count their assigned leads
    let setterFilter: { assignedToUserId: string } | undefined;
    if (clientId && scope.clientIds.length === 1) {
      const userRole = await getUserRoleForClient(scope.userId, clientId);
      if (isSetterRole(userRole)) {
        setterFilter = { assignedToUserId: scope.userId };
      }
    }

    const clientFilter = {
      clientId: { in: scope.clientIds },
      ...(setterFilter ?? {}),
    };

    const attentionTags = ATTENTION_SENTIMENT_TAGS as unknown as string[];

    // Build SETTER filter clause for raw SQL
    const setterSqlClause = setterFilter
      ? Prisma.sql`and l."assignedToUserId" = ${scope.userId}`
      : Prisma.sql``;

    const cacheKey = `inbox:v1:counts:${scope.userId}:${clientId || "__all__"}:${setterFilter ? scope.userId : "__all__"}`;
    const cached = await redisGetJson<typeof empty>(cacheKey);
    if (cached) return cached;

    const tryMaterializedCounts = async (): Promise<typeof empty | null> => {
      if (!clientId || scope.clientIds.length !== 1) return null;

      const workspaceId = scope.clientIds[0];
      const isGlobalScope = !setterFilter;
      const scopeUserId = isGlobalScope ? GLOBAL_SCOPE_USER_ID : scope.userId;

      const row = await prisma.inboxCounts.findUnique({
        where: {
          clientId_isGlobal_scopeUserId: {
            clientId: workspaceId,
            isGlobal: isGlobalScope,
            scopeUserId,
          },
        },
        select: {
          allResponses: true,
          requiresAttention: true,
          previouslyRequiredAttention: true,
          awaitingReply: true,
          needsRepair: true,
          aiSent: true,
          aiReview: true,
          total: true,
          computedAt: true,
        },
      });

      if (!row) return null;
      if (Date.now() - row.computedAt.getTime() > INBOX_COUNTS_STALE_MS) return null;

      return {
        allResponses: row.allResponses,
        requiresAttention: row.requiresAttention,
        previouslyRequiredAttention: row.previouslyRequiredAttention,
        awaitingReply: row.awaitingReply,
        needsRepair: row.needsRepair,
        aiSent: row.aiSent,
        aiReview: row.aiReview,
        total: row.total,
      };
    };

    const materialized = await tryMaterializedCounts();
    if (materialized) {
      await redisSetJson(cacheKey, materialized, { exSeconds: 10 });
      return materialized;
    }

    const persistMaterializedSnapshot = async (
      snapshot: typeof empty
    ): Promise<void> => {
      if (!clientId || scope.clientIds.length !== 1) return;

      const workspaceId = scope.clientIds[0];
      const isGlobalScope = !setterFilter;
      const scopeUserId = isGlobalScope ? GLOBAL_SCOPE_USER_ID : scope.userId;
      const totalNonBlacklisted = Math.max(
        0,
        snapshot.awaitingReply + snapshot.requiresAttention
      );

      await prisma.inboxCounts.upsert({
        where: {
          clientId_isGlobal_scopeUserId: {
            clientId: workspaceId,
            isGlobal: isGlobalScope,
            scopeUserId,
          },
        },
        create: {
          clientId: workspaceId,
          isGlobal: isGlobalScope,
          scopeUserId,
          allResponses: snapshot.allResponses,
          requiresAttention: snapshot.requiresAttention,
          previouslyRequiredAttention: snapshot.previouslyRequiredAttention,
          totalNonBlacklisted,
          awaitingReply: snapshot.awaitingReply,
          needsRepair: snapshot.needsRepair,
          aiSent: snapshot.aiSent,
          aiReview: snapshot.aiReview,
          total: snapshot.total,
          computedAt: new Date(),
        },
        update: {
          allResponses: snapshot.allResponses,
          requiresAttention: snapshot.requiresAttention,
          previouslyRequiredAttention: snapshot.previouslyRequiredAttention,
          totalNonBlacklisted,
          awaitingReply: snapshot.awaitingReply,
          needsRepair: snapshot.needsRepair,
          aiSent: snapshot.aiSent,
          aiReview: snapshot.aiReview,
          total: snapshot.total,
          computedAt: new Date(),
        },
        select: { id: true },
      });
    };

    const isMissingLastZrgOutboundAt = (error: unknown): boolean => {
      if (!error || typeof error !== "object") return false;
      const anyError = error as { code?: unknown; message?: unknown };
      if (anyError.code === "P2022") return true; // Column does not exist (during staged rollouts).
      return typeof anyError.message === "string" && anyError.message.includes("lastZrgOutboundAt");
    };

    const runCountsUsingLeadRollups = async (): Promise<{
      allResponses: number;
      requiresAttention: number;
      previouslyRequiredAttention: number;
      awaitingReply: number;
      needsRepair: number;
      aiSent: number;
      aiReview: number;
      total: number;
    }> => {
      const rows = await prisma.$queryRaw<
        Array<{
          totalNonBlacklisted: number;
          blacklisted: number;
          needsRepair: number;
          allResponses: number;
          requiresAttention: number;
          previouslyRequiredAttention: number;
          aiSent: number;
          aiReview: number;
        }>
      >(Prisma.sql`
        select
          count(*) filter (
            where l."status" not in ('blacklisted', 'unqualified')
          )::int as "totalNonBlacklisted",
          count(*) filter (
            where l."status" = 'blacklisted'
          )::int as "blacklisted",
          count(*) filter (
            where l."status" = 'needs_repair'
          )::int as "needsRepair",
          count(*) filter (
            where l."lastInboundAt" is not null
              and l."lastInboundAt" > coalesce(l."lastZrgOutboundAt", l."lastOutboundAt", to_timestamp(0))
          )::int as "allResponses",
          count(*) filter (
            where l."lastInboundAt" is not null
              and l."sentimentTag" in (${Prisma.join(attentionTags)})
              and l."status" not in ('blacklisted', 'unqualified')
              and l."lastInboundAt" > coalesce(l."lastZrgOutboundAt", l."lastOutboundAt", to_timestamp(0))
          )::int as "requiresAttention",
          count(*) filter (
            where l."lastInboundAt" is not null
              and l."sentimentTag" in (${Prisma.join(attentionTags)})
              and l."status" not in ('blacklisted', 'unqualified')
              and coalesce(l."lastZrgOutboundAt", l."lastOutboundAt", to_timestamp(0)) >= l."lastInboundAt"
          )::int as "previouslyRequiredAttention",
          count(*) filter (
            where exists (
              select 1
              from "AIDraft" d
              where d."leadId" = l.id
                and d.status = 'pending'
                and d."autoSendAction" = 'needs_review'
            )
          )::int as "aiReview",
          count(*) filter (
            where exists (
              select 1
              from "Message" m
              join "EmailCampaign" ec on ec.id = l."emailCampaignId"
              where m."leadId" = l.id
                and m.channel = 'email'
                and m.direction = 'outbound'
                and m.source = 'zrg'
                and m."sentBy" = 'ai'
                and m."aiDraftId" is not null
                and ec."responseMode" = 'AI_AUTO_SEND'
            )
          )::int as "aiSent"
        from "Lead" l
        where l."clientId" in (${Prisma.join(scope.clientIds)})
          and (l."snoozedUntil" is null or l."snoozedUntil" <= ${now})
          ${setterSqlClause}
      `);

      const row = rows[0] ?? {
        totalNonBlacklisted: 0,
        blacklisted: 0,
        needsRepair: 0,
        allResponses: 0,
        requiresAttention: 0,
        previouslyRequiredAttention: 0,
        aiSent: 0,
        aiReview: 0,
      };

      return {
        allResponses: row.allResponses,
        requiresAttention: row.requiresAttention,
        previouslyRequiredAttention: row.previouslyRequiredAttention,
        awaitingReply: Math.max(0, row.totalNonBlacklisted - row.requiresAttention),
        needsRepair: row.needsRepair,
        aiSent: row.aiSent,
        aiReview: row.aiReview,
        total: row.totalNonBlacklisted + row.blacklisted,
      };
    };

    const runLegacyCounts = async (): Promise<{
      allResponses: number;
      requiresAttention: number;
      previouslyRequiredAttention: number;
      awaitingReply: number;
      needsRepair: number;
      aiSent: number;
      aiReview: number;
      total: number;
    }> => {
      const [replyCounts, totalNonBlacklisted, blacklisted, needsRepair, aiSent, aiReview] = await Promise.all([
        prisma.$queryRaw<
          Array<{
            allResponses: number;
            requiresAttention: number;
            previouslyRequiredAttention: number;
          }>
        >(Prisma.sql`
          with reply_leads as (
            select
              l.id,
              l."status",
              l."sentimentTag",
              l."lastInboundAt"
            from "Lead" l
            where l."clientId" in (${Prisma.join(scope.clientIds)})
              and (l."snoozedUntil" is null or l."snoozedUntil" <= ${now})
              and l."lastInboundAt" is not null
              ${setterSqlClause}
          ),
          zrg_outbound as (
            select
              m."leadId",
              max(m."sentAt") as last_zrg_outbound
            from "Message" m
            where m.direction = 'outbound'
              and m.source = 'zrg'
              and m."leadId" in (select id from reply_leads)
            group by m."leadId"
          )
          select
            count(*) filter (
              where rl."lastInboundAt" > coalesce(z.last_zrg_outbound, to_timestamp(0))
            )::int as "allResponses",
            count(*) filter (
              where rl."sentimentTag" in (${Prisma.join(attentionTags)})
                and rl."status" not in ('blacklisted', 'unqualified')
                and rl."lastInboundAt" > coalesce(z.last_zrg_outbound, to_timestamp(0))
            )::int as "requiresAttention",
            count(*) filter (
              where rl."sentimentTag" in (${Prisma.join(attentionTags)})
                and rl."status" not in ('blacklisted', 'unqualified')
                and coalesce(z.last_zrg_outbound, to_timestamp(0)) >= rl."lastInboundAt"
            )::int as "previouslyRequiredAttention"
          from reply_leads rl
          left join zrg_outbound z on z."leadId" = rl.id
        `),
        prisma.lead.count({
          where: {
            ...clientFilter,
            ...snoozeFilter,
            status: { notIn: ["blacklisted", "unqualified"] },
          },
        }),
        prisma.lead.count({
          where: {
            ...clientFilter,
            ...snoozeFilter,
            status: "blacklisted",
          },
        }),
        prisma.lead.count({
          where: {
            ...clientFilter,
            ...snoozeFilter,
            status: "needs_repair",
          },
        }),
        prisma.lead.count({
          where: {
            ...clientFilter,
            ...snoozeFilter,
            emailCampaign: {
              is: { responseMode: "AI_AUTO_SEND" },
            },
            messages: {
              some: {
                channel: "email",
                direction: "outbound",
                source: "zrg",
                sentBy: "ai",
                aiDraftId: { not: null },
              },
            },
          },
        }),
        prisma.lead.count({
          where: {
            ...clientFilter,
            ...snoozeFilter,
            aiDrafts: {
              some: {
                status: "pending",
                autoSendAction: "needs_review",
              },
            },
          },
        }),
      ]);

      const openCounts = replyCounts[0] ?? { allResponses: 0, requiresAttention: 0, previouslyRequiredAttention: 0 };

      return {
        allResponses: openCounts.allResponses,
        requiresAttention: openCounts.requiresAttention,
        previouslyRequiredAttention: openCounts.previouslyRequiredAttention,
        awaitingReply: Math.max(0, totalNonBlacklisted - openCounts.requiresAttention),
        needsRepair,
        aiSent,
        aiReview,
        total: totalNonBlacklisted + blacklisted,
      };
    };

    let computed: typeof empty;
    try {
      computed = await runCountsUsingLeadRollups();
    } catch (error) {
      if (isMissingLastZrgOutboundAt(error)) {
        computed = await runLegacyCounts();
      } else {
        throw error;
      }
    }

    await persistMaterializedSnapshot(computed).catch(() => undefined);
    await redisSetJson(cacheKey, computed, { exSeconds: 10 });
    return computed;
  } catch (error) {
    // Auth/authorization issues are expected in some states (signed-out, stale workspace selection).
    // Avoid noisy error logs and return a safe empty-state.
    const message = error instanceof Error ? error.message : "";
    if (message === "Not authenticated" || message === "Unauthorized") {
      return empty;
    }

    console.error("Failed to get inbox counts:", error);
    return empty;
  }
}

/**
 * Get a single conversation with full message history
 */
export async function getConversation(leadId: string, channelFilter?: Channel) {
  try {
    const user = await requireAuthUser();
    const accessible = await getAccessibleClientIdsForUser(user.id, user.email);
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      // Same reasoning as the cursor inbox fetch: keep this payload explicit and schema-resilient.
      select: {
        id: true,
        clientId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        alternateEmails: true,
        currentReplierEmail: true,
        currentReplierName: true,
        currentReplierSince: true,
        status: true,
        sentimentTag: true,
        autoReplyEnabled: true,
        autoFollowUpEnabled: true,
        autoBookMeetingsEnabled: true,
        smsDndActive: true,
        smsLastBlockedAt: true,
        smsLastBlockedReason: true,
        smsConsecutiveBlockedCount: true,
        smsLastSuccessAt: true,
        smsCampaignId: true,
        senderAccountId: true,
        linkedinUrl: true,
        linkedinId: true,
        companyName: true,
        companyWebsite: true,
        companyState: true,
        emailBisonLeadId: true,
        enrichmentStatus: true,
        ghlContactId: true,
        overallScore: true,
        scoredAt: true,
        assignedToUserId: true,
        assignedAt: true,
        client: {
          select: {
            id: true,
            name: true,
            ghlLocationId: true,
          },
        },
        smsCampaign: {
          select: {
            id: true,
            name: true,
          },
        },
        messages: {
          where: channelFilter ? { channel: channelFilter } : undefined,
          orderBy: { sentAt: "asc" }, // Order by actual message time
          select: {
            id: true,
            body: true,
            subject: true,
            rawHtml: true,
            rawText: true,
            cc: true,
            bcc: true,
            source: true,
            fromEmail: true,
            fromName: true,
            toEmail: true,
            toName: true,
            emailBisonReplyId: true,
            channel: true,
            direction: true,
            sentAt: true,
            sentBy: true,
            sentByUserId: true,
            aiDraftId: true,
          },
        },
        followUpInstances: {
          where: {
            status: "paused",
            pausedReason: { startsWith: "missing_" },
          },
          select: { pausedReason: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }
    if (!accessible.includes(lead.clientId)) {
      return { success: false, error: "Unauthorized" };
    }
    const viewerRole = await getUserRoleForClient(user.id, lead.clientId);

    const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
    const latestMessage = lead.messages[lead.messages.length - 1];
    const primaryChannel = detectPrimaryChannel(latestMessage, lead);
    const channels = getChannelsFromMessages(lead.messages);
    const availableChannels = getAvailableChannels({
      phone: lead.phone,
      ghlContactId: lead.ghlContactId,
      email: lead.email,
      linkedinUrl: lead.linkedinUrl,
      linkedinId: lead.linkedinId,
    });

    // Fetch setter email for assigned lead (Phase 43)
    let assignedToEmail: string | null = null;
    if (lead.assignedToUserId) {
      const emailMap = await getSupabaseUserEmailsByIds([lead.assignedToUserId]);
      assignedToEmail = emailMap.get(lead.assignedToUserId) ?? null;
    }

    const followUpBlockedReason = getFollowUpBlockedReason(lead);

    return {
      success: true,
      data: {
        id: lead.id,
        lead: {
          id: lead.id,
          name: fullName,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          alternateEmails: lead.alternateEmails ?? [],
          currentReplierEmail: lead.currentReplierEmail ?? null,
          currentReplierName: lead.currentReplierName ?? null,
          currentReplierSince: lead.currentReplierSince ? lead.currentReplierSince.toISOString() : null,
          phone: lead.phone,
          company: lead.client.name,
          title: "",
          status: lead.status,
          sentimentTag: lead.sentimentTag,
          autoReplyEnabled: lead.autoReplyEnabled,
          autoFollowUpEnabled: lead.autoFollowUpEnabled,
          autoBookMeetingsEnabled: lead.autoBookMeetingsEnabled,
          smsDndActive: lead.smsDndActive,
          smsLastBlockedAt: lead.smsLastBlockedAt ? lead.smsLastBlockedAt.toISOString() : null,
          smsLastBlockedReason: lead.smsLastBlockedReason ?? null,
          smsConsecutiveBlockedCount: lead.smsConsecutiveBlockedCount ?? 0,
          smsLastSuccessAt: lead.smsLastSuccessAt ? lead.smsLastSuccessAt.toISOString() : null,
          clientId: lead.clientId,
          smsCampaignId: lead.smsCampaignId,
          smsCampaignName: lead.smsCampaign?.name ?? null,
          // Enrichment data
          linkedinUrl: lead.linkedinUrl,
          companyName: lead.companyName,
          companyWebsite: lead.companyWebsite,
          companyState: lead.companyState,
          emailBisonLeadId: lead.emailBisonLeadId,
          enrichmentStatus: lead.enrichmentStatus,
          followUpBlockedReason,
          // GHL integration data
          ghlContactId: lead.ghlContactId,
          ghlLocationId: lead.client.ghlLocationId,
          // Lead scoring (Phase 33)
          overallScore: lead.overallScore,
          scoredAt: lead.scoredAt ? lead.scoredAt.toISOString() : null,
          // Lead assignment (Phase 43)
          assignedToUserId: lead.assignedToUserId ?? null,
          assignedToEmail,
          assignedAt: lead.assignedAt ? lead.assignedAt.toISOString() : null,
        },
        channels,
        availableChannels,
        primaryChannel,
        viewerRole,
        messages: lead.messages.map((msg) => {
          const isEmailMessage = msg.channel === "email" || !!msg.subject || !!msg.rawHtml || !!msg.emailBisonReplyId;
          const baseContent = toPlainTextIfHtml(msg.body);
          const content = isEmailMessage ? enhanceEmailBodyWithLinkTargets(baseContent, msg.rawHtml) : baseContent;

          return {
            id: msg.id,
            sender: toUiSender(msg),
            content,
            subject: msg.subject || undefined,
            rawHtml: msg.rawHtml || undefined,
            rawText: msg.rawText || undefined,
            cc: msg.cc,
            bcc: msg.bcc,
            source: msg.source || undefined,
            // Phase 50: Email participant metadata
            fromEmail: msg.fromEmail || undefined,
            fromName: msg.fromName ?? null,
            toEmail: msg.toEmail || undefined,
            toName: msg.toName ?? null,
            emailBisonReplyId: msg.emailBisonReplyId || undefined,
            channel: (msg.channel || "sms") as Channel,
            direction: msg.direction as "inbound" | "outbound",
            timestamp: msg.sentAt.toISOString(), // Use sentAt for actual message time
          };
        }),
      },
    };
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    return { success: false, error: "Failed to fetch conversation" };
  }
}

/**
 * Get a lead's workspace (client) ID
 * Used for URL validation and auto-switching workspaces
 */
export async function getLeadWorkspaceId(leadId: string): Promise<{
  success: boolean;
  workspaceId?: string;
  error?: string;
}> {
  try {
    const user = await requireAuthUser();
    const accessible = await getAccessibleClientIdsForUser(user.id, user.email);
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { clientId: true },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }
    if (!accessible.includes(lead.clientId)) {
      return { success: false, error: "Unauthorized" };
    }

    return { success: true, workspaceId: lead.clientId };
  } catch (error) {
    console.error("Failed to get lead workspace:", error);
    return { success: false, error: "Failed to get lead workspace" };
  }
}

// =============================================================================
// Cursor-Based Pagination for Conversations (Performance Optimized)
// =============================================================================

export interface ConversationsCursorOptions {
  clientId?: string | null;
  cursor?: string | null; // Lead ID to start after
  limit?: number;
  search?: string;
  channels?: Channel[];
  channel?: Channel | "all";
  sentimentTag?: string;
  sentimentTags?: string[];
  smsCampaignId?: string;
  smsCampaignUnattributed?: boolean;
  filter?: "responses" | "attention" | "needs_repair" | "previous_attention" | "drafts" | "ai_sent" | "ai_review" | "all";
  // Lead scoring filter (Phase 33)
  scoreFilter?: "all" | "4" | "3+" | "2+" | "1+" | "unscored" | "disqualified";
}

export interface ConversationsCursorResult {
  success: boolean;
  conversations: ConversationData[];
  nextCursor: string | null;
  hasMore: boolean;
  error?: string;
}

/**
 * Transform a lead to ConversationData format
 */
function transformLeadToConversation(
  lead: any,
  opts?: { hasOpenReply?: boolean; setterEmailMap?: Map<string, string | null> }
): ConversationData {
  const latestMessage = lead.messages[0];
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
  const followUpBlockedReason = getFollowUpBlockedReason(lead);
  const primaryChannel = detectPrimaryChannel(latestMessage, lead);
  const channels = getChannelsFromMessages(lead.messages);
  const availableChannels = getAvailableChannels({
    phone: lead.phone,
    ghlContactId: lead.ghlContactId,
    email: lead.email,
    linkedinUrl: lead.linkedinUrl,
    linkedinId: lead.linkedinId,
  });
  const campaignId: string | null =
    (primaryChannel === "email" ? lead.emailCampaignId ?? lead.campaignId : lead.campaignId) ?? null;
  const channelDrafts = lead.aiDrafts?.filter(
    (draft: any) => draft.channel === primaryChannel || (!draft.channel && primaryChannel === "sms")
  ) || [];

  return {
    id: lead.id,
    lead: {
      id: lead.id,
      name: fullName,
      firstName: typeof lead.firstName === "string" ? lead.firstName : null,
      lastName: typeof lead.lastName === "string" ? lead.lastName : null,
      email: typeof lead.email === "string" ? lead.email : null,
      alternateEmails: lead.alternateEmails ?? [],
      currentReplierEmail: lead.currentReplierEmail ?? null,
      currentReplierName: lead.currentReplierName ?? null,
      currentReplierSince: lead.currentReplierSince ? lead.currentReplierSince.toISOString() : null,
      phone: typeof lead.phone === "string" ? lead.phone : null,
      company: lead.client?.name ?? "Unknown",
      title: "",
      status: typeof lead.status === "string" ? lead.status : "new",
      autoReplyEnabled: Boolean(lead.autoReplyEnabled),
      autoFollowUpEnabled: Boolean(lead.autoFollowUpEnabled),
      autoBookMeetingsEnabled:
        typeof lead.autoBookMeetingsEnabled === "boolean" ? lead.autoBookMeetingsEnabled : true,
      smsDndActive: Boolean(lead.smsDndActive),
      smsLastBlockedAt: lead.smsLastBlockedAt instanceof Date ? lead.smsLastBlockedAt.toISOString() : null,
      smsLastBlockedReason: typeof lead.smsLastBlockedReason === "string" ? lead.smsLastBlockedReason : null,
      smsConsecutiveBlockedCount:
        typeof lead.smsConsecutiveBlockedCount === "number" ? lead.smsConsecutiveBlockedCount : 0,
      smsLastSuccessAt: lead.smsLastSuccessAt instanceof Date ? lead.smsLastSuccessAt.toISOString() : null,
      clientId: lead.clientId,
      smsCampaignId: lead.smsCampaignId ?? null,
      smsCampaignName: lead.smsCampaign?.name ?? null,
      linkedinUrl: typeof lead.linkedinUrl === "string" ? lead.linkedinUrl : null,
      companyName: typeof lead.companyName === "string" ? lead.companyName : null,
      companyWebsite: typeof lead.companyWebsite === "string" ? lead.companyWebsite : null,
      companyState: typeof lead.companyState === "string" ? lead.companyState : null,
      emailBisonLeadId: typeof lead.emailBisonLeadId === "string" ? lead.emailBisonLeadId : null,
      enrichmentStatus: typeof lead.enrichmentStatus === "string" ? lead.enrichmentStatus : null,
      followUpBlockedReason,
      ghlContactId: typeof lead.ghlContactId === "string" ? lead.ghlContactId : null,
      ghlLocationId: lead.client?.ghlLocationId ?? null,
      // Lead scoring (Phase 33)
      overallScore: typeof lead.overallScore === "number" ? lead.overallScore : null,
      scoredAt: lead.scoredAt ? lead.scoredAt.toISOString() : null,
      // Lead assignment (Phase 43)
      assignedToUserId: lead.assignedToUserId ?? null,
      assignedToEmail: lead.assignedToUserId
        ? opts?.setterEmailMap?.get(lead.assignedToUserId) ?? null
        : null,
      assignedAt: lead.assignedAt ? lead.assignedAt.toISOString() : null,
    },
    channels,
    availableChannels,
    primaryChannel,
    classification: mapSentimentToClassification(lead.sentimentTag),
    lastMessage: toPlainTextIfHtml(latestMessage?.body) || "No messages yet",
    lastSubject: latestMessage?.subject || null,
    lastMessageTime: (latestMessage?.sentAt || lead.createdAt).toISOString(),
    hasAiDraft:
      lead.status !== "blacklisted" &&
      lead.status !== "unqualified" &&
      lead.sentimentTag !== "Blacklist" &&
      channelDrafts.length > 0,
    requiresAttention:
      typeof opts?.hasOpenReply === "boolean"
        ? opts.hasOpenReply && lead.status !== "blacklisted" && lead.status !== "unqualified" && isAttentionSentimentTag(lead.sentimentTag)
        : leadRequiresAttention(lead),
    sentimentTag: typeof lead.sentimentTag === "string" ? lead.sentimentTag : null,
    campaignId,
    emailCampaignId: lead.emailCampaignId ?? null,
  };
}

function hasOpenReplyFromLeadRollups(lead: { lastInboundAt?: Date | null; lastZrgOutboundAt?: Date | null }): boolean {
  const lastInboundAt = lead.lastInboundAt ?? null;
  if (!lastInboundAt) return false;
  const lastZrgOutboundAt = lead.lastZrgOutboundAt ?? null;
  return !lastZrgOutboundAt || lastZrgOutboundAt.getTime() < lastInboundAt.getTime();
}

const INBOX_QUERY_STATEMENT_TIMEOUT_MS = 12_000;
const INBOX_FULL_EMAIL_FALLBACK_TIMEOUT_MS = 5_000;

function looksLikeFullEmailSearchTerm(value: string): boolean {
  if (!value.includes("@")) return false;
  if (/\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0) return false;
  const dot = value.indexOf(".", at + 2);
  return dot > at + 1;
}

function buildFullEmailSearchCondition(
  emailTerm: string,
  opts?: { includeCurrentReplierEmail?: boolean }
): Prisma.LeadWhereInput {
  const normalizedEmailTerm = emailTerm.trim().toLowerCase();
  const orClauses: Prisma.LeadWhereInput[] = [
    { email: { equals: normalizedEmailTerm, mode: "insensitive" } },
    { alternateEmails: { has: normalizedEmailTerm } },
  ];

  if (opts?.includeCurrentReplierEmail) {
    orClauses.push({ currentReplierEmail: { equals: normalizedEmailTerm, mode: "insensitive" } });
  }

  return { OR: orClauses };
}

function expandFullEmailSearchCondition(
  whereConditions: any[],
  conditionIndex: number | null,
  emailTerm: string | null
): any[] {
  if (conditionIndex === null || !emailTerm) return whereConditions;
  const expandedConditions = [...whereConditions];
  expandedConditions[conditionIndex] = buildFullEmailSearchCondition(emailTerm, { includeCurrentReplierEmail: true });
  return expandedConditions;
}

async function findLeadsWithStatementTimeout(queryOptions: any, timeoutMs = INBOX_QUERY_STATEMENT_TIMEOUT_MS): Promise<any[]> {
  const normalizedTimeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
      ? Math.max(1_000, Math.trunc(timeoutMs))
      : INBOX_QUERY_STATEMENT_TIMEOUT_MS;
  const transactionTimeoutMs = Math.max(15_000, normalizedTimeoutMs + 5_000);
  const transactionMaxWaitMs = Math.min(30_000, Math.max(5_000, Math.trunc(transactionTimeoutMs / 2)));

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${normalizedTimeoutMs}`);
      return tx.lead.findMany(queryOptions);
    },
    {
      maxWait: transactionMaxWaitMs,
      timeout: transactionTimeoutMs,
    }
  );
}

/**
 * Get conversations with cursor-based pagination
 * Optimized for large datasets (50,000+ leads)
 */
export async function getConversationsCursor(
  options: ConversationsCursorOptions
): Promise<ConversationsCursorResult> {
  try {
    // Server Actions can be invoked from the client with malformed args (or args that serialize
    // poorly across the RSC boundary). Coerce aggressively so we never throw for basic input issues.
    const raw = (options && typeof options === "object" ? options : {}) as Record<string, unknown>;

    const clientIdRaw = raw.clientId;
    const clientId =
      typeof clientIdRaw === "string" && clientIdRaw.trim() && clientIdRaw !== "$undefined"
        ? clientIdRaw
        : null;

    const cursorRaw = raw.cursor;
    const cursor =
      typeof cursorRaw === "string" && cursorRaw.trim() && cursorRaw !== "$undefined"
        ? cursorRaw
        : null;

    const limitRaw = raw.limit;
    const limit =
      typeof limitRaw === "number" && Number.isFinite(limitRaw)
        ? Math.min(Math.max(1, Math.trunc(limitRaw)), 200)
        : 50;

    const searchRaw = raw.search;
    const search =
      typeof searchRaw === "string" && searchRaw.trim()
        ? searchRaw.trim()
        : undefined;

    const channelsRaw = raw.channels;
    const channels = Array.isArray(channelsRaw)
      ? channelsRaw.filter((value): value is Channel =>
          value === "sms" || value === "email" || value === "linkedin"
        )
      : undefined;

    const channelRaw = raw.channel;
    const channel =
      channelRaw === "sms" || channelRaw === "email" || channelRaw === "linkedin" || channelRaw === "all"
        ? (channelRaw as Channel | "all")
        : undefined;

    const sentimentTagRaw = raw.sentimentTag;
    const sentimentTag =
      typeof sentimentTagRaw === "string" && sentimentTagRaw.trim()
        ? sentimentTagRaw
        : undefined;

    const sentimentTagsRaw = raw.sentimentTags;
    const sentimentTags = Array.isArray(sentimentTagsRaw)
      ? sentimentTagsRaw.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : undefined;

    const smsCampaignIdRaw = raw.smsCampaignId;
    const smsCampaignId =
      typeof smsCampaignIdRaw === "string" && smsCampaignIdRaw.trim()
        ? smsCampaignIdRaw
        : undefined;

    const smsCampaignUnattributedRaw = raw.smsCampaignUnattributed;
    const smsCampaignUnattributed =
      typeof smsCampaignUnattributedRaw === "boolean" ? smsCampaignUnattributedRaw : undefined;

    const filterRaw = raw.filter;
    const filter =
      filterRaw === "responses" ||
      filterRaw === "attention" ||
      filterRaw === "needs_repair" ||
      filterRaw === "previous_attention" ||
      filterRaw === "drafts" ||
      filterRaw === "ai_sent" ||
      filterRaw === "ai_review" ||
      filterRaw === "all"
        ? (filterRaw as ConversationsCursorOptions["filter"])
        : undefined;

    const scoreFilterRaw = raw.scoreFilter;
    const scoreFilter =
      scoreFilterRaw === "all" ||
      scoreFilterRaw === "4" ||
      scoreFilterRaw === "3+" ||
      scoreFilterRaw === "2+" ||
      scoreFilterRaw === "1+" ||
      scoreFilterRaw === "unscored" ||
      scoreFilterRaw === "disqualified"
        ? (scoreFilterRaw as ConversationsCursorOptions["scoreFilter"])
        : undefined;

    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return { success: true, conversations: [], nextCursor: null, hasMore: false };
    }

    // Phase 43: SETTER role filtering
    // If user is SETTER for the selected workspace, only show their assigned leads
    let setterUserId: string | null = null;
    if (clientId && scope.clientIds.length === 1) {
      const userRole = await getUserRoleForClient(scope.userId, clientId);
      if (isSetterRole(userRole)) {
        setterUserId = scope.userId;
      }
    }

    const cacheKey = [
      "inbox:v1:list",
      scope.userId,
      clientId || "__all__",
      setterUserId ? `setter:${setterUserId}` : "all",
      cursor || "",
      String(limit),
      search || "",
      channels?.length ? channels.join(",") : channel || "all",
      sentimentTag || "",
      sentimentTags?.length ? sentimentTags.join(",") : "",
      smsCampaignId || "",
      typeof smsCampaignUnattributed === "boolean" ? (smsCampaignUnattributed ? "unattributed" : "attributed") : "",
      filter || "all",
      scoreFilter || "all",
    ].join(":");

    const cached = await redisGetJson<ConversationsCursorResult>(cacheKey);
    if (cached) return cached;

    // Build the where clause for filtering
    const whereConditions: any[] = [];
    let fullEmailSearchTerm: string | null = null;
    let fullEmailSearchConditionIndex: number | null = null;
    const now = new Date();
    whereConditions.push({ OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] });

    whereConditions.push({ clientId: { in: scope.clientIds } });

    if (setterUserId) {
      whereConditions.push({ assignedToUserId: setterUserId });
    }

    // Search filter
    if (search && search.trim()) {
      const rawSearchTerm = search.trim();
      const normalizedSearchTerm = rawSearchTerm.replace(/[),.;:\]\}]+$/g, "").trim();

      // Guardrail: very short queries are disproportionately expensive on large workspaces.
      // The client also debounces, but this protects us from URL/state edge cases.
      if (normalizedSearchTerm.length >= 3) {
        if (looksLikeFullEmailSearchTerm(normalizedSearchTerm)) {
          // Avoid `ILIKE %term%` scans on huge workspaces by treating full-email searches as exact matches.
          // This keeps inbox search responsive even at 100k+ leads.
          const emailTerm = normalizedSearchTerm.toLowerCase();
          // Primary pass stays on indexed-ish fields; we only include currentReplierEmail in a
          // second pass if this returns no rows, to preserve perf while fixing false negatives.
          whereConditions.push(buildFullEmailSearchCondition(emailTerm));
          fullEmailSearchTerm = emailTerm;
          fullEmailSearchConditionIndex = whereConditions.length - 1;
        } else {
          const terms = normalizedSearchTerm.split(/\s+/).filter(Boolean);

          const buildTermFilter = (term: string) => ({
            OR: [
              { firstName: { contains: term, mode: "insensitive" } },
              { lastName: { contains: term, mode: "insensitive" } },
              { email: { contains: term, mode: "insensitive" } },
              { companyName: { contains: term, mode: "insensitive" } },
              { phone: { contains: term } },
              { smsCampaign: { is: { name: { contains: term, mode: "insensitive" } } } },
            ],
          });

          whereConditions.push(
            terms.length > 1
              ? { AND: terms.map(buildTermFilter) }
              : buildTermFilter(normalizedSearchTerm)
          );
        }
      }
    }

    // Channel filter - filter by messages having any selected channel
    const channelList =
      channels && channels.length > 0
        ? Array.from(new Set(channels))
        : channel && channel !== "all"
          ? [channel]
          : [];

    if (channelList.length > 0) {
      whereConditions.push({
        messages: {
          some: { channel: { in: channelList } },
        },
      });
    }

    // Sentiment tag filter (multi-select supported)
    if (sentimentTags && sentimentTags.length > 0) {
      whereConditions.push({ sentimentTag: { in: sentimentTags } });
    } else if (sentimentTag && sentimentTag !== "all") {
      whereConditions.push({ sentimentTag });
    }

    // SMS sub-client filter (Lead.smsCampaignId)
    if (smsCampaignUnattributed) {
      whereConditions.push({ smsCampaignId: null });
    } else if (smsCampaignId) {
      whereConditions.push({ smsCampaignId });
    }

    // Lead score filter (Phase 33)
    if (scoreFilter && scoreFilter !== "all") {
      switch (scoreFilter) {
        case "4":
          whereConditions.push({ overallScore: 4 });
          break;
        case "3+":
          whereConditions.push({ overallScore: { gte: 3 } });
          break;
        case "2+":
          whereConditions.push({ overallScore: { gte: 2 } });
          break;
        case "1+":
          whereConditions.push({ overallScore: { gte: 1 } });
          break;
        case "unscored":
          whereConditions.push({ overallScore: null });
          break;
        case "disqualified":
          whereConditions.push({ sentimentTag: { in: [...DISQUALIFIED_SENTIMENT_TAGS] } });
          break;
      }
    }

    const replyStateFilter: "open" | "handled" | null =
      filter === "responses" || filter === "attention"
        ? "open"
        : filter === "previous_attention" || filter === "drafts"
          ? "handled"
          : null;

    // Special filter presets
    if (filter === "responses") {
      // "Open replies": lead has an inbound reply more recent than any outbound sent by our system.
      // This intentionally does not rely on Lead.lastMessageDirection because outbound campaign steps
      // (EmailBison/Inboxxia) can land after a reply and would otherwise hide the thread.
      whereConditions.push({ lastInboundAt: { not: null } });
    } else if (filter === "attention") {
      whereConditions.push({
        sentimentTag: { in: ATTENTION_SENTIMENT_TAGS as unknown as string[] },
        lastInboundAt: { not: null },
        status: { notIn: ["blacklisted", "unqualified"] },
      });
    } else if (filter === "previous_attention" || filter === "drafts") {
      whereConditions.push({
        sentimentTag: { in: ATTENTION_SENTIMENT_TAGS as unknown as string[] },
        lastInboundAt: { not: null },
        status: { notIn: ["blacklisted", "unqualified"] },
      });
    } else if (filter === "needs_repair") {
      whereConditions.push({ status: "needs_repair" });
    } else if (filter === "ai_sent") {
      // Phase 70: "AI Sent" = actually sent by AI auto-send (not just evaluated/scheduled).
      whereConditions.push({
        emailCampaign: {
          is: { responseMode: "AI_AUTO_SEND" },
        },
      });
      whereConditions.push({
        messages: {
          some: {
            channel: "email",
            direction: "outbound",
            sentBy: "ai",
            source: "zrg",
            aiDraftId: { not: null },
          },
        },
      });
    } else if (filter === "ai_review") {
      // Phase 70: Pending drafts that auto-send flagged for human review.
      whereConditions.push({
        aiDrafts: {
          some: {
            status: "pending",
            autoSendAction: "needs_review",
          },
        },
      });
    }

    const where = whereConditions.length > 0
      ? { AND: whereConditions }
      : undefined;

    // Schema-safe fallback where:
    // keep only the workspace scope filter so we can recover from missing-column/table errors
    // in optional filters/features during staged rollouts or when the DB lags the Prisma schema.
    const safeWhere: any = { AND: [{ clientId: { in: scope.clientIds } }] };

    // Avoid selecting every Lead scalar column in inbox queries.
    // In db-push workflows (no migrations), production DBs can temporarily lag the Prisma schema;
    // selecting only the fields we actually need makes the inbox much more resilient.
    const baseQueryOptionsFull: any = {
      where,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        alternateEmails: true,
        currentReplierEmail: true,
        currentReplierName: true,
        currentReplierSince: true,
        status: true,
        sentimentTag: true,
        autoReplyEnabled: true,
        autoFollowUpEnabled: true,
        autoBookMeetingsEnabled: true,
        smsDndActive: true,
        smsLastBlockedAt: true,
        smsLastBlockedReason: true,
        smsConsecutiveBlockedCount: true,
        smsLastSuccessAt: true,
        clientId: true,
        smsCampaignId: true,
        emailCampaignId: true,
        campaignId: true,
        senderAccountId: true,
        companyName: true,
        companyWebsite: true,
        companyState: true,
        emailBisonLeadId: true,
        enrichmentStatus: true,
        ghlContactId: true,
        linkedinUrl: true,
        linkedinId: true,
        // Lead scoring (Phase 33)
        overallScore: true,
        scoredAt: true,
        // Lead assignment (Phase 43)
        assignedToUserId: true,
        assignedAt: true,
        // Reply-state filter support
        lastInboundAt: true,
        lastZrgOutboundAt: true,
        lastMessageDirection: true,
        createdAt: true,
        client: {
          select: {
            id: true,
            name: true,
            ghlLocationId: true,
          },
        },
        smsCampaign: {
          select: {
            id: true,
            name: true,
          },
        },
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1, // Only get latest message for list view
          select: {
            id: true,
            body: true,
            subject: true,
            channel: true,
            direction: true,
            emailBisonReplyId: true,
            rawHtml: true,
            sentAt: true,
          },
        },
        aiDrafts: {
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            channel: true,
          },
        },
        followUpInstances: {
          where: {
            status: "paused",
            pausedReason: { startsWith: "missing_" },
          },
          select: { pausedReason: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    };

    const baseQueryOptionsSafe: any = {
      where: safeWhere,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        clientId: true,
        smsCampaignId: true,
        emailCampaignId: true,
        campaignId: true,
        createdAt: true,
        client: {
          select: {
            id: true,
            name: true,
            ghlLocationId: true,
          },
        },
        smsCampaign: {
          select: {
            id: true,
            name: true,
          },
        },
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1,
          select: {
            id: true,
            body: true,
            subject: true,
            channel: true,
            direction: true,
            emailBisonReplyId: true,
            rawHtml: true,
            sentAt: true,
          },
        },
      },
    };

    const collectLeads = async (
      baseQueryOptions: any,
      opts?: { forceNoReplyStateFilter?: boolean; statementTimeoutMs?: number }
    ): Promise<any[]> => {
      const statementTimeoutMs = opts?.statementTimeoutMs ?? INBOX_QUERY_STATEMENT_TIMEOUT_MS;
      const needsReplyStateFilter = replyStateFilter !== null && !opts?.forceNoReplyStateFilter;
      if (!needsReplyStateFilter) {
        const queryOptions: any = { ...baseQueryOptions, take: limit + 1 };
        if (cursor) {
          queryOptions.cursor = { id: cursor };
          queryOptions.skip = 1;
        }
        return findLeadsWithStatementTimeout(queryOptions, statementTimeoutMs);
      }

      const batchSize = Math.max(limit * 4, 200);
      const maxBatches = 10;
      const matched: any[] = [];
      let nextCursorId: string | null = cursor ?? null;
      let exhausted = false;

      for (let batch = 0; batch < maxBatches && matched.length < limit + 1 && !exhausted; batch += 1) {
        const queryOptions: any = { ...baseQueryOptions, take: batchSize };
        if (nextCursorId) {
          queryOptions.cursor = { id: nextCursorId };
          queryOptions.skip = 1;
        }

        const batchLeads = await findLeadsWithStatementTimeout(queryOptions, statementTimeoutMs);
        if (batchLeads.length === 0) break;

        nextCursorId = batchLeads[batchLeads.length - 1]!.id;
        if (batchLeads.length < batchSize) exhausted = true;

        const filtered = batchLeads.filter((lead: any) => {
          const hasOpenReply = hasOpenReplyFromLeadRollups(lead);
          return replyStateFilter === "open" ? hasOpenReply : !hasOpenReply;
        });

        matched.push(...filtered);
      }

      return matched;
    };

    const executeCollectLeadsWithSchemaFallback = async (
      fullQueryOptions: any,
      opts?: { statementTimeoutMs?: number; allowSchemaSafeFallback?: boolean }
    ): Promise<any[]> => {
      try {
        return await collectLeads(fullQueryOptions, opts);
      } catch (error) {
        const anyError = error as { code?: unknown };
        if ((anyError?.code === "P2021" || anyError?.code === "P2022") && opts?.allowSchemaSafeFallback !== false) {
          console.warn("[Inbox] getConversationsCursor falling back to schema-safe query:", {
            code: anyError.code,
          });
          // When the DB is behind, the reply-state filter may rely on columns that don't exist yet.
          // Fall back to "no reply-state filter" so the inbox still renders.
          return collectLeads(baseQueryOptionsSafe, {
            forceNoReplyStateFilter: true,
            statementTimeoutMs: opts?.statementTimeoutMs,
          });
        }
        throw error;
      }
    };

    let leads = await executeCollectLeadsWithSchemaFallback(baseQueryOptionsFull);

    if (leads.length === 0 && fullEmailSearchTerm && fullEmailSearchConditionIndex !== null) {
      const expandedWhereConditions = expandFullEmailSearchCondition(
        whereConditions,
        fullEmailSearchConditionIndex,
        fullEmailSearchTerm
      );
      const expandedQueryOptionsFull: any = {
        ...baseQueryOptionsFull,
        where: expandedWhereConditions.length > 0 ? { AND: expandedWhereConditions } : undefined,
      };

      try {
        const fallbackLeads = await executeCollectLeadsWithSchemaFallback(expandedQueryOptionsFull, {
          statementTimeoutMs: INBOX_FULL_EMAIL_FALLBACK_TIMEOUT_MS,
          allowSchemaSafeFallback: false,
        });
        if (fallbackLeads.length > 0) {
          leads = fallbackLeads;
          console.info("[InboxSearch] full-email fallback matched via currentReplierEmail", {
            scopeSize: scope.clientIds.length,
          });
        }
      } catch (fallbackError) {
        console.warn("[InboxSearch] full-email fallback failed", {
          message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }

    // Check if there are more records
    const hasMore = leads.length > limit;
    const resultLeads = hasMore ? leads.slice(0, limit) : leads;
    const nextCursor = hasMore && resultLeads.length > 0 ? resultLeads[resultLeads.length - 1].id : null;

    // Batch fetch setter emails for assigned leads (Phase 43)
    const assignedUserIds = [...new Set(
      resultLeads
        .map((lead: any) => lead.assignedToUserId)
        .filter((id: string | null): id is string => id !== null)
    )];
    const setterEmailMap = assignedUserIds.length > 0
      ? await getSupabaseUserEmailsByIds(assignedUserIds)
      : new Map<string, string | null>();

    // Transform to conversation format
    const hasOpenReplyOverride = replyStateFilter === "open" ? true : replyStateFilter === "handled" ? false : undefined;
    const conversations = resultLeads.map((lead: any) =>
      transformLeadToConversation(lead, { hasOpenReply: hasOpenReplyOverride, setterEmailMap })
    );

    const out: ConversationsCursorResult = {
      success: true,
      conversations,
      nextCursor,
      hasMore,
    };

    await redisSetJson(cacheKey, out, { exSeconds: cursor ? 30 : 15 });
    return out;
  } catch (error) {
    const safe = toSafeActionError(error, { defaultPublicMessage: "Failed to load conversations" });
    if (safe.errorClass === "not_authenticated" || safe.errorClass === "unauthorized") {
      return {
        success: false,
        conversations: [],
        nextCursor: null,
        hasMore: false,
        error: safe.publicMessage,
      };
    }

    console.error("Failed to fetch conversations with cursor:", {
      debugId: safe.debugId,
      errorClass: safe.errorClass,
    }, error);
    return {
      success: false,
      conversations: [],
      nextCursor: null,
      hasMore: false,
      error: `${safe.publicMessage} (ref: ${safe.debugId})`,
    };
  }
}

/**
 * Get conversations from the end of the list (for "Jump to Bottom" feature)
 */
export async function getConversationsFromEnd(
  options: Omit<ConversationsCursorOptions, "cursor">
): Promise<ConversationsCursorResult> {
  try {
    const {
      clientId,
      limit = 50,
      search,
      channels,
      channel,
      sentimentTag,
      sentimentTags,
      smsCampaignId,
      smsCampaignUnattributed,
      filter,
    } = options;

    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return { success: true, conversations: [], nextCursor: null, hasMore: false };
    }

    // Build the where clause (same as cursor version)
    const whereConditions: any[] = [];
    let fullEmailSearchTerm: string | null = null;
    let fullEmailSearchConditionIndex: number | null = null;
    const now = new Date();
    whereConditions.push({ OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] });

    whereConditions.push({ clientId: { in: scope.clientIds } });

    if (search && search.trim()) {
      const rawSearchTerm = search.trim();
      const normalizedSearchTerm = rawSearchTerm.replace(/[),.;:\]\}]+$/g, "").trim();

      if (normalizedSearchTerm.length >= 3) {
        if (looksLikeFullEmailSearchTerm(normalizedSearchTerm)) {
          const emailTerm = normalizedSearchTerm.toLowerCase();
          whereConditions.push(buildFullEmailSearchCondition(emailTerm));
          fullEmailSearchTerm = emailTerm;
          fullEmailSearchConditionIndex = whereConditions.length - 1;
        } else {
          whereConditions.push({
            OR: [
              { firstName: { contains: normalizedSearchTerm, mode: "insensitive" } },
              { lastName: { contains: normalizedSearchTerm, mode: "insensitive" } },
              { email: { contains: normalizedSearchTerm, mode: "insensitive" } },
              { companyName: { contains: normalizedSearchTerm, mode: "insensitive" } },
              { smsCampaign: { is: { name: { contains: normalizedSearchTerm, mode: "insensitive" } } } },
            ],
          });
        }
      }
    }

    const channelList =
      channels && channels.length > 0
        ? Array.from(new Set(channels))
        : channel && channel !== "all"
          ? [channel]
          : [];

    if (channelList.length > 0) {
      whereConditions.push({
        messages: {
          some: { channel: { in: channelList } },
        },
      });
    }

    if (sentimentTags && sentimentTags.length > 0) {
      whereConditions.push({ sentimentTag: { in: sentimentTags } });
    } else if (sentimentTag && sentimentTag !== "all") {
      whereConditions.push({ sentimentTag });
    }

    if (smsCampaignUnattributed) {
      whereConditions.push({ smsCampaignId: null });
    } else if (smsCampaignId) {
      whereConditions.push({ smsCampaignId });
    }

    const replyStateFilter: "open" | "handled" | null =
      filter === "responses" || filter === "attention"
        ? "open"
        : filter === "previous_attention" || filter === "drafts"
          ? "handled"
          : null;

    if (filter === "responses") {
      whereConditions.push({ lastInboundAt: { not: null } });
    } else if (filter === "attention") {
      whereConditions.push({
        sentimentTag: { in: ATTENTION_SENTIMENT_TAGS as unknown as string[] },
        lastInboundAt: { not: null },
        status: { notIn: ["blacklisted", "unqualified"] },
      });
    } else if (filter === "previous_attention" || filter === "drafts") {
      whereConditions.push({
        sentimentTag: { in: ATTENTION_SENTIMENT_TAGS as unknown as string[] },
        lastInboundAt: { not: null },
        status: { notIn: ["blacklisted", "unqualified"] },
      });
    } else if (filter === "needs_repair") {
      whereConditions.push({ status: "needs_repair" });
    } else if (filter === "ai_sent") {
      whereConditions.push({
        emailCampaign: {
          is: { responseMode: "AI_AUTO_SEND" },
        },
      });
      whereConditions.push({
        messages: {
          some: {
            channel: "email",
            direction: "outbound",
            sentBy: "ai",
            source: "zrg",
            aiDraftId: { not: null },
          },
        },
      });
    } else if (filter === "ai_review") {
      whereConditions.push({
        aiDrafts: {
          some: {
            status: "pending",
            autoSendAction: "needs_review",
          },
        },
      });
    }

    const where = whereConditions.length > 0
      ? { AND: whereConditions }
      : undefined;

    // Fetch from the "end" by reversing sort order
    const fromEndQueryOptions: any = {
      where,
      take: limit,
      orderBy: { updatedAt: "asc" }, // Reverse order
      include: {
        client: {
          select: {
            id: true,
            name: true,
            ghlLocationId: true,
          },
        },
        smsCampaign: {
          select: {
            id: true,
            name: true,
          },
        },
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1,
          select: {
            id: true,
            body: true,
            subject: true,
            channel: true,
            direction: true,
            emailBisonReplyId: true,
            rawHtml: true,
            sentAt: true,
          },
        },
        aiDrafts: {
          where: { status: "pending" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            channel: true,
          },
        },
        followUpInstances: {
          where: {
            status: "paused",
            pausedReason: { startsWith: "missing_" },
          },
          select: { pausedReason: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    };

    let leads = await findLeadsWithStatementTimeout(fromEndQueryOptions);

    if (leads.length === 0 && fullEmailSearchTerm && fullEmailSearchConditionIndex !== null) {
      const expandedWhereConditions = expandFullEmailSearchCondition(
        whereConditions,
        fullEmailSearchConditionIndex,
        fullEmailSearchTerm
      );
      const fallbackQueryOptions = {
        ...fromEndQueryOptions,
        where: expandedWhereConditions.length > 0 ? { AND: expandedWhereConditions } : undefined,
      };

      try {
        const fallbackLeads = await findLeadsWithStatementTimeout(
          fallbackQueryOptions,
          INBOX_FULL_EMAIL_FALLBACK_TIMEOUT_MS
        );
        if (fallbackLeads.length > 0) {
          leads = fallbackLeads;
          console.info("[InboxSearch] from-end full-email fallback matched via currentReplierEmail", {
            scopeSize: scope.clientIds.length,
          });
        }
      } catch (fallbackError) {
        console.warn("[InboxSearch] from-end full-email fallback failed", {
          message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }

    if (replyStateFilter) {
      leads = leads.filter((lead: any) => {
        const hasOpenReply = hasOpenReplyFromLeadRollups(lead);
        return replyStateFilter === "open" ? hasOpenReply : !hasOpenReply;
      });
    }

    // Reverse to get correct display order
    const reversedLeads = leads.reverse();

    // Batch fetch setter emails for assigned leads (Phase 43)
    const assignedUserIds = [...new Set(
      reversedLeads
        .map((lead: any) => lead.assignedToUserId)
        .filter((id: string | null): id is string => id !== null)
    )];
    const setterEmailMap = assignedUserIds.length > 0
      ? await getSupabaseUserEmailsByIds(assignedUserIds)
      : new Map<string, string | null>();

    // Transform to conversation format
    const hasOpenReplyOverride = replyStateFilter === "open" ? true : replyStateFilter === "handled" ? false : undefined;
    const conversations = reversedLeads.map((lead: any) =>
      transformLeadToConversation(lead, { hasOpenReply: hasOpenReplyOverride, setterEmailMap })
    );

    const nextCursor = reversedLeads.length > 0 ? reversedLeads[0].id : null;

    const out: ConversationsCursorResult = {
      success: true,
      conversations,
      nextCursor,
      hasMore: leads.length === limit,
    };

    return out;
  } catch (error) {
    const safe = toSafeActionError(error, { defaultPublicMessage: "Failed to load conversations" });
    if (safe.errorClass === "not_authenticated" || safe.errorClass === "unauthorized") {
      return {
        success: false,
        conversations: [],
        nextCursor: null,
        hasMore: false,
        error: safe.publicMessage,
      };
    }

    console.error("Failed to fetch conversations from end:", {
      debugId: safe.debugId,
      errorClass: safe.errorClass,
    }, error);
    return {
      success: false,
      conversations: [],
      nextCursor: null,
      hasMore: false,
      error: `${safe.publicMessage} (ref: ${safe.debugId})`,
    };
  }
}

// =============================================================================
// Diagnostic Functions for Debugging
// =============================================================================

/**
 * Diagnostic function to analyze sentiment tag distribution for a workspace
 * Helps debug issues with "requires attention" counts and filter functionality
 */
export async function diagnoseSentimentTags(clientId?: string | null): Promise<{
  success: boolean;
  data?: {
    totalLeads: number;
    sentimentDistribution: Record<string, number>;
    attentionTagsCount: number;
    blacklistedCount: number;
    leadsWithNullSentiment: number;
    sampleLeadsNeedingAttention: Array<{ id: string; name: string; sentimentTag: string | null; status: string }>;
  };
  error?: string;
}> {
  try {
    const scope = await resolveClientScope(clientId);
    if (scope.clientIds.length === 0) {
      return {
        success: true,
        data: {
          totalLeads: 0,
          sentimentDistribution: {},
          attentionTagsCount: 0,
          blacklistedCount: 0,
          leadsWithNullSentiment: 0,
          sampleLeadsNeedingAttention: [],
        },
      };
    }
    const clientFilter = { clientId: { in: scope.clientIds } };
    const attentionTags = [
      "Meeting Requested",
      "Call Requested",
      "Information Requested",
      "Positive",
      "Interested",
      "Follow Up"
    ];

    // Get all leads for the workspace
    const leads = await prisma.lead.findMany({
      where: clientFilter,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        sentimentTag: true,
        status: true,
      },
    });

    // Calculate sentiment distribution
    const sentimentDistribution: Record<string, number> = {};
    let leadsWithNullSentiment = 0;

    for (const lead of leads) {
      if (lead.sentimentTag === null) {
        leadsWithNullSentiment++;
        sentimentDistribution["(null)"] = (sentimentDistribution["(null)"] || 0) + 1;
      } else {
        sentimentDistribution[lead.sentimentTag] = (sentimentDistribution[lead.sentimentTag] || 0) + 1;
      }
    }

    // Count leads that should require attention
    const attentionLeads = leads.filter(
      (lead) =>
        attentionTags.includes(lead.sentimentTag || "") &&
        !["blacklisted", "unqualified"].includes(lead.status)
    );

    // Count blacklisted
    const blacklistedCount = leads.filter((lead) => lead.status === "blacklisted").length;

    // Get sample leads that require attention
    const sampleLeadsNeedingAttention = attentionLeads.slice(0, 5).map((lead) => ({
      id: lead.id,
      name: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown",
      sentimentTag: lead.sentimentTag,
      status: lead.status,
    }));

    return {
      success: true,
      data: {
        totalLeads: leads.length,
        sentimentDistribution,
        attentionTagsCount: attentionLeads.length,
        blacklistedCount,
        leadsWithNullSentiment,
        sampleLeadsNeedingAttention,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to diagnose sentiment tags:", errorMessage, error);
    return {
      success: false,
      error: `Failed to diagnose sentiment tags: ${errorMessage}`,
    };
  }
}

export async function promoteAlternateContactToPrimary(
  leadId: string,
  newPrimaryEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { clientId } = await requireLeadAccessById(leadId);
    await requireClientAdminAccess(clientId);

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        email: true,
        alternateEmails: true,
        currentReplierEmail: true,
        currentReplierName: true,
        currentReplierSince: true,
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const normalizedNew = normalizeOptionalEmail(newPrimaryEmail);
    if (!normalizedNew || !validateEmail(normalizedNew)) {
      return { success: false, error: "Invalid email address" };
    }

    if (emailsMatch(lead.email, normalizedNew)) {
      return { success: false, error: "Email is already the primary contact" };
    }

    const isAlternate = (lead.alternateEmails ?? []).some((alt) => emailsMatch(alt, normalizedNew));
    if (!isAlternate) {
      return { success: false, error: "Email is not an alternate contact for this lead" };
    }

    const nextAlternates = addToAlternateEmails(lead.alternateEmails ?? [], lead.email, normalizedNew);
    const shouldClearReplier = emailsMatch(lead.currentReplierEmail, normalizedNew);

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        email: normalizedNew,
        alternateEmails: nextAlternates,
        currentReplierEmail: shouldClearReplier ? null : lead.currentReplierEmail,
        currentReplierName: shouldClearReplier ? null : lead.currentReplierName,
        currentReplierSince: shouldClearReplier ? null : lead.currentReplierSince,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("[promoteAlternateContactToPrimary] Error:", error);
    return { success: false, error: "Failed to promote contact" };
  }
}

export async function requestPromoteAlternateContactToPrimary(
  leadId: string,
  requestedEmail: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    const user = await requireAuthUser();
    const { clientId } = await requireLeadAccessById(leadId);
    const role = await getUserRoleForClient(user.id, clientId);

    if (role !== "SETTER") {
      return { success: false, error: "Only setters can request promotion approval" };
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        email: true,
        alternateEmails: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const normalizedRequested = normalizeOptionalEmail(requestedEmail);
    if (!normalizedRequested || !validateEmail(normalizedRequested)) {
      return { success: false, error: "Invalid email address" };
    }

    if (emailsMatch(lead.email, normalizedRequested)) {
      return { success: false, error: "Email is already the primary contact" };
    }

    const isAlternate = (lead.alternateEmails ?? []).some((alt) => emailsMatch(alt, normalizedRequested));
    if (!isAlternate) {
      return { success: false, error: "Email is not an alternate contact for this lead" };
    }

    const [client, adminMembers] = await Promise.all([
      prisma.client.findUnique({
        where: { id: clientId },
        select: { userId: true, name: true },
      }),
      prisma.clientMember.findMany({
        where: { clientId, role: ClientMemberRole.ADMIN },
        select: { userId: true },
      }),
    ]);

    const adminUserIds = new Set<string>();
    if (client?.userId) adminUserIds.add(client.userId);
    for (const member of adminMembers) {
      if (member.userId) adminUserIds.add(member.userId);
    }

    if (adminUserIds.size === 0) {
      return {
        success: true,
        message:
          "No admins found for this workspace. Please contact a workspace admin/owner to promote this contact.",
      };
    }

    let adminEmails: string[] = [];
    try {
      const adminEmailMap = await getSupabaseUserEmailsByIds(Array.from(adminUserIds));
      adminEmails = Array.from(adminEmailMap.values()).filter((email): email is string => Boolean(email));
    } catch (error) {
      console.warn(
        "[requestPromoteAlternateContactToPrimary] Failed to look up admin emails for Slack notifications:",
        error
      );
    }

    if (adminEmails.length === 0) {
      return {
        success: true,
        message:
          "Could not notify admins via Slack (admin email lookup not available). Please contact a workspace admin/owner to promote this contact.",
      };
    }

    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
    const clientName = client?.name || "Workspace";
    const dashboardUrl = `${getPublicAppUrl()}/?view=inbox&clientId=${encodeURIComponent(clientId)}&leadId=${encodeURIComponent(leadId)}`;
    const requesterLabel = user.email ? `${user.email}` : `User ${user.id}`;
    const leadLabel = `${leadName}${lead.email ? ` (${lead.email})` : ""}`;

    const results = await Promise.all(
      adminEmails.map((email) =>
        sendSlackDmByEmail({
          email,
          dedupeKey: `promote_request:${leadId}:${normalizedRequested}:${email}`,
          text: `Promotion request for ${leadName}`,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: "Contact Promotion Request", emoji: true },
            },
            {
              type: "section",
              fields: [
                { type: "mrkdwn", text: `*Lead:*\n${leadLabel}` },
                { type: "mrkdwn", text: `*Requested Primary:*\n${normalizedRequested}` },
                { type: "mrkdwn", text: `*Requested By:*\n${requesterLabel}` },
                { type: "mrkdwn", text: `*Workspace:*\n${clientName}` },
              ],
            },
            {
              type: "actions",
              elements: [
                {
                  type: "button",
                  text: { type: "plain_text", text: "Open in Dashboard", emoji: true },
                  url: dashboardUrl,
                  action_id: "open_dashboard",
                },
              ],
            },
          ],
        })
      )
    );

    const notifiedCount = results.filter((result) => result.success).length;

    if (notifiedCount === 0) {
      return {
        success: true,
        message:
          "Could not notify admins via Slack (Slack may not be configured). Please contact a workspace admin/owner to promote this contact.",
      };
    }

    return {
      success: true,
      message: `Request sent to ${notifiedCount} admin${notifiedCount === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    console.error("[requestPromoteAlternateContactToPrimary] Error:", error);
    return { success: false, error: "Failed to request promotion" };
  }
}
