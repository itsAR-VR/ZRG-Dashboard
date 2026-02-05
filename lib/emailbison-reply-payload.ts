import type { EmailBisonRecipient, EmailBisonReplyPayload } from "@/lib/emailbison-api";

export function buildEmailBisonReplyPayload(params: {
  messageHtml: string;
  senderEmailId: number;
  toEmails: EmailBisonRecipient[];
  subject?: string | null;
  ccEmails?: EmailBisonRecipient[];
  bccEmails?: EmailBisonRecipient[];
}): EmailBisonReplyPayload {
  return {
    message: params.messageHtml,
    sender_email_id: params.senderEmailId,
    to_emails: params.toEmails,
    subject: params.subject || undefined,
    cc_emails: params.ccEmails ?? [],
    bcc_emails: params.bccEmails ?? [],
    // Important: this copies the previous email body (including lead signatures) directly into our outbound.
    // Disable to avoid sending the lead's signature/links as if we wrote them.
    inject_previous_email_body: false,
    content_type: "html",
  };
}
