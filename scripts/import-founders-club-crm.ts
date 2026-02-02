/**
 * Founders Club CRM Importer (Interested-only, Idempotent)
 *
 * Run with:
 *   npx tsx scripts/import-founders-club-crm.ts --clientId <uuid> --dry-run
 *   npx tsx scripts/import-founders-club-crm.ts --clientId <uuid> --apply
 *   npx tsx scripts/import-founders-club-crm.ts --clientId <uuid> --apply --csvPath "/path/to/file.csv"
 *
 * Options:
 *   --clientId <id>       Required workspace/client ID
 *   --csvPath <path>      CSV file path (default: Founders Club CRM - Founders Club CRM.csv)
 *   --dry-run             Show what would change (default)
 *   --apply               Apply changes
 *   --fill-blanks-only    Only fill missing fields (default)
 *   --only-interested     Only import positive interest rows (default)
 *   --update-automation   Update auto-reply/follow-up fields when columns are present (default: false)
 *
 * Env:
 *   DATABASE_URL          Required
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import Papa from "papaparse";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";

import { normalizeEmail, normalizePhone } from "../lib/lead-matching";
import { normalizeLinkedInUrl } from "../lib/linkedin-utils";
import { isSamePhone, toStoredPhone } from "../lib/phone-utils";

dns.setDefaultResultOrder("ipv4first");

const DEFAULT_CSV_PATH = "Founders Club CRM - Founders Club CRM.csv";

type Args = {
  clientId: string | null;
  csvPath: string;
  dryRun: boolean;
  fillBlanksOnly: boolean;
  onlyInterested: boolean;
  updateAutomation: boolean;
};

type ImportTotals = {
  rows: number;
  matched: number;
  created: number;
  updated: number;
  skipped: number;
  skippedNonInterested: number;
  skippedMissingIdentifier: number;
  errors: { row: number; reason: string }[];
};

const POSITIVE_CATEGORIES = new Map<string, string>([
  ["meeting requested", "Meeting Requested"],
  ["call requested", "Call Requested"],
  ["information requested", "Information Requested"],
  ["interested", "Interested"],
]);

const HEADER_KEYS = {
  date: ["date"],
  campaign: ["campaign"],
  companyName: ["companyname"],
  website: ["website", "companywebsite"],
  firstName: ["firstname"],
  lastName: ["lastname"],
  jobTitle: ["jobtitle"],
  leadEmail: ["leadsemail", "leademail", "email"],
  leadLinkedIn: ["leadlinkedin", "leadlinkedinurl", "linkedin", "linkedinurl"],
  phone: ["phonenumber", "phone"],
  leadCategory: ["leadcategory"],
  leadStatus: ["leadstatus"],
  channel: ["channel"],
  leadType: ["leadtype"],
  applicationStatus: ["applicationstatus"],
  notes: ["notes", "note"],
  followUpDateRequested: ["followupdaterequested", "followupdaterequest", "followupdate"],
  autoReplyEnabled: ["autoreplyenabled", "autoreply"],
  autoFollowUpEnabled: ["autofollowupenabled", "autofollowup", "autofollowupenabled"],
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    clientId: null,
    csvPath: DEFAULT_CSV_PATH,
    dryRun: true,
    fillBlanksOnly: true,
    onlyInterested: true,
    updateAutomation: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--clientId") args.clientId = argv[++i] ?? null;
    else if (arg === "--csvPath") args.csvPath = argv[++i] || args.csvPath;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--apply") args.dryRun = false;
    else if (arg === "--fill-blanks-only") args.fillBlanksOnly = true;
    else if (arg === "--only-interested") args.onlyInterested = true;
    else if (arg === "--update-automation") args.updateAutomation = true;
    else if (arg === "--include-non-interested") args.onlyInterested = false;
    else if (arg === "--overwrite") args.fillBlanksOnly = false;
  }

  return args;
}

function normalizeHeader(header: string | undefined): string {
  if (!header) return "";
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeString(value: unknown): string | null {
  if (value == null) return null;
  const raw = typeof value === "string" ? value : String(value);
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getRowValue(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeString(row[key]);
    if (value) return value;
  }
  return null;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed);
}

function parseBoolean(value: string | null): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return null;
}

function normalizeLeadCategory(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const canonical = POSITIVE_CATEGORIES.get(trimmed.toLowerCase());
  return canonical ?? trimmed;
}

function isPositiveCategory(category: string | null): boolean {
  if (!category) return false;
  return POSITIVE_CATEGORIES.has(category.toLowerCase());
}

function normalizeChannel(raw: string | null): string | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized.includes("email")) return "email";
  if (normalized.includes("linkedin")) return "linkedin";
  if (normalized.includes("sms") || normalized.includes("text") || normalized.includes("ghl")) return "sms";
  return null;
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function shouldSetString(
  existing: string | null | undefined,
  incoming: string | null,
  fillBlanksOnly: boolean
): incoming is string {
  if (!incoming) return false;
  if (fillBlanksOnly) return isBlank(existing);
  return normalizeString(existing) !== incoming;
}

function shouldSetDate(existing: Date | null | undefined, incoming: Date | null, fillBlanksOnly: boolean): boolean {
  if (!incoming) return false;
  if (fillBlanksOnly) return !existing;
  if (!existing) return true;
  return existing.getTime() !== incoming.getTime();
}

type LeadMatch = {
  lead: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    companyName: string | null;
    companyWebsite: string | null;
    jobTitle: string | null;
    snoozedUntil: Date | null;
    autoReplyEnabled: boolean;
    autoFollowUpEnabled: boolean;
    crmRow: {
      id: string;
      interestRegisteredAt: Date | null;
      interestType: string | null;
      interestChannel: string | null;
      interestCampaignName: string | null;
      leadCategoryOverride: string | null;
      pipelineStatus: string | null;
      leadType: string | null;
      applicationStatus: string | null;
      notes: string | null;
    } | null;
  };
  matchedBy: "email" | "phone" | "linkedin";
};

const leadSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  linkedinUrl: true,
  companyName: true,
  companyWebsite: true,
  jobTitle: true,
  snoozedUntil: true,
  autoReplyEnabled: true,
  autoFollowUpEnabled: true,
  crmRow: {
    select: {
      id: true,
      interestRegisteredAt: true,
      interestType: true,
      interestChannel: true,
      interestCampaignName: true,
      leadCategoryOverride: true,
      pipelineStatus: true,
      leadType: true,
      applicationStatus: true,
      notes: true,
    },
  },
};

async function findLeadMatch(
  prisma: PrismaClient,
  clientId: string,
  normalizedEmail: string | null,
  normalizedPhone: string | null,
  normalizedLinkedIn: string | null
): Promise<LeadMatch | null> {
  if (normalizedEmail) {
    const lead = await prisma.lead.findFirst({
      where: { clientId, email: { equals: normalizedEmail, mode: "insensitive" } },
      select: leadSelect,
    });
    if (lead) return { lead, matchedBy: "email" };
  }

  if (normalizedPhone) {
    const lead = await prisma.lead.findFirst({
      where: { clientId, phone: { contains: normalizedPhone } },
      select: leadSelect,
    });
    if (lead) return { lead, matchedBy: "phone" };
  }

  if (normalizedLinkedIn) {
    const lead = await prisma.lead.findFirst({
      where: { clientId, linkedinUrl: normalizedLinkedIn },
      select: leadSelect,
    });
    if (lead) return { lead, matchedBy: "linkedin" };
  }

  return null;
}

function hasCrmData(candidate: Record<string, unknown>): boolean {
  return Object.values(candidate).some((value) => value !== null && value !== undefined && value !== "");
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.clientId) {
    throw new Error("Missing required --clientId <uuid>");
  }

  const csvPath = path.resolve(args.csvPath);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const totals: ImportTotals = {
    rows: 0,
    matched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    skippedNonInterested: 0,
    skippedMissingIdentifier: 0,
    errors: [],
  };

  console.log("=".repeat(70));
  console.log("Founders Club CRM Import");
  console.log("=".repeat(70));
  console.log(`Mode:             ${args.dryRun ? "DRY RUN (no changes)" : "APPLY"}`);
  console.log(`Workspace:        ${args.clientId}`);
  console.log(`CSV path:         ${csvPath}`);
  console.log(`Fill blanks only: ${args.fillBlanksOnly ? "yes" : "no"}`);
  console.log(`Only interested:  ${args.onlyInterested ? "yes" : "no"}`);
  console.log(`Update automation:${args.updateAutomation ? "yes" : "no"}`);
  console.log("=".repeat(70));
  console.log("");

  try {
    const client = await prisma.client.findUnique({
      where: { id: args.clientId },
      select: { id: true },
    });
    if (!client) {
      throw new Error(`Client not found for id: ${args.clientId}`);
    }

    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(csvPath);

      Papa.parse(stream, {
        header: true,
        skipEmptyLines: true,
        transformHeader: normalizeHeader,
        step: (results, parser) => {
          parser.pause();
          totals.rows += 1;
          const rowIndex = totals.rows;

          processRow(results.data as Record<string, unknown>, rowIndex, prisma, args, totals)
            .then(() => {
              if (rowIndex % 500 === 0) {
                console.log(
                  `[Progress] rows=${totals.rows} matched=${totals.matched} created=${totals.created} updated=${totals.updated} skipped=${totals.skipped} errors=${totals.errors.length}`
                );
              }
            })
            .catch(() => {
              totals.errors.push({ row: rowIndex, reason: "row_processing_failed" });
            })
            .finally(() => parser.resume());
        },
        complete: () => resolve(),
        error: (err) => reject(err),
      });
    });
  } finally {
    await prisma.$disconnect();
  }

  console.log("");
  console.log("Import Summary");
  console.log("-".repeat(70));
  console.log(`Rows processed:        ${totals.rows}`);
  console.log(`Matched existing:      ${totals.matched}`);
  console.log(`Created leads:         ${totals.created}`);
  console.log(`Updated rows:          ${totals.updated}`);
  console.log(`Skipped:               ${totals.skipped}`);
  console.log(`  - non-interested:    ${totals.skippedNonInterested}`);
  console.log(`  - missing identifier:${totals.skippedMissingIdentifier}`);
  console.log(`Errors:                ${totals.errors.length}`);
  if (totals.errors.length > 0) {
    console.log("Error rows:");
    console.log(JSON.stringify(totals.errors.slice(0, 25), null, 2));
    if (totals.errors.length > 25) {
      console.log(`...and ${totals.errors.length - 25} more`);
    }
  }
  console.log("-".repeat(70));
}

async function processRow(
  row: Record<string, unknown>,
  rowIndex: number,
  prisma: PrismaClient,
  args: Args,
  totals: ImportTotals
): Promise<void> {
  const categoryRaw = getRowValue(row, HEADER_KEYS.leadCategory);
  const normalizedCategory = normalizeLeadCategory(categoryRaw);
  const positiveCategory = isPositiveCategory(normalizedCategory);

  if (args.onlyInterested && !positiveCategory) {
    totals.skipped += 1;
    totals.skippedNonInterested += 1;
    return;
  }

  const firstName = getRowValue(row, HEADER_KEYS.firstName);
  const lastName = getRowValue(row, HEADER_KEYS.lastName);
  const emailRaw = getRowValue(row, HEADER_KEYS.leadEmail);
  const phoneRaw = getRowValue(row, HEADER_KEYS.phone);
  const linkedinRaw = getRowValue(row, HEADER_KEYS.leadLinkedIn);
  const companyName = getRowValue(row, HEADER_KEYS.companyName);
  const companyWebsite = getRowValue(row, HEADER_KEYS.website);
  const jobTitle = getRowValue(row, HEADER_KEYS.jobTitle);

  const normalizedEmail = normalizeEmail(emailRaw);
  const normalizedPhone = normalizePhone(phoneRaw);
  const normalizedLinkedIn = normalizeLinkedInUrl(linkedinRaw);

  if (!normalizedEmail && !normalizedPhone && !normalizedLinkedIn) {
    totals.skipped += 1;
    totals.skippedMissingIdentifier += 1;
    return;
  }

  const interestDate = parseDate(getRowValue(row, HEADER_KEYS.date));
  const followUpDate = parseDate(getRowValue(row, HEADER_KEYS.followUpDateRequested));
  const campaignName = getRowValue(row, HEADER_KEYS.campaign);
  const channel = normalizeChannel(getRowValue(row, HEADER_KEYS.channel));
  const leadStatus = getRowValue(row, HEADER_KEYS.leadStatus);
  const leadType = getRowValue(row, HEADER_KEYS.leadType);
  const applicationStatus = getRowValue(row, HEADER_KEYS.applicationStatus);
  const notes = getRowValue(row, HEADER_KEYS.notes);

  const interestType = positiveCategory ? normalizedCategory : null;
  const leadCategoryOverride = normalizedCategory;

  const crmCandidate = {
    interestRegisteredAt: interestDate ?? null,
    interestType,
    interestChannel: channel ?? null,
    interestCampaignName: campaignName ?? null,
    leadCategoryOverride: leadCategoryOverride ?? null,
    pipelineStatus: leadStatus ?? null,
    leadType: leadType ?? null,
    applicationStatus: applicationStatus ?? null,
    notes: notes ?? null,
  };

  const autoReplyRaw = getRowValue(row, HEADER_KEYS.autoReplyEnabled);
  const autoFollowUpRaw = getRowValue(row, HEADER_KEYS.autoFollowUpEnabled);
  const autoReplyEnabled = parseBoolean(autoReplyRaw);
  const autoFollowUpEnabled = parseBoolean(autoFollowUpRaw);

  const match = await findLeadMatch(prisma, args.clientId!, normalizedEmail, normalizedPhone, normalizedLinkedIn);

  if (!match) {
    const createData: Prisma.LeadUncheckedCreateInput = {
      clientId: args.clientId!,
    };

    if (firstName) createData.firstName = firstName;
    if (lastName) createData.lastName = lastName;
    if (normalizedEmail) createData.email = normalizedEmail;
    if (phoneRaw) createData.phone = toStoredPhone(phoneRaw);
    if (normalizedLinkedIn) createData.linkedinUrl = normalizedLinkedIn;
    if (companyName) createData.companyName = companyName;
    if (companyWebsite) createData.companyWebsite = companyWebsite;
    if (jobTitle) createData.jobTitle = jobTitle;
    if (shouldSetDate(null, followUpDate, true)) createData.snoozedUntil = followUpDate;
    if (args.updateAutomation) {
      if (autoReplyEnabled != null) createData.autoReplyEnabled = autoReplyEnabled;
      if (autoFollowUpEnabled != null) createData.autoFollowUpEnabled = autoFollowUpEnabled;
    }

    if (!args.dryRun) {
      if (hasCrmData(crmCandidate)) {
        createData.crmRow = { create: crmCandidate };
      }
      await prisma.lead.create({ data: createData });
    }

    totals.created += 1;
    return;
  }

  totals.matched += 1;
  let rowUpdated = false;

  const leadUpdates: Record<string, unknown> = {};
  if (shouldSetString(match.lead.firstName, firstName, args.fillBlanksOnly)) {
    leadUpdates.firstName = firstName;
  }
  if (shouldSetString(match.lead.lastName, lastName, args.fillBlanksOnly)) {
    leadUpdates.lastName = lastName;
  }
  if (shouldSetString(match.lead.email, normalizedEmail, args.fillBlanksOnly)) {
    leadUpdates.email = normalizedEmail;
  }
  if (phoneRaw) {
    const incomingPhone = toStoredPhone(phoneRaw);
    const shouldSetPhone =
      incomingPhone &&
      (args.fillBlanksOnly ? isBlank(match.lead.phone) : !isSamePhone(match.lead.phone, incomingPhone));
    if (shouldSetPhone) {
      leadUpdates.phone = incomingPhone;
    }
  }
  if (normalizedLinkedIn) {
    const existingLinkedIn = normalizeLinkedInUrl(match.lead.linkedinUrl);
    const shouldSetLinkedIn =
      args.fillBlanksOnly ? !existingLinkedIn : existingLinkedIn !== normalizedLinkedIn;
    if (shouldSetLinkedIn) {
      leadUpdates.linkedinUrl = normalizedLinkedIn;
    }
  }
  if (shouldSetString(match.lead.companyName, companyName, args.fillBlanksOnly)) {
    leadUpdates.companyName = companyName;
  }
  if (shouldSetString(match.lead.companyWebsite, companyWebsite, args.fillBlanksOnly)) {
    leadUpdates.companyWebsite = companyWebsite;
  }
  if (shouldSetString(match.lead.jobTitle, jobTitle, args.fillBlanksOnly)) {
    leadUpdates.jobTitle = jobTitle;
  }
  if (shouldSetDate(match.lead.snoozedUntil, followUpDate, args.fillBlanksOnly)) {
    leadUpdates.snoozedUntil = followUpDate;
  }
  if (args.updateAutomation) {
    if (autoReplyEnabled != null && autoReplyEnabled !== match.lead.autoReplyEnabled) {
      leadUpdates.autoReplyEnabled = autoReplyEnabled;
    }
    if (autoFollowUpEnabled != null && autoFollowUpEnabled !== match.lead.autoFollowUpEnabled) {
      leadUpdates.autoFollowUpEnabled = autoFollowUpEnabled;
    }
  }

  if (Object.keys(leadUpdates).length > 0) {
    rowUpdated = true;
    if (!args.dryRun) {
      await prisma.lead.update({ where: { id: match.lead.id }, data: leadUpdates });
    }
  }

  if (hasCrmData(crmCandidate)) {
    if (!match.lead.crmRow) {
      rowUpdated = true;
      if (!args.dryRun) {
        await prisma.leadCrmRow.create({
          data: { leadId: match.lead.id, ...crmCandidate },
        });
      }
    } else {
      const crmUpdates: Record<string, unknown> = {};
      if (shouldSetDate(match.lead.crmRow.interestRegisteredAt, crmCandidate.interestRegisteredAt, args.fillBlanksOnly)) {
        crmUpdates.interestRegisteredAt = crmCandidate.interestRegisteredAt;
      }
      if (shouldSetString(match.lead.crmRow.interestType, crmCandidate.interestType, args.fillBlanksOnly)) {
        crmUpdates.interestType = crmCandidate.interestType;
      }
      if (shouldSetString(match.lead.crmRow.interestChannel, crmCandidate.interestChannel, args.fillBlanksOnly)) {
        crmUpdates.interestChannel = crmCandidate.interestChannel;
      }
      if (shouldSetString(match.lead.crmRow.interestCampaignName, crmCandidate.interestCampaignName, args.fillBlanksOnly)) {
        crmUpdates.interestCampaignName = crmCandidate.interestCampaignName;
      }
      if (shouldSetString(match.lead.crmRow.leadCategoryOverride, crmCandidate.leadCategoryOverride, args.fillBlanksOnly)) {
        crmUpdates.leadCategoryOverride = crmCandidate.leadCategoryOverride;
      }
      if (shouldSetString(match.lead.crmRow.pipelineStatus, crmCandidate.pipelineStatus, args.fillBlanksOnly)) {
        crmUpdates.pipelineStatus = crmCandidate.pipelineStatus;
      }
      if (shouldSetString(match.lead.crmRow.leadType, crmCandidate.leadType, args.fillBlanksOnly)) {
        crmUpdates.leadType = crmCandidate.leadType;
      }
      if (shouldSetString(match.lead.crmRow.applicationStatus, crmCandidate.applicationStatus, args.fillBlanksOnly)) {
        crmUpdates.applicationStatus = crmCandidate.applicationStatus;
      }
      if (shouldSetString(match.lead.crmRow.notes, crmCandidate.notes, args.fillBlanksOnly)) {
        crmUpdates.notes = crmCandidate.notes;
      }

      if (Object.keys(crmUpdates).length > 0) {
        rowUpdated = true;
        if (!args.dryRun) {
          await prisma.leadCrmRow.update({
            where: { leadId: match.lead.id },
            data: crmUpdates,
          });
        }
      }
    }
  }

  if (rowUpdated) {
    totals.updated += 1;
  }
}

main().catch((error) => {
  console.error("Importer failed:", error);
  process.exitCode = 1;
});
