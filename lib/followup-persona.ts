import "server-only";

import { prisma } from "@/lib/prisma";

type PersonaSummary = {
  id: string;
  personaName: string | null;
  signature: string | null;
};

export type FollowUpPersonaContext = {
  personaId: string | null;
  senderName: string | null;
  signature: string | null;
  source: "sequence" | "campaign" | "default" | "settings";
};

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveFollowUpPersonaContext(opts: {
  clientId: string;
  leadId: string;
  sequencePersonaId?: string | null;
}): Promise<FollowUpPersonaContext> {
  let sequencePersona: PersonaSummary | null = null;

  if (opts.sequencePersonaId) {
    sequencePersona = await prisma.aiPersona.findUnique({
      where: { id: opts.sequencePersonaId },
      select: { id: true, personaName: true, signature: true },
    });
  }

  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId, clientId: opts.clientId },
    select: {
      emailCampaign: {
        select: {
          aiPersona: {
            select: { id: true, personaName: true, signature: true },
          },
        },
      },
      client: {
        select: {
          settings: { select: { aiPersonaName: true, aiSignature: true } },
          aiPersonas: {
            where: { isDefault: true },
            select: { id: true, personaName: true, signature: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  const campaignPersona = lead?.emailCampaign?.aiPersona ?? null;
  const defaultPersona = lead?.client?.aiPersonas?.[0] ?? null;

  const selectedPersona = sequencePersona ?? campaignPersona ?? defaultPersona;
  const source: FollowUpPersonaContext["source"] = sequencePersona
    ? "sequence"
    : campaignPersona
      ? "campaign"
      : defaultPersona
        ? "default"
        : "settings";

  const settings = lead?.client?.settings ?? null;

  const senderName = normalize(selectedPersona?.personaName) ?? normalize(settings?.aiPersonaName);
  const signature = normalize(selectedPersona?.signature) ?? normalize(settings?.aiSignature);

  return {
    personaId: selectedPersona?.id ?? null,
    senderName,
    signature,
    source,
  };
}
