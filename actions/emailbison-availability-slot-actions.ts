"use server";

import { requireClientAccess } from "@/lib/workspace-access";
import { previewEmailBisonAvailabilitySlotSentence } from "@/lib/emailbison-first-touch-availability";

export async function previewEmailBisonAvailabilitySlotSentenceForWorkspace(
  clientId: string | null | undefined
): Promise<{
  success: boolean;
  data?: {
    variableName: string;
    sentence: string | null;
    slotUtcIso: string[];
    slotLabels: string[];
    timeZone: string;
  };
  error?: string;
}> {
  try {
    if (!clientId) return { success: false, error: "No workspace selected" };
    await requireClientAccess(clientId);

    const data = await previewEmailBisonAvailabilitySlotSentence({
      clientId,
      refreshIfStale: false,
    });

    return { success: true, data };
  } catch (error) {
    console.error("Failed to preview EmailBison availability_slot:", error);
    return { success: false, error: "Failed to preview availability slot" };
  }
}

