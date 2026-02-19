import "server-only";

import crypto from "crypto";
import { Prisma, WebhookProvider, WebhookEventStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildCrmWebhookRowPayloadForLead } from "@/lib/crm-webhook-payload";
import {
  getCrmWebhookDispatchSkipReason,
  type CrmWebhookEventType,
  resolveCrmWebhookDispatchConfig,
} from "@/lib/crm-webhook-config";

export type EnqueueCrmWebhookEventParams = {
  clientId: string;
  leadId: string;
  eventType: CrmWebhookEventType;
  occurredAt?: Date | null;
  messageId?: string | null;
  changedField?: string | null;
  source?: string | null;
  dedupeSeed?: string | null;
};

export type EnqueueCrmWebhookEventResult =
  | { queued: true; dedupeKey: string; eventId: string; webhookEventId: string }
  | { queued: false; skipped: string };

function buildCrmWebhookDedupeKey(parts: {
  clientId: string;
  leadId: string;
  eventType: CrmWebhookEventType;
  seed: string;
}): string {
  const material = [parts.clientId, parts.leadId, parts.eventType, parts.seed].join("|");
  const hash = crypto.createHash("sha256").update(material).digest("hex").slice(0, 32);
  return `crm:${parts.eventType}:${hash}`;
}

export async function enqueueCrmWebhookEvent(
  params: EnqueueCrmWebhookEventParams
): Promise<EnqueueCrmWebhookEventResult> {
  const workspaceSettings = await prisma.workspaceSettings.findUnique({
    where: { clientId: params.clientId },
    select: {
      crmWebhookEnabled: true,
      crmWebhookUrl: true,
      crmWebhookEvents: true,
      crmWebhookSecret: true,
    },
  });

  const dispatchConfig = resolveCrmWebhookDispatchConfig(workspaceSettings ?? {});
  const skipReason = getCrmWebhookDispatchSkipReason(dispatchConfig, params.eventType);
  if (skipReason) {
    return { queued: false, skipped: skipReason };
  }

  const row = await buildCrmWebhookRowPayloadForLead(params.leadId);
  if (!row) {
    return { queued: false, skipped: "missing_crm_row" };
  }

  const occurredAt = (params.occurredAt ?? new Date()).toISOString();
  const seed =
    params.dedupeSeed ||
    [params.eventType, params.messageId || "", params.changedField || "", occurredAt].join(":");
  const dedupeKey = buildCrmWebhookDedupeKey({
    clientId: params.clientId,
    leadId: params.leadId,
    eventType: params.eventType,
    seed,
  });
  const eventId = crypto.randomUUID();

  const payload = {
    eventId,
    eventType: params.eventType,
    occurredAt,
    dedupeKey,
    workspaceId: params.clientId,
    leadId: params.leadId,
    messageId: params.messageId ?? null,
    changedField: params.changedField ?? null,
    source: params.source ?? null,
    row,
  };
  const payloadJson = JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;

  const persisted = await prisma.webhookEvent.upsert({
    where: { dedupeKey },
    update: {
      provider: WebhookProvider.CRM,
      eventType: params.eventType,
      status: WebhookEventStatus.PENDING,
      runAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      finishedAt: null,
      lastError: null,
      workspaceId: params.clientId,
      raw: payloadJson,
    },
    create: {
      provider: WebhookProvider.CRM,
      eventType: params.eventType,
      dedupeKey,
      status: WebhookEventStatus.PENDING,
      runAt: new Date(),
      workspaceId: params.clientId,
      raw: payloadJson,
    },
    select: { id: true },
  });

  return { queued: true, dedupeKey, eventId, webhookEventId: persisted.id };
}
