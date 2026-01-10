import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { resolveClientScope } from "@/lib/workspace-access";

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
    select: { meetingBookingProvider: true },
  });

  const leads = await prisma.lead.findMany({
    where: { clientId },
    include: {
      emailCampaign: { select: { id: true, bisonCampaignId: true, name: true } },
      smsCampaign: { select: { id: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

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

  const leadsCsv = toCsv(leadRows);

  const messages = await prisma.message.findMany({
    where: { lead: { clientId } },
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

  const messagesJsonl = messages
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

  const zip = new JSZip();
  zip.file("leads.csv", leadsCsv);
  zip.file("messages.jsonl", messagesJsonl);

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const date = new Date().toISOString().split("T")[0];
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=\"chatgpt-export-${date}.zip\"`,
    },
  });
}

