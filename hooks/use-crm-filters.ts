"use client"

import { useSearchParams, usePathname, useRouter } from "next/navigation"
import { useCallback, useMemo } from "react"

export interface CRMFilters {
  search: string
  status: string
  sort: string
  direction: "asc" | "desc"
  workspace: string | null
  channel: string
  sentiment: string
  filter: string
}

const DEFAULT_FILTERS: CRMFilters = {
  search: "",
  status: "all",
  sort: "updatedAt",
  direction: "desc",
  workspace: null,
  channel: "all",
  sentiment: "all",
  filter: "all",
}

/**
 * Hook for managing CRM/Inbox filter state via URL parameters
 * Enables shareable, bookmarkable filter states
 */
export function useCRMFilters() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()

  // Parse current filters from URL
  const filters: CRMFilters = useMemo(() => ({
    search: searchParams.get("q") || DEFAULT_FILTERS.search,
    status: searchParams.get("status") || DEFAULT_FILTERS.status,
    sort: searchParams.get("sort") || DEFAULT_FILTERS.sort,
    direction: (searchParams.get("dir") as "asc" | "desc") || DEFAULT_FILTERS.direction,
    workspace: searchParams.get("ws") || DEFAULT_FILTERS.workspace,
    channel: searchParams.get("channel") || DEFAULT_FILTERS.channel,
    sentiment: searchParams.get("sentiment") || DEFAULT_FILTERS.sentiment,
    filter: searchParams.get("filter") || DEFAULT_FILTERS.filter,
  }), [searchParams])

  // Update URL with new filters
  const setFilters = useCallback((newFilters: Partial<CRMFilters>) => {
    const params = new URLSearchParams(searchParams.toString())

    // Update each filter
    Object.entries(newFilters).forEach(([key, value]) => {
      const paramKey = key === "search" ? "q" : 
                       key === "direction" ? "dir" : 
                       key === "workspace" ? "ws" : 
                       key
      
      if (value && value !== DEFAULT_FILTERS[key as keyof CRMFilters]) {
        params.set(paramKey, value.toString())
      } else {
        params.delete(paramKey)
      }
    })

    // Use replace to avoid adding to history for every filter change
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, pathname, router])

  // Convenience methods for individual filters
  const setSearch = useCallback((search: string) => {
    setFilters({ search })
  }, [setFilters])

  const setStatus = useCallback((status: string) => {
    setFilters({ status })
  }, [setFilters])

  const setSort = useCallback((sort: string, direction?: "asc" | "desc") => {
    setFilters({ sort, direction })
  }, [setFilters])

  const setWorkspace = useCallback((workspace: string | null) => {
    setFilters({ workspace })
  }, [setFilters])

  const setChannel = useCallback((channel: string) => {
    setFilters({ channel })
  }, [setFilters])

  const setSentiment = useCallback((sentiment: string) => {
    setFilters({ sentiment })
  }, [setFilters])

  const setFilter = useCallback((filter: string) => {
    setFilters({ filter })
  }, [setFilters])

  // Reset all filters to defaults
  const resetFilters = useCallback(() => {
    router.replace(pathname, { scroll: false })
  }, [pathname, router])

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return filters.search !== DEFAULT_FILTERS.search ||
           filters.status !== DEFAULT_FILTERS.status ||
           filters.channel !== DEFAULT_FILTERS.channel ||
           filters.sentiment !== DEFAULT_FILTERS.sentiment ||
           filters.filter !== DEFAULT_FILTERS.filter
  }, [filters])

  return {
    filters,
    setFilters,
    setSearch,
    setStatus,
    setSort,
    setWorkspace,
    setChannel,
    setSentiment,
    setFilter,
    resetFilters,
    hasActiveFilters,
  }
}

/**
 * Hook for persisting workspace-specific filter state
 * Stores filters per workspace in localStorage
 */
export function useWorkspaceFilters(workspaceId: string | null) {
  const storageKey = workspaceId ? `crm-filters-${workspaceId}` : null

  const getSavedFilters = useCallback((): Partial<CRMFilters> | null => {
    if (!storageKey || typeof window === "undefined") return null
    try {
      const saved = localStorage.getItem(storageKey)
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  }, [storageKey])

  const saveFilters = useCallback((filters: Partial<CRMFilters>) => {
    if (!storageKey || typeof window === "undefined") return
    try {
      localStorage.setItem(storageKey, JSON.stringify(filters))
    } catch {
      // Ignore storage errors
    }
  }, [storageKey])

  const clearSavedFilters = useCallback(() => {
    if (!storageKey || typeof window === "undefined") return
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // Ignore storage errors
    }
  }, [storageKey])

  return {
    getSavedFilters,
    saveFilters,
    clearSavedFilters,
  }
}
