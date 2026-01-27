import "server-only";

import { prisma } from "@/lib/prisma";
import { getWorkspaceAvailabilitySlotsUtc } from "@/lib/availability-cache";
import { getWorkspaceSlotOfferCountsForRange, incrementWorkspaceSlotOffersBatch } from "@/lib/slot-offer-ledger";
import { selectDistributedAvailabilitySlots } from "@/lib/availability-distribution";
import { findOrCreateLead } from "@/lib/lead-matching";
import {
  fetchEmailBisonCampaignLeadsPage,
  fetchEmailBisonLead,
  fetchEmailBisonScheduledEmails,
  patchEmailBisonLead,
  type EmailBisonCampaignLead,
  type EmailBisonCustomVariable,
  type EmailBisonScheduledEmail,
} from "@/lib/emailbison-api";

const AVAILABILITY_SLOT_CUSTOM_VARIABLE_NAME = "availability_slot";

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function getEmailsSent(lead: EmailBisonCampaignLead): number {
  const raw =
    Array.isArray(lead.lead_campaign_data) && lead.lead_campaign_data.length > 0
      ? lead.lead_campaign_data[0]?.emails_sent
      : (lead as any)?.emails_sent;
  const parsed = parseNumber(raw);
  return parsed == null ? 0 : parsed;
}

function getEarliestScheduledSendAt(emails: EmailBisonScheduledEmail[]): Date | null {
  let best: Date | null = null;
  for (const e of emails) {
    const d = parseDate(e.scheduled_date) ?? parseDate(e.scheduled_date_local) ?? parseDate(e.sent_at);
    if (!d) continue;
    if (!best || d.getTime() < best.getTime()) best = d;
  }
  return best;
}

function isWeekendInTimeZone(dateUtc: Date, timeZone: string): boolean | null {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(dateUtc);
    return weekday === "Sat" || weekday === "Sun";
  } catch {
    return null;
  }
}

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function formatTimeInTimeZone(dateUtc: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(dateUtc);

  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;
  const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value || "").toLowerCase();

  if (!hour || !minute || !dayPeriod) {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true })
      .format(dateUtc)
      .replace(/\s?(AM|PM)$/i, (m) => m.toLowerCase())
      .replace(/\s+/g, "");
  }

  const time = minute === "00" ? `${hour}${dayPeriod}` : `${hour}:${minute}${dayPeriod}`;
  return time;
}

function formatDateInTimeZone(dateUtc: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(dateUtc);
  const month = new Intl.DateTimeFormat("en-US", { timeZone, month: "long" }).format(dateUtc);
  const dayStr = new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric" }).format(dateUtc);
  const day = Number.parseInt(dayStr, 10);
  const suffix = Number.isFinite(day) ? ordinalSuffix(day) : "";
  return `${weekday}, ${month} ${dayStr}${suffix}`;
}

function formatAvailabilityOptionLabel(slotUtcIso: string, timeZone: string): string | null {
  const dateUtc = new Date(slotUtcIso);
  if (Number.isNaN(dateUtc.getTime())) return null;
  try {
    const time = formatTimeInTimeZone(dateUtc, timeZone);
    const day = formatDateInTimeZone(dateUtc, timeZone);
    return `${time} on ${day}`;
  } catch {
    return null;
  }
}

function buildAvailabilitySentence(labels: string[]): string | null {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) return `does ${cleaned[0]} work for you?`;
  return `does ${cleaned[0]} or ${cleaned[1]} work for you?`;
}

function buildAvailabilitySentenceFromTemplate(opts: { labels: string[]; template?: string | null }): string | null {
  const cleaned = opts.labels.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  const template = (opts.template || "").trim();
  if (!template) return buildAvailabilitySentence(cleaned);

  const option1 = cleaned[0] || "";
  const option2 = cleaned[1] || option1;

  const rendered = template
    .replaceAll("{{option1}}", option1)
    .replaceAll("{{option2}}", option2)
    .replaceAll("{{time1}}", option1)
    .replaceAll("{{time2}}", option2);

  return rendered.trim() || null;
}

export async function previewEmailBisonAvailabilitySlotSentence(opts: {
  clientId: string;
  refreshIfStale?: boolean;
}): Promise<{
  variableName: string;
  sentence: string | null;
  slotUtcIso: string[];
  slotLabels: string[];
  timeZone: string;
}> {
  const now = new Date();
  const settings = await prisma.workspaceSettings.findUnique({
    where: { clientId: opts.clientId },
    select: {
      timezone: true,
      emailBisonFirstTouchAvailabilitySlotEnabled: true,
      emailBisonAvailabilitySlotTemplate: true,
      emailBisonAvailabilitySlotIncludeWeekends: true,
      emailBisonAvailabilitySlotCount: true,
      emailBisonAvailabilitySlotPreferWithinDays: true,
    },
  });
  const timeZone = settings?.timezone || "UTC";
  const injectionEnabled = settings?.emailBisonFirstTouchAvailabilitySlotEnabled ?? true;
  const includeWeekends = settings?.emailBisonAvailabilitySlotIncludeWeekends ?? false;
  const preferWithinDaysRaw = settings?.emailBisonAvailabilitySlotPreferWithinDays ?? 5;
  const preferWithinDays = Math.max(1, Math.min(30, preferWithinDaysRaw));
  const slotCountRaw = settings?.emailBisonAvailabilitySlotCount ?? 2;
  const slotCount = Math.max(1, Math.min(2, slotCountRaw));
  const template = settings?.emailBisonAvailabilitySlotTemplate ?? null;

  const availability = await getWorkspaceAvailabilitySlotsUtc(opts.clientId, { refreshIfStale: opts.refreshIfStale ?? false });
  const slotsUtc = availability.slotsUtc;
  if (slotsUtc.length === 0) {
    return {
      variableName: AVAILABILITY_SLOT_CUSTOM_VARIABLE_NAME,
      sentence: null,
      slotUtcIso: [],
      slotLabels: [],
      timeZone,
    };
  }

  if (!injectionEnabled) {
    return {
      variableName: AVAILABILITY_SLOT_CUSTOM_VARIABLE_NAME,
      sentence: null,
      slotUtcIso: [],
      slotLabels: [],
      timeZone,
    };
  }

  const weekdaySlots = slotsUtc.filter((iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    const weekend = isWeekendInTimeZone(d, timeZone);
    return weekend === null ? true : !weekend;
  });
  const pool = includeWeekends ? slotsUtc : (weekdaySlots.length > 0 ? weekdaySlots : slotsUtc);

  const rangeEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const offerCounts = await getWorkspaceSlotOfferCountsForRange(opts.clientId, now, rangeEnd).catch(() => new Map<string, number>());
  const selectedUtcIso = selectDistributedAvailabilitySlots({
    slotsUtcIso: pool,
    offeredCountBySlotUtcIso: offerCounts,
    timeZone,
    preferWithinDays,
    now,
  }).slice(0, slotCount);

  const slotLabels = selectedUtcIso
    .map((iso) => formatAvailabilityOptionLabel(iso, timeZone))
    .filter((label): label is string => Boolean(label));
  const sentence = buildAvailabilitySentenceFromTemplate({ labels: slotLabels, template });

  return {
    variableName: AVAILABILITY_SLOT_CUSTOM_VARIABLE_NAME,
    sentence,
    slotUtcIso: selectedUtcIso,
    slotLabels,
    timeZone,
  };
}

function upsertCustomVariable(
  existing: EmailBisonCustomVariable[] | undefined,
  update: EmailBisonCustomVariable
): EmailBisonCustomVariable[] {
  const vars = Array.isArray(existing) ? existing : [];
  const without = vars.filter((v) => (v?.name || "").trim().toLowerCase() !== update.name.trim().toLowerCase());
  return [...without, update];
}

function getIsoSetFromOfferedSlotsJson(value: string | null | undefined): Set<string> {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value) as Array<{ datetime?: unknown }>;
    if (!Array.isArray(parsed)) return new Set();
    const set = new Set<string>();
    for (const s of parsed) {
      if (typeof s?.datetime === "string") {
        const iso = new Date(s.datetime).toISOString();
        set.add(iso);
      }
    }
    return set;
  } catch {
    return new Set();
  }
}

function parseOfferedAtFromSlots(value: string | null | undefined): Date | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Array<{ offeredAt?: unknown }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const offeredAt = parsed[0]?.offeredAt;
    if (typeof offeredAt !== "string") return null;
    const d = new Date(offeredAt);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export async function processEmailBisonFirstTouchAvailabilitySlots(params?: {
  timeBudgetMs?: number;
  maxLeadsPerClient?: number;
  maxCampaignsPerClient?: number;
  dryRun?: boolean;
}): Promise<{
  clientsScanned: number;
  campaignsScanned: number;
  leadsScanned: number;
  leadsFirstTouch: number;
  leadsScheduledWithin24h: number;
  leadsDueWithin15m: number;
  leadsUpdated: number;
  leadsSkippedAlreadySet: number;
  errors: number;
  finishedWithinBudget: boolean;
}> {
  const startedAtMs = Date.now();
  const timeBudgetMs = Math.max(5_000, Math.min(10 * 60_000, params?.timeBudgetMs ?? 45_000));
  const deadlineMs = startedAtMs + timeBudgetMs;

  const maxLeadsPerClient = Math.max(50, Math.min(20_000, params?.maxLeadsPerClient ?? 4_000));
  const maxCampaignsPerClient = Math.max(1, Math.min(500, params?.maxCampaignsPerClient ?? 50));
  const dryRun = params?.dryRun ?? false;

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in15m = new Date(now.getTime() + 15 * 60 * 1000);

  let clientsScanned = 0;
  let campaignsScanned = 0;
  let leadsScanned = 0;
  let leadsFirstTouch = 0;
  let leadsScheduledWithin24h = 0;
  let leadsDueWithin15m = 0;
  let leadsUpdated = 0;
  let leadsSkippedAlreadySet = 0;
  let errors = 0;

  const clients = await prisma.client.findMany({
    where: {
      emailProvider: "EMAILBISON",
      emailBisonApiKey: { not: null },
    },
    select: {
      id: true,
      name: true,
      emailBisonApiKey: true,
      emailBisonBaseHost: { select: { host: true } },
      settings: {
        select: {
          timezone: true,
          autoBookMeetings: true,
          emailBisonFirstTouchAvailabilitySlotEnabled: true,
          emailBisonAvailabilitySlotTemplate: true,
          emailBisonAvailabilitySlotIncludeWeekends: true,
          emailBisonAvailabilitySlotCount: true,
          emailBisonAvailabilitySlotPreferWithinDays: true,
        },
      },
    },
  });

  for (const client of clients) {
    if (Date.now() > deadlineMs - 2_500) break;

    clientsScanned++;

    const apiKey = (client.emailBisonApiKey || "").trim();
    if (!apiKey) continue;

    const baseHost = client.emailBisonBaseHost?.host || null;
    const timeZone = client.settings?.timezone || "UTC";
    const injectionEnabled = client.settings?.emailBisonFirstTouchAvailabilitySlotEnabled ?? true;
    if (!injectionEnabled) continue;

    const includeWeekends = client.settings?.emailBisonAvailabilitySlotIncludeWeekends ?? false;
    const preferWithinDaysRaw = client.settings?.emailBisonAvailabilitySlotPreferWithinDays ?? 5;
    const preferWithinDays = Math.max(1, Math.min(30, preferWithinDaysRaw));
    const slotCountRaw = client.settings?.emailBisonAvailabilitySlotCount ?? 2;
    const slotCount = Math.max(1, Math.min(2, slotCountRaw));
    const template = client.settings?.emailBisonAvailabilitySlotTemplate ?? null;

    const campaigns = await prisma.emailCampaign.findMany({
      where: { clientId: client.id, bisonCampaignId: { not: "" } },
      select: { id: true, bisonCampaignId: true },
      orderBy: { updatedAt: "desc" },
      take: maxCampaignsPerClient,
    });

    if (campaigns.length === 0) continue;

    // Cache availability + offer counts once per workspace for this run.
    // Phase 61: rely on the dedicated availability cron for freshness (avoid provider fetches on this path).
    const availability = await getWorkspaceAvailabilitySlotsUtc(client.id, { refreshIfStale: false }).catch((e) => {
      errors++;
      console.error("[EmailBison FirstTouch] Failed to load workspace availability:", {
        clientId: client.id,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    });
    if (!availability || availability.slotsUtc.length === 0) continue;

    const rangeEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const offerCounts = await getWorkspaceSlotOfferCountsForRange(client.id, now, rangeEnd).catch((e) => {
      errors++;
      console.error("[EmailBison FirstTouch] Failed to load offer counts:", {
        clientId: client.id,
        error: e instanceof Error ? e.message : String(e),
      });
      return new Map<string, number>();
    });

    // In-run, keep the map updated to reduce collisions.
    const inRunOfferCounts = new Map<string, number>(offerCounts);

    let clientLeadBudgetUsed = 0;

    for (const campaign of campaigns) {
      if (Date.now() > deadlineMs - 2_500) break;
      if (clientLeadBudgetUsed >= maxLeadsPerClient) break;

      const bisonCampaignId = (campaign.bisonCampaignId || "").trim();
      if (!bisonCampaignId) continue;

      campaignsScanned++;

      // Rotate starting page per campaign per minute so large campaigns still get coverage over time.
      const minuteBucket = Math.floor(Date.now() / 60_000);
      const startPageSeed = (Number.parseInt(bisonCampaignId.replace(/\D+/g, ""), 10) || 0) + minuteBucket;

      let firstPage = await fetchEmailBisonCampaignLeadsPage(apiKey, bisonCampaignId, 1, { baseHost });
      if (!firstPage.success) {
        errors++;
        continue;
      }

      const lastPage = Math.max(1, Number(firstPage.meta?.last_page || 1) || 1);
      let page = (startPageSeed % lastPage) + 1;
      let pagesVisited = 0;

      // Visit up to 3 pages per campaign per run to bound time; rotation handles coverage.
      const maxPagesThisRun = Math.min(3, lastPage);

      while (pagesVisited < maxPagesThisRun && Date.now() <= deadlineMs - 2_500) {
        pagesVisited++;

        const res = page === 1 ? firstPage : await fetchEmailBisonCampaignLeadsPage(apiKey, bisonCampaignId, page, { baseHost });
        if (!res.success || !res.data) {
          errors++;
          break;
        }

        for (const leadItem of res.data) {
          if (Date.now() > deadlineMs - 2_500) break;
          if (clientLeadBudgetUsed >= maxLeadsPerClient) break;

          leadsScanned++;
          clientLeadBudgetUsed++;

          const emailsSent = getEmailsSent(leadItem);
          if (emailsSent !== 0) continue;
          leadsFirstTouch++;

          const emailBisonLeadId = String(leadItem.id);

          const scheduled = await fetchEmailBisonScheduledEmails(apiKey, emailBisonLeadId, { baseHost });
          if (!scheduled.success || !scheduled.data || scheduled.data.length === 0) continue;

          const scheduledSendAt = getEarliestScheduledSendAt(scheduled.data);
          if (!scheduledSendAt) continue;

          if (scheduledSendAt > in24h || scheduledSendAt < now) continue;
          leadsScheduledWithin24h++;

          if (scheduledSendAt > in15m) continue;
          leadsDueWithin15m++;

          const leadDetails = await fetchEmailBisonLead(apiKey, emailBisonLeadId, { baseHost });
          if (!leadDetails.success || !leadDetails.data) {
            errors++;
            continue;
          }

          const existingVar = (leadDetails.data.custom_variables || []).find(
            (v) => (v?.name || "").trim().toLowerCase() === AVAILABILITY_SLOT_CUSTOM_VARIABLE_NAME
          );

          // Idempotency: if already set and we have a recent offeredSlots record, don't thrash.
          const existingLead = await prisma.lead.findFirst({
            where: { clientId: client.id, emailBisonLeadId },
            select: { id: true, offeredSlots: true, appointmentBookedAt: true },
          });

          if (existingLead?.appointmentBookedAt) continue;

          const offeredAt = parseOfferedAtFromSlots(existingLead?.offeredSlots);
          const recentlySet = offeredAt ? now.getTime() - offeredAt.getTime() < 6 * 60 * 60 * 1000 : false;
          const alreadySet = Boolean(existingVar?.value && existingVar.value.trim().length > 0);

          if (alreadySet && recentlySet) {
            leadsSkippedAlreadySet++;
            continue;
          }

          const leadEmail = (leadDetails.data.email || "").trim();
          if (!leadEmail) continue;

          const leadFirstName = (leadDetails.data.first_name || "").trim() || null;
          const leadLastName = (leadDetails.data.last_name || "").trim() || null;

          const leadResult = await findOrCreateLead(
            client.id,
            { email: leadEmail, firstName: leadFirstName, lastName: leadLastName },
            { emailBisonLeadId },
            { emailCampaignId: campaign.id }
          );

          const leadId = leadResult.lead.id;

          const exclude = getIsoSetFromOfferedSlotsJson(existingLead?.offeredSlots ?? null);
          const startAfterUtc = scheduledSendAt;

          const weekdaySlots = availability.slotsUtc.filter((iso) => {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return false;
            const weekend = isWeekendInTimeZone(d, timeZone);
            return weekend === null ? true : !weekend;
          });

          const pool = includeWeekends ? availability.slotsUtc : (weekdaySlots.length > 0 ? weekdaySlots : availability.slotsUtc);

          const selected = selectDistributedAvailabilitySlots({
            slotsUtcIso: pool,
            offeredCountBySlotUtcIso: inRunOfferCounts,
            timeZone,
            excludeUtcIso: exclude.size > 0 ? exclude : undefined,
            startAfterUtc,
            preferWithinDays,
            now,
          }).slice(0, slotCount);

          if (selected.length === 0) continue;

          const labels = selected.map((iso) => formatAvailabilityOptionLabel(iso, timeZone) || iso);
          const sentence = buildAvailabilitySentenceFromTemplate({ labels, template });
          if (!sentence) continue;

          // Keep in-run offer counts updated to avoid collisions.
          for (const iso of selected) {
            inRunOfferCounts.set(iso, (inRunOfferCounts.get(iso) ?? 0) + 1);
          }

          if (!dryRun) {
            // Persist offeredSlots for inbound acceptance auto-booking.
            const offeredAtIso = now.toISOString();
            const offeredSlotsJson = JSON.stringify(
              selected.map((iso, idx) => ({
                datetime: iso,
                label: labels[idx] || iso,
                offeredAt: offeredAtIso,
              }))
            );

            await prisma.lead.update({
              where: { id: leadId },
              data: { offeredSlots: offeredSlotsJson },
            });

            await incrementWorkspaceSlotOffersBatch({
              clientId: client.id,
              slotUtcIsoList: selected,
              offeredAt: now,
            }).catch(() => undefined);

            const nextCustomVars = upsertCustomVariable(leadDetails.data.custom_variables, {
              name: AVAILABILITY_SLOT_CUSTOM_VARIABLE_NAME,
              value: sentence,
            });

            const patched = await patchEmailBisonLead(apiKey, emailBisonLeadId, { custom_variables: nextCustomVars }, { baseHost });
            if (!patched.success) {
              errors++;
              console.warn("[EmailBison FirstTouch] Failed to patch availability_slot:", {
                clientId: client.id,
                leadId: emailBisonLeadId,
                error: patched.error,
              });
              continue;
            }
          }

          leadsUpdated++;

          // Safety: if auto-book is disabled, surface it since Process (2) depends on it.
          if (!client.settings?.autoBookMeetings) {
            console.warn("[EmailBison FirstTouch] Workspace autoBookMeetings disabled; inbound acceptance will not auto-book.", {
              clientId: client.id,
              clientName: client.name,
            });
          }
        }

        if (clientLeadBudgetUsed >= maxLeadsPerClient) break;

        page = page >= lastPage ? 1 : page + 1;
        firstPage = { ...firstPage, success: false }; // ensure we don't reuse when page loops
      }
    }
  }

  return {
    clientsScanned,
    campaignsScanned,
    leadsScanned,
    leadsFirstTouch,
    leadsScheduledWithin24h,
    leadsDueWithin15m,
    leadsUpdated,
    leadsSkippedAlreadySet,
    errors,
    finishedWithinBudget: Date.now() <= deadlineMs,
  };
}
