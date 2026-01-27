import { prisma } from "@/lib/prisma";
import {
  fetchEmailBisonReplies,
  fetchEmailBisonRepliesGlobal,
  fetchEmailBisonSenderEmails,
  findEmailBisonLeadIdByEmail,
  sendEmailBisonReply,
} from "@/lib/emailbison-api";
import { emailBisonHtmlFromPlainText } from "@/lib/email-format";
import { bumpLeadMessageRollup } from "@/lib/lead-message-rollups";
import { searchGHLContactsAdvanced } from "@/lib/ghl-api";
import { pickReactivationAnchorFromReplies } from "@/lib/reactivation-anchor";
import { computeStepOffsetMs } from "@/lib/followup-schedule";

function parseDate(...dateStrs: (string | null | undefined)[]): Date {
  for (const dateStr of dateStrs) {
    if (!dateStr) continue;
    const parsed = new Date(dateStr);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function normalizeAllowedSenderIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .map((v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  return out.length > 0 ? out : null;
}

function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

async function pickAnchorFromExistingMessages(leadId: string): Promise<{ anchorReplyId: string; kind: "db_outbound" | "db_any" } | null> {
  const outbound = await prisma.message.findFirst({
    where: {
      leadId,
      channel: "email",
      direction: "outbound",
      source: "zrg",
      emailBisonReplyId: { not: null },
    },
    select: { emailBisonReplyId: true },
    orderBy: { sentAt: "desc" },
  });
  if (outbound?.emailBisonReplyId) {
    return { anchorReplyId: outbound.emailBisonReplyId, kind: "db_outbound" };
  }

  const any = await prisma.message.findFirst({
    where: { leadId, channel: "email", emailBisonReplyId: { not: null } },
    select: { emailBisonReplyId: true },
    orderBy: { sentAt: "desc" },
  });
  if (any?.emailBisonReplyId) {
    return { anchorReplyId: any.emailBisonReplyId, kind: "db_any" };
  }

  return null;
}

function pickFirstGhlContact(payload: unknown): { id: string; email?: string | null } | null {
  const data = payload as any;
  const contacts: unknown[] =
    (Array.isArray(data?.contacts) && data.contacts) ||
    (Array.isArray(data?.data?.contacts) && data.data.contacts) ||
    [];

  const first = contacts[0] as any;
  if (!first || typeof first.id !== "string") return null;
  return { id: first.id, email: typeof first.email === "string" ? first.email : null };
}

function safeTimeZone(timeZone: string | null | undefined, fallback: string): string {
  const tz = timeZone || fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return fallback;
  }
}

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  // en-CA yields YYYY-MM-DD
  return dtf.format(date);
}

function getZonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
    second: Number(map.get("second")),
  };
}

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  // Offset = (timeZone-local wall clock as UTC) - actual UTC time.
  const z = getZonedDateParts(date, timeZone);
  const asUTC = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return asUTC - date.getTime();
}

function zonedTimeToUtc(timeZone: string, local: { year: number; month: number; day: number; hour: number; minute?: number; second?: number }): Date {
  const minute = local.minute ?? 0;
  const second = local.second ?? 0;

  const utcGuessMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, minute, second);

  // Two-pass offset correction to account for DST transitions.
  let date = new Date(utcGuessMs);
  let offset = getTimeZoneOffsetMs(timeZone, date);
  date = new Date(utcGuessMs - offset);
  offset = getTimeZoneOffsetMs(timeZone, date);
  return new Date(utcGuessMs - offset);
}

function nextDayAtHourInTimeZone(now: Date, timeZone: string, hour: number): Date {
  const parts = getZonedDateParts(now, timeZone);
  const utcDateOnly = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utcDateOnly.setUTCDate(utcDateOnly.getUTCDate() + 1);

  return zonedTimeToUtc(timeZone, {
    year: utcDateOnly.getUTCFullYear(),
    month: utcDateOnly.getUTCMonth() + 1,
    day: utcDateOnly.getUTCDate(),
    hour,
    minute: 0,
    second: 0,
  });
}

function computeIsSenderEmailSendable(sender: Record<string, unknown>): { isSendable: boolean; status: string | null } {
  const status = typeof sender.status === "string" ? sender.status : null;
  const haystack = JSON.stringify(sender).toLowerCase();

  // Treat explicit error/disabled states as non-sendable.
  const nonSendablePatterns = [
    "disabled",
    "inactive",
    "disconnected",
    "connection_failed",
    "error",
    "invalid",
    "deleted",
    "paused",
    "suspended",
  ];

  const isExplicitlyNonSendable =
    (status && nonSendablePatterns.some((p) => status.toLowerCase().includes(p))) ||
    nonSendablePatterns.some((p) => haystack.includes(p));

  return { isSendable: !isExplicitlyNonSendable, status };
}

 async function refreshSenderEmailSnapshotsForClient(clientId: string): Promise<{ refreshed: boolean; count: number; error?: string }> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { emailBisonApiKey: true, emailBisonBaseHost: { select: { host: true } } },
  });

  if (!client?.emailBisonApiKey) return { refreshed: false, count: 0, error: "missing_emailbison_api_key" };

  const senderResult = await fetchEmailBisonSenderEmails(client.emailBisonApiKey, {
    baseHost: client.emailBisonBaseHost?.host ?? null,
  });
  if (!senderResult.success || !senderResult.data) {
    return { refreshed: false, count: 0, error: senderResult.error || "sender_fetch_failed" };
  }

  const now = new Date();
  let count = 0;
  const seenSenderIds = new Set<string>();

  for (const sender of senderResult.data) {
    if (!sender?.id) continue;
    const normalized = {
      senderEmailId: String(sender.id),
      emailAddress: String((sender.email_address ?? sender.email ?? "") || "") || null,
      ...computeIsSenderEmailSendable(sender as any),
      raw: sender as any,
    };

    await prisma.emailBisonSenderEmailSnapshot.upsert({
      where: {
        clientId_senderEmailId: {
          clientId,
          senderEmailId: normalized.senderEmailId,
        },
      },
      create: {
        clientId,
        senderEmailId: normalized.senderEmailId,
        emailAddress: normalized.emailAddress,
        status: normalized.status,
        isSendable: normalized.isSendable,
        raw: normalized.raw,
        fetchedAt: now,
      },
      update: {
        emailAddress: normalized.emailAddress,
        status: normalized.status,
        isSendable: normalized.isSendable,
        raw: normalized.raw,
        fetchedAt: now,
      },
    });
    count++;
    seenSenderIds.add(normalized.senderEmailId);
  }

  // If a sender disappears from the provider API, treat it as non-sendable so we don't keep selecting
  // a stale/invalid sender_email_id (common cause of 422 invalid sender id errors).
  await prisma.emailBisonSenderEmailSnapshot
    .updateMany({
      where: {
        clientId,
        senderEmailId: { notIn: Array.from(seenSenderIds) },
        isSendable: true,
      },
      data: {
        isSendable: false,
        status: "missing_in_provider",
        fetchedAt: now,
      },
    })
    .catch(() => undefined);

  return { refreshed: true, count };
}

async function pickFallbackSenderEmailId(opts: {
  clientId: string;
  dateKey: string;
  limitPerSender: number;
  allowedSenderIds: string[] | null;
}): Promise<{ senderEmailId: string | null; reason?: string }> {
  const senders = await prisma.emailBisonSenderEmailSnapshot.findMany({
    where: {
      clientId: opts.clientId,
      isSendable: true,
      ...(opts.allowedSenderIds && opts.allowedSenderIds.length > 0
        ? { senderEmailId: { in: opts.allowedSenderIds } }
        : {}),
    },
    select: { senderEmailId: true, emailAddress: true },
    orderBy: { senderEmailId: "asc" },
    take: 2000,
  });

  if (senders.length === 0) return { senderEmailId: null, reason: "no_sendable_senders" };

  const usageRows = await prisma.reactivationSenderDailyUsage.findMany({
    where: { clientId: opts.clientId, dateKey: opts.dateKey, senderEmailId: { in: senders.map((s) => s.senderEmailId) } },
    select: { senderEmailId: true, count: true },
  });
  const usage = new Map(usageRows.map((r) => [r.senderEmailId, r.count]));

  const scored = senders
    .map((s) => ({ senderEmailId: s.senderEmailId, count: usage.get(s.senderEmailId) ?? 0 }))
    .sort((a, b) => a.count - b.count || a.senderEmailId.localeCompare(b.senderEmailId));

  const underLimit = scored.filter((c) => c.count < opts.limitPerSender);
  if (underLimit.length > 0) return { senderEmailId: underLimit[0]!.senderEmailId };

  // If all senders are at today's limit, still pick the least-used sender so we can schedule for tomorrow.
  return { senderEmailId: scored[0]?.senderEmailId ?? null, reason: "all_senders_at_limit" };
}

export async function resolveReactivationEnrollmentsDue(opts?: {
  clientId?: string;
  limit?: number;
  senderSnapshotTtlMinutes?: number;
}): Promise<{ checked: number; resolved: number; needsReview: number; errors: string[] }> {
  const limit = opts?.limit ?? 200;
  const senderSnapshotTtlMinutes = opts?.senderSnapshotTtlMinutes ?? 60;
  const now = new Date();

  const enrollments = await prisma.reactivationEnrollment.findMany({
    where: {
      status: "pending_resolution",
      ...(opts?.clientId ? { campaign: { clientId: opts.clientId } } : {}),
      campaign: { isActive: true, client: { emailBisonApiKey: { not: null } } },
      lead: { email: { not: null } },
    },
    include: {
      lead: {
        select: {
          id: true,
          email: true,
          emailBisonLeadId: true,
          senderAccountId: true,
          ghlContactId: true,
          firstName: true,
          lastName: true,
          status: true,
          sentimentTag: true,
        },
      },
      campaign: {
        select: {
          id: true,
          clientId: true,
          dailyLimitPerSender: true,
          allowedSenderEmailIds: true,
          emailCampaignId: true,
          emailCampaign: { select: { bisonCampaignId: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const results = { checked: 0, resolved: 0, needsReview: 0, errors: [] as string[] };
  const leadIdByEmail = new Map<string, string | null>();

  for (const enrollment of enrollments) {
    results.checked++;
    try {
      const client = await prisma.client.findUnique({
        where: { id: enrollment.campaign.clientId },
        select: {
          id: true,
          emailBisonApiKey: true,
          emailBisonBaseHost: { select: { host: true } },
          settings: { select: { timezone: true } },
          ghlPrivateKey: true,
          ghlLocationId: true,
        },
      });
      if (!client?.emailBisonApiKey) {
        await prisma.reactivationEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "needs_review", needsReviewReason: "Workspace missing EmailBison API key" },
        });
        results.needsReview++;
        continue;
      }

      // Ensure sender snapshot is reasonably fresh.
      const latestSnapshot = await prisma.emailBisonSenderEmailSnapshot.findFirst({
        where: { clientId: client.id },
        select: { fetchedAt: true },
        orderBy: { fetchedAt: "desc" },
      });
      const stale =
        !latestSnapshot?.fetchedAt ||
        now.getTime() - latestSnapshot.fetchedAt.getTime() > senderSnapshotTtlMinutes * 60 * 1000;
      if (stale) {
        await refreshSenderEmailSnapshotsForClient(client.id).catch(() => undefined);
      }

      const leadEmail = enrollment.lead.email!;
      const emailKey = normalizeEmailKey(leadEmail);
      const desiredCampaignId = enrollment.campaign.emailCampaign?.bisonCampaignId ?? null;
      const allowedSenderIds = normalizeAllowedSenderIds(enrollment.campaign.allowedSenderEmailIds);

      // Prefer a known thread anchor already stored on Message rows (no provider calls).
      const dbAnchor = await pickAnchorFromExistingMessages(enrollment.lead.id);

      let emailBisonLeadId: string | null = enrollment.lead.emailBisonLeadId ?? null;
      let anchorReplyId: string | null = dbAnchor?.anchorReplyId ?? null;
      let anchorCampaignId: string | null = null;
      let originalSenderEmailId: string | null = null;

      if (!anchorReplyId) {
        // Resolve EmailBison lead_id (prefer stored id, otherwise search by email, then fallback to global replies search).
        let bisonLeadId = emailBisonLeadId;
        if (!bisonLeadId) {
          const cacheHit = leadIdByEmail.get(emailKey);
          if (cacheHit !== undefined) bisonLeadId = cacheHit ?? null;
        }

        if (!bisonLeadId) {
          const found = await findEmailBisonLeadIdByEmail(client.emailBisonApiKey, leadEmail, {
            baseHost: client.emailBisonBaseHost?.host ?? null,
          });
          if (found.success && found.leadId) {
            bisonLeadId = found.leadId;
          } else {
            // Fallback: search global replies and extract lead_id if present.
            const global = await fetchEmailBisonRepliesGlobal(
              client.emailBisonApiKey,
              { search: leadEmail },
              { baseHost: client.emailBisonBaseHost?.host ?? null }
            );
            const leadIdFromReplies =
              global.success && global.data
                ? global.data
                    .filter((r) => r.lead_id != null)
                    .sort(
                      (a, b) =>
                        parseDate(b.date_received, b.created_at).getTime() -
                        parseDate(a.date_received, a.created_at).getTime()
                    )[0]?.lead_id
                : null;

            if (leadIdFromReplies != null) {
              bisonLeadId = String(leadIdFromReplies);
            }
          }
        }

        // GHL-assisted fallback when EmailBison lead lookup fails (best-effort).
        if (!bisonLeadId && client.ghlPrivateKey && client.ghlLocationId) {
          const search = await searchGHLContactsAdvanced(
            {
              locationId: client.ghlLocationId,
              page: 1,
              pageLimit: 1,
              filters: [{ field: "email", operator: "eq", value: emailKey }],
            },
            client.ghlPrivateKey
          );

          if (search.success && search.data) {
            const first = pickFirstGhlContact(search.data);
            if (first?.id && !enrollment.lead.ghlContactId) {
              await prisma.lead
                .update({ where: { id: enrollment.lead.id }, data: { ghlContactId: first.id } })
                .catch(() => undefined);
            }

            const alternateEmail = first?.email ? normalizeEmailKey(first.email) : null;
            if (alternateEmail && alternateEmail !== emailKey) {
              const foundAlt = await findEmailBisonLeadIdByEmail(client.emailBisonApiKey, alternateEmail, {
                baseHost: client.emailBisonBaseHost?.host ?? null,
              });
              if (foundAlt.success && foundAlt.leadId) {
                bisonLeadId = foundAlt.leadId;
              }
            }
          }
        }

        // Cache the final outcome for this email (including negative results).
        if (!enrollment.lead.emailBisonLeadId) {
          leadIdByEmail.set(emailKey, bisonLeadId ?? null);
        }

        if (!bisonLeadId) {
          await prisma.reactivationEnrollment.update({
            where: { id: enrollment.id },
            data: { status: "needs_review", needsReviewReason: "EmailBison lead_id not found for this email" },
          });
          results.needsReview++;
          continue;
        }

        emailBisonLeadId = bisonLeadId;

        const repliesResult = await fetchEmailBisonReplies(client.emailBisonApiKey, bisonLeadId, {
          baseHost: client.emailBisonBaseHost?.host ?? null,
        });
        if (!repliesResult.success || !repliesResult.data) {
          await prisma.reactivationEnrollment.update({
            where: { id: enrollment.id },
            data: { status: "needs_review", needsReviewReason: repliesResult.error || "Failed to fetch EmailBison replies" },
          });
          results.needsReview++;
          continue;
        }

        const anchor = pickReactivationAnchorFromReplies({ replies: repliesResult.data, desiredCampaignId });

        if (!anchor) {
          await prisma.reactivationEnrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "needs_review",
              needsReviewReason:
                "No EmailBison thread/replies exist for this lead; cannot send reactivation via reply API. Enroll the lead in an EmailBison campaign to start a thread.",
              emailBisonLeadId: bisonLeadId,
            },
          });
          results.needsReview++;
          continue;
        }

        anchorReplyId = anchor.anchorReplyId;
        anchorCampaignId = anchor.anchorCampaignId;
        originalSenderEmailId = anchor.originalSenderEmailId;
      }

      if (!anchorReplyId) {
        await prisma.reactivationEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "needs_review", needsReviewReason: "Missing anchorReplyId after resolution (unexpected)" },
        });
        results.needsReview++;
        continue;
      }

      const preferredSenderEmailId = originalSenderEmailId ?? enrollment.lead.senderAccountId ?? null;
      let selectedSenderEmailId: string | null = null;
      let deadOriginalSender = originalSenderEmailId == null;
      let deadReason: string | null = deadOriginalSender ? "Original sender_email_id missing on anchor" : null;

      if (preferredSenderEmailId) {
        const preferredSender = await prisma.emailBisonSenderEmailSnapshot
          .findUnique({
            where: { clientId_senderEmailId: { clientId: client.id, senderEmailId: preferredSenderEmailId } },
            select: { isSendable: true },
          })
          .catch(() => null);

        const isPreferredAllowed =
          !allowedSenderIds || allowedSenderIds.length === 0 || allowedSenderIds.includes(preferredSenderEmailId);
        const preferredSendable = Boolean(preferredSender?.isSendable) && isPreferredAllowed;

        if (preferredSendable) {
          selectedSenderEmailId = preferredSenderEmailId;
          if (originalSenderEmailId && selectedSenderEmailId === originalSenderEmailId) {
            deadOriginalSender = false;
            deadReason = null;
          }
        } else {
          deadOriginalSender = true;
          deadReason = !isPreferredAllowed
            ? "Preferred sender not in allowed sender pool"
            : preferredSender
              ? "Preferred sender is not sendable"
              : "Preferred sender not found in sender email list (likely deleted)";
        }
      } else if (!deadReason) {
        deadOriginalSender = true;
        deadReason = "No sender account available on lead";
      }

      if (!selectedSenderEmailId) {
        const timezone = safeTimeZone(client.settings?.timezone, "America/Los_Angeles");
        const dateKey = dateKeyInTimeZone(now, timezone);

        const fallback = await pickFallbackSenderEmailId({
          clientId: client.id,
          dateKey,
          limitPerSender: enrollment.campaign.dailyLimitPerSender,
          allowedSenderIds,
        });

        if (!fallback.senderEmailId) {
          await prisma.reactivationEnrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "needs_review",
              needsReviewReason: `No sendable fallback sender available (${fallback.reason || "unknown"})`,
              emailBisonLeadId: emailBisonLeadId ?? undefined,
              anchorReplyId,
              anchorCampaignId,
              originalSenderEmailId,
              selectedSenderEmailId: null,
              deadOriginalSender: true,
              deadReason,
              resolvedAt: now,
            },
          });
          results.needsReview++;
          continue;
        }

        selectedSenderEmailId = fallback.senderEmailId;

        if (fallback.reason === "all_senders_at_limit") {
          const nextActionAt = nextDayAtHourInTimeZone(now, timezone, 9);
          await prisma.reactivationEnrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "rate_limited",
              needsReviewReason: null,
              emailBisonLeadId: emailBisonLeadId ?? undefined,
              anchorReplyId,
              anchorCampaignId,
              originalSenderEmailId,
              selectedSenderEmailId,
              deadOriginalSender: true,
              deadReason,
              resolvedAt: now,
              nextActionAt,
              lastError: "All sender accounts are at today's daily limit",
            },
          });

          if (emailBisonLeadId || selectedSenderEmailId) {
            await prisma.lead.update({
              where: { id: enrollment.lead.id },
              data: {
                ...(emailBisonLeadId ? { emailBisonLeadId } : {}),
                ...(selectedSenderEmailId ? { senderAccountId: selectedSenderEmailId } : {}),
              },
            });
          }

          results.resolved++;
          continue;
        }
      }

      await prisma.reactivationEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: "ready",
          needsReviewReason: null,
          emailBisonLeadId: emailBisonLeadId ?? undefined,
          anchorReplyId,
          anchorCampaignId,
          originalSenderEmailId,
          selectedSenderEmailId,
          deadOriginalSender,
          deadReason,
          resolvedAt: now,
          nextActionAt: now,
        },
      });

      // Best-effort: also store on Lead for future reuse.
      if (emailBisonLeadId || selectedSenderEmailId) {
        await prisma.lead.update({
          where: { id: enrollment.lead.id },
          data: {
            ...(emailBisonLeadId ? { emailBisonLeadId } : {}),
            ...(selectedSenderEmailId ? { senderAccountId: selectedSenderEmailId } : {}),
          },
        });
      }

      results.resolved++;
    } catch (error) {
      results.errors.push(`${enrollment.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return results;
}

async function reserveSenderDailySend(opts: {
  clientId: string;
  senderEmailId: string;
  dateKey: string;
  limitPerSender: number;
}): Promise<{ ok: boolean }> {
  return prisma.$transaction(async (tx) => {
    await tx.reactivationSenderDailyUsage.upsert({
      where: { clientId_senderEmailId_dateKey: { clientId: opts.clientId, senderEmailId: opts.senderEmailId, dateKey: opts.dateKey } },
      create: { clientId: opts.clientId, senderEmailId: opts.senderEmailId, dateKey: opts.dateKey, count: 0 },
      update: {},
    });

    const updated = await tx.reactivationSenderDailyUsage.updateMany({
      where: {
        clientId: opts.clientId,
        senderEmailId: opts.senderEmailId,
        dateKey: opts.dateKey,
        count: { lt: opts.limitPerSender },
      },
      data: { count: { increment: 1 } },
    });

    return { ok: updated.count === 1 };
  });
}

async function startFollowUpSequenceInstance(leadId: string, sequenceId: string): Promise<void> {
  const sequence = await prisma.followUpSequence.findUnique({
    where: { id: sequenceId },
    include: {
      steps: { orderBy: { stepOrder: "asc" }, take: 1 },
    },
  });
  if (!sequence?.isActive) return;

  const firstStep = sequence.steps[0];
  const nextStepDue = firstStep ? new Date(Date.now() + computeStepOffsetMs(firstStep)) : null;

  await prisma.followUpInstance.upsert({
    where: { leadId_sequenceId: { leadId, sequenceId } },
    update: {
      status: "active",
      currentStep: 0,
      pausedReason: null,
      startedAt: new Date(),
      lastStepAt: null,
      nextStepDue,
      completedAt: null,
    },
    create: {
      leadId,
      sequenceId,
      status: "active",
      currentStep: 0,
      nextStepDue,
    },
  });
}

export async function processReactivationSendsDue(opts?: {
  clientId?: string;
  limit?: number;
}): Promise<{ processed: number; sent: number; rateLimited: number; needsReview: number; failed: number; errors: string[] }> {
  const limit = opts?.limit ?? 50;
  const now = new Date();

  const enrollments = await prisma.reactivationEnrollment.findMany({
    where: {
      status: { in: ["ready", "rate_limited"] },
      nextActionAt: { lte: now },
      ...(opts?.clientId ? { campaign: { clientId: opts.clientId } } : {}),
      campaign: { isActive: true, client: { emailBisonApiKey: { not: null } } },
      lead: { email: { not: null } },
    },
    include: {
      lead: {
        select: {
          id: true,
          email: true,
          emailBisonLeadId: true,
          senderAccountId: true,
          ghlContactId: true,
          firstName: true,
          status: true,
          sentimentTag: true,
        },
      },
      campaign: {
        select: {
          id: true,
          clientId: true,
          dailyLimitPerSender: true,
          bumpMessageTemplate: true,
          followUpSequenceId: true,
          allowedSenderEmailIds: true,
          emailCampaign: { select: { bisonCampaignId: true } },
        },
      },
    },
    orderBy: { nextActionAt: "asc" },
    take: limit,
  });

  const results = { processed: 0, sent: 0, rateLimited: 0, needsReview: 0, failed: 0, errors: [] as string[] };
  const leadIdByEmail = new Map<string, string | null>();

  for (const enrollment of enrollments) {
    results.processed++;
    try {
      if (
        enrollment.lead.status === "blacklisted" ||
        enrollment.lead.status === "unqualified" ||
        enrollment.lead.sentimentTag === "Blacklist"
      ) {
        await prisma.reactivationEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: "needs_review",
            needsReviewReason:
              enrollment.lead.status === "unqualified"
                ? "Lead is unqualified"
                : "Lead is blacklisted/opted out",
          },
        });
        results.needsReview++;
        continue;
      }

      const client = await prisma.client.findUnique({
        where: { id: enrollment.campaign.clientId },
        select: {
          id: true,
          emailBisonApiKey: true,
          emailBisonBaseHost: { select: { host: true } },
          settings: { select: { timezone: true } },
          ghlPrivateKey: true,
          ghlLocationId: true,
        },
      });
      if (!client?.emailBisonApiKey) {
        await prisma.reactivationEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "needs_review", needsReviewReason: "Workspace missing EmailBison API key" },
        });
        results.needsReview++;
        continue;
      }

      const timezone = safeTimeZone(client.settings?.timezone, "America/Los_Angeles");
      const dateKey = dateKeyInTimeZone(now, timezone);

      let anchorReplyId = enrollment.anchorReplyId;
      let selectedSenderEmailId = enrollment.selectedSenderEmailId;

      if (!anchorReplyId || !selectedSenderEmailId) {
        const hadAnchorReplyId = Boolean(enrollment.anchorReplyId);
        const senderSnapshotTtlMinutes = 60;

        // Ensure sender snapshot is reasonably fresh (best-effort).
        const latestSnapshot = await prisma.emailBisonSenderEmailSnapshot.findFirst({
          where: { clientId: client.id },
          select: { fetchedAt: true },
          orderBy: { fetchedAt: "desc" },
        });
        const stale =
          !latestSnapshot?.fetchedAt ||
          now.getTime() - latestSnapshot.fetchedAt.getTime() > senderSnapshotTtlMinutes * 60 * 1000;
        if (stale) {
          await refreshSenderEmailSnapshotsForClient(client.id).catch(() => undefined);
        }

        const leadEmail = enrollment.lead.email!;
        const emailKey = normalizeEmailKey(leadEmail);
        const desiredCampaignId = enrollment.campaign.emailCampaign?.bisonCampaignId ?? null;
        const allowedSenderIds = normalizeAllowedSenderIds(enrollment.campaign.allowedSenderEmailIds);

        let emailBisonLeadId: string | null = enrollment.emailBisonLeadId ?? enrollment.lead.emailBisonLeadId ?? null;
        let anchorCampaignId: string | null = enrollment.anchorCampaignId ?? null;
        let originalSenderEmailId: string | null = enrollment.originalSenderEmailId ?? null;

        if (!anchorReplyId) {
          const dbAnchor = await pickAnchorFromExistingMessages(enrollment.lead.id);
          if (dbAnchor) {
            anchorReplyId = dbAnchor.anchorReplyId;
            anchorCampaignId = null;
            originalSenderEmailId = null;
          }
        }

        if (!anchorReplyId) {
          // Resolve EmailBison lead_id (prefer stored id, otherwise search by email, then fallback to global replies search).
          let bisonLeadId = emailBisonLeadId;
          if (!bisonLeadId) {
            const cacheHit = leadIdByEmail.get(emailKey);
            if (cacheHit !== undefined) bisonLeadId = cacheHit ?? null;
          }

          if (!bisonLeadId) {
            const found = await findEmailBisonLeadIdByEmail(client.emailBisonApiKey, leadEmail, {
              baseHost: client.emailBisonBaseHost?.host ?? null,
            });
            if (found.success && found.leadId) {
              bisonLeadId = found.leadId;
            } else {
              const global = await fetchEmailBisonRepliesGlobal(
                client.emailBisonApiKey,
                { search: leadEmail },
                { baseHost: client.emailBisonBaseHost?.host ?? null }
              );
              const leadIdFromReplies =
                global.success && global.data
                  ? global.data
                      .filter((r) => r.lead_id != null)
                      .sort(
                        (a, b) =>
                          parseDate(b.date_received, b.created_at).getTime() -
                          parseDate(a.date_received, a.created_at).getTime()
                      )[0]?.lead_id
                  : null;

              if (leadIdFromReplies != null) {
                bisonLeadId = String(leadIdFromReplies);
              }
            }
          }

          // GHL-assisted fallback when EmailBison lead lookup fails (best-effort).
          if (!bisonLeadId && client.ghlPrivateKey && client.ghlLocationId) {
            const search = await searchGHLContactsAdvanced(
              {
                locationId: client.ghlLocationId,
                page: 1,
                pageLimit: 1,
                filters: [{ field: "email", operator: "eq", value: emailKey }],
              },
              client.ghlPrivateKey
            );

            if (search.success && search.data) {
              const first = pickFirstGhlContact(search.data);
              if (first?.id && !enrollment.lead.ghlContactId) {
                await prisma.lead.update({ where: { id: enrollment.lead.id }, data: { ghlContactId: first.id } }).catch(() => undefined);
              }

              const alternateEmail = first?.email ? normalizeEmailKey(first.email) : null;
              if (alternateEmail && alternateEmail !== emailKey) {
                const foundAlt = await findEmailBisonLeadIdByEmail(client.emailBisonApiKey, alternateEmail, {
                  baseHost: client.emailBisonBaseHost?.host ?? null,
                });
                if (foundAlt.success && foundAlt.leadId) {
                  bisonLeadId = foundAlt.leadId;
                }
              }
            }
          }

          if (!enrollment.lead.emailBisonLeadId) {
            leadIdByEmail.set(emailKey, bisonLeadId ?? null);
          }

          if (!bisonLeadId) {
            await prisma.reactivationEnrollment.update({
              where: { id: enrollment.id },
              data: { status: "needs_review", needsReviewReason: "EmailBison lead_id not found for this email" },
            });
            results.needsReview++;
            continue;
          }

          emailBisonLeadId = bisonLeadId;

          const repliesResult = await fetchEmailBisonReplies(client.emailBisonApiKey, bisonLeadId, {
            baseHost: client.emailBisonBaseHost?.host ?? null,
          });
          if (!repliesResult.success || !repliesResult.data) {
            await prisma.reactivationEnrollment.update({
              where: { id: enrollment.id },
              data: { status: "needs_review", needsReviewReason: repliesResult.error || "Failed to fetch EmailBison replies" },
            });
            results.needsReview++;
            continue;
          }

          const anchor = pickReactivationAnchorFromReplies({ replies: repliesResult.data, desiredCampaignId });
          if (!anchor) {
            await prisma.reactivationEnrollment.update({
              where: { id: enrollment.id },
              data: {
                status: "needs_review",
                needsReviewReason:
                  "No EmailBison thread/replies exist for this lead; cannot send reactivation via reply API. Enroll the lead in an EmailBison campaign to start a thread.",
                emailBisonLeadId: bisonLeadId,
              },
            });
            results.needsReview++;
            continue;
          }

          anchorReplyId = anchor.anchorReplyId;
          anchorCampaignId = anchor.anchorCampaignId;
          originalSenderEmailId = anchor.originalSenderEmailId;
        }

        if (!anchorReplyId) {
          await prisma.reactivationEnrollment.update({
            where: { id: enrollment.id },
            data: { status: "needs_review", needsReviewReason: "Missing anchorReplyId after resolution (unexpected)" },
          });
          results.needsReview++;
          continue;
        }

        if (!hadAnchorReplyId && anchorReplyId) {
          await prisma.reactivationEnrollment
            .update({
              where: { id: enrollment.id },
              data: {
                status: "ready",
                needsReviewReason: null,
                emailBisonLeadId: emailBisonLeadId ?? undefined,
                anchorReplyId,
                anchorCampaignId,
                originalSenderEmailId,
                resolvedAt: now,
                nextActionAt: now,
              },
            })
            .catch(() => undefined);

          if (emailBisonLeadId) {
            await prisma.lead.update({ where: { id: enrollment.lead.id }, data: { emailBisonLeadId } }).catch(() => undefined);
          }
        }

        if (!selectedSenderEmailId) {
          const preferredSenderEmailId = originalSenderEmailId ?? enrollment.lead.senderAccountId ?? null;
          let deadOriginalSender = originalSenderEmailId == null;
          let deadReason: string | null = deadOriginalSender ? "Original sender_email_id missing on anchor" : null;

          if (preferredSenderEmailId) {
            const preferredSender = await prisma.emailBisonSenderEmailSnapshot
              .findUnique({
                where: { clientId_senderEmailId: { clientId: client.id, senderEmailId: preferredSenderEmailId } },
                select: { isSendable: true },
              })
              .catch(() => null);

            const isPreferredAllowed =
              !allowedSenderIds || allowedSenderIds.length === 0 || allowedSenderIds.includes(preferredSenderEmailId);
            const preferredSendable = Boolean(preferredSender?.isSendable) && isPreferredAllowed;

            if (preferredSendable) {
              selectedSenderEmailId = preferredSenderEmailId;
              if (originalSenderEmailId && selectedSenderEmailId === originalSenderEmailId) {
                deadOriginalSender = false;
                deadReason = null;
              }
            } else {
              deadOriginalSender = true;
              deadReason = !isPreferredAllowed
                ? "Preferred sender not in allowed sender pool"
                : preferredSender
                  ? "Preferred sender is not sendable"
                  : "Preferred sender not found in sender email list (likely deleted)";
            }
          } else if (!deadReason) {
            deadOriginalSender = true;
            deadReason = "No sender account available on lead";
          }

          if (!selectedSenderEmailId) {
            const fallback = await pickFallbackSenderEmailId({
              clientId: client.id,
              dateKey,
              limitPerSender: enrollment.campaign.dailyLimitPerSender,
              allowedSenderIds,
            });

            if (!fallback.senderEmailId) {
              await prisma.reactivationEnrollment.update({
                where: { id: enrollment.id },
                data: {
                  status: "needs_review",
                  needsReviewReason: `No sendable fallback sender available (${fallback.reason || "unknown"})`,
                  emailBisonLeadId: emailBisonLeadId ?? undefined,
                  anchorReplyId,
                  anchorCampaignId,
                  originalSenderEmailId,
                  selectedSenderEmailId: null,
                  deadOriginalSender: true,
                  deadReason,
                  resolvedAt: now,
                },
              });
              results.needsReview++;
              continue;
            }

            selectedSenderEmailId = fallback.senderEmailId;

            if (fallback.reason === "all_senders_at_limit") {
              const nextActionAt = nextDayAtHourInTimeZone(now, timezone, 9);
              await prisma.reactivationEnrollment.update({
                where: { id: enrollment.id },
                data: {
                  status: "rate_limited",
                  needsReviewReason: null,
                  emailBisonLeadId: emailBisonLeadId ?? undefined,
                  anchorReplyId,
                  anchorCampaignId,
                  originalSenderEmailId,
                  selectedSenderEmailId,
                  deadOriginalSender: true,
                  deadReason,
                  resolvedAt: now,
                  nextActionAt,
                  lastError: "All sender accounts are at today's daily limit",
                },
              });

              if (emailBisonLeadId || selectedSenderEmailId) {
                await prisma.lead
                  .update({
                    where: { id: enrollment.lead.id },
                    data: {
                      ...(emailBisonLeadId ? { emailBisonLeadId } : {}),
                      ...(selectedSenderEmailId ? { senderAccountId: selectedSenderEmailId } : {}),
                    },
                  })
                  .catch(() => undefined);
              }

              results.rateLimited++;
              continue;
            }
          }

          await prisma.reactivationEnrollment.update({
            where: { id: enrollment.id },
            data: {
              status: "ready",
              needsReviewReason: null,
              emailBisonLeadId: emailBisonLeadId ?? undefined,
              anchorReplyId,
              anchorCampaignId,
              originalSenderEmailId,
              selectedSenderEmailId,
              deadOriginalSender,
              deadReason,
              resolvedAt: now,
              nextActionAt: now,
            },
          });

          if (emailBisonLeadId || selectedSenderEmailId) {
            await prisma.lead
              .update({
                where: { id: enrollment.lead.id },
                data: {
                  ...(emailBisonLeadId ? { emailBisonLeadId } : {}),
                  ...(selectedSenderEmailId ? { senderAccountId: selectedSenderEmailId } : {}),
                },
              })
              .catch(() => undefined);
          }
        }
      }

      if (!anchorReplyId || !selectedSenderEmailId) {
        await prisma.reactivationEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "needs_review", needsReviewReason: "Missing anchorReplyId or selectedSenderEmailId" },
        });
        results.needsReview++;
        continue;
      }

      const reserved = await reserveSenderDailySend({
        clientId: client.id,
        senderEmailId: selectedSenderEmailId,
        dateKey,
        limitPerSender: enrollment.campaign.dailyLimitPerSender,
      });

      if (!reserved.ok) {
        const nextActionAt = nextDayAtHourInTimeZone(now, timezone, 9);

        await prisma.reactivationEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "rate_limited", nextActionAt, lastAttemptAt: now, lastError: "Sender daily limit reached" },
        });
        results.rateLimited++;
        continue;
      }

      const firstName = enrollment.lead.firstName || "there";
      const content = enrollment.campaign.bumpMessageTemplate.replaceAll("{firstName}", firstName);

      const senderEmailIdNum = Number.parseInt(selectedSenderEmailId, 10);
      if (!Number.isFinite(senderEmailIdNum)) {
        await prisma.reactivationEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "needs_review", needsReviewReason: "selectedSenderEmailId is not a number" },
        });
        results.needsReview++;
        continue;
      }

      const sendResult = await sendEmailBisonReply(
        client.emailBisonApiKey,
        anchorReplyId,
        {
          message: emailBisonHtmlFromPlainText(content),
          sender_email_id: senderEmailIdNum,
          to_emails: [{ name: enrollment.lead.firstName || null, email_address: enrollment.lead.email! }],
          inject_previous_email_body: true,
          content_type: "html",
        },
        { baseHost: client.emailBisonBaseHost?.host ?? null }
      );

      if (!sendResult.success) {
        await prisma.reactivationEnrollment.update({
          where: { id: enrollment.id },
          data: {
            status: "failed",
            lastAttemptAt: now,
            retryCount: { increment: 1 },
            lastError: sendResult.error || "EmailBison send failed",
          },
        });
        results.failed++;
        continue;
      }

      const providerMessageId = sendResult.data?.message_id ? String(sendResult.data.message_id) : null;

      await prisma.reactivationSendLog.create({
        data: {
          enrollmentId: enrollment.id,
          stepKey: "bump_1",
          channel: "email",
          senderEmailId: selectedSenderEmailId,
          anchorReplyId,
          providerMessageId,
          status: "sent",
          sentAt: now,
        },
      });

      const msg = await prisma.message.create({
        data: {
          channel: "email",
          source: "zrg",
          body: content,
          direction: "outbound",
          leadId: enrollment.lead.id,
          sentAt: now,
        },
      });
      await bumpLeadMessageRollup({ leadId: enrollment.lead.id, direction: "outbound", source: "zrg", sentAt: msg.sentAt });

      // Ensure the lead is enrolled in automation so sequences actually run.
      await prisma.lead.update({
        where: { id: enrollment.lead.id },
        data: { autoFollowUpEnabled: true },
      });

      if (enrollment.campaign.followUpSequenceId) {
        await startFollowUpSequenceInstance(enrollment.lead.id, enrollment.campaign.followUpSequenceId);
      }

      await prisma.reactivationEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "sent", sentAt: now, lastAttemptAt: now, lastError: null },
      });

      results.sent++;
    } catch (error) {
      results.failed++;
      results.errors.push(`${enrollment.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return results;
}

export async function refreshSenderEmailSnapshotsDue(opts?: {
  clientId?: string;
  ttlMinutes?: number;
  limitClients?: number;
}): Promise<{ checked: number; refreshed: number; errors: string[] }> {
  const ttlMinutes = opts?.ttlMinutes ?? 60;
  const limitClients = opts?.limitClients ?? 50;
  const now = new Date();

  const clients = await prisma.client.findMany({
    where: {
      ...(opts?.clientId ? { id: opts.clientId } : {}),
      emailBisonApiKey: { not: null },
    },
    select: { id: true },
    take: limitClients,
  });

  const results = { checked: 0, refreshed: 0, errors: [] as string[] };

  for (const c of clients) {
    results.checked++;
    const latest = await prisma.emailBisonSenderEmailSnapshot.findFirst({
      where: { clientId: c.id },
      select: { fetchedAt: true },
      orderBy: { fetchedAt: "desc" },
    });
    const stale = !latest?.fetchedAt || now.getTime() - latest.fetchedAt.getTime() > ttlMinutes * 60 * 1000;
    if (!stale) continue;

    const r = await refreshSenderEmailSnapshotsForClient(c.id);
    if (r.refreshed) results.refreshed++;
    else results.errors.push(`${c.id}: ${r.error || "refresh_failed"}`);
  }

  return results;
}
