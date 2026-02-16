import { NextRequest, NextResponse } from "next/server";

import {
  getConversationsCursor,
  type Channel,
  type ConversationsCursorOptions,
} from "@/actions/lead-actions";
import { isInboxReadApiEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";
const READ_API_FAIL_OPEN_HEADER = "x-zrg-read-api-fail-open";
const READ_API_FAIL_OPEN_REASON = "server_action_unavailable";

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseChannelList(value: string | null): Channel[] | undefined {
  const entries = parseCsv(value);
  const channels = entries.filter((entry): entry is Channel => entry === "sms" || entry === "email" || entry === "linkedin");
  const unique = Array.from(new Set(channels));
  return unique.length > 0 ? unique : undefined;
}

function parseStringList(value: string | null): string[] | undefined {
  const entries = parseCsv(value);
  return entries.length > 0 ? entries : undefined;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (!value) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function parseConversationsCursorOptions(request: NextRequest): ConversationsCursorOptions {
  const searchParams = request.nextUrl.searchParams;

  const clientId = searchParams.get("clientId");
  const cursor = searchParams.get("cursor");
  const limitRaw = searchParams.get("limit");
  const search = searchParams.get("search");

  const filter = searchParams.get("filter");
  const scoreFilter = searchParams.get("scoreFilter");
  const smsCampaignId = searchParams.get("smsCampaignId");
  const smsCampaignUnattributed = parseBoolean(searchParams.get("smsCampaignUnattributed"));

  const channel = searchParams.get("channel");

  const channels = parseChannelList(searchParams.get("channels"));
  const sentimentTags = parseStringList(searchParams.get("sentimentTags"));

  const opts: ConversationsCursorOptions = {
    clientId: clientId || null,
    cursor: cursor || null,
    limit: limitRaw ? Number(limitRaw) : undefined,
    search: search || undefined,
    channels,
    sentimentTags,
    smsCampaignId: smsCampaignId || undefined,
    smsCampaignUnattributed,
    filter: filter as ConversationsCursorOptions["filter"],
    scoreFilter: scoreFilter as ConversationsCursorOptions["scoreFilter"],
    channel: channel as ConversationsCursorOptions["channel"],
  };

  // Normalize empty string inputs (common from URL plumbing).
  if (opts.clientId && !opts.clientId.trim()) opts.clientId = null;
  if (opts.cursor && !opts.cursor.trim()) opts.cursor = null;
  if (typeof opts.search === "string" && !opts.search.trim()) opts.search = undefined;
  if (typeof opts.smsCampaignId === "string" && !opts.smsCampaignId.trim()) opts.smsCampaignId = undefined;

  return opts;
}

function mapActionErrorToStatus(error: string | undefined): number {
  const message = (error || "").trim();
  if (message === "Not authenticated") return 401;
  if (message === "Unauthorized") return 403;
  if (message.startsWith("Not authenticated")) return 401;
  if (message.startsWith("Unauthorized")) return 403;
  return 500;
}

function shouldFailOpenReadApi(request: NextRequest): boolean {
  return request.headers.get(READ_API_FAIL_OPEN_HEADER) === READ_API_FAIL_OPEN_REASON;
}

export async function GET(request: NextRequest) {
  if (!isInboxReadApiEnabled() && !shouldFailOpenReadApi(request)) {
    const response = NextResponse.json(
      { success: false, error: "READ_API_DISABLED" },
      { status: 503 }
    );
    response.headers.set("x-zrg-read-api-enabled", "0");
    response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
    return response;
  }

  const options = parseConversationsCursorOptions(request);

  const result = await getConversationsCursor(options);
  if (!result.success) {
    return NextResponse.json(result, { status: mapActionErrorToStatus(result.error) });
  }

  const response = NextResponse.json(result, { status: 200 });
  response.headers.set("x-zrg-read-api-enabled", "1");
  response.headers.set("Cache-Control", "private, max-age=0, must-revalidate");
  return response;
}
