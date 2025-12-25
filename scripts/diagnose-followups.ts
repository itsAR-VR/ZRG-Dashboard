/**
 * Diagnose follow-up sequencing for a specific lead/workspace.
 *
 * Run:
 *   npx tsx scripts/diagnose-followups.ts --email lorraine@becomingrentable.com --workspace "Todd Little"
 *   npx tsx scripts/diagnose-followups.ts --leadId <uuid>
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function summarizeDate(d: Date | null): string {
  if (!d) return "—";
  const iso = d.toISOString();
  return iso.replace("T", " ").replace("Z", "Z");
}

async function main() {
  const leadId = getArg("--leadId");
  const email = getArg("--email");
  const workspace = getArg("--workspace"); // substring match against Client.name

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing (set it in .env/.env.local)");
  }

  if (!leadId && !email) {
    console.log("Usage:");
    console.log('  npx tsx scripts/diagnose-followups.ts --email "<email>" [--workspace "<name substring>"]');
    console.log('  npx tsx scripts/diagnose-followups.ts --leadId "<uuid>"');
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const leads = await prisma.lead.findMany({
    where: leadId
      ? { id: leadId }
      : {
          email: email ?? undefined,
          ...(workspace
            ? { client: { name: { contains: workspace, mode: "insensitive" } } }
            : {}),
        },
    include: {
      client: { include: { settings: true } },
      followUpInstances: {
        include: {
          sequence: {
            include: {
              steps: { orderBy: { stepOrder: "asc" } },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
      },
    },
    take: 10,
  });

  if (leads.length === 0) {
    console.log("No leads found for the given criteria.");
    await prisma.$disconnect();
    return;
  }

  for (const lead of leads) {
    const inboundEmailCount = await prisma.message.count({
      where: { leadId: lead.id, channel: "email", direction: "inbound" },
    });

    const lastOutboundEmail = await prisma.message.findFirst({
      where: { leadId: lead.id, channel: "email", direction: "outbound" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true, source: true },
    });

    const lastOutboundSms = await prisma.message.findFirst({
      where: { leadId: lead.id, channel: "sms", direction: "outbound" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true, source: true },
    });

    console.log("\n" + "=".repeat(70));
    console.log(`Lead: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.id}`);
    console.log(`Email: ${lead.email || "—"}`);
    console.log(`Phone: ${lead.phone || "—"}`);
    console.log(`Workspace: ${lead.client?.name || lead.clientId}`);
    console.log(`Sentiment: ${lead.sentimentTag || "—"} | Status: ${lead.status}`);
    console.log(`autoFollowUpEnabled: ${lead.autoFollowUpEnabled ? "true" : "false"}`);
    console.log(`snoozedUntil: ${summarizeDate(lead.snoozedUntil)}`);
    console.log(`lastOutboundAt (rollup): ${summarizeDate(lead.lastOutboundAt)}`);
    console.log(`lastInboundAt  (rollup): ${summarizeDate(lead.lastInboundAt)}`);
    console.log(`lastMessageAt  (rollup): ${summarizeDate(lead.lastMessageAt)} (${lead.lastMessageDirection || "—"})`);
    console.log(`inbound email count: ${inboundEmailCount}`);
    console.log(
      `last outbound email message: ${summarizeDate(lastOutboundEmail?.sentAt ?? null)} (source: ${lastOutboundEmail?.source ?? "—"})`
    );
    console.log(
      `last outbound sms message:   ${summarizeDate(lastOutboundSms?.sentAt ?? null)} (source: ${lastOutboundSms?.source ?? "—"})`
    );

    const settings = lead.client?.settings;
    console.log("\nWorkspace settings (relevant):");
    console.log(`- timezone: ${settings?.timezone || "—"}`);
    console.log(`- business hours: ${settings?.workStartTime || "09:00"}–${settings?.workEndTime || "17:00"}`);
    console.log(`- autoFollowUpsOnReply: ${settings?.autoFollowUpsOnReply ? "true" : "false"}`);
    console.log(`- airtableMode: ${settings?.airtableMode ? "true" : "false"}`);
    console.log(`- companyName: ${settings?.companyName || "—"}`);
    console.log(`- targetResult: ${settings?.targetResult || "—"}`);
    console.log(`- aiPersonaName: ${settings?.aiPersonaName || "—"}`);

    if (lead.followUpInstances.length === 0) {
      console.log("\nFollow-up instances: none");
      continue;
    }

    console.log("\nFollow-up instances:");
    for (const instance of lead.followUpInstances) {
      const steps = instance.sequence.steps;
      const nextStep = steps.find((s) => s.stepOrder > instance.currentStep) || null;
      console.log(`- ${instance.sequence.name} (triggerOn=${instance.sequence.triggerOn}, active=${instance.sequence.isActive ? "true" : "false"})`);
      console.log(
        `  status=${instance.status} pausedReason=${instance.pausedReason || "—"} currentStep=${instance.currentStep} nextStepDue=${summarizeDate(
          instance.nextStepDue
        )}`
      );
      if (nextStep) {
        console.log(
          `  nextStep: order=${nextStep.stepOrder} dayOffset=${nextStep.dayOffset} channel=${nextStep.channel} requiresApproval=${
            nextStep.requiresApproval ? "true" : "false"
          } condition=${nextStep.condition || "—"}`
        );
      } else {
        console.log("  nextStep: — (sequence complete)");
      }
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

