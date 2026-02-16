import "server-only";

import { prisma } from "@/lib/prisma";
import { redisIncr } from "@/lib/redis";

export async function markInboxCountsDirty(clientId: string): Promise<void> {
  const normalized = clientId.trim();
  if (!normalized) return;

  await prisma.inboxCountsDirty.upsert({
    where: { clientId: normalized },
    create: { clientId: normalized, dirtyAt: new Date() },
    update: { dirtyAt: new Date() },
    select: { clientId: true },
  });

  // Keep analytics read caches coherent with fresh inbound/outbound activity.
  await redisIncr(`analytics:v1:ver:${normalized}`);
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
