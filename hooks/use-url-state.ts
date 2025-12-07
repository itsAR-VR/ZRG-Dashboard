"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * URL State configuration
 * Defines which params to track and their defaults
 */
export interface UrlStateConfig {
  view: string;
  workspace: string | null;
  channel: string;
  filter: string;
  leadId: string | null;
  tab: string;      // Settings tab
  fTab: string;     // Follow-ups tab
}

const DEFAULT_STATE: UrlStateConfig = {
  view: "inbox",
  workspace: null,
  channel: "all",
  filter: "",
  leadId: null,
  tab: "general",
  fTab: "needs-followup",
};

/**
 * Custom hook for bidirectional URL state synchronization
 * Syncs React state with URL search params for persistence across refresh/navigation
 */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Parse current URL state
  const urlState = useMemo((): UrlStateConfig => {
    return {
      view: searchParams.get("view") || DEFAULT_STATE.view,
      workspace: searchParams.get("workspace") || DEFAULT_STATE.workspace,
      channel: searchParams.get("channel") || DEFAULT_STATE.channel,
      filter: searchParams.get("filter") || DEFAULT_STATE.filter,
      leadId: searchParams.get("leadId") || DEFAULT_STATE.leadId,
      tab: searchParams.get("tab") || DEFAULT_STATE.tab,
      fTab: searchParams.get("fTab") || DEFAULT_STATE.fTab,
    };
  }, [searchParams]);

  /**
   * Update URL with new state
   * Only includes non-default values to keep URL clean
   */
  const updateUrl = useCallback(
    (updates: Partial<UrlStateConfig>, options?: { replace?: boolean }) => {
      const newState = { ...urlState, ...updates };
      const params = new URLSearchParams();

      // Only add params that differ from defaults
      if (newState.view !== DEFAULT_STATE.view) {
        params.set("view", newState.view);
      }
      if (newState.workspace) {
        params.set("workspace", newState.workspace);
      }
      if (newState.channel !== DEFAULT_STATE.channel) {
        params.set("channel", newState.channel);
      }
      if (newState.filter) {
        params.set("filter", newState.filter);
      }
      if (newState.leadId) {
        params.set("leadId", newState.leadId);
      }
      // Tab params - only include if not on default and in relevant view
      if (newState.view === "settings" && newState.tab !== DEFAULT_STATE.tab) {
        params.set("tab", newState.tab);
      }
      if (newState.view === "followups" && newState.fTab !== DEFAULT_STATE.fTab) {
        params.set("fTab", newState.fTab);
      }

      const queryString = params.toString();
      const url = queryString ? `${pathname}?${queryString}` : pathname;

      if (options?.replace) {
        router.replace(url);
      } else {
        router.push(url);
      }
    },
    [urlState, pathname, router]
  );

  // Individual setters for convenience
  const setView = useCallback(
    (view: string) => updateUrl({ view }),
    [updateUrl]
  );

  const setWorkspace = useCallback(
    (workspace: string | null) => updateUrl({ workspace }),
    [updateUrl]
  );

  const setChannel = useCallback(
    (channel: string) => updateUrl({ channel }),
    [updateUrl]
  );

  const setFilter = useCallback(
    (filter: string) => updateUrl({ filter }),
    [updateUrl]
  );

  const setLeadId = useCallback(
    (leadId: string | null) => updateUrl({ leadId }),
    [updateUrl]
  );

  const setTab = useCallback(
    (tab: string) => updateUrl({ tab }),
    [updateUrl]
  );

  const setFTab = useCallback(
    (fTab: string) => updateUrl({ fTab }),
    [updateUrl]
  );

  /**
   * Batch update multiple values at once (more efficient)
   */
  const setMultiple = useCallback(
    (updates: Partial<UrlStateConfig>, options?: { replace?: boolean }) => {
      updateUrl(updates, options);
    },
    [updateUrl]
  );

  /**
   * Clear a specific param (reset to default)
   */
  const clearParam = useCallback(
    (param: keyof UrlStateConfig) => {
      updateUrl({ [param]: DEFAULT_STATE[param] });
    },
    [updateUrl]
  );

  return {
    // Current state
    view: urlState.view,
    workspace: urlState.workspace,
    channel: urlState.channel,
    filter: urlState.filter,
    leadId: urlState.leadId,
    tab: urlState.tab,
    fTab: urlState.fTab,

    // Individual setters
    setView,
    setWorkspace,
    setChannel,
    setFilter,
    setLeadId,
    setTab,
    setFTab,

    // Batch operations
    setMultiple,
    clearParam,

    // Full state for debugging
    urlState,
    DEFAULT_STATE,
  };
}

/**
 * Helper to validate if a workspace ID exists in the available workspaces
 */
export function isValidWorkspace(
  workspaceId: string | null,
  workspaces: Array<{ id: string }>
): boolean {
  if (!workspaceId) return true; // null is valid (all workspaces)
  return workspaces.some((w) => w.id === workspaceId);
}

/**
 * Helper to validate if a lead ID exists and get its workspace
 */
export async function validateLeadWorkspace(
  leadId: string | null,
  getLeadClientId: (leadId: string) => Promise<string | null>
): Promise<{ valid: boolean; workspaceId: string | null }> {
  if (!leadId) return { valid: true, workspaceId: null };
  
  const workspaceId = await getLeadClientId(leadId);
  return {
    valid: workspaceId !== null,
    workspaceId,
  };
}
