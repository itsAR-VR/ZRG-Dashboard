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
 */
export async function getFollowUpTasks(filter: "today" | "week" | "overdue" | "all" = "all"): Promise<{
  success: boolean;
  data?: FollowUpTaskData[];
  error?: string;
}> {
  try {
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const endOfDay = new Date(now.setHours(23, 59, 59, 999));
    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    let whereClause: any = { status: "pending" };

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

