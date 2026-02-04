export type DraftResponseDisposition = "AUTO_SENT" | "APPROVED" | "EDITED";

export function computeAIDraftResponseDisposition(params: {
  sentBy: "ai" | "setter" | null | undefined;
  draftContent: string;
  finalContent: string;
}): DraftResponseDisposition {
  if (params.sentBy === "ai") return "AUTO_SENT";
  return params.finalContent !== params.draftContent ? "EDITED" : "APPROVED";
}
