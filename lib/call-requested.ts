import "server-only";

import { prisma } from "@/lib/prisma";
import { getPublicAppUrl } from "@/lib/app-url";

function buildLeadUrl(leadId: string): string {
  const base = getPublicAppUrl();
  return `${base}/?view=inbox&leadId=${encodeURIComponent(leadId)}`;
}

export async function ensureCallRequestedTask(opts: {
  leadId: string;
  latestInboundText?: string | null;
  // When true, create the call task even if the lead sentiment isn't "Call Requested".
  // This is used when booking-process routing detects explicit callback intent under a different sentiment.
  force?: boolean;
}): Promise<{ created: boolean; skipped?: boolean; reason?: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: {
      id: true,
      sentimentTag: true,
      phone: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  });

  if (!lead) return { created: false, skipped: true, reason: "lead_not_found" };
  if (!opts.force && lead.sentimentTag !== "Call Requested") {
    return { created: false, skipped: true, reason: "not_call_requested" };
  }

  const phone = (lead.phone || "").trim();
  if (!phone) return { created: false, skipped: true, reason: "missing_phone" };

  const existingTask = await prisma.followUpTask.findFirst({
    where: {
      leadId: lead.id,
      type: "call",
      status: "pending",
      campaignName: "call_requested",
    },
    select: { id: true },
  });
  if (existingTask) return { created: false, skipped: true, reason: "already_exists" };

  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || lead.email || "Lead";
  const inbound = (opts.latestInboundText || "").trim();
  const inboundShort = inbound.length > 400 ? `${inbound.slice(0, 400)}…` : inbound;
  const url = buildLeadUrl(lead.id);

  await prisma.followUpTask.create({
    data: {
      leadId: lead.id,
      type: "call",
      dueDate: new Date(),
      status: "pending",
      campaignName: "call_requested",
      suggestedMessage: [`Call requested by ${leadName}`, `Phone: ${phone}`, inboundShort ? `Latest: ${inboundShort}` : null, `Link: ${url}`]
        .filter(Boolean)
        .join("\n"),
    },
  });

  return { created: true };
}
