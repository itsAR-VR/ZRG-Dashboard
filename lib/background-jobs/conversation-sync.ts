import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveGhlContactIdForLead } from "@/lib/ghl-contacts";
import { syncEmailConversationHistorySystem, syncSmsConversationHistorySystem } from "@/lib/conversation-sync";

function isRetryableSyncErrorText(text: string): boolean {
  const lower = (text || "").toLowerCase();

  // Common network/timeout indicators.
  if (lower.includes("timeout")) return true;
  if (lower.includes("timed out")) return true;
  if (lower.includes("econnreset")) return true;
  if (lower.includes("enotfound")) return true;
  if (lower.includes("fetch failed")) return true;
  if (lower.includes("429")) return true;
  if (lower.includes("rate limit")) return true;

  return false;
}

function isNonRetryableSyncErrorText(text: string): boolean {
  const lower = (text || "").toLowerCase();

  // Configuration / deterministic failures.
  if (lower.includes("authentication failed")) return true;
  if (lower.includes("missing") && lower.includes("api key")) return true;
  if (lower.includes("missing ghl configuration")) return true;
  if (lower.includes("no ghl contact id")) return true;
  if (lower.includes("no emailbison lead id")) return true;
  if (lower.includes("cannot sync")) return true;
  if (lower === "unauthorized" || lower.includes("unauthorized")) return true;

  return false;
}

export async function runConversationSyncJob(opts: {
  clientId: string;
  leadId: string;
  messageId: string;
}): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: {
      id: true,
      clientId: true,
      email: true,
      ghlContactId: true,
      emailBisonLeadId: true,
      client: {
        select: {
          ghlPrivateKey: true,
          ghlLocationId: true,
          emailBisonApiKey: true,
        },
      },
    },
  });

  if (!lead) return;
  if (lead.clientId !== opts.clientId) {
    console.warn("[ConversationSyncJob] clientId mismatch:", { leadId: lead.id, jobClientId: opts.clientId });
    return;
  }

  // Best-effort: if this lead is email-first and missing a GHL contact ID, attempt to resolve/link (search only; no create).
  if (!lead.ghlContactId && lead.email && lead.client.ghlPrivateKey && lead.client.ghlLocationId) {
    await resolveGhlContactIdForLead(lead.id).catch(() => undefined);
  }

  const canSyncSms = Boolean(lead.client.ghlPrivateKey && lead.client.ghlLocationId);
  const canSyncEmail = Boolean(lead.client.emailBisonApiKey && lead.emailBisonLeadId);

  if (!canSyncSms && !canSyncEmail) return;

  const retryableErrors: string[] = [];

  if (canSyncSms) {
    const sms = await syncSmsConversationHistorySystem(lead.id);
    if (!sms.success && sms.error) {
      const retryable = isRetryableSyncErrorText(sms.error) && !isNonRetryableSyncErrorText(sms.error);
      if (retryable) retryableErrors.push(`SMS: ${sms.error}`);
      else console.warn("[ConversationSyncJob] SMS sync failed:", { leadId: lead.id, error: sms.error });
    }
  }

  if (canSyncEmail) {
    const email = await syncEmailConversationHistorySystem(lead.id);
    if (!email.success && email.error) {
      const retryable = isRetryableSyncErrorText(email.error) && !isNonRetryableSyncErrorText(email.error);
      if (retryable) retryableErrors.push(`Email: ${email.error}`);
      else console.warn("[ConversationSyncJob] Email sync failed:", { leadId: lead.id, error: email.error });
    }
  }

  if (retryableErrors.length > 0) {
    throw new Error(retryableErrors.join("; "));
  }
}

