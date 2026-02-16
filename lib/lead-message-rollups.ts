import "server-only";

import { markInboxCountsDirtyByLeadId } from "@/lib/inbox-counts-dirty";
import { prisma } from "@/lib/prisma";

export async function bumpLeadMessageRollup(opts: {
  leadId: string;
  direction: "inbound" | "outbound";
  sentAt: Date;
  source?: string | null;
}): Promise<void> {
  const { leadId, direction, sentAt, source } = opts;

  await prisma.lead.updateMany({
    where: {
      id: leadId,
      OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: sentAt } }],
    },
    data: { lastMessageAt: sentAt, lastMessageDirection: direction },
  });

  if (direction === "inbound") {
    await prisma.lead.updateMany({
      where: {
        id: leadId,
        OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: sentAt } }],
      },
      data: { lastInboundAt: sentAt },
    });
    await markInboxCountsDirtyByLeadId(leadId).catch(() => undefined);
    return;
  }

  await prisma.lead.updateMany({
    where: {
      id: leadId,
      OR: [{ lastOutboundAt: null }, { lastOutboundAt: { lt: sentAt } }],
    },
    data: { lastOutboundAt: sentAt },
  });

  if (source === "zrg") {
    await prisma.lead.updateMany({
      where: {
        id: leadId,
        OR: [{ lastZrgOutboundAt: null }, { lastZrgOutboundAt: { lt: sentAt } }],
      },
      data: { lastZrgOutboundAt: sentAt },
    });
  }

  await markInboxCountsDirtyByLeadId(leadId).catch(() => undefined);
}

export async function recomputeLeadMessageRollups(leadId: string): Promise<void> {
  const [lastInbound, lastOutbound, lastZrgOutbound, lastMessage] = await Promise.all([
    prisma.message.findFirst({
      where: { leadId, direction: "inbound" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.message.findFirst({
      where: { leadId, direction: "outbound" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.message.findFirst({
      where: { leadId, direction: "outbound", source: "zrg" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.message.findFirst({
      where: { leadId },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true, direction: true },
    }),
  ]);

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      lastInboundAt: lastInbound?.sentAt ?? null,
      lastOutboundAt: lastOutbound?.sentAt ?? null,
      lastZrgOutboundAt: lastZrgOutbound?.sentAt ?? null,
      lastMessageAt: lastMessage?.sentAt ?? null,
      lastMessageDirection: (lastMessage?.direction as string | undefined) ?? null,
    },
  });

  await markInboxCountsDirtyByLeadId(leadId).catch(() => undefined);
}
