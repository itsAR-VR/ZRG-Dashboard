"use server";

import { isGlobalAdminUser, requireAuthUser } from "@/lib/workspace-access";

export async function getGlobalAdminStatus(): Promise<{ success: boolean; isAdmin: boolean; error?: string }> {
  try {
    const user = await requireAuthUser();
    const isAdmin = await isGlobalAdminUser(user.id);
    return { success: true, isAdmin };
  } catch (error) {
    return { success: false, isAdmin: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

