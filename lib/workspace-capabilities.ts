import { getUserRoleForClient, requireClientAccess, type UserRole } from "@/lib/workspace-access";

export type WorkspaceCapabilities = {
  role: UserRole;
  isClientPortalUser: boolean;
  isWorkspaceAdmin: boolean;
  canEditSettings: boolean;
  canEditAiPersonality: boolean;
  canViewAiObservability: boolean;
  canManageMembers: boolean;
};

export function getCapabilitiesForRole(role: UserRole): WorkspaceCapabilities {
  const isWorkspaceAdmin = role === "OWNER" || role === "ADMIN";
  const isClientPortalUser = role === "CLIENT_PORTAL";

  return {
    role,
    isClientPortalUser,
    isWorkspaceAdmin,
    canEditSettings: isWorkspaceAdmin,
    canEditAiPersonality: isWorkspaceAdmin,
    canViewAiObservability: isWorkspaceAdmin,
    canManageMembers: isWorkspaceAdmin,
  };
}

export async function requireWorkspaceCapabilities(clientId: string): Promise<{
  userId: string;
  userEmail: string | null;
  role: UserRole;
  capabilities: WorkspaceCapabilities;
}> {
  const { userId, userEmail } = await requireClientAccess(clientId);
  const role = await getUserRoleForClient(userId, clientId);
  if (!role) {
    throw new Error("Unauthorized");
  }

  return {
    userId,
    userEmail,
    role,
    capabilities: getCapabilitiesForRole(role),
  };
}
