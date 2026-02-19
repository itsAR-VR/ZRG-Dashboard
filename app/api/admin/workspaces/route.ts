import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRouteSecret } from "@/lib/api-secret-auth";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { ClientMemberRole, EmailIntegrationProvider, Prisma } from "@prisma/client";
import { ensureDefaultSequencesIncludeLinkedInStepsForClient } from "@/lib/followup-sequence-linkedin";
import { resolveEmailIntegrationProvider } from "@/lib/email-integration";
import { ensureReengagementFollowUpSequenceForClient } from "@/lib/followup-sequence-reengagement";
import { normalizeCrmWebhookSettingsPatch } from "@/lib/crm-webhook-config";

type ProvisionWorkspaceRequest = {
  // Required
  name?: string;
  ghlLocationId?: string;
  ghlPrivateKey?: string;

  // Required (one of)
  userId?: string;
  userEmail?: string;

  // Optional integrations
  emailProvider?: string | null;
  emailBisonApiKey?: string;
  emailBisonWorkspaceId?: string; // numeric string
  emailBisonBaseHostId?: string; // UUID of EmailBisonBaseHost (optional custom base host)
  smartLeadApiKey?: string;
  smartLeadWebhookSecret?: string;
  instantlyApiKey?: string;
  instantlyWebhookSecret?: string;
  unipileAccountId?: string;
  calendlyAccessToken?: string; // Calendly calendar integration

  // Optional assignments (email inputs resolved server-side)
  inboxManagerEmail?: string; // legacy single inbox manager
  inboxManagerEmails?: string[] | string;
  setterEmails?: string[] | string;

  // Optional round-robin settings (email inputs for sequence resolved server-side)
  roundRobinEnabled?: boolean | string; // true/false or "true"/"false"
  roundRobinEmailOnly?: boolean | string; // true/false or "true"/"false"
  roundRobinSequenceEmails?: string[] | string; // emails must be in setterEmails list

  // Optional behavior controls
  upsert?: boolean; // if true, update an existing workspace for same ghlLocationId

  // Optional initial settings overrides
  settings?: Record<string, unknown>;
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

type OptionalStringField =
  | { touched: false }
  | { touched: true; value: string | null }
  | { touched: true; error: string };

function readOptionalStringField(bodyRaw: unknown, key: string): OptionalStringField {
  if (!bodyRaw || typeof bodyRaw !== "object" || Array.isArray(bodyRaw)) return { touched: false };
  const obj = bodyRaw as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return { touched: false };

  const raw = obj[key];
  if (raw === null) return { touched: true, value: null };
  if (typeof raw !== "string") return { touched: true, error: `${key} must be a string` };

  const trimmed = raw.trim();
  return { touched: true, value: trimmed ? trimmed : null };
}

function normalizeEmailBisonWorkspaceId(value: unknown): string | undefined {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) return undefined;
  // People sometimes paste "# 123" from Inboxxia/EmailBison UI.
  return trimmed.replace(/^#\s*/, "");
}

function readEmailBisonWorkspaceIdField(bodyRaw: unknown, key: string): OptionalStringField {
  const base = readOptionalStringField(bodyRaw, key);
  if (!base.touched || "error" in base) return base;
  if (!base.value) return base;
  return { touched: true, value: base.value.replace(/^#\s*/, "") || null };
}

function normalizeEmailList(value: unknown): string[] {
  if (!value) return [];

  const raw: string[] = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? value.split(/[\n,;]+/g)
      : [];

  const emails = raw
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(emails));
}

function validateEmailBisonWorkspaceId(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) return "emailBisonWorkspaceId must be a numeric string";
  return null;
}

function parseEmailProvider(value: unknown): EmailIntegrationProvider | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (value === EmailIntegrationProvider.EMAILBISON) return EmailIntegrationProvider.EMAILBISON;
  if (value === EmailIntegrationProvider.SMARTLEAD) return EmailIntegrationProvider.SMARTLEAD;
  if (value === EmailIntegrationProvider.INSTANTLY) return EmailIntegrationProvider.INSTANTLY;
  return undefined;
}

function hasValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function assertProviderRequirements(
  provider: EmailIntegrationProvider,
  snapshot: {
    smartLeadApiKey: string | null;
    smartLeadWebhookSecret: string | null;
    instantlyApiKey: string | null;
    instantlyWebhookSecret: string | null;
  }
) {
  if (provider === EmailIntegrationProvider.SMARTLEAD) {
    if (!hasValue(snapshot.smartLeadApiKey)) {
      throw new Error("smartLeadApiKey is required when emailProvider is SMARTLEAD");
    }
    if (!hasValue(snapshot.smartLeadWebhookSecret)) {
      throw new Error("smartLeadWebhookSecret is required when emailProvider is SMARTLEAD");
    }
  }

  if (provider === EmailIntegrationProvider.INSTANTLY) {
    if (!hasValue(snapshot.instantlyApiKey)) {
      throw new Error("instantlyApiKey is required when emailProvider is INSTANTLY");
    }
    if (!hasValue(snapshot.instantlyWebhookSecret)) {
      throw new Error("instantlyWebhookSecret is required when emailProvider is INSTANTLY");
    }
  }
}

function pickWorkspaceSettings(input: Record<string, unknown>): Record<string, unknown> {
  // Whitelist only fields we expect for WorkspaceSettings.
  const allowed = [
    "aiPersonaName",
    "aiTone",
    "aiGreeting",
    "aiSmsGreeting",
    "aiSignature",
    "aiGoals",
    "serviceDescription",
    "qualificationQuestions",
    "companyName",
    "targetResult",
    "autoApproveMeetings",
    "flagUncertainReplies",
    "pauseForOOO",
    "followUpsPausedUntil",
    "autoBlacklist",
    "autoFollowUpsOnReply",
    "airtableMode",
    "emailDigest",
    "slackAlerts",
    "crmWebhookEnabled",
    "crmWebhookUrl",
    "crmWebhookEvents",
    "crmWebhookSecret",
    "timezone",
    "workStartTime",
    "workEndTime",
    "calendarSlotsToShow",
    "calendarLookAheadDays",
    "ghlDefaultCalendarId",
    "ghlAssignedUserId",
    "autoBookMeetings",
    "meetingDurationMinutes",
    "meetingTitle",
    "meetingBookingProvider",
    "calendlyEventTypeLink",
    "calendlyEventTypeUri",
    // Round-robin settings (can be set via settings object OR top-level roundRobin* fields)
    "roundRobinEnabled",
    "roundRobinEmailOnly",
    // Note: roundRobinSetterSequence requires user ID resolution, so it's handled via roundRobinSequenceEmails at top level
  ] as const;

  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
  }
  return out;
}

function coerceWorkspaceSettings(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    // Keep strings as-is (trim), allow null to clear, convert numbers/booleans safely.
    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === "string") {
      out[key] = value.trim();
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    // Allow date strings for followUpsPausedUntil (Monday often sends ISO strings).
    if (key === "followUpsPausedUntil" && typeof value === "object") {
      // ignore unknown shapes
      continue;
    }
  }

  if (typeof values.followUpsPausedUntil === "string") {
    const str = values.followUpsPausedUntil.trim();
    out.followUpsPausedUntil = str ? new Date(str) : null;
  }

  // Numbers that Monday may send as strings.
  for (const numericField of ["calendarSlotsToShow", "calendarLookAheadDays", "meetingDurationMinutes"] as const) {
    const raw = values[numericField];
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) continue;
      out[numericField] = Math.trunc(parsed);
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[numericField] = Math.trunc(raw);
    }
  }

  for (const booleanField of [
    "autoApproveMeetings",
    "flagUncertainReplies",
    "pauseForOOO",
    "autoBlacklist",
    "autoFollowUpsOnReply",
    "airtableMode",
    "emailDigest",
    "slackAlerts",
    "autoBookMeetings",
    "roundRobinEnabled",
    "roundRobinEmailOnly",
    "crmWebhookEnabled",
  ] as const) {
    const raw = values[booleanField];
    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      if (normalized === "true") out[booleanField] = true;
      if (normalized === "false") out[booleanField] = false;
    }
  }

  if (Array.isArray(values.crmWebhookEvents)) {
    out.crmWebhookEvents = values.crmWebhookEvents
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } else if (typeof values.crmWebhookEvents === "string") {
    out.crmWebhookEvents = values.crmWebhookEvents
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return out;
}

async function resolveUserId(params: {
  userId: string | null;
  userEmail: string | null;
}): Promise<{ ok: true; userId: string } | { ok: false; error: string; status: number }> {
  if (params.userId) return { ok: true, userId: params.userId };
  if (!params.userEmail) return { ok: false, error: "Provide either userId or userEmail", status: 400 };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      error: "Server misconfigured: missing Supabase env vars for userEmail lookup",
      status: 500,
    };
  }

  const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  // Supabase JS doesn't expose getUserByEmail; page through users until we find a match.
  const email = params.userEmail.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[Provision Workspace] supabase listUsers error:", error);
      return { ok: false, error: "Failed to look up user by email", status: 500 };
    }

    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (found) return { ok: true, userId: found.id };
    if (data.users.length < perPage) break;
  }

  return { ok: false, error: "User not found for userEmail", status: 404 };
}

export async function POST(request: NextRequest) {
  const expectedSecret =
    process.env.WORKSPACE_PROVISIONING_SECRET ??
    process.env.ADMIN_ACTIONS_SECRET ??
    process.env.CRON_SECRET ??
    null;

  const auth = verifyRouteSecret({
    request,
    expectedSecret,
    allowQuerySecret: true,
    misconfiguredError: "Server misconfigured: set WORKSPACE_PROVISIONING_SECRET",
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const bodyRaw = (await request.json().catch(() => null)) as unknown;
  const body = bodyRaw as ProvisionWorkspaceRequest | null;

  const upsert = body?.upsert === true;

  // For upsert (update), only ghlLocationId is required to identify the workspace.
  // For create (new workspace), name, ghlLocationId, and ghlPrivateKey are all required.
  const nameField = readOptionalStringField(bodyRaw, "name");
  const nameTouched = nameField.touched && !("error" in nameField) ? nameField.value : undefined;
  const name = normalizeOptionalString(body?.name) ?? "";

  const ghlLocationId = normalizeOptionalString(body?.ghlLocationId) ?? "";

  const ghlPrivateKeyField = readOptionalStringField(bodyRaw, "ghlPrivateKey");
  const ghlPrivateKeyTouched = ghlPrivateKeyField.touched && !("error" in ghlPrivateKeyField) ? ghlPrivateKeyField.value : undefined;
  const ghlPrivateKey = normalizeOptionalString(body?.ghlPrivateKey) ?? "";

  const userId = normalizeOptionalString(body?.userId) ?? null;
  const userEmail = normalizeOptionalString(body?.userEmail) ?? null;

  // ghlLocationId is ALWAYS required (it's the unique identifier)
  if (!ghlLocationId) {
    return NextResponse.json(
      { error: "Missing required field: ghlLocationId" },
      { status: 400 }
    );
  }

  // For upsert, we'll check if the workspace exists first.
  // If it exists, we can update it. If not, we need full creation fields.
  const existingWorkspace = await prisma.client.findUnique({ where: { ghlLocationId } });

  // For create (workspace doesn't exist), name and ghlPrivateKey are required
  if (!existingWorkspace && (!name || !ghlPrivateKey)) {
    return NextResponse.json(
      { error: "Missing required fields for new workspace: name, ghlLocationId, ghlPrivateKey" },
      { status: 400 }
    );
  }

  // User resolution: required for create, optional for update (falls back to existing owner)
  let resolvedUserId: string;
  if (userId || userEmail) {
    const resolvedUser = await resolveUserId({ userId, userEmail });
    if (!resolvedUser.ok) {
      return NextResponse.json({ error: resolvedUser.error }, { status: resolvedUser.status });
    }
    resolvedUserId = resolvedUser.userId;
  } else if (existingWorkspace) {
    // For updates without specifying user, use the existing workspace owner
    resolvedUserId = existingWorkspace.userId;
  } else {
    // Creating new workspace without specifying user
    return NextResponse.json(
      { error: "Missing required field for new workspace: userId or userEmail" },
      { status: 400 }
    );
  }

  const emailProviderField = readOptionalStringField(bodyRaw, "emailProvider");
  if (emailProviderField.touched && "error" in emailProviderField) {
    return NextResponse.json({ error: emailProviderField.error }, { status: 400 });
  }
  const emailProviderTouched = emailProviderField.touched ? emailProviderField.value : undefined;
  const emailProvider = parseEmailProvider(emailProviderTouched);
  if (emailProviderTouched !== undefined && emailProvider === undefined) {
    return NextResponse.json({ error: "emailProvider must be one of EMAILBISON | SMARTLEAD | INSTANTLY | null" }, { status: 400 });
  }

  const emailBisonApiKeyField = readOptionalStringField(bodyRaw, "emailBisonApiKey");
  if (emailBisonApiKeyField.touched && "error" in emailBisonApiKeyField) {
    return NextResponse.json({ error: emailBisonApiKeyField.error }, { status: 400 });
  }
  const emailBisonApiKeyTouched = emailBisonApiKeyField.touched ? emailBisonApiKeyField.value : undefined;

  const emailBisonWorkspaceIdField = readEmailBisonWorkspaceIdField(bodyRaw, "emailBisonWorkspaceId");
  if (emailBisonWorkspaceIdField.touched && "error" in emailBisonWorkspaceIdField) {
    return NextResponse.json({ error: emailBisonWorkspaceIdField.error }, { status: 400 });
  }
  const emailBisonWorkspaceIdTouched = emailBisonWorkspaceIdField.touched ? emailBisonWorkspaceIdField.value : undefined;

  const smartLeadApiKeyField = readOptionalStringField(bodyRaw, "smartLeadApiKey");
  if (smartLeadApiKeyField.touched && "error" in smartLeadApiKeyField) {
    return NextResponse.json({ error: smartLeadApiKeyField.error }, { status: 400 });
  }
  const smartLeadApiKeyTouched = smartLeadApiKeyField.touched ? smartLeadApiKeyField.value : undefined;

  const smartLeadWebhookSecretField = readOptionalStringField(bodyRaw, "smartLeadWebhookSecret");
  if (smartLeadWebhookSecretField.touched && "error" in smartLeadWebhookSecretField) {
    return NextResponse.json({ error: smartLeadWebhookSecretField.error }, { status: 400 });
  }
  const smartLeadWebhookSecretTouched = smartLeadWebhookSecretField.touched ? smartLeadWebhookSecretField.value : undefined;

  const instantlyApiKeyField = readOptionalStringField(bodyRaw, "instantlyApiKey");
  if (instantlyApiKeyField.touched && "error" in instantlyApiKeyField) {
    return NextResponse.json({ error: instantlyApiKeyField.error }, { status: 400 });
  }
  const instantlyApiKeyTouched = instantlyApiKeyField.touched ? instantlyApiKeyField.value : undefined;

  const instantlyWebhookSecretField = readOptionalStringField(bodyRaw, "instantlyWebhookSecret");
  if (instantlyWebhookSecretField.touched && "error" in instantlyWebhookSecretField) {
    return NextResponse.json({ error: instantlyWebhookSecretField.error }, { status: 400 });
  }
  const instantlyWebhookSecretTouched = instantlyWebhookSecretField.touched ? instantlyWebhookSecretField.value : undefined;

  const unipileAccountIdField = readOptionalStringField(bodyRaw, "unipileAccountId");
  if (unipileAccountIdField.touched && "error" in unipileAccountIdField) {
    return NextResponse.json({ error: unipileAccountIdField.error }, { status: 400 });
  }
  const unipileAccountIdTouched = unipileAccountIdField.touched ? unipileAccountIdField.value : undefined;

  const emailBisonBaseHostIdField = readOptionalStringField(bodyRaw, "emailBisonBaseHostId");
  if (emailBisonBaseHostIdField.touched && "error" in emailBisonBaseHostIdField) {
    return NextResponse.json({ error: emailBisonBaseHostIdField.error }, { status: 400 });
  }
  const emailBisonBaseHostIdTouched = emailBisonBaseHostIdField.touched ? emailBisonBaseHostIdField.value : undefined;

  const calendlyAccessTokenField = readOptionalStringField(bodyRaw, "calendlyAccessToken");
  if (calendlyAccessTokenField.touched && "error" in calendlyAccessTokenField) {
    return NextResponse.json({ error: calendlyAccessTokenField.error }, { status: 400 });
  }
  const calendlyAccessTokenTouched = calendlyAccessTokenField.touched ? calendlyAccessTokenField.value : undefined;

  const unipileAccountId = unipileAccountIdTouched ?? null;
  const emailBisonBaseHostId = emailBisonBaseHostIdTouched ?? null;
  const calendlyAccessToken = calendlyAccessTokenTouched ?? null;
  const inboxManagerEmail = normalizeOptionalString(body?.inboxManagerEmail) ?? null;
  const setterEmails = normalizeEmailList(body?.setterEmails);
  const inboxManagerEmails = [
    ...normalizeEmailList(body?.inboxManagerEmails),
    ...(inboxManagerEmail ? [inboxManagerEmail.trim().toLowerCase()] : []),
  ];
  const uniqueInboxManagerEmails = Array.from(new Set(inboxManagerEmails));
  const assignmentsSpecified =
    !!body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    ("setterEmails" in body || "inboxManagerEmails" in body || "inboxManagerEmail" in body);

  // Round-robin settings (parsed at top level, stored in WorkspaceSettings)
  const roundRobinEnabledRaw = body?.roundRobinEnabled;
  const roundRobinEnabled =
    roundRobinEnabledRaw === true ||
    (typeof roundRobinEnabledRaw === "string" && roundRobinEnabledRaw.toLowerCase() === "true");
  const roundRobinEmailOnlyRaw = body?.roundRobinEmailOnly;
  const roundRobinEmailOnly =
    roundRobinEmailOnlyRaw === true ||
    (typeof roundRobinEmailOnlyRaw === "string" && roundRobinEmailOnlyRaw.toLowerCase() === "true");
  const roundRobinSequenceEmails = normalizeEmailList(body?.roundRobinSequenceEmails);
  const roundRobinSpecified =
    !!body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    ("roundRobinEnabled" in body || "roundRobinEmailOnly" in body || "roundRobinSequenceEmails" in body);

  if (emailBisonWorkspaceIdTouched !== undefined && emailBisonWorkspaceIdTouched !== null) {
    const workspaceIdError = validateEmailBisonWorkspaceId(emailBisonWorkspaceIdTouched);
    if (workspaceIdError) {
      return NextResponse.json({ error: workspaceIdError }, { status: 400 });
    }
  }

  const rawSettings = body?.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
    ? (body.settings as Record<string, unknown>)
    : null;
  const settings = rawSettings ? coerceWorkspaceSettings(pickWorkspaceSettings(rawSettings)) : null;
  if (settings) {
    const normalizedCrmWebhook = normalizeCrmWebhookSettingsPatch({
      crmWebhookEnabled: settings.crmWebhookEnabled,
      crmWebhookUrl: settings.crmWebhookUrl,
      crmWebhookEvents: settings.crmWebhookEvents,
      crmWebhookSecret: settings.crmWebhookSecret,
    });
    if (normalizedCrmWebhook.error) {
      return NextResponse.json({ error: normalizedCrmWebhook.error }, { status: 400 });
    }
    Object.assign(settings, normalizedCrmWebhook.values);
  }

  if (settings?.followUpsPausedUntil instanceof Date) {
    if (Number.isNaN(settings.followUpsPausedUntil.getTime())) {
      return NextResponse.json(
        { error: "settings.followUpsPausedUntil must be an ISO date string" },
        { status: 400 }
      );
    }
  }

  for (const numericField of ["calendarSlotsToShow", "calendarLookAheadDays", "meetingDurationMinutes"] as const) {
    const raw = settings?.[numericField];
    if (typeof raw === "number" && raw < 0) {
      return NextResponse.json(
        { error: `settings.${numericField} must be >= 0` },
        { status: 400 }
      );
    }
  }

  try {
    const setterUserIds: string[] = [];
    const inboxManagerUserIds: string[] = [];
    const missingAssignmentEmails: string[] = [];

    for (const email of setterEmails) {
      const resolved = await resolveUserId({ userId: null, userEmail: email });
      if (!resolved.ok) missingAssignmentEmails.push(email);
      else setterUserIds.push(resolved.userId);
    }

    for (const email of uniqueInboxManagerEmails) {
      const resolved = await resolveUserId({ userId: null, userEmail: email });
      if (!resolved.ok) missingAssignmentEmails.push(email);
      else inboxManagerUserIds.push(resolved.userId);
    }

    if (missingAssignmentEmails.length > 0) {
      return NextResponse.json(
        { error: `User(s) not found for assignments: ${missingAssignmentEmails.join(", ")}` },
        { status: 404 }
      );
    }

    // Validate round-robin sequence emails are in setter list
    const setterEmailsSet = new Set(setterEmails);
    const invalidSequenceEmails = roundRobinSequenceEmails.filter((email) => !setterEmailsSet.has(email));
    if (invalidSequenceEmails.length > 0) {
      return NextResponse.json(
        { error: `Round robin sequence email(s) must be included in setter list: ${invalidSequenceEmails.join(", ")}` },
        { status: 400 }
      );
    }

    // Resolve round-robin sequence emails to user IDs (preserving order and duplicates for weighting)
    const roundRobinSequenceUserIds: string[] = [];
    const emailToUserId = new Map<string, string>();
    for (let i = 0; i < setterEmails.length; i++) {
      emailToUserId.set(setterEmails[i], setterUserIds[i]);
    }
    for (const email of roundRobinSequenceEmails) {
      const userId = emailToUserId.get(email);
      if (userId) roundRobinSequenceUserIds.push(userId);
    }

    // Validate emailBisonBaseHostId exists if provided
    if (emailBisonBaseHostId) {
      const baseHostExists = await prisma.emailBisonBaseHost.findUnique({
        where: { id: emailBisonBaseHostId },
        select: { id: true },
      });
      if (!baseHostExists) {
        return NextResponse.json(
          { error: "emailBisonBaseHostId not found" },
          { status: 404 }
        );
      }
    }

    // Use existingWorkspace from earlier lookup for idempotency handling.
    // We reference it as `existing` for brevity in the update logic below.
    const existing = existingWorkspace;

    if (existing) {
      // Don't allow silently reassigning workspaces across owners.
      // If a different user is specified, reject the update.
      if (userId || userEmail) {
        if (existing.userId !== resolvedUserId) {
          return NextResponse.json(
            { error: "Workspace already exists for this locationId under a different user" },
            { status: 409 }
          );
        }
      }

      if (emailBisonWorkspaceIdTouched) {
        const conflict = await prisma.client.findFirst({
          where: {
            emailBisonWorkspaceId: emailBisonWorkspaceIdTouched,
            id: { not: existing.id },
          },
          select: { id: true },
        });
        if (conflict) {
          return NextResponse.json(
            { error: "emailBisonWorkspaceId is already in use by another workspace" },
            { status: 409 }
          );
        }
      }

      const emailIntegrationTouched =
        emailProviderTouched !== undefined ||
        emailBisonApiKeyTouched !== undefined ||
        emailBisonWorkspaceIdTouched !== undefined ||
        emailBisonBaseHostIdTouched !== undefined ||
        smartLeadApiKeyTouched !== undefined ||
        smartLeadWebhookSecretTouched !== undefined ||
        instantlyApiKeyTouched !== undefined ||
        instantlyWebhookSecretTouched !== undefined;

      let emailUpdate: Prisma.ClientUpdateInput = {};
      if (emailIntegrationTouched) {
        if (emailProviderTouched === null) {
          emailUpdate = {
            emailProvider: null,
            emailBisonApiKey: null,
            emailBisonWorkspaceId: null,
            smartLeadApiKey: null,
            smartLeadWebhookSecret: null,
            instantlyApiKey: null,
            instantlyWebhookSecret: null,
          };
        } else {
          const nextSnapshot = {
            emailProvider: emailProvider ?? existing.emailProvider ?? null,
            emailBisonApiKey:
              emailBisonApiKeyTouched !== undefined ? emailBisonApiKeyTouched : existing.emailBisonApiKey,
            emailBisonWorkspaceId:
              emailBisonWorkspaceIdTouched !== undefined ? emailBisonWorkspaceIdTouched : existing.emailBisonWorkspaceId,
            smartLeadApiKey: smartLeadApiKeyTouched !== undefined ? smartLeadApiKeyTouched : existing.smartLeadApiKey,
            smartLeadWebhookSecret:
              smartLeadWebhookSecretTouched !== undefined ? smartLeadWebhookSecretTouched : existing.smartLeadWebhookSecret,
            instantlyApiKey: instantlyApiKeyTouched !== undefined ? instantlyApiKeyTouched : existing.instantlyApiKey,
            instantlyWebhookSecret:
              instantlyWebhookSecretTouched !== undefined ? instantlyWebhookSecretTouched : existing.instantlyWebhookSecret,
          };

          let resolvedProvider: EmailIntegrationProvider | null;
          try {
            resolvedProvider = resolveEmailIntegrationProvider(nextSnapshot);
          } catch (error) {
            return NextResponse.json(
              { error: error instanceof Error ? error.message : "Invalid email integration configuration" },
              { status: 409 }
            );
          }

          if (resolvedProvider === EmailIntegrationProvider.SMARTLEAD || resolvedProvider === EmailIntegrationProvider.INSTANTLY) {
            try {
              assertProviderRequirements(resolvedProvider, {
                smartLeadApiKey: nextSnapshot.smartLeadApiKey || null,
                smartLeadWebhookSecret: nextSnapshot.smartLeadWebhookSecret || null,
                instantlyApiKey: nextSnapshot.instantlyApiKey || null,
                instantlyWebhookSecret: nextSnapshot.instantlyWebhookSecret || null,
              });
            } catch (error) {
              return NextResponse.json(
                { error: error instanceof Error ? error.message : "Invalid email integration configuration" },
                { status: 400 }
              );
            }
          }

          if (resolvedProvider === EmailIntegrationProvider.EMAILBISON) {
            if (
              nextSnapshot.emailBisonWorkspaceId &&
              nextSnapshot.emailBisonWorkspaceId !== existing.emailBisonWorkspaceId
            ) {
              const conflict = await prisma.client.findFirst({
                where: {
                  emailBisonWorkspaceId: nextSnapshot.emailBisonWorkspaceId,
                  id: { not: existing.id },
                },
                select: { id: true },
              });
              if (conflict) {
                return NextResponse.json(
                  { error: "emailBisonWorkspaceId is already in use by another workspace" },
                  { status: 409 }
                );
              }
            }

            emailUpdate = {
              emailProvider: resolvedProvider,
              ...(emailBisonApiKeyTouched !== undefined ? { emailBisonApiKey: emailBisonApiKeyTouched } : {}),
              ...(emailBisonWorkspaceIdTouched !== undefined ? { emailBisonWorkspaceId: emailBisonWorkspaceIdTouched } : {}),
              ...(emailBisonBaseHostIdTouched !== undefined
                ? emailBisonBaseHostIdTouched
                  ? { emailBisonBaseHost: { connect: { id: emailBisonBaseHostIdTouched } } }
                  : { emailBisonBaseHost: { disconnect: true } }
                : {}),
              smartLeadApiKey: null,
              smartLeadWebhookSecret: null,
              instantlyApiKey: null,
              instantlyWebhookSecret: null,
            };
          } else if (resolvedProvider === EmailIntegrationProvider.SMARTLEAD) {
            emailUpdate = {
              emailProvider: resolvedProvider,
              emailBisonApiKey: null,
              emailBisonWorkspaceId: null,
              emailBisonBaseHost: { disconnect: true },
              ...(smartLeadApiKeyTouched !== undefined ? { smartLeadApiKey: smartLeadApiKeyTouched } : {}),
              ...(smartLeadWebhookSecretTouched !== undefined ? { smartLeadWebhookSecret: smartLeadWebhookSecretTouched } : {}),
              instantlyApiKey: null,
              instantlyWebhookSecret: null,
            };
          } else if (resolvedProvider === EmailIntegrationProvider.INSTANTLY) {
            emailUpdate = {
              emailProvider: resolvedProvider,
              emailBisonApiKey: null,
              emailBisonWorkspaceId: null,
              emailBisonBaseHost: { disconnect: true },
              smartLeadApiKey: null,
              smartLeadWebhookSecret: null,
              ...(instantlyApiKeyTouched !== undefined ? { instantlyApiKey: instantlyApiKeyTouched } : {}),
              ...(instantlyWebhookSecretTouched !== undefined ? { instantlyWebhookSecret: instantlyWebhookSecretTouched } : {}),
            };
          } else {
            emailUpdate = {
              emailProvider: null,
              emailBisonApiKey: null,
              emailBisonWorkspaceId: null,
              emailBisonBaseHost: { disconnect: true },
              smartLeadApiKey: null,
              smartLeadWebhookSecret: null,
              instantlyApiKey: null,
              instantlyWebhookSecret: null,
            };
          }
        }
      }

		      if (upsert) {
		        const updated = await prisma.$transaction(async (tx) => {
		          const workspace = await tx.client.update({
	            where: { id: existing.id },
	            data: {
	              // Only update name/ghlPrivateKey if explicitly provided in the request
	              ...(nameTouched !== undefined ? { name: nameTouched || existing.name } : {}),
	              ...(ghlPrivateKeyTouched !== undefined ? { ghlPrivateKey: ghlPrivateKeyTouched || existing.ghlPrivateKey } : {}),
	              ...emailUpdate,
	              ...(unipileAccountIdTouched !== undefined ? { unipileAccountId: unipileAccountIdTouched } : {}),
	              ...(calendlyAccessTokenTouched !== undefined
	                ? {
	                    calendlyAccessToken: calendlyAccessTokenTouched,
	                    ...(calendlyAccessTokenTouched === null
	                      ? {
	                          calendlyUserUri: null,
	                          calendlyOrganizationUri: null,
	                          calendlyWebhookSubscriptionUri: null,
	                          calendlyWebhookSigningKey: null,
	                        }
	                      : {}),
	                  }
	                : {}),
	            },
	            select: {
	              id: true,
	              name: true,
	              userId: true,
              ghlLocationId: true,
              emailProvider: true,
              emailBisonWorkspaceId: true,
              unipileAccountId: true,
              createdAt: true,
              updatedAt: true,
            },
          });

          const roundRobinSettings = roundRobinSpecified
            ? {
                roundRobinEnabled,
                roundRobinEmailOnly,
                roundRobinSetterSequence: roundRobinSequenceUserIds,
                ...(roundRobinSequenceUserIds.length > 0 ? { roundRobinLastSetterIndex: -1 } : {}),
              }
            : {};

          await tx.workspaceSettings.upsert({
            where: { clientId: existing.id },
            create: { clientId: existing.id, ...(settings ?? {}), ...roundRobinSettings },
            update: { ...(settings ?? {}), ...roundRobinSettings },
          });

          const reactivationCount = await tx.reactivationCampaign.count({ where: { clientId: existing.id } });
          if (reactivationCount === 0) {
            await tx.reactivationCampaign.create({
              data: {
                clientId: existing.id,
                name: "Reactivation",
                isActive: true,
                dailyLimitPerSender: 5,
                bumpMessageTemplate:
                  "Hey {firstName} — just bumping this. Is it worth discussing this now, or should I circle back later?",
              },
            });
          }

          if (assignmentsSpecified) {
            await tx.clientMember.deleteMany({
              where: { clientId: existing.id, role: { in: [ClientMemberRole.SETTER, ClientMemberRole.INBOX_MANAGER] } },
            });

            const rows = [
              ...setterUserIds.map((userId) => ({ clientId: existing.id, userId, role: ClientMemberRole.SETTER })),
              ...inboxManagerUserIds.map((userId) => ({
                clientId: existing.id,
                userId,
                role: ClientMemberRole.INBOX_MANAGER,
              })),
            ];
            if (rows.length > 0) {
              await tx.clientMember.createMany({ data: rows, skipDuplicates: true });
            }
          }

	          return workspace;
	        });

	        const before = (existing.unipileAccountId ?? "").trim();
	        const after = (updated.unipileAccountId ?? "").trim();
	        if (!before && after) {
	          await ensureDefaultSequencesIncludeLinkedInStepsForClient({ prisma, clientId: updated.id });
	        }

	        await ensureReengagementFollowUpSequenceForClient({ prisma, clientId: updated.id }).catch((error) => {
	          console.warn("[Provision Workspace] Failed to seed re-engagement follow-up template:", error);
	        });

	        return NextResponse.json({ success: true, existed: true, updated: true, workspace: updated }, { status: 200 });
	      }

      return NextResponse.json(
        {
          success: true,
          existed: true,
          updated: false,
          workspace: {
            id: existing.id,
            name: existing.name,
            userId: existing.userId,
            ghlLocationId: existing.ghlLocationId,
            emailProvider: existing.emailProvider,
            emailBisonWorkspaceId: existing.emailBisonWorkspaceId,
            unipileAccountId: existing.unipileAccountId,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
          },
        },
        { status: 200 }
      );
    }

    const createEmailBisonWorkspaceId =
      emailBisonWorkspaceIdTouched !== undefined ? emailBisonWorkspaceIdTouched : normalizeEmailBisonWorkspaceId(body?.emailBisonWorkspaceId) ?? null;

    const createSnapshot = {
      emailProvider: emailProvider ?? undefined,
      emailBisonApiKey: emailBisonApiKeyTouched ?? normalizeOptionalString(body?.emailBisonApiKey) ?? null,
      emailBisonWorkspaceId: createEmailBisonWorkspaceId,
      smartLeadApiKey: smartLeadApiKeyTouched ?? normalizeOptionalString(body?.smartLeadApiKey) ?? null,
      smartLeadWebhookSecret: smartLeadWebhookSecretTouched ?? normalizeOptionalString(body?.smartLeadWebhookSecret) ?? null,
      instantlyApiKey: instantlyApiKeyTouched ?? normalizeOptionalString(body?.instantlyApiKey) ?? null,
      instantlyWebhookSecret: instantlyWebhookSecretTouched ?? normalizeOptionalString(body?.instantlyWebhookSecret) ?? null,
    };

    let createProvider: EmailIntegrationProvider | null;
    try {
      createProvider = resolveEmailIntegrationProvider(createSnapshot);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid email integration configuration" },
        { status: 409 }
      );
    }

    if (createProvider === EmailIntegrationProvider.SMARTLEAD || createProvider === EmailIntegrationProvider.INSTANTLY) {
      try {
        assertProviderRequirements(createProvider, {
          smartLeadApiKey: createSnapshot.smartLeadApiKey || null,
          smartLeadWebhookSecret: createSnapshot.smartLeadWebhookSecret || null,
          instantlyApiKey: createSnapshot.instantlyApiKey || null,
          instantlyWebhookSecret: createSnapshot.instantlyWebhookSecret || null,
        });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid email integration configuration" },
          { status: 400 }
        );
      }
    }

    if (createProvider === EmailIntegrationProvider.EMAILBISON && createEmailBisonWorkspaceId) {
      const existingByWorkspaceId = await prisma.client.findUnique({
        where: { emailBisonWorkspaceId: createEmailBisonWorkspaceId },
        select: { id: true },
      });
      if (existingByWorkspaceId) {
        return NextResponse.json(
          { error: "emailBisonWorkspaceId is already in use by another workspace" },
          { status: 409 }
        );
      }
    }

	    const created = await prisma.$transaction(async (tx) => {
	      const workspace = await tx.client.create({
        data: {
          name,
          ghlLocationId,
          ghlPrivateKey,
          emailProvider: createProvider,
          emailBisonApiKey: createProvider === EmailIntegrationProvider.EMAILBISON ? (createSnapshot.emailBisonApiKey as string | null) : null,
          emailBisonWorkspaceId: createProvider === EmailIntegrationProvider.EMAILBISON ? (createSnapshot.emailBisonWorkspaceId as string | null) : null,
          ...(createProvider === EmailIntegrationProvider.EMAILBISON && emailBisonBaseHostId
            ? { emailBisonBaseHost: { connect: { id: emailBisonBaseHostId } } }
            : {}),
          smartLeadApiKey: createProvider === EmailIntegrationProvider.SMARTLEAD ? (createSnapshot.smartLeadApiKey as string | null) : null,
          smartLeadWebhookSecret: createProvider === EmailIntegrationProvider.SMARTLEAD ? (createSnapshot.smartLeadWebhookSecret as string | null) : null,
          instantlyApiKey: createProvider === EmailIntegrationProvider.INSTANTLY ? (createSnapshot.instantlyApiKey as string | null) : null,
          instantlyWebhookSecret: createProvider === EmailIntegrationProvider.INSTANTLY ? (createSnapshot.instantlyWebhookSecret as string | null) : null,
          unipileAccountId,
          calendlyAccessToken,
          userId: resolvedUserId,
        },
        select: {
          id: true,
          name: true,
          userId: true,
          ghlLocationId: true,
          emailProvider: true,
          emailBisonWorkspaceId: true,
          unipileAccountId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const createRoundRobinSettings = roundRobinSpecified
        ? {
            roundRobinEnabled,
            roundRobinEmailOnly,
            roundRobinSetterSequence: roundRobinSequenceUserIds,
            ...(roundRobinSequenceUserIds.length > 0 ? { roundRobinLastSetterIndex: -1 } : {}),
          }
        : {};

      await tx.workspaceSettings.create({
        data: {
          clientId: workspace.id,
          ...(settings ?? {}),
          ...createRoundRobinSettings,
        },
      });

      await tx.reactivationCampaign.create({
        data: {
          clientId: workspace.id,
          name: "Reactivation",
          isActive: true,
          dailyLimitPerSender: 5,
          bumpMessageTemplate:
            "Hey {firstName} — just bumping this. Is it worth discussing this now, or should I circle back later?",
        },
      });

      if (assignmentsSpecified) {
        const rows = [
          ...setterUserIds.map((userId) => ({ clientId: workspace.id, userId, role: ClientMemberRole.SETTER })),
          ...inboxManagerUserIds.map((userId) => ({ clientId: workspace.id, userId, role: ClientMemberRole.INBOX_MANAGER })),
        ];
        if (rows.length > 0) {
          await tx.clientMember.createMany({ data: rows, skipDuplicates: true });
        }
      }

	      return workspace;
	    });

	    if ((created.unipileAccountId ?? "").trim()) {
	      await ensureDefaultSequencesIncludeLinkedInStepsForClient({ prisma, clientId: created.id });
	    }

	    await ensureReengagementFollowUpSequenceForClient({ prisma, clientId: created.id }).catch((error) => {
	      console.warn("[Provision Workspace] Failed to seed re-engagement follow-up template:", error);
	    });

	    return NextResponse.json({ success: true, existed: false, workspace: created }, { status: 201 });
	  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Unique constraint violation (race condition)
      return NextResponse.json({ error: "Workspace already exists (unique constraint)" }, { status: 409 });
    }

    console.error("[Provision Workspace] error:", error);
    return NextResponse.json(
      { error: "Failed to provision workspace" },
      { status: 500 }
    );
  }
}
