import { createClient } from "@supabase/supabase-js";

// Create a single supabase client for interacting with your database
// This is used for realtime subscriptions on the client side
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Subscribe to new messages in real-time
 * @param callback Function to call when a new message is inserted
 * @returns Subscription channel for cleanup
 */
export function subscribeToMessages(
  callback: (payload: {
    eventType: string;
    new: Record<string, unknown>;
    old: Record<string, unknown>;
  }) => void
) {
  const channel = supabase
    .channel("messages-changes")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "Message",
      },
      (payload) => {
        callback({
          eventType: payload.eventType,
          new: payload.new,
          old: payload.old as Record<string, unknown>,
        });
      }
    )
    .subscribe();

  return channel;
}

/**
 * Subscribe to lead updates in real-time
 * @param callback Function to call when a lead is updated
 * @returns Subscription channel for cleanup
 */
export function subscribeToLeads(
  callback: (payload: {
    eventType: string;
    new: Record<string, unknown>;
    old: Record<string, unknown>;
  }) => void
) {
  const channel = supabase
    .channel("leads-changes")
    .on(
      "postgres_changes",
      {
        event: "*", // Listen to all events (INSERT, UPDATE, DELETE)
        schema: "public",
        table: "Lead",
      },
      (payload) => {
        callback({
          eventType: payload.eventType,
          new: payload.new,
          old: payload.old as Record<string, unknown>,
        });
      }
    )
    .subscribe();

  return channel;
}

/**
 * Unsubscribe from a channel
 */
export function unsubscribe(channel: ReturnType<typeof supabase.channel>) {
  supabase.removeChannel(channel);
}

