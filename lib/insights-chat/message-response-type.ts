import "server-only";

/**
 * Message response type classification for insights analysis.
 *
 * - `initial_outbound`: First outbound message OR any outbound with no prior inbound
 * - `follow_up_response`: Outbound message that follows an inbound message
 * - `inbound`: Prospect message (any direction === "inbound")
 */
export type MessageResponseType = "initial_outbound" | "follow_up_response" | "inbound";

/**
 * Human-readable label for transcript annotation.
 */
export function getResponseTypeLabel(type: MessageResponseType): string {
  switch (type) {
    case "initial_outbound":
      return "[INITIAL]";
    case "follow_up_response":
      return "[FOLLOW-UP]";
    case "inbound":
      return "[PROSPECT]";
  }
}
