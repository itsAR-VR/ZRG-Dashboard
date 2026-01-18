import "server-only";

import type { MessageResponseType } from "./message-response-type";

/**
 * Minimal message shape for classification (does not need full Prisma Message).
 */
export interface ClassifiableMessage {
  id: string;
  sentAt: Date;
  direction: string; // "inbound" | "outbound"
}

/**
 * Classify a single message's response type based on conversation context.
 *
 * Rules (deterministic, no AI):
 * 1. If direction === "inbound" → "inbound"
 * 2. If direction === "outbound":
 *    - If there are NO inbound messages before this outbound → "initial_outbound"
 *    - If there IS an inbound message before this outbound → "follow_up_response"
 *
 * @param messages All messages in the conversation, will be sorted by sentAt
 * @param targetMessage The message to classify
 * @returns The response type for the target message
 */
export function classifyMessageResponseType(
  messages: ClassifiableMessage[],
  targetMessage: ClassifiableMessage
): MessageResponseType {
  if (targetMessage.direction === "inbound") {
    return "inbound";
  }

  // Sort messages by sentAt to establish chronological order
  const sorted = messages.slice().sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const targetTime = targetMessage.sentAt.getTime();

  // Check if any inbound message exists before this outbound
  const hasInboundBefore = sorted.some(
    (m) => m.direction === "inbound" && m.sentAt.getTime() < targetTime
  );

  return hasInboundBefore ? "follow_up_response" : "initial_outbound";
}

/**
 * Message with its classified response type attached.
 */
export type ClassifiedMessage<T extends ClassifiableMessage> = T & {
  responseType: MessageResponseType;
};

/**
 * Classify all messages in a conversation with their response types.
 *
 * @param messages All messages in the conversation
 * @returns Messages with responseType attached, sorted by sentAt
 */
export function classifyConversationMessages<T extends ClassifiableMessage>(
  messages: T[]
): ClassifiedMessage<T>[] {
  if (messages.length === 0) return [];

  // Sort once for consistent ordering
  const sorted = messages.slice().sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  // Track whether we've seen any inbound yet
  let seenInbound = false;

  return sorted.map((message) => {
    let responseType: MessageResponseType;

    if (message.direction === "inbound") {
      responseType = "inbound";
      seenInbound = true;
    } else {
      // Outbound message
      responseType = seenInbound ? "follow_up_response" : "initial_outbound";
    }

    return { ...message, responseType };
  });
}

// ============================================================================
// Validation fixtures (for manual verification during development)
// ============================================================================

/**
 * Test fixtures for message classification. Run these in a dev script to verify behavior.
 *
 * Usage (Node REPL or one-off script):
 * ```ts
 * import { verifyClassificationFixtures } from "./message-classifier";
 * verifyClassificationFixtures(); // throws if any fixture fails
 * ```
 */
export const CLASSIFICATION_FIXTURES: Array<{
  name: string;
  messages: Array<{ id: string; sentAt: Date; direction: string }>;
  expected: MessageResponseType[];
}> = [
  {
    name: "Single outbound only → initial_outbound",
    messages: [{ id: "1", sentAt: new Date("2024-01-01T10:00:00Z"), direction: "outbound" }],
    expected: ["initial_outbound"],
  },
  {
    name: "Outbound, outbound, outbound → all initial_outbound",
    messages: [
      { id: "1", sentAt: new Date("2024-01-01T10:00:00Z"), direction: "outbound" },
      { id: "2", sentAt: new Date("2024-01-01T11:00:00Z"), direction: "outbound" },
      { id: "3", sentAt: new Date("2024-01-01T12:00:00Z"), direction: "outbound" },
    ],
    expected: ["initial_outbound", "initial_outbound", "initial_outbound"],
  },
  {
    name: "Outbound, inbound, outbound → initial, inbound, follow_up",
    messages: [
      { id: "1", sentAt: new Date("2024-01-01T10:00:00Z"), direction: "outbound" },
      { id: "2", sentAt: new Date("2024-01-01T11:00:00Z"), direction: "inbound" },
      { id: "3", sentAt: new Date("2024-01-01T12:00:00Z"), direction: "outbound" },
    ],
    expected: ["initial_outbound", "inbound", "follow_up_response"],
  },
  {
    name: "Inbound, outbound → inbound, follow_up (prospect contacted first)",
    messages: [
      { id: "1", sentAt: new Date("2024-01-01T10:00:00Z"), direction: "inbound" },
      { id: "2", sentAt: new Date("2024-01-01T11:00:00Z"), direction: "outbound" },
    ],
    expected: ["inbound", "follow_up_response"],
  },
  {
    name: "Outbound, inbound, outbound, inbound, outbound → mixed sequence",
    messages: [
      { id: "1", sentAt: new Date("2024-01-01T10:00:00Z"), direction: "outbound" },
      { id: "2", sentAt: new Date("2024-01-01T11:00:00Z"), direction: "inbound" },
      { id: "3", sentAt: new Date("2024-01-01T12:00:00Z"), direction: "outbound" },
      { id: "4", sentAt: new Date("2024-01-01T13:00:00Z"), direction: "inbound" },
      { id: "5", sentAt: new Date("2024-01-01T14:00:00Z"), direction: "outbound" },
    ],
    expected: ["initial_outbound", "inbound", "follow_up_response", "inbound", "follow_up_response"],
  },
  {
    name: "Single inbound only → inbound",
    messages: [{ id: "1", sentAt: new Date("2024-01-01T10:00:00Z"), direction: "inbound" }],
    expected: ["inbound"],
  },
  {
    name: "Empty conversation → empty result",
    messages: [],
    expected: [],
  },
];

/**
 * Verify all classification fixtures pass. Throws on first failure.
 */
export function verifyClassificationFixtures(): void {
  for (const fixture of CLASSIFICATION_FIXTURES) {
    const result = classifyConversationMessages(fixture.messages);
    const actual = result.map((m) => m.responseType);

    if (actual.length !== fixture.expected.length) {
      throw new Error(
        `Fixture "${fixture.name}" failed: expected ${fixture.expected.length} results, got ${actual.length}`
      );
    }

    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== fixture.expected[i]) {
        throw new Error(
          `Fixture "${fixture.name}" failed at index ${i}: expected "${fixture.expected[i]}", got "${actual[i]}"`
        );
      }
    }
  }
}
