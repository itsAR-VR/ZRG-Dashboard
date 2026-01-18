import "server-only";

import type { Lead, Message } from "@prisma/client";
import { classifyConversationMessages } from "./message-classifier";
import { getResponseTypeLabel, type MessageResponseType } from "./message-response-type";

export type LeadTranscriptMessage = Pick<Message, "id" | "sentAt" | "direction" | "channel" | "sentBy" | "subject" | "body">;

/**
 * Message with response type classification attached.
 */
export type ClassifiedTranscriptMessage = LeadTranscriptMessage & {
  responseType: MessageResponseType;
};

function formatLeadName(lead: Pick<Lead, "firstName" | "lastName">): string | null {
  const first = (lead.firstName || "").trim();
  const last = (lead.lastName || "").trim();
  const full = `${first} ${last}`.trim();
  return full ? full : null;
}

function safeOneLine(text: string, maxLen: number): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLen - 1))}…`;
}

export function formatLeadTranscript(opts: {
  lead: Pick<
    Lead,
    | "id"
    | "firstName"
    | "lastName"
    | "email"
    | "phone"
    | "companyName"
    | "industry"
    | "employeeHeadcount"
    | "sentimentTag"
    | "appointmentBookedAt"
  >;
  campaign?: { id: string; name: string } | null;
  messages: LeadTranscriptMessage[];
}): {
  header: string;
  transcript: string;
  lastMessages: string;
  /** Classified messages with response_type for downstream use */
  classifiedMessages: ClassifiedTranscriptMessage[];
} {
  const leadName = formatLeadName(opts.lead);
  const leadEmail = (opts.lead.email || "").trim() || null;
  const leadPhone = (opts.lead.phone || "").trim() || null;
  const company = (opts.lead.companyName || "").trim() || null;
  const industry = (opts.lead.industry || "").trim() || null;
  const headcount = (opts.lead.employeeHeadcount || "").trim() || null;
  const sentiment = (opts.lead.sentimentTag || "").trim() || null;
  const bookedAt = opts.lead.appointmentBookedAt ? opts.lead.appointmentBookedAt.toISOString() : null;

  const campaignName = opts.campaign?.name?.trim() || null;
  const campaignId = opts.campaign?.id || null;

  const header = JSON.stringify(
    {
      lead: {
        id: opts.lead.id,
        name: leadName,
        email: leadEmail,
        phone: leadPhone,
        company,
        industry,
        employeeHeadcount: headcount,
        sentimentTag: sentiment,
        appointmentBookedAt: bookedAt,
      },
      campaign: campaignId ? { id: campaignId, name: campaignName } : null,
    },
    null,
    2
  );

  // Classify all messages with response type (deterministic, based on sequence)
  const classified = classifyConversationMessages(opts.messages);

  const lines: string[] = [];
  for (const m of classified) {
    const ts = m.sentAt.toISOString();
    const subject = m.subject ? safeOneLine(m.subject, 120) : "";
    const sentBy = m.sentBy ? ` sentBy=${m.sentBy}` : "";
    const responseTypeLabel = getResponseTypeLabel(m.responseType);
    // Include response_type= for machine parsing and label for model visibility
    const meta = `${ts} ${m.direction} ${m.channel} response_type=${m.responseType}${sentBy}${subject ? ` subject="${subject}"` : ""} ${responseTypeLabel}`;
    lines.push(`[${meta}]`);
    lines.push(m.body || "");
    lines.push("");
  }

  const last = classified.slice(-8);
  const lastLines: string[] = [];
  for (const m of last) {
    const responseTypeLabel = getResponseTypeLabel(m.responseType);
    lastLines.push(
      `[${m.sentAt.toISOString()} ${m.direction} ${m.channel} response_type=${m.responseType}${m.sentBy ? ` sentBy=${m.sentBy}` : ""} ${responseTypeLabel}] ${safeOneLine(m.body || "", 280)}`
    );
  }

  return {
    header,
    transcript: lines.join("\n").trim(),
    lastMessages: lastLines.join("\n").trim(),
    classifiedMessages: classified,
  };
}

