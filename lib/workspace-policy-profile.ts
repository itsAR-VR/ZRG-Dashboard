import "server-only";

export type WorkspacePolicyProfile = "default" | "founders_club";

export const FOUNDERS_CLUB_CLIENT_ID = "ef824aca-a3c9-4cde-b51f-2e421ebb6b6e";

export function resolveWorkspacePolicyProfile(clientId: string | null | undefined): WorkspacePolicyProfile {
  const normalized = (clientId || "").trim().toLowerCase();
  if (!normalized) return "default";
  return normalized === FOUNDERS_CLUB_CLIENT_ID ? "founders_club" : "default";
}
