import "@/lib/server-dns";

type InstantlyCampaign = {
  id: string;
  name: string;
};

function safeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseCampaigns(payload: any): InstantlyCampaign[] {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.campaigns)
        ? payload.campaigns
        : [];

  const campaigns: InstantlyCampaign[] = [];
  for (const item of raw) {
    const idRaw = item?.id ?? item?.campaign_id ?? item?.campaignId;
    const id = safeText(idRaw) ?? (typeof idRaw === "number" ? String(idRaw) : null);
    if (!id) continue;
    const name = safeText(item?.name ?? item?.campaign_name ?? item?.campaignName) ?? `Campaign ${id}`;
    campaigns.push({ id, name });
  }
  return campaigns;
}

export async function fetchInstantlyCampaigns(
  apiKey: string,
  opts: { limit?: number } = {}
): Promise<{ success: boolean; data?: InstantlyCampaign[]; error?: string }> {
  try {
    const url = new URL("https://api.instantly.ai/api/v2/campaigns");
    url.searchParams.set("limit", String(opts.limit ?? 100));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, error: `Instantly campaigns fetch failed (${response.status}): ${text || "unknown error"}` };
    }

    const body = (await response.json().catch(() => null)) as any;
    const campaigns = parseCampaigns(body);
    return { success: true, data: campaigns };
  } catch (error) {
    console.error("[Instantly] fetch campaigns error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch Instantly campaigns" };
  }
}

export async function sendInstantlyReply(
  apiKey: string,
  opts: {
    replyToUuid: string;
    eaccount: string;
    subject: string | null;
    body: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://api.instantly.ai/api/v2/emails/reply", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        reply_to_uuid: opts.replyToUuid,
        eaccount: opts.eaccount,
        subject: opts.subject ?? undefined,
        body: opts.body,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, error: `Instantly reply failed (${response.status}): ${text || "unknown error"}` };
    }

    return { success: true };
  } catch (error) {
    console.error("[Instantly] send reply error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to send Instantly reply" };
  }
}

