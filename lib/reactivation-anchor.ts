import type { EmailBisonReplyMessage } from "@/lib/emailbison-api";

function parseDate(...dateStrs: (string | null | undefined)[]): Date {
  for (const dateStr of dateStrs) {
    if (!dateStr) continue;
    const parsed = new Date(dateStr);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

export function isEmailBisonSentFolder(folder: string | null | undefined): boolean {
  if (!folder) return false;
  const normalized = folder.toLowerCase();

  // EmailBison folder naming can vary. Be permissive but still conservative: only treat explicit outbound-ish folders as "sent".
  return normalized.includes("sent") || normalized.includes("outbox") || normalized.includes("outgoing");
}

export type ReactivationAnchorKind = "sent_campaign_match" | "sent_any" | "any_folder";

export function pickReactivationAnchorFromReplies(opts: {
  replies: EmailBisonReplyMessage[];
  desiredCampaignId: string | null;
}): {
  anchorReplyId: string;
  originalSenderEmailId: string | null;
  anchorCampaignId: string | null;
  anchorKind: ReactivationAnchorKind;
} | null {
  const replies = Array.isArray(opts.replies) ? opts.replies : [];
  if (replies.length === 0) return null;

  const sorted = [...replies].sort((a, b) => {
    const aT = parseDate(a.date_received, a.created_at).getTime();
    const bT = parseDate(b.date_received, b.created_at).getTime();
    return bT - aT;
  });

  const sent = sorted.filter((r) => isEmailBisonSentFolder(r.folder));

  // Tier 1: sent folder + campaign match (if configured)
  if (opts.desiredCampaignId) {
    const desired = sent.find((r) => r.campaign_id != null && String(r.campaign_id) === opts.desiredCampaignId);
    if (desired?.id != null) {
      return {
        anchorReplyId: String(desired.id),
        originalSenderEmailId: desired.sender_email_id != null ? String(desired.sender_email_id) : null,
        anchorCampaignId: desired.campaign_id != null ? String(desired.campaign_id) : null,
        anchorKind: "sent_campaign_match",
      };
    }
  }

  // Tier 2: any sent folder reply (campaign_id may be missing)
  const anySent = sent.find((r) => r.id != null);
  if (anySent?.id != null) {
    return {
      anchorReplyId: String(anySent.id),
      originalSenderEmailId: anySent.sender_email_id != null ? String(anySent.sender_email_id) : null,
      anchorCampaignId: anySent.campaign_id != null ? String(anySent.campaign_id) : null,
      anchorKind: "sent_any",
    };
  }

  // Tier 3: newest reply in any folder
  const any = sorted.find((r) => r.id != null);
  if (!any?.id) return null;

  return {
    anchorReplyId: String(any.id),
    originalSenderEmailId: any.sender_email_id != null ? String(any.sender_email_id) : null,
    anchorCampaignId: any.campaign_id != null ? String(any.campaign_id) : null,
    anchorKind: "any_folder",
  };
}

