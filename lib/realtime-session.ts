"use client";

import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";

type RealtimeRow = Record<string, unknown>;

export type LeadRealtimePayload = {
  eventType: "INSERT" | "UPDATE";
  new: RealtimeRow;
  old: RealtimeRow;
};

export type RealtimeConnectionState =
  | "subscribed"
  | "timed_out"
  | "channel_error"
  | "closed"
  | "session_missing";

export async function subscribeToWorkspaceLeadsRealtime(opts: {
  clientId: string;
  onEvent: (payload: LeadRealtimePayload) => void;
  onConnectionStateChange?: (state: RealtimeConnectionState) => void;
}): Promise<RealtimeChannel | null> {
  const clientId = (opts.clientId || "").trim();
  if (!clientId) return null;

  const supabase = createClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    opts.onConnectionStateChange?.("session_missing");
    return null;
  }

  const filter = `clientId=eq.${clientId}`;
  const channel = supabase
    .channel(`leads-session:${clientId}:${Math.random().toString(36).slice(2, 10)}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "Lead",
        filter,
      },
      (payload: RealtimePostgresChangesPayload<RealtimeRow>) => {
        opts.onEvent({
          eventType: "INSERT",
          new: (payload.new as RealtimeRow) ?? {},
          old: (payload.old as RealtimeRow) ?? {},
        });
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "Lead",
        filter,
      },
      (payload: RealtimePostgresChangesPayload<RealtimeRow>) => {
        opts.onEvent({
          eventType: "UPDATE",
          new: (payload.new as RealtimeRow) ?? {},
          old: (payload.old as RealtimeRow) ?? {},
        });
      }
    );

  channel.subscribe((status: string) => {
    if (status === "SUBSCRIBED") {
      opts.onConnectionStateChange?.("subscribed");
      return;
    }
    if (status === "TIMED_OUT") {
      opts.onConnectionStateChange?.("timed_out");
      return;
    }
    if (status === "CHANNEL_ERROR") {
      opts.onConnectionStateChange?.("channel_error");
      return;
    }
    if (status === "CLOSED") {
      opts.onConnectionStateChange?.("closed");
    }
  });

  return channel;
}

export function unsubscribeRealtimeChannel(channel: RealtimeChannel | null | undefined): void {
  if (!channel) return;
  const supabase = createClient();
  void supabase.removeChannel(channel);
}
