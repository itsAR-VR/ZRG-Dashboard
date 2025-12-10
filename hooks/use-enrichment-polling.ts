"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Enrichment status polling result
 */
interface EnrichmentStatusResult {
  enrichmentStatus: string | null;
  phone: string | null;
  linkedinUrl: string | null;
}

/**
 * Options for the enrichment polling hook
 */
interface UseEnrichmentPollingOptions {
  /**
   * Lead ID to poll enrichment status for
   */
  leadId: string;
  
  /**
   * Callback when enrichment completes (status changes from "pending")
   */
  onComplete: (result: EnrichmentStatusResult) => void;
  
  /**
   * Callback when polling times out (2 minutes)
   */
  onTimeout: () => void;
}

/**
 * Polling interval in milliseconds (10 seconds)
 */
const POLLING_INTERVAL_MS = 10 * 1000;

/**
 * Polling timeout in milliseconds (2 minutes)
 */
const POLLING_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Hook for polling lead enrichment status
 * 
 * Used when user manually clicks "Enrich Lead" to monitor Clay enrichment progress.
 * - Polls every 10 seconds
 * - Times out after 2 minutes
 * - Continues polling even if component unmounts (uses refs)
 * - Does NOT modify database status on timeout
 */
export function useEnrichmentPolling(options: UseEnrichmentPollingOptions) {
  const { leadId, onComplete, onTimeout } = options;
  
  const [isPolling, setIsPolling] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  
  // Track the previous status to detect changes
  const previousStatusRef = useRef<string | null>(null);

  /**
   * Fetch current enrichment status from API
   */
  const fetchStatus = useCallback(async (): Promise<EnrichmentStatusResult | null> => {
    try {
      const response = await fetch(`/api/leads/${leadId}/enrichment-status`);
      if (!response.ok) {
        console.error("[EnrichmentPolling] Failed to fetch status:", response.status);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error("[EnrichmentPolling] Error fetching status:", error);
      return null;
    }
  }, [leadId]);

  /**
   * Check if status has changed from "pending" to something else
   */
  const checkStatusChange = useCallback(async () => {
    const result = await fetchStatus();
    if (!result) return;

    const currentStatus = result.enrichmentStatus;
    
    // If status changed from "pending" to something else, enrichment is complete
    if (
      previousStatusRef.current === "pending" &&
      currentStatus !== "pending"
    ) {
      console.log(`[EnrichmentPolling] Status changed: ${previousStatusRef.current} -> ${currentStatus}`);
      stopPolling();
      onComplete(result);
      return;
    }

    // Update previous status for next check
    previousStatusRef.current = currentStatus;
  }, [fetchStatus, onComplete]);

  /**
   * Stop polling and clear all timers
   */
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (isMountedRef.current) {
      setIsPolling(false);
    }
  }, []);

  /**
   * Start polling for enrichment status changes
   */
  const startPolling = useCallback(async () => {
    // Don't start if already polling
    if (pollingIntervalRef.current) {
      console.log("[EnrichmentPolling] Already polling, ignoring start request");
      return;
    }

    console.log(`[EnrichmentPolling] Starting polling for lead ${leadId}`);
    setIsPolling(true);

    // Get initial status
    const initialStatus = await fetchStatus();
    previousStatusRef.current = initialStatus?.enrichmentStatus ?? null;

    // If not pending, no need to poll
    if (initialStatus?.enrichmentStatus !== "pending") {
      console.log("[EnrichmentPolling] Status is not pending, completing immediately");
      setIsPolling(false);
      onComplete(initialStatus || { enrichmentStatus: null, phone: null, linkedinUrl: null });
      return;
    }

    // Start polling interval
    pollingIntervalRef.current = setInterval(() => {
      checkStatusChange();
    }, POLLING_INTERVAL_MS);

    // Set timeout
    timeoutRef.current = setTimeout(() => {
      console.log("[EnrichmentPolling] Polling timeout reached (2 minutes)");
      stopPolling();
      onTimeout();
    }, POLLING_TIMEOUT_MS);
  }, [leadId, fetchStatus, checkStatusChange, stopPolling, onComplete, onTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    
    return () => {
      isMountedRef.current = false;
      // Note: We intentionally don't stop polling on unmount
      // The toast notifications should still fire even if drawer closes
      // However, we do need to clean up intervals when component is destroyed
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    startPolling,
    stopPolling,
    isPolling,
  };
}
