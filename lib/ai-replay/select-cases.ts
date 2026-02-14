import type {
  ReplayChannel,
  ReplayChannelFilter,
  ReplayRiskReason,
  ReplaySelectionCase,
  ReplaySelectionResult,
  ReplaySelectionSource,
} from "@/lib/ai-replay/types";

type SelectReplayCasesOptions = {
  clientId: string | null;
  threadIds: string[];
  channel: ReplayChannelFilter;
  from: Date;
  to: Date;
  limit: number;
  dbClient?: {
    message: {
      findMany: (args: Record<string, unknown>) => Promise<Array<{
        id: string;
        channel: string;
        sentAt: Date;
        subject: string | null;
        body: string;
        lead: {
          id: string;
          clientId: string;
          firstName: string | null;
          lastName: string | null;
          email: string | null;
          sentimentTag: string | null;
        };
      }>>;
    };
  };
};

const PRICING_KEYWORD_REGEX = /\b(price|pricing|cost|costs|fee|fees|budget|investment|membership|plan|billing)\b/i;
const CADENCE_KEYWORD_REGEX = /\b(monthly|annual|annually|yearly|quarterly|per\s+month|per\s+year|per\s+quarter|\/\s?(mo|month|yr|year|qtr|quarter))\b/i;
const DOLLAR_AMOUNT_REGEX = /\$\s*\d[\d,]*(?:\.\d{1,2})?/;

function normalizeChannel(channel: string): ReplayChannel | null {
  if (channel === "email" || channel === "sms" || channel === "linkedin") return channel;
  return null;
}

type AutoSelectionScope = "channel_window" | "all_channels_window" | "channel_all_time" | "all_channels_all_time";

function describeScope(scope: AutoSelectionScope, channel: ReplayChannelFilter): string {
  if (scope === "channel_window") return `${channel} in requested window`;
  if (scope === "all_channels_window") return "all channels in requested window";
  if (scope === "channel_all_time") return `${channel} across full history`;
  return "all channels across full history";
}

function buildAutoWhere(opts: {
  clientId: string;
  scope: AutoSelectionScope;
  channel: ReplayChannelFilter;
  from: Date;
  to: Date;
}): Record<string, unknown> {
  const where: Record<string, unknown> = {
    direction: "inbound",
    lead: { clientId: opts.clientId },
  };

  if (opts.scope === "channel_window" || opts.scope === "channel_all_time") {
    where.channel = opts.channel;
  }
  if (opts.scope === "channel_window" || opts.scope === "all_channels_window") {
    where.sentAt = { gte: opts.from, lte: opts.to };
  }

  return where;
}

function computeRiskSignals(opts: {
  body: string;
  subject: string | null;
  sentimentTag: string | null;
  explicit: boolean;
}): { score: number; reasons: ReplayRiskReason[] } {
  const body = opts.body || "";
  const subject = opts.subject || "";
  const combined = `${subject}\n${body}`;
  const reasons: ReplayRiskReason[] = [];
  let score = 0;

  if (opts.explicit) {
    reasons.push("explicit_thread_id");
    score += 100;
  }
  if (PRICING_KEYWORD_REGEX.test(combined)) {
    reasons.push("pricing_keyword");
    score += 50;
  }
  if (CADENCE_KEYWORD_REGEX.test(combined)) {
    reasons.push("cadence_keyword");
    score += 40;
  }
  if (DOLLAR_AMOUNT_REGEX.test(combined)) {
    reasons.push("dollar_amount");
    score += 25;
  }

  const normalizedSentiment = (opts.sentimentTag || "").trim();
  if (normalizedSentiment === "Information Requested") {
    reasons.push("information_requested");
    score += 15;
  } else if (normalizedSentiment === "Follow Up") {
    reasons.push("follow_up");
    score += 10;
  } else if (normalizedSentiment === "Meeting Requested" || normalizedSentiment === "Call Requested") {
    reasons.push("meeting_requested");
    score += 8;
  }

  reasons.push("recent_inbound");
  score += 2;

  return { score, reasons };
}

function buildLeadName(firstName: string | null, lastName: string | null): string {
  const parts = [firstName || "", lastName || ""].map((part) => part.trim()).filter(Boolean);
  return parts.join(" ").trim() || "Unknown";
}

function buildSelectionCase(opts: {
  message: {
    id: string;
    channel: string;
    sentAt: Date;
    subject: string | null;
    body: string;
    lead: {
      id: string;
      clientId: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      sentimentTag: string | null;
    };
  };
  selectionSource: ReplaySelectionSource;
  explicit: boolean;
}): ReplaySelectionCase | null {
  const channel = normalizeChannel(opts.message.channel);
  if (!channel) return null;

  const normalizedSentiment = (opts.message.lead.sentimentTag || "").trim();
  // Replay is primarily used to validate "should we respond?" quality. Auto-selection should avoid
  // known non-actionable inbound categories like out-of-office and opt-outs.
  if (!opts.explicit && (normalizedSentiment === "Automated Reply" || normalizedSentiment === "Opt Out")) {
    return null;
  }

  const { score, reasons } = computeRiskSignals({
    body: opts.message.body,
    subject: opts.message.subject,
    sentimentTag: normalizedSentiment,
    explicit: opts.explicit,
  });

  return {
    caseId: `${opts.message.id}:${channel}`,
    messageId: opts.message.id,
    leadId: opts.message.lead.id,
    clientId: opts.message.lead.clientId,
    channel,
    sentAt: opts.message.sentAt.toISOString(),
    leadName: buildLeadName(opts.message.lead.firstName, opts.message.lead.lastName),
    leadEmail: opts.message.lead.email,
    leadSentiment: opts.message.lead.sentimentTag || "Neutral",
    inboundSubject: opts.message.subject,
    inboundBody: opts.message.body,
    riskScore: score,
    riskReasons: reasons,
    selectionSource: opts.selectionSource,
  };
}

export async function selectReplayCases(options: SelectReplayCasesOptions): Promise<ReplaySelectionResult> {
  const dbClient = options.dbClient ?? (await import("@/lib/prisma")).prisma;
  const warnings: string[] = [];
  const threadIds = options.threadIds.map((id) => id.trim()).filter(Boolean);
  const explicitMode = threadIds.length > 0;

  if (!explicitMode && !options.clientId) {
    throw new Error("clientId is required when --thread-ids is not provided");
  }

  const scannedLimit = explicitMode ? Math.max(threadIds.length, 1) : Math.max(options.limit * 6, options.limit);
  const queryMessages = async (where: Record<string, unknown>) =>
    dbClient.message.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
      take: scannedLimit,
      select: {
        id: true,
        channel: true,
        sentAt: true,
        subject: true,
        body: true,
        lead: {
          select: {
            id: true,
            clientId: true,
            firstName: true,
            lastName: true,
            email: true,
            sentimentTag: true,
          },
        },
      },
    });

  let messages: Awaited<ReturnType<typeof queryMessages>> = [];
  if (explicitMode) {
    messages = await queryMessages({
      id: { in: threadIds },
      direction: "inbound",
    });
  } else {
    const scopes: AutoSelectionScope[] =
      options.channel === "any"
        ? ["all_channels_window", "all_channels_all_time"]
        : ["channel_window", "all_channels_window", "channel_all_time", "all_channels_all_time"];

    for (let index = 0; index < scopes.length; index++) {
      const scope = scopes[index]!;
      messages = await queryMessages(
        buildAutoWhere({
          clientId: options.clientId!,
          scope,
          channel: options.channel,
          from: options.from,
          to: options.to,
        })
      );
      if (messages.length > 0) {
        if (index > 0) {
          warnings.push(`Selection fallback used: ${describeScope(scope, options.channel)}.`);
        }
        break;
      }

      const nextScope = scopes[index + 1];
      if (nextScope) {
        warnings.push(
          `No inbound messages found in ${describeScope(scope, options.channel)}; widening to ${describeScope(nextScope, options.channel)}.`
        );
      }
    }

    if (messages.length === 0) {
      warnings.push(
        `No inbound messages found for client ${options.clientId} (checked requested window and full history).`
      );
    }
  }

  if (explicitMode) {
    const found = new Set(messages.map((message) => message.id));
    for (const threadId of threadIds) {
      if (!found.has(threadId)) warnings.push(`Thread/message id not found or not inbound: ${threadId}`);
    }
  }

  const mapped = messages
    .map((message) =>
      buildSelectionCase({
        message,
        selectionSource: explicitMode ? "explicit_thread_ids" : "auto_risk_ranked",
        explicit: explicitMode,
      })
    )
    .filter((value): value is ReplaySelectionCase => Boolean(value));

  const deduped = new Map<string, ReplaySelectionCase>();
  for (const value of mapped) {
    if (!deduped.has(value.messageId)) deduped.set(value.messageId, value);
  }
  let cases = Array.from(deduped.values());

  if (messages.length > 0 && cases.length === 0) {
    warnings.push("Inbound messages were found but none were in supported replay channels (email/sms/linkedin).");
  }

  if (explicitMode) {
    const indexById = new Map(threadIds.map((id, index) => [id, index]));
    cases.sort((a, b) => (indexById.get(a.messageId) ?? Number.MAX_SAFE_INTEGER) - (indexById.get(b.messageId) ?? Number.MAX_SAFE_INTEGER));
  } else {
    cases.sort((a, b) => {
      if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
      return new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime();
    });
  }

  if (cases.length > options.limit) cases = cases.slice(0, options.limit);

  return {
    cases,
    warnings,
    scannedCount: messages.length,
  };
}

export const __private__ = {
  computeRiskSignals,
  normalizeChannel,
  buildAutoWhere,
  describeScope,
};
