import "server-only";

import { prisma } from "@/lib/prisma";

export async function markInboxCountsDirty(clientId: string): Promise<void> {
  const normalized = clientId.trim();
  if (!normalized) return;

  await prisma.inboxCountsDirty.upsert({
    where: { clientId: normalized },
    create: { clientId: normalized, dirtyAt: new Date() },
    update: { dirtyAt: new Date() },
    select: { clientId: true },
  });
}

export async function markInboxCountsDirtyByLeadId(leadId: string): Promise<void> {
  const normalized = leadId.trim();
  if (!normalized) return;

  const lead = await prisma.lead.findUnique({
    where: { id: normalized },
    select: { clientId: true },
  });
  if (!lead?.clientId) return;

  await markInboxCountsDirty(lead.clientId);
}
