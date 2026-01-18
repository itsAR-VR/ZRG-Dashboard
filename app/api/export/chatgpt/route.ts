import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveClientScope } from "@/lib/workspace-access";
import { POSITIVE_SENTIMENTS } from "@/lib/sentiment-shared";
import {
  DEFAULT_CHATGPT_EXPORT_OPTIONS,
  computeChatgptExportDateRange,
  parseChatgptExportOptionsJson,
  type ChatgptExportOptions,
} from "@/lib/chatgpt-export";

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] || {});
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escapeCsvField(row[h] ?? "")).join(",")),
  ];
  return lines.join("\n");
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const clientId = searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  // Enforce authenticated, scoped access (setter/admin).
  try {
    await resolveClientScope(clientId);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId },
    select: { meetingBookingProvider: true, chatgptExportDefaults: true },
  });

  const optsFromQuery = parseChatgptExportOptionsJson(searchParams.get("opts"));
  const optsFromSettings = parseChatgptExportOptionsJson(settings?.chatgptExportDefaults || null);
  const exportOptions: ChatgptExportOptions = optsFromQuery ?? optsFromSettings ?? DEFAULT_CHATGPT_EXPORT_OPTIONS;

  const { from, to } = computeChatgptExportDateRange(exportOptions, new Date());

  const messageSomeWhere: Prisma.MessageWhereInput = {
    ...(exportOptions.channels.length > 0 ? { channel: { in: exportOptions.channels } } : {}),
    ...(exportOptions.directions.length > 0 ? { direction: { in: exportOptions.directions } } : {}),
    ...(from && to ? { sentAt: { gte: from, lt: to } } : {}),
  };

  const leadWhere: Prisma.LeadWhereInput = {
    clientId,
    ...(exportOptions.positiveOnly ? { sentimentTag: { in: Array.from(POSITIVE_SENTIMENTS) } } : {}),
    ...(Object.keys(messageSomeWhere).length > 0 ? { messages: { some: messageSomeWhere } } : {}),
  };

  let leadsCsv = "";
  let leadIds: string[] = [];

  if (exportOptions.includeLeadsCsv) {
    const leads = await prisma.lead.findMany({
      where: leadWhere,
      include: {
        emailCampaign: { select: { id: true, bisonCampaignId: true, name: true } },
        smsCampaign: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    leadIds = leads.map((l) => l.id);

    const leadRows = leads.map((lead) => ({
      leadId: lead.id,
      firstName: lead.firstName || "",
      lastName: lead.lastName || "",
      email: lead.email || "",
      sentimentTag: lead.sentimentTag || "",
      emailCampaignId: lead.emailCampaign?.id || "",
      emailCampaignBisonId: lead.emailCampaign?.bisonCampaignId || "",
      emailCampaignName: lead.emailCampaign?.name || "",
      smsCampaignId: lead.smsCampaign?.id || "",
      smsCampaignName: lead.smsCampaign?.name || "",
      meetingBookingProvider: settings?.meetingBookingProvider || "GHL",
      ghlAppointmentId: lead.ghlAppointmentId || "",
      calendlyInviteeUri: lead.calendlyInviteeUri || "",
      calendlyScheduledEventUri: lead.calendlyScheduledEventUri || "",
      appointmentBookedAt: lead.appointmentBookedAt ? lead.appointmentBookedAt.toISOString() : "",
      industry: lead.industry || "",
      employeeHeadcount: lead.employeeHeadcount || "",
    }));

    leadsCsv = toCsv(leadRows);
  } else {
    const leads = await prisma.lead.findMany({
      where: leadWhere,
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    });
    leadIds = leads.map((l) => l.id);
  }

  let messagesJsonl = "";
  if (exportOptions.includeMessagesJsonl && leadIds.length > 0) {
    const messageWhere: Prisma.MessageWhereInput = {
      leadId: { in: leadIds },
      ...(exportOptions.channels.length > 0 ? { channel: { in: exportOptions.channels } } : {}),
      ...(exportOptions.directions.length > 0 ? { direction: { in: exportOptions.directions } } : {}),
      ...(from && to && exportOptions.messagesWithinRangeOnly ? { sentAt: { gte: from, lt: to } } : {}),
    };

    const messages = await prisma.message.findMany({
      where: messageWhere,
      orderBy: { sentAt: "asc" },
      select: {
        id: true,
        leadId: true,
        channel: true,
        direction: true,
        sentAt: true,
        body: true,
        subject: true,
        sentBy: true,
        aiDraftId: true,
        source: true,
      },
    });

    messagesJsonl = messages
      .map((m) =>
        JSON.stringify({
          messageId: m.id,
          leadId: m.leadId,
          channel: m.channel,
          direction: m.direction,
          sentAt: m.sentAt.toISOString(),
          subject: m.subject,
          body: m.body,
          source: m.source,
          sentBy: m.sentBy,
          aiDraftId: m.aiDraftId,
        })
      )
      .join("\n");
  }

  const zip = new JSZip();
  if (exportOptions.includeLeadsCsv) zip.file("leads.csv", leadsCsv);
  if (exportOptions.includeMessagesJsonl) zip.file("messages.jsonl", messagesJsonl);

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const date = new Date().toISOString().split("T")[0];
  const arrayBuffer = Uint8Array.from(buffer).buffer;
  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=\"chatgpt-export-${date}.zip\"`,
    },
  });
}
