import { createClient } from "@supabase/supabase-js";

// Create a single supabase client for interacting with your database
// This is used for realtime subscriptions on the client side
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type RealtimeRow = Record<string, unknown>;

type RealtimeCallback = (payload: {
  eventType: string;
  new: RealtimeRow;
  old: RealtimeRow;
}) => void;

/**
 * Subscribe to new messages in real-time
 * @param callback Function to call when a new message is inserted
 * @returns Subscription channel for cleanup
 */
export function subscribeToMessages(
  callback: RealtimeCallback
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
          old: payload.old as RealtimeRow,
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
  callback: RealtimeCallback,
  opts?: { clientId?: string | null }
) {
  const clientId = (opts?.clientId || "").trim();
  const filter = clientId ? `clientId=eq.${clientId}` : undefined;

  const channel = supabase
    .channel(clientId ? `leads-changes:${clientId}` : "leads-changes")
    .on(
      "postgres_changes",
      {
        event: "*", // Listen to all events (INSERT, UPDATE, DELETE)
        schema: "public",
        table: "Lead",
        ...(filter ? { filter } : {}),
      },
      (payload) => {
        callback({
          eventType: payload.eventType,
          new: payload.new,
          old: payload.old as RealtimeRow,
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
