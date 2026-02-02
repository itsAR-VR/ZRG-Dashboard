"use server";

import { isGlobalAdminUser, requireAuthUser, requireClientAdminAccess } from "@/lib/workspace-access";
import { requireWorkspaceCapabilities, type WorkspaceCapabilities } from "@/lib/workspace-capabilities";

export async function getGlobalAdminStatus(): Promise<{ success: boolean; isAdmin: boolean; error?: string }> {
  try {
    const user = await requireAuthUser();
    const isAdmin = await isGlobalAdminUser(user.id);
    return { success: true, isAdmin };
  } catch (error) {
    return { success: false, isAdmin: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function getWorkspaceAdminStatus(
  clientId: string | null | undefined
): Promise<{ success: boolean; isAdmin: boolean; error?: string }> {
  try {
    if (!clientId) return { success: true, isAdmin: false };
    await requireClientAdminAccess(clientId);
    return { success: true, isAdmin: true };
  } catch (error) {
    return { success: true, isAdmin: false, error: error instanceof Error ? error.message : "Not an admin" };
  }
}

export async function getWorkspaceCapabilities(
  clientId: string | null | undefined
): Promise<{ success: boolean; capabilities?: WorkspaceCapabilities | null; error?: string }> {
  try {
    if (!clientId) return { success: true, capabilities: null };
    const { capabilities } = await requireWorkspaceCapabilities(clientId);
    return { success: true, capabilities };
  } catch (error) {
    return { success: false, capabilities: null, error: error instanceof Error ? error.message : "Not authorized" };
  }
}
