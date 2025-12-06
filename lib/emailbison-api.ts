export interface EmailBisonCampaign {
  id: string;
  name: string;
  status?: string;
}

export interface EmailBisonReplyPayload {
  message: string;
  sender_email_id: string;
  subject?: string;
  cc?: string[];
  bcc?: string[];
}

const INBOXXIA_BASE_URL = "https://send.meetinboxxia.com";

async function parseJsonSafe(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchEmailBisonCampaigns(
  apiKey: string
): Promise<{ success: boolean; data?: EmailBisonCampaign[]; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/campaigns`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      return {
        success: false,
        error: `EmailBison campaigns fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"
          }`,
      };
    }

    const data = (await response.json()) as any;
    const campaignsArray: any[] =
      Array.isArray(data) ? data : Array.isArray(data?.campaigns) ? data.campaigns : [];

    const campaigns: EmailBisonCampaign[] = campaignsArray.map((c) => ({
      id: String(c.id ?? c.bisonCampaignId ?? c.campaignId ?? ""),
      name: c.name || c.title || "Untitled Campaign",
      status: c.status,
    }));

    return { success: true, data: campaigns };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch campaigns:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendEmailBisonReply(
  apiKey: string,
  replyId: string,
  payload: EmailBisonReplyPayload
): Promise<{ success: boolean; data?: any; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/replies/${replyId}/reply`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await parseJsonSafe(response);
      return {
        success: false,
        error: `EmailBison reply send failed (${response.status}): ${body?.error || body?.message || "Unknown error"
          }`,
      };
    }

    const body = await parseJsonSafe(response);
    return { success: true, data: body };
  } catch (error) {
    console.error("[EmailBison] Failed to send reply:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

