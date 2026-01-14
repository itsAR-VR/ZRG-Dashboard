import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type LeadRollupDb = Pick<PrismaClient, "lead"> | Pick<Prisma.TransactionClient, "lead">;

export async function bumpLeadMessageRollup(opts: {
  leadId: string;
  direction: "inbound" | "outbound";
  sentAt: Date;
}, db: LeadRollupDb = prisma): Promise<void> {
  const { leadId, direction, sentAt } = opts;

  await db.lead.updateMany({
    where: {
      id: leadId,
      OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: sentAt } }],
    },
    data: { lastMessageAt: sentAt, lastMessageDirection: direction },
  });

  if (direction === "inbound") {
    await db.lead.updateMany({
      where: {
        id: leadId,
        OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: sentAt } }],
      },
      data: { lastInboundAt: sentAt },
    });
    return;
  }

  await db.lead.updateMany({
    where: {
      id: leadId,
      OR: [{ lastOutboundAt: null }, { lastOutboundAt: { lt: sentAt } }],
    },
    data: { lastOutboundAt: sentAt },
  });
}

export async function recomputeLeadMessageRollups(leadId: string): Promise<void> {
  const [lastInbound, lastOutbound, lastMessage] = await Promise.all([
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
      lastMessageAt: lastMessage?.sentAt ?? null,
      lastMessageDirection: (lastMessage?.direction as string | undefined) ?? null,
    },
  });
}
