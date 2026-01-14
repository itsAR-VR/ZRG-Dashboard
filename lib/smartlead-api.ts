import "@/lib/server-dns";

type SmartLeadCampaign = {
  id: string;
  name: string;
};

function safeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseCampaigns(payload: any): SmartLeadCampaign[] {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.campaigns)
        ? payload.campaigns
        : [];

  const campaigns: SmartLeadCampaign[] = [];
  for (const item of raw) {
    const idRaw = item?.id ?? item?.campaign_id ?? item?.campaignId;
    const id = safeText(idRaw) ?? (typeof idRaw === "number" ? String(idRaw) : null);
    if (!id) continue;
    const name = safeText(item?.name ?? item?.campaign_name ?? item?.campaignName) ?? `Campaign ${id}`;
    campaigns.push({ id, name });
  }
  return campaigns;
}

export async function fetchSmartLeadCampaigns(apiKey: string): Promise<{
  success: boolean;
  data?: SmartLeadCampaign[];
  error?: string;
}> {
  try {
    const url = new URL("https://server.smartlead.ai/api/v1/campaigns");
    url.searchParams.set("api_key", apiKey);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, error: `SmartLead campaigns fetch failed (${response.status}): ${text || "unknown error"}` };
    }

    const body = (await response.json().catch(() => null)) as any;
    const campaigns = parseCampaigns(body);
    return { success: true, data: campaigns };
  } catch (error) {
    console.error("[SmartLead] fetch campaigns error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to fetch SmartLead campaigns" };
  }
}

export async function sendSmartLeadReplyToThread(
  apiKey: string,
  opts: {
    campaignId: string;
    statsId: string | null;
    messageId: string | null;
    subject: string | null;
    body: string;
    cc?: string[];
    bcc?: string[];
    toEmail?: string | null;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = new URL(
      `https://server.smartlead.ai/api/v1/campaigns/${encodeURIComponent(opts.campaignId)}/reply-email-thread`
    );
    url.searchParams.set("api_key", apiKey);

    const payload: Record<string, unknown> = {
      subject: opts.subject ?? undefined,
      email_body: opts.body,
      stats_id: opts.statsId ?? undefined,
      message_id: opts.messageId ?? undefined,
      to_email: opts.toEmail ?? undefined,
      cc_emails: opts.cc && opts.cc.length > 0 ? opts.cc : undefined,
      bcc_emails: opts.bcc && opts.bcc.length > 0 ? opts.bcc : undefined,
    };

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { success: false, error: `SmartLead reply failed (${response.status}): ${text || "unknown error"}` };
    }

    return { success: true };
  } catch (error) {
    console.error("[SmartLead] send reply error:", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to send SmartLead reply" };
  }
}

