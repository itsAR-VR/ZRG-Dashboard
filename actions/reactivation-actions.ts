"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { findOrCreateLead } from "@/lib/lead-matching";
import { refreshSenderEmailSnapshotsDue, resolveReactivationEnrollmentsDue, processReactivationSendsDue } from "@/lib/reactivation-engine";
import Papa from "papaparse";
import { Prisma } from "@prisma/client";
import { requireClientAdminAccess } from "@/lib/workspace-access";

type ReactivationCampaignData = {
  id: string;
  clientId: string;
  name: string;
  isActive: boolean;
  emailCampaignId: string | null;
  followUpSequenceId: string | null;
  dailyLimitPerSender: number;
  allowedSenderEmailIds: unknown | null;
  bumpMessageTemplate: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { enrollments: number };
};

export async function getReactivationCampaigns(clientId: string): Promise<{ success: boolean; data?: ReactivationCampaignData[]; error?: string }> {
  try {
    await requireClientAdminAccess(clientId);
    const campaigns = await prisma.reactivationCampaign.findMany({
      where: { clientId },
      include: { _count: { select: { enrollments: true } } },
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data: campaigns as any };
  } catch (error) {
    console.error("[Reactivation] Failed to fetch campaigns:", error);
    return { success: false, error: "Failed to fetch reactivation campaigns" };
  }
}

export async function createReactivationCampaign(input: {
  clientId: string;
  name: string;
  emailCampaignId?: string | null;
  followUpSequenceId?: string | null;
  dailyLimitPerSender?: number;
  bumpMessageTemplate?: string;
  allowedSenderEmailIds?: unknown | null;
}): Promise<{ success: boolean; campaignId?: string; error?: string }> {
  try {
    await requireClientAdminAccess(input.clientId);
    const name = input.name.trim();
    if (!name) return { success: false, error: "Campaign name is required" };

    const bumpMessageTemplate =
      (input.bumpMessageTemplate || "").trim() ||
      "Hey {firstName} — just bumping this. Is it worth discussing this now, or should I circle back later?";

    const campaign = await prisma.reactivationCampaign.create({
      data: {
        clientId: input.clientId,
        name,
        isActive: true,
        emailCampaignId: input.emailCampaignId ?? null,
        followUpSequenceId: input.followUpSequenceId ?? null,
        dailyLimitPerSender: input.dailyLimitPerSender ?? 5,
        allowedSenderEmailIds: input.allowedSenderEmailIds ?? Prisma.DbNull,
        bumpMessageTemplate,
      },
      select: { id: true },
    });

    revalidatePath("/");
    return { success: true, campaignId: campaign.id };
  } catch (error) {
    console.error("[Reactivation] Failed to create campaign:", error);
    return { success: false, error: "Failed to create reactivation campaign" };
  }
}

export async function updateReactivationCampaign(
  campaignId: string,
  input: Partial<{
    name: string;
    isActive: boolean;
    emailCampaignId: string | null;
    followUpSequenceId: string | null;
    dailyLimitPerSender: number;
    bumpMessageTemplate: string;
    allowedSenderEmailIds: unknown | null;
  }>
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await prisma.reactivationCampaign.findUnique({
      where: { id: campaignId },
      select: { clientId: true },
    });
    if (!existing) return { success: false, error: "Campaign not found" };
    await requireClientAdminAccess(existing.clientId);

    const data: any = {};
    if (typeof input.name === "string") {
      const name = input.name.trim();
      if (!name) return { success: false, error: "Campaign name cannot be empty" };
      data.name = name;
    }
    if (typeof input.isActive === "boolean") data.isActive = input.isActive;
    if (input.emailCampaignId !== undefined) data.emailCampaignId = input.emailCampaignId;
    if (input.followUpSequenceId !== undefined) data.followUpSequenceId = input.followUpSequenceId;
    if (typeof input.dailyLimitPerSender === "number") data.dailyLimitPerSender = input.dailyLimitPerSender;
    if (typeof input.bumpMessageTemplate === "string") data.bumpMessageTemplate = input.bumpMessageTemplate;
    if (input.allowedSenderEmailIds !== undefined) data.allowedSenderEmailIds = input.allowedSenderEmailIds ?? Prisma.DbNull;

    await prisma.reactivationCampaign.update({ where: { id: campaignId }, data });
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[Reactivation] Failed to update campaign:", error);
    return { success: false, error: "Failed to update reactivation campaign" };
  }
}

export async function deleteReactivationCampaign(campaignId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await prisma.reactivationCampaign.findUnique({
      where: { id: campaignId },
      select: { clientId: true },
    });
    if (!existing) return { success: false, error: "Campaign not found" };
    await requireClientAdminAccess(existing.clientId);

    await prisma.reactivationCampaign.delete({ where: { id: campaignId } });
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[Reactivation] Failed to delete campaign:", error);
    return { success: false, error: "Failed to delete reactivation campaign" };
  }
}

export async function getReactivationEnrollments(campaignId: string): Promise<{
  success: boolean;
  data?: Array<{
    id: string;
    status: string;
    needsReviewReason: string | null;
    emailBisonLeadId: string | null;
    anchorReplyId: string | null;
    anchorCampaignId: string | null;
    originalSenderEmailId: string | null;
    selectedSenderEmailId: string | null;
    deadOriginalSender: boolean;
    deadReason: string | null;
    nextActionAt: Date | null;
    retryCount: number;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
    lead: { id: string; email: string | null; firstName: string | null; lastName: string | null; status: string; sentimentTag: string | null };
  }>;
  error?: string;
}> {
  try {
    const campaign = await prisma.reactivationCampaign.findUnique({
      where: { id: campaignId },
      select: { clientId: true },
    });
    if (!campaign) return { success: false, error: "Campaign not found" };
    await requireClientAdminAccess(campaign.clientId);

    const rows = await prisma.reactivationEnrollment.findMany({
      where: { campaignId },
      include: {
        lead: { select: { id: true, email: true, firstName: true, lastName: true, status: true, sentimentTag: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 2000,
    });
    return { success: true, data: rows as any };
  } catch (error) {
    console.error("[Reactivation] Failed to fetch enrollments:", error);
    return { success: false, error: "Failed to fetch enrollments" };
  }
}

export async function resetReactivationEnrollment(enrollmentId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const enrollment = await prisma.reactivationEnrollment.findUnique({
      where: { id: enrollmentId },
      select: { campaign: { select: { clientId: true } } },
    });
    if (!enrollment) return { success: false, error: "Enrollment not found" };
    await requireClientAdminAccess(enrollment.campaign.clientId);

    await prisma.reactivationEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: "pending_resolution",
        needsReviewReason: null,
        emailBisonLeadId: null,
        anchorReplyId: null,
        anchorCampaignId: null,
        originalSenderEmailId: null,
        selectedSenderEmailId: null,
        deadOriginalSender: false,
        deadReason: null,
        nextActionAt: null,
        lastAttemptAt: null,
        retryCount: 0,
        lastError: null,
        resolvedAt: null,
        sentAt: null,
      },
    });
    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("[Reactivation] Failed to reset enrollment:", error);
    return { success: false, error: "Failed to reset enrollment" };
  }
}

export async function importReactivationCsv(input: {
  campaignId: string;
  csvText: string;
}): Promise<{ success: boolean; imported?: number; deduped?: number; error?: string }> {
  try {
    const campaign = await prisma.reactivationCampaign.findUnique({
      where: { id: input.campaignId },
      select: { id: true, clientId: true },
    });
    if (!campaign) return { success: false, error: "Campaign not found" };
    await requireClientAdminAccess(campaign.clientId);

    const parsed = Papa.parse<Record<string, unknown>>(input.csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (parsed.errors?.length) {
      return { success: false, error: `CSV parse error: ${parsed.errors[0]?.message || "Unknown error"}` };
    }

    const rows = parsed.data || [];
    if (rows.length === 0) return { success: false, error: "CSV has no data rows" };

    let imported = 0;
    let deduped = 0;

    const pick = (obj: Record<string, unknown>, keys: string[]): string | null => {
      for (const key of keys) {
        const v = obj[key];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return null;
    };

    const maxRows = 10000;
    if (rows.length > maxRows) {
      return { success: false, error: `CSV is too large (${rows.length} rows). Max ${maxRows}.` };
    }

    const unique: Array<{ email: string; firstName: string | null; lastName: string | null }> = [];
    const seenEmails = new Set<string>();

    for (const row of rows) {
      const emailRaw =
        pick(row, ["email", "Email", "EMAIL"]) ||
        // tolerate “work email”/etc
        Object.entries(row).find(([k]) => k.toLowerCase().includes("email"))?.[1] as any;

      const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
      if (!email || !email.includes("@")) continue;
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);

      const firstName =
        pick(row, ["first_name", "firstName", "First Name", "FirstName", "firstname"]) ||
        Object.entries(row).find(([k]) => k.toLowerCase().includes("first"))?.[1] as any;

      const lastName =
        pick(row, ["last_name", "lastName", "Last Name", "LastName", "lastname"]) ||
        Object.entries(row).find(([k]) => k.toLowerCase().includes("last"))?.[1] as any;

      unique.push({
        email,
        firstName: typeof firstName === "string" ? firstName : null,
        lastName: typeof lastName === "string" ? lastName : null,
      });
    }

    if (unique.length === 0) return { success: false, error: "No valid emails found in CSV" };

    const leadIds: string[] = [];
    const blockedLeadReasonById = new Map<string, string>();

    for (const row of unique) {
      const leadResult = await findOrCreateLead(
        campaign.clientId,
        { email: row.email, firstName: row.firstName, lastName: row.lastName },
        undefined,
        undefined
      );
      leadIds.push(leadResult.lead.id);
      if (leadResult.lead.status === "blacklisted") {
        blockedLeadReasonById.set(leadResult.lead.id, "Lead is blacklisted/opted out");
      }
      if (leadResult.lead.status === "unqualified") {
        blockedLeadReasonById.set(leadResult.lead.id, "Lead is unqualified");
      }
    }

    const existing = await prisma.reactivationEnrollment.findMany({
      where: { campaignId: input.campaignId, leadId: { in: leadIds } },
      select: { leadId: true, status: true },
    });
    const existingMap = new Map(existing.map((e) => [e.leadId, e.status]));

    const createRows: Array<{ campaignId: string; leadId: string; status: string; needsReviewReason?: string | null }> = [];
    const updatePendingLeadIds: string[] = [];
    const updateNeedsReviewLeadIds: string[] = [];

    for (const leadId of leadIds) {
      const existingStatus = existingMap.get(leadId);
      const blockedReason = blockedLeadReasonById.get(leadId) || null;
      const isBlocked = Boolean(blockedReason);

      if (!existingStatus) {
        imported++;
        createRows.push({
          campaignId: input.campaignId,
          leadId,
          status: isBlocked ? "needs_review" : "pending_resolution",
          ...(isBlocked ? { needsReviewReason: blockedReason } : {}),
        });
        continue;
      }

      deduped++;
      if ((existingStatus || "").toLowerCase() === "sent") continue;

      if (isBlocked) updateNeedsReviewLeadIds.push(leadId);
      else updatePendingLeadIds.push(leadId);
    }

    if (createRows.length > 0) {
      await prisma.reactivationEnrollment.createMany({
        data: createRows as any,
        skipDuplicates: true,
      });
    }

    const resetData = {
      emailBisonLeadId: null,
      anchorReplyId: null,
      anchorCampaignId: null,
      originalSenderEmailId: null,
      selectedSenderEmailId: null,
      deadOriginalSender: false,
      deadReason: null,
      nextActionAt: null,
      lastAttemptAt: null,
      retryCount: 0,
      lastError: null,
      resolvedAt: null,
      sentAt: null,
    } as const;

    if (updatePendingLeadIds.length > 0) {
      await prisma.reactivationEnrollment.updateMany({
        where: { campaignId: input.campaignId, leadId: { in: updatePendingLeadIds } },
        data: { status: "pending_resolution", needsReviewReason: null, ...resetData },
      });
    }

    if (updateNeedsReviewLeadIds.length > 0) {
      await prisma.reactivationEnrollment.updateMany({
        where: { campaignId: input.campaignId, leadId: { in: updateNeedsReviewLeadIds } },
        data: { status: "needs_review", needsReviewReason: "Lead is blacklisted/opted out", ...resetData },
      });
    }

    revalidatePath("/");
    return { success: true, imported, deduped };
  } catch (error) {
    console.error("[Reactivation] Failed to import CSV:", error);
    return { success: false, error: "Failed to import CSV" };
  }
}

export async function runReactivationNow(input: {
  clientId: string;
  resolveLimit?: number;
  sendLimit?: number;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    await requireClientAdminAccess(input.clientId);
    const snapshots = await refreshSenderEmailSnapshotsDue({ clientId: input.clientId, ttlMinutes: 0, limitClients: 1 });
    const resolved = await resolveReactivationEnrollmentsDue({ clientId: input.clientId, limit: input.resolveLimit ?? 200 });
    const sent = await processReactivationSendsDue({ clientId: input.clientId, limit: input.sendLimit ?? 50 });
    revalidatePath("/");
    return { success: true, data: { snapshots, resolved, sent } };
  } catch (error) {
    console.error("[Reactivation] Failed to run now:", error);
    return { success: false, error: "Failed to run reactivations" };
  }
}
