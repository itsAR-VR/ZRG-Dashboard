import {
  getUserRoleForClient,
  isTrueSuperAdminUser,
  requireClientAccess,
  type UserRole,
} from "@/lib/workspace-access";

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

  // Global admins can access any workspace via `requireClientAccess()`, but they might not be explicit owners/members.
  // Treat them as OWNER for capabilities so RBAC-gated actions/settings work consistently.
  if (isTrueSuperAdminUser({ id: userId, email: userEmail })) {
    return {
      userId,
      userEmail,
      role: "OWNER",
      capabilities: getCapabilitiesForRole("OWNER"),
    };
  }

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
