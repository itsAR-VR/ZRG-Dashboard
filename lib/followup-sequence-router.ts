import "server-only";

import { prisma } from "@/lib/prisma";

export type FollowUpSequenceCandidate = {
  id: string;
  name: string;
  aiPersonaId: string | null;
  createdAt: Date;
};

export async function routeSequenceByPersona(opts: {
  clientId: string;
  triggerOn: string;
  routingPersonaId: string | null;
  fallbackNames?: string[];
}): Promise<{ sequence: FollowUpSequenceCandidate | null; reason: string }> {
  const candidates = await prisma.followUpSequence.findMany({
    where: {
      clientId: opts.clientId,
      isActive: true,
      triggerOn: opts.triggerOn,
    },
    select: { id: true, name: true, aiPersonaId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  if (candidates.length > 0) {
    const personaMatch = opts.routingPersonaId
      ? candidates.find((seq) => seq.aiPersonaId === opts.routingPersonaId)
      : null;
    const generic = candidates.find((seq) => !seq.aiPersonaId);
    const selected = personaMatch ?? generic ?? candidates[0] ?? null;
    const reason = personaMatch
      ? "matched_persona"
      : generic
        ? "generic_fallback"
        : "latest_fallback";
    return { sequence: selected, reason };
  }

  if (opts.fallbackNames && opts.fallbackNames.length > 0) {
    const fallback = await prisma.followUpSequence.findMany({
      where: {
        clientId: opts.clientId,
        isActive: true,
        name: { in: opts.fallbackNames },
      },
      select: { id: true, name: true, aiPersonaId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    if (fallback.length > 0) {
      const priority = new Map(opts.fallbackNames.map((name, index) => [name, index]));
      const sorted = [...fallback].sort((a, b) => {
        const aRank = priority.get(a.name) ?? 999;
        const bRank = priority.get(b.name) ?? 999;
        if (aRank !== bRank) return aRank - bRank;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      return { sequence: sorted[0] ?? null, reason: "name_fallback" };
    }
  }

  return { sequence: null, reason: "sequence_not_found_or_inactive" };
}
