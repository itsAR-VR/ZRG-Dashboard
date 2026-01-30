// Client-safe constants (no Prisma imports) for default follow-up sequence names.

export const MEETING_REQUESTED_SEQUENCE_NAME_LEGACY = "Meeting Requested Day 1/2/5/7" as const;
export const ZRG_WORKFLOW_V1_SEQUENCE_NAME = "ZRG Workflow V1" as const;
export const MEETING_REQUESTED_SEQUENCE_NAMES = [
  MEETING_REQUESTED_SEQUENCE_NAME_LEGACY,
  ZRG_WORKFLOW_V1_SEQUENCE_NAME,
] as const;

export const NO_RESPONSE_SEQUENCE_NAME = "No Response Day 2/5/7" as const;
export const POST_BOOKING_SEQUENCE_NAME = "Post-Booking Qualification" as const;

export function isMeetingRequestedSequenceName(name: string | null | undefined): boolean {
  if (!name) return false;
  return (MEETING_REQUESTED_SEQUENCE_NAMES as readonly string[]).includes(name);
}

