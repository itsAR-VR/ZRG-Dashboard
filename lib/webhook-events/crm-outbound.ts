import "server-only";

import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildCrmWebhookRowPayloadForLead, type CrmWebhookRowPayload } from "@/lib/crm-webhook-payload";
import {
  CRM_WEBHOOK_DELIVERY_ID_HEADER,
  CRM_WEBHOOK_EVENT_HEADER,
  CRM_WEBHOOK_SIGNATURE_ALGORITHM,
  CRM_WEBHOOK_SIGNATURE_ALGORITHM_HEADER,
  CRM_WEBHOOK_SIGNATURE_HEADER,
  CRM_WEBHOOK_TIMESTAMP_HEADER,
  getCrmWebhookDispatchSkipReason,
  isCrmWebhookEventType,
  resolveCrmWebhookDispatchConfig,
  type CrmWebhookEventType,
} from "@/lib/crm-webhook-config";
import { WebhookEventTerminalError } from "@/lib/webhook-events/errors";

type QueuedCrmWebhookPayload = {
  eventId?: string;
  eventType?: string;
  occurredAt?: string;
  dedupeKey?: string;
  workspaceId?: string;
  leadId?: string;
  messageId?: string | null;
  changedField?: string | null;
  source?: string | null;
  row?: CrmWebhookRowPayload;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getCrmWebhookTimeoutMs(): number {
  return Math.max(2_500, parsePositiveInt(process.env.CRM_WEBHOOK_TIMEOUT_MS, 10_000));
}

export function isCrmWebhookRetryableStatus(status: number): boolean {
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}

export function buildCrmWebhookSignature(params: {
  secret: string;
  timestamp: string;
  body: string;
}): string {
  const payloadToSign = `${params.timestamp}.${params.body}`;
  const digest = crypto.createHmac("sha256", params.secret).update(payloadToSign).digest("hex");
  return `sha256=${digest}`;
}

function parseQueuedPayload(raw: Prisma.JsonValue | null): QueuedCrmWebhookPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as QueuedCrmWebhookPayload;
}

export async function processCrmOutboundWebhookEvent(event: {
  id: string;
  eventType: string;
  workspaceId: string | null;
  raw: Prisma.JsonValue | null;
}): Promise<void> {
  const queued = parseQueuedPayload(event.raw);
  const resolvedEventType = isCrmWebhookEventType(event.eventType)
    ? event.eventType
    : isCrmWebhookEventType(String(queued.eventType || ""))
      ? (queued.eventType as CrmWebhookEventType)
      : null;
  if (!resolvedEventType) {
    throw new WebhookEventTerminalError(`unsupported_crm_event_type:${event.eventType}`);
  }

  const workspaceId =
    (event.workspaceId || "").trim() || (typeof queued.workspaceId === "string" ? queued.workspaceId.trim() : "");
  if (!workspaceId) {
    throw new WebhookEventTerminalError("missing_workspace_id");
  }

  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId: workspaceId },
    select: {
      crmWebhookEnabled: true,
      crmWebhookUrl: true,
      crmWebhookEvents: true,
      crmWebhookSecret: true,
    },
  });

  const dispatchConfig = resolveCrmWebhookDispatchConfig(settings ?? {});
  const skipReason = getCrmWebhookDispatchSkipReason(dispatchConfig, resolvedEventType);
  if (skipReason) {
    console.log(
      `[WebhookEvents][CRM] Skipping delivery id=${event.id} workspaceId=${workspaceId} eventType=${resolvedEventType} reason=${skipReason}`
    );
    return;
  }

  const leadId = typeof queued.leadId === "string" ? queued.leadId.trim() : "";
  if (!leadId) {
    throw new WebhookEventTerminalError("missing_lead_id");
  }

  const rowPayload = queued.row ?? (await buildCrmWebhookRowPayloadForLead(leadId));
  if (!rowPayload) {
    throw new WebhookEventTerminalError(`crm_row_not_found leadId=${leadId}`);
  }

  const bodyObject = {
    eventId: typeof queued.eventId === "string" && queued.eventId.trim() ? queued.eventId : event.id,
    eventType: resolvedEventType,
    occurredAt:
      typeof queued.occurredAt === "string" && queued.occurredAt.trim() ? queued.occurredAt : new Date().toISOString(),
    dedupeKey: typeof queued.dedupeKey === "string" ? queued.dedupeKey : null,
    workspaceId,
    leadId,
    messageId: typeof queued.messageId === "string" ? queued.messageId : null,
    changedField: typeof queued.changedField === "string" ? queued.changedField : null,
    source: typeof queued.source === "string" ? queued.source : null,
    row: rowPayload,
  };
  const body = JSON.stringify(bodyObject);
  const timestamp = new Date().toISOString();
  const signature = buildCrmWebhookSignature({
    secret: dispatchConfig.secret!,
    timestamp,
    body,
  });

  const timeoutMs = getCrmWebhookTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(dispatchConfig.url!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CRM_WEBHOOK_SIGNATURE_HEADER]: signature,
        [CRM_WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        [CRM_WEBHOOK_DELIVERY_ID_HEADER]: event.id,
        [CRM_WEBHOOK_EVENT_HEADER]: resolvedEventType,
        [CRM_WEBHOOK_SIGNATURE_ALGORITHM_HEADER]: CRM_WEBHOOK_SIGNATURE_ALGORITHM,
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `crm_webhook_timeout after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`crm_webhook_network_error: ${message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (response.ok) {
    console.log(
      `[WebhookEvents][CRM] Delivered id=${event.id} workspaceId=${workspaceId} eventType=${resolvedEventType} status=${response.status}`
    );
    return;
  }

  const responseText = (await response.text().catch(() => "")).slice(0, 1_000);
  const responseSummary = responseText ? ` body=${JSON.stringify(responseText)}` : "";
  const message = `crm_webhook_http_error status=${response.status}${responseSummary}`;
  if (isCrmWebhookRetryableStatus(response.status)) {
    throw new Error(message);
  }
  throw new WebhookEventTerminalError(message);
}
