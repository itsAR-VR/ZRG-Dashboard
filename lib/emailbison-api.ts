export interface EmailBisonCampaign {
  id: string;
  name: string;
  status?: string;
}

export interface EmailBisonRecipient {
  name: string | null;
  email_address: string;
}

export interface EmailBisonReplyPayload {
  message: string;
  sender_email_id: number;
  to_emails: EmailBisonRecipient[];
  subject?: string;
  cc_emails?: EmailBisonRecipient[];
  bcc_emails?: EmailBisonRecipient[];
  inject_previous_email_body?: boolean;
  content_type?: "text" | "html";
}

// Response types for fetching replies
export interface EmailBisonReplyMessage {
  id: number;
  uuid?: string | null;
  email_subject?: string | null;
  from_email_address?: string | null;
  from_name?: string | null;
  to?: { address: string; name: string | null }[] | null;
  cc?: { address: string; name: string | null }[] | null;
  bcc?: { address: string; name: string | null }[] | null;
  html_body?: string | null;
  text_body?: string | null;
  date_received?: string | null;
  created_at?: string | null;
  automated_reply?: boolean | null;
  interested?: boolean | null;
  type?: string | null;
  folder?: string | null;
  lead_id?: number | null;
  campaign_id?: number | null;
  sender_email_id?: number | null;
  // Threading fields
  thread_id?: string | null;
  in_reply_to?: string | null;
  message_id?: string | null;
}

export interface EmailBisonSentEmail {
  id: number;
  lead_id?: number;
  sequence_step_id?: number;
  email_subject?: string | null;
  email_body?: string | null;
  status?: string | null;
  sent_at?: string | null;
  scheduled_date_local?: string | null;
  raw_message_id?: string | null;
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

  console.log(`[EmailBison] Sending reply to ${replyId}:`, {
    to: payload.to_emails.map(e => e.email_address),
    sender_email_id: payload.sender_email_id,
    subject: payload.subject,
    messagePreview: payload.message.substring(0, 50) + "...",
  });

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
      console.error(`[EmailBison] Reply send failed (${response.status}):`, body);
      return {
        success: false,
        error: `EmailBison reply send failed (${response.status}): ${body?.error || body?.message || JSON.stringify(body) || "Unknown error"}`,
      };
    }

    const body = await parseJsonSafe(response);
    console.log(`[EmailBison] Reply sent successfully:`, body);
    return { success: true, data: body };
  } catch (error) {
    console.error("[EmailBison] Failed to send reply:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch all replies for a lead from EmailBison
 * Used for syncing email conversation history
 */
export async function fetchEmailBisonReplies(
  apiKey: string,
  bisonLeadId: string
): Promise<{ success: boolean; data?: EmailBisonReplyMessage[]; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/leads/${bisonLeadId}/replies?filters[folder]=all`;

  console.log(`[EmailBison] Fetching replies for lead ${bisonLeadId}`);

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
      console.error(`[EmailBison] Replies fetch failed (${response.status}):`, body);
      return {
        success: false,
        error: `EmailBison replies fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"}`,
      };
    }

    const data = await response.json();
    
    // Handle both array response and object with replies property
    const repliesArray: EmailBisonReplyMessage[] = Array.isArray(data) 
      ? data 
      : Array.isArray(data?.data) 
        ? data.data 
        : Array.isArray(data?.replies) 
          ? data.replies 
          : [];

    console.log(`[EmailBison] Found ${repliesArray.length} replies for lead ${bisonLeadId}:`, 
      repliesArray.map(r => ({
        id: r.id,
        subject: r.email_subject?.substring(0, 30),
        from: r.from_email_address,
        folder: r.folder,
        type: r.type,
        date: r.date_received || r.created_at,
      }))
    );
    return { success: true, data: repliesArray };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch replies:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch all sent emails for a lead from EmailBison
 * Used for syncing outbound campaign emails
 */
export async function fetchEmailBisonSentEmails(
  apiKey: string,
  bisonLeadId: string
): Promise<{ success: boolean; data?: EmailBisonSentEmail[]; error?: string }> {
  const url = `${INBOXXIA_BASE_URL}/api/leads/${bisonLeadId}/sent-emails`;

  console.log(`[EmailBison] Fetching sent emails for lead ${bisonLeadId}`);

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
      console.error(`[EmailBison] Sent emails fetch failed (${response.status}):`, body);
      return {
        success: false,
        error: `EmailBison sent emails fetch failed (${response.status}): ${body?.error || body?.message || "Unknown error"}`,
      };
    }

    const data = await response.json();
    
    // Handle both array response and object with sent_emails property
    const sentEmailsArray: EmailBisonSentEmail[] = Array.isArray(data) 
      ? data 
      : Array.isArray(data?.data) 
        ? data.data 
        : Array.isArray(data?.sent_emails) 
          ? data.sent_emails 
          : [];

    console.log(`[EmailBison] Found ${sentEmailsArray.length} sent emails for lead ${bisonLeadId}`);
    return { success: true, data: sentEmailsArray };
  } catch (error) {
    console.error("[EmailBison] Failed to fetch sent emails:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

