"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface FollowUpTaskData {
  id: string;
  leadId: string;
  leadName: string;
  leadCompany: string;
  type: "email" | "call" | "sms" | "linkedin";
  dueDate: Date;
  status: "pending" | "completed" | "skipped";
  suggestedMessage: string | null;
  sequenceStep: number | null;
  totalSteps: number | null;
  campaignName: string | null;
}

/**
 * Get all follow-up tasks
 * @param filter - Time filter for tasks
 * @param clientId - Optional workspace ID to filter by
 */
export async function getFollowUpTasks(
  filter: "today" | "week" | "overdue" | "all" = "all",
  clientId?: string | null
): Promise<{
  success: boolean;
  data?: FollowUpTaskData[];
  error?: string;
}> {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(startOfDay);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    let whereClause: any = {
      status: "pending",
      ...(clientId && { lead: { clientId } }),
    };

    switch (filter) {
      case "today":
        whereClause = {
          ...whereClause,
          dueDate: {
            gte: startOfDay,
            lte: endOfDay,
          },
        };
        break;
      case "week":
        whereClause = {
          ...whereClause,
          dueDate: {
            gte: startOfDay,
            lte: endOfWeek,
          },
        };
        break;
      case "overdue":
        whereClause = {
          ...whereClause,
          dueDate: {
            lt: startOfDay,
          },
        };
        break;
    }

    const tasks = await prisma.followUpTask.findMany({
      where: whereClause,
      include: {
        lead: {
          include: {
            client: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: { dueDate: "asc" },
    });

    const formattedTasks: FollowUpTaskData[] = tasks.map((task) => ({
      id: task.id,
      leadId: task.leadId,
      leadName: [task.lead.firstName, task.lead.lastName].filter(Boolean).join(" ") || "Unknown",
      leadCompany: task.lead.client.name,
      type: task.type as FollowUpTaskData["type"],
      dueDate: task.dueDate,
      status: task.status as FollowUpTaskData["status"],
      suggestedMessage: task.suggestedMessage,
      sequenceStep: task.sequenceStep,
      totalSteps: task.totalSteps,
      campaignName: task.campaignName,
    }));

    return { success: true, data: formattedTasks };
  } catch (error) {
    console.error("Failed to fetch follow-up tasks:", error);
    return { success: false, error: "Failed to fetch follow-up tasks" };
  }
}

/**
 * Create a new follow-up task
 */
export async function createFollowUpTask(data: {
  leadId: string;
  type: string;
  dueDate: Date;
  suggestedMessage?: string;
  campaignName?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.followUpTask.create({
      data: {
        leadId: data.leadId,
        type: data.type,
        dueDate: data.dueDate,
        suggestedMessage: data.suggestedMessage,
        campaignName: data.campaignName,
        status: "pending",
      },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to create follow-up task:", error);
    return { success: false, error: "Failed to create follow-up task" };
  }
}

/**
 * Complete a follow-up task
 */
export async function completeFollowUpTask(taskId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    await prisma.followUpTask.update({
      where: { id: taskId },
      data: { status: "completed" },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to complete follow-up task:", error);
    return { success: false, error: "Failed to complete task" };
  }
}

/**
 * Skip a follow-up task
 */
export async function skipFollowUpTask(taskId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    await prisma.followUpTask.update({
      where: { id: taskId },
      data: { status: "skipped" },
    });

    revalidatePath("/");
    return { success: true };
  } catch (error) {
    console.error("Failed to skip follow-up task:", error);
    return { success: false, error: "Failed to skip task" };
  }
}

/**
 * Snooze a follow-up task by a number of days
 * @param taskId - The task ID
 * @param days - Number of days to snooze (default: 1)
 */
export async function snoozeFollowUpTask(
  taskId: string,
  days: number = 1
): Promise<{
  success: boolean;
  newDueDate?: Date;
  error?: string;
}> {
  try {
    const newDueDate = new Date();
    newDueDate.setDate(newDueDate.getDate() + days);
    newDueDate.setHours(9, 0, 0, 0); // Set to 9 AM on the snooze date

    await prisma.followUpTask.update({
      where: { id: taskId },
      data: { dueDate: newDueDate },
    });

    revalidatePath("/");
    return { success: true, newDueDate };
  } catch (error) {
    console.error("Failed to snooze follow-up task:", error);
    return { success: false, error: "Failed to snooze task" };
  }
}

/**
 * Get follow-up task counts by filter
 */
export async function getFollowUpCounts(): Promise<{
  today: number;
  week: number;
  overdue: number;
  total: number;
}> {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const [today, week, overdue, total] = await Promise.all([
      prisma.followUpTask.count({
        where: {
          status: "pending",
          dueDate: { gte: startOfDay, lte: endOfDay },
        },
      }),
      prisma.followUpTask.count({
        where: {
          status: "pending",
          dueDate: { gte: startOfDay, lte: endOfWeek },
        },
      }),
      prisma.followUpTask.count({
        where: {
          status: "pending",
          dueDate: { lt: startOfDay },
        },
      }),
      prisma.followUpTask.count({
        where: { status: "pending" },
      }),
    ]);

    return { today, week, overdue, total };
  } catch (error) {
    console.error("Failed to get follow-up counts:", error);
    return { today: 0, week: 0, overdue: 0, total: 0 };
  }
}

// ============================================================================
// Follow-Up Tagged Leads (Sentiment-based)
// ============================================================================

export interface FollowUpTaggedLeadData {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string;
  sentimentTag: string;
  leadScore: number;
  lastMessagePreview: string | null;
  lastMessageAt: Date | null;
  lastOutboundAt: Date | null;
}

/**
 * Calculate a simple lead score based on engagement signals
 */
function calculateLeadScore(lead: {
  messages: { direction: string; createdAt: Date }[];
  sentimentTag: string | null;
}): number {
  let score = 50; // Base score

  // Boost for engagement
  const inboundMessages = lead.messages.filter((m) => m.direction === "inbound").length;
  score += Math.min(inboundMessages * 5, 25); // Up to +25 for responses

  // Sentiment-based scoring
  if (lead.sentimentTag === "Meeting Requested") score += 20;
  if (lead.sentimentTag === "Interested") score += 15;
  if (lead.sentimentTag === "Information Requested") score += 10;
  if (lead.sentimentTag === "Follow Up") score += 5;

  // Recency boost - more recent activity = higher score
  if (lead.messages.length > 0) {
    // messages are fetched newest-first (orderBy: createdAt desc), so index 0 is most recent
    const lastMessage = lead.messages[0];
    const daysSinceLastMessage = Math.floor(
      (Date.now() - new Date(lastMessage.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceLastMessage <= 1) score += 10;
    else if (daysSinceLastMessage <= 3) score += 5;
    else if (daysSinceLastMessage > 7) score -= 5;
  }

  return Math.max(0, Math.min(100, score)); // Clamp to 0-100
}

/**
 * Get leads tagged with "Follow Up" or "Snoozed" sentiment
 * These are conversations that need follow-up action
 * @param clientId - Workspace ID to filter by
 */
export async function getFollowUpTaggedLeads(
  clientId: string
): Promise<{
  success: boolean;
  data?: FollowUpTaggedLeadData[];
  error?: string;
}> {
  try {
    const leads = await prisma.lead.findMany({
      where: {
        clientId,
        sentimentTag: { in: ["Follow Up", "Snoozed"] },
        status: { not: "blacklisted" },
      },
      include: {
        client: {
          select: { name: true },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 10, // Get recent messages for scoring and preview
          select: {
            id: true,
            content: true,
            direction: true,
            createdAt: true,
          },
        },
      },
    });

    const formattedLeads: FollowUpTaggedLeadData[] = leads.map((lead) => {
      // Find the last message (any direction) for preview
      const lastMessage = lead.messages[0] || null;

      // Find the last outbound message for "time since last follow-up"
      const lastOutbound = lead.messages.find((m) => m.direction === "outbound");

      return {
        id: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phone,
        company: lead.client.name,
        sentimentTag: lead.sentimentTag || "Follow Up",
        leadScore: calculateLeadScore({
          messages: lead.messages,
          sentimentTag: lead.sentimentTag,
        }),
        lastMessagePreview: lastMessage?.content?.slice(0, 150) || null,
        lastMessageAt: lastMessage?.createdAt || null,
        lastOutboundAt: lastOutbound?.createdAt || null,
      };
    });

    // Sort by lead score (highest first)
    formattedLeads.sort((a, b) => b.leadScore - a.leadScore);

    return { success: true, data: formattedLeads };
  } catch (error) {
    console.error("Failed to fetch follow-up tagged leads:", error);
    return { success: false, error: "Failed to fetch follow-up tagged leads" };
  }
}

/**
 * Get count of leads needing follow-up
 */
export async function getFollowUpTaggedLeadsCount(
  clientId: string
): Promise<number> {
  try {
    return await prisma.lead.count({
      where: {
        clientId,
        sentimentTag: { in: ["Follow Up", "Snoozed"] },
        status: { not: "blacklisted" },
      },
    });
  } catch (error) {
    console.error("Failed to get follow-up tagged leads count:", error);
    return 0;
  }
}

/**
 * Outcome options for marking a follow-up lead as done
 */
export type FollowUpOutcome =
  | "no-response"
  | "replied"
  | "meeting-booked"
  | "not-interested"
  | "snoozed";

/**
 * Map outcome to sentiment tag
 */
const OUTCOME_TO_SENTIMENT: Record<FollowUpOutcome, string> = {
  "no-response": "Follow Up",      // Stays in list
  "replied": "Neutral",            // Replied but no clear intent
  "meeting-booked": "Meeting Requested",
  "not-interested": "Not Interested",
  "snoozed": "Snoozed",            // Temporarily hidden
};

/**
 * Update a lead's follow-up status based on outcome
 * Used when marking a follow-up as "done" from the Follow-ups view
 * @param leadId - The lead ID
 * @param outcome - The outcome of the follow-up
 */
export async function updateLeadFollowUpStatus(
  leadId: string,
  outcome: FollowUpOutcome
): Promise<{
  success: boolean;
  newSentimentTag?: string;
  newStatus?: string;
  error?: string;
}> {
  try {
    const newSentimentTag = OUTCOME_TO_SENTIMENT[outcome];

    // Build update data - always update sentiment tag
    const updateData: { sentimentTag: string; status?: string } = {
      sentimentTag: newSentimentTag,
    };

    // When outcome is "meeting-booked", also set the lead status to "meeting-booked"
    // This ensures the status reflects that a meeting was actually booked
    if (outcome === "meeting-booked") {
      updateData.status = "meeting-booked";
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
    });

    revalidatePath("/");
    return { 
      success: true, 
      newSentimentTag,
      newStatus: updateData.status,
    };
  } catch (error) {
    console.error("Failed to update lead follow-up status:", error);
    return { success: false, error: "Failed to update follow-up status" };
  }
}

