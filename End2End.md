# ZRG Dashboard — End-to-End Guide (Strict RRO)

> This document is written in **Strict Recursive Reasoning Operator (RRO)** format.
> Every section is source-grounded with minimal excerpts and explicit confidence scoring.

## 1) System Definition / What This Product Is

### PLAN
- Define what the ZRG Dashboard is (as a product/system).
- Identify the core channels/integrations and what they unify into.
- Identify the major capabilities (AI, follow-ups, booking) and how they relate at a high level.
- Identify what is explicitly not complete yet (per repo docs).

### LOCATE
- `README.md`: keywords `Master Inbox`, `Architecture`, `Core Integrations`, `Current Status`
- `AGENTS.md`: keywords `What This Repo Is`, `Key Flows`

### EXTRACT
- **E1 — `README.md:1-6`**
  ```md
  # ZRG AI Master Inbox & CRM Dashboard

  A scalable, full-stack application designed to manage high-volume sales outreach. This system replaces legacy n8n/Airtable workflows by unifying Email, SMS (GoHighLevel), and LinkedIn conversations into a single "Master Inbox" with AI-driven sentiment analysis, automatic drafting, and campaign management.

  **Current Status:** Phases I–IV complete for core operations (SMS + Email inbox, follow-up automation, LinkedIn outbound via Unipile, calendar availability + booking). LinkedIn inbound ingestion is still pending.
  ```
- **E2 — `README.md:11-23`**
  ```md
  ## 🏗 Architecture

  | Layer | Technology |
  |-------|------------|
  | **Frontend** | Next.js 16 (App Router), Tailwind CSS, Shadcn UI, Lucide Icons |
  | **Backend** | Next.js Server Actions & API Routes |
  | **Database** | Supabase (PostgreSQL) with Prisma ORM |
  | **AI Engine** | OpenAI (GPT-5.1 / GPT-5-mini / GPT 5-nano) |
  | **Hosting** | Vercel (Serverless) |
  | **Email Platform** | EmailBison (Inboxxia) / SmartLead / Instantly - Cold email campaigns & replies |
  | **SMS Platform** | GoHighLevel (GHL) - SMS messaging & CRM sync |
  | **LinkedIn Platform** | Unipile - LinkedIn connection requests + DMs |
  ```
- **E3 — `AGENTS.md:20-28`**
  ```md
  ## What This Repo Is

  ZRG Dashboard unifies **SMS (GoHighLevel)**, **Email (Inboxxia/EmailBison)**, and **LinkedIn outbound (Unipile)** into a single “Master Inbox” with:

  - AI sentiment classification
  - AI draft generation (human-approve workflow)
  - optional auto-replies (with safety gating)
  - follow-up sequences (cron-driven)
  - calendar availability + booking automation
  ```
- **E4 — `README.md:99-137`**
  ```md
  ## 🔌 Core Integrations

  ### GoHighLevel (SMS)
  - **Webhook:** `/api/webhooks/ghl/sms?locationId={GHL_LOCATION_ID}`
  - **Auth:** Private Integration API Key per workspace

  ### Email Providers (EmailBison / SmartLead / Instantly)
  - **Single-select per workspace:** configure exactly one provider via `Client.emailProvider` (the server rejects multiple configured providers).
  - **EmailBison (Inboxxia)**
    - **Webhook:** `/api/webhooks/email` (optionally `?clientId={ZRG_CLIENT_ID}`)
  - **SmartLead**
    - **Webhook:** `/api/webhooks/smartlead?clientId={ZRG_CLIENT_ID}`
  - **Instantly**
    - **Webhook:** `/api/webhooks/instantly?clientId={ZRG_CLIENT_ID}`

  ### Unipile (LinkedIn)
  - **Auth:** `UNIPILE_DSN` + `UNIPILE_API_KEY` (global) + per-workspace `Client.unipileAccountId`
  ```

### SOLVE (Confidence: 0.9)
- The product is a “Master Inbox & CRM Dashboard” that **unifies Email, SMS (GoHighLevel), and LinkedIn conversations** and adds **AI-driven sentiment + drafting** to help manage high-volume outreach. (E1)
- The stack is **Next.js 16 App Router** (UI + API routes + Server Actions) with **Supabase Postgres + Prisma**, hosted on **Vercel**, using **OpenAI** models for AI features. (E2)
- Core capabilities called out in repo docs: sentiment classification, draft generation with a human-approve workflow, optional auto-replies with gating, follow-up sequences, and availability/booking automation. (E3)
- Integrations are explicitly tied to webhook ingestion endpoints for GHL + email providers, and Unipile is used for LinkedIn (outbound). (E4)
- Repo docs state LinkedIn inbound ingestion is still pending. (E1)

### VERIFY
- The “LinkedIn inbound ingestion is still pending” statement is explicitly documented, so any end-to-end model must treat LinkedIn inbound as not guaranteed. (E1)
- The AI model names listed are specific (GPT-5.1 / GPT-5-mini / GPT 5-nano); if production has changed models, this document should be updated at the source (`README.md`). (E2)

### SYNTHESIZE
- **Mental model:** multi-channel inbound (webhooks) → normalize into a single Lead+Message thread → AI pipeline produces sentiment and drafts → human or AI sends replies → follow-up automation and booking logic run on top of the same unified record.
- **Where to look in code (entry points):**
  - Product overview / claims: `README.md`
  - Canonical schema: `prisma/schema.prisma`
  - Webhooks: `app/api/webhooks/*`
  - Core logic: `lib/*`
  - UI + actions: `components/dashboard/*`, `actions/*`

## 2) Tenancy + Auth + Access Control

### PLAN
- Identify how authentication works (browser session + server-side checks).
- Identify what a “workspace” is in the data model and how users gain access to it.
- Identify how roles are derived (OWNER vs ClientMember roles) and how “admin access” is enforced.
- Identify how the dashboard decides the active workspace (including deep links).

### LOCATE
- `middleware.ts`, `lib/supabase/middleware.ts`: keywords `updateSession`, `/api`, `/auth/login`, auth cookie
- `lib/workspace-access.ts`: keywords `requireAuthUser`, `getAccessibleClientIdsForUser`, `requireClientAdminAccess`, `getUserRoleForClient`, `ROLE_PRECEDENCE`
- `prisma/schema.prisma`: keywords `model Client`, `model ClientMember`, `userId`, `role`
- `app/page.tsx`: keywords `activeWorkspace`, `clientId`, `getClients`, `settingsTab`

### EXTRACT
- **E1 — `middleware.ts:1-9`**
  ```ts
  import { type NextRequest } from "next/server";
  import { updateSession } from "@/lib/supabase/middleware";

  export async function middleware(request: NextRequest) {
    return await updateSession(request);
  }
  ```
- **E2 — `lib/supabase/middleware.ts:125-151`**
  ```ts
  export async function updateSession(request: NextRequest) {
    // Middleware runs for every request matched by `middleware.ts`. Avoid doing network work
    // for API routes (webhooks/cron), which can be hot paths and don't need browser session refresh.
    if (request.nextUrl.pathname.startsWith("/api")) {
      return NextResponse.next({ request });
    }

    let supabaseResponse = NextResponse.next({
      request,
    });

    // Fast-path: if there is no Supabase auth cookie, skip creating a client and any network calls.
    // This avoids noisy auth refresh attempts for signed-out users (e.g. refresh_token_not_found).
    const isAuthPage = request.nextUrl.pathname.startsWith("/auth");
    const isApiRoute = request.nextUrl.pathname.startsWith("/api");
    const isPublicRoute = isAuthPage || isApiRoute;
    const isAuthCallbackRoute = request.nextUrl.pathname === "/auth/callback";
    const isResetPasswordRoute = request.nextUrl.pathname === "/auth/reset-password";

    if (!hasSupabaseAuthCookie(request)) {
      if (!isPublicRoute) {
        const url = request.nextUrl.clone();
        url.pathname = "/auth/login";
        return NextResponse.redirect(url);
      }

      return supabaseResponse;
    }
  ```
- **E3 — `lib/workspace-access.ts:11-57`**
  ```ts
  export async function requireAuthUser(): Promise<AuthUser> {
    const supabase = await createSupabaseClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error("Not authenticated");
    return { id: user.id, email: user.email ?? null };
  }

  export async function getAccessibleClientIdsForUser(userId: string): Promise<string[]> {
    const [owned, member] = await Promise.all([
      prisma.client.findMany({ where: { userId }, select: { id: true } }),
      prisma.clientMember.findMany({ where: { userId }, select: { clientId: true } }),
    ]);
    const ids = new Set<string>();
    for (const row of owned) ids.add(row.id);
    for (const row of member) ids.add(row.clientId);
    return Array.from(ids);
  }

  export async function requireClientAccess(clientId: string) {
    const user = await requireAuthUser();
    const accessible = await getAccessibleClientIdsForUser(user.id);
    if (!accessible.includes(clientId)) throw new Error("Unauthorized");
    return { userId: user.id, userEmail: user.email };
  }
  ```
- **E4 — `lib/workspace-access.ts:59-77`**
  ```ts
  export async function requireClientAdminAccess(clientId: string) {
    const user = await requireAuthUser();
    const [client, adminMembership] = await Promise.all([
      prisma.client.findUnique({ where: { id: clientId }, select: { userId: true } }),
      prisma.clientMember.findFirst({
        where: { clientId, userId: user.id, role: ClientMemberRole.ADMIN },
        select: { id: true },
      }),
    ]);
    if (!client) throw new Error("Workspace not found");
    if (client.userId !== user.id && !adminMembership) throw new Error("Unauthorized");
    return { userId: user.id, userEmail: user.email };
  }
  ```
- **E5 — `lib/workspace-access.ts:117-175`**
  ```ts
  export type UserRole = ClientMemberRole | "OWNER";
  const ROLE_PRECEDENCE: Record<UserRole, number> = {
    OWNER: 4,
    ADMIN: 4,
    INBOX_MANAGER: 3,
    SETTER: 1,
  };

  export async function getUserRoleForClient(userId: string, clientId: string): Promise<UserRole | null> {
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { userId: true } });
    if (client?.userId === userId) return "OWNER";

    const memberships = await prisma.clientMember.findMany({ where: { clientId, userId }, select: { role: true } });
    if (memberships.length === 0) return null;

    let bestRole: UserRole = memberships[0].role;
    for (const membership of memberships) {
      if (ROLE_PRECEDENCE[membership.role] > ROLE_PRECEDENCE[bestRole]) bestRole = membership.role;
    }
    return bestRole;
  }
  ```
- **E6 — `prisma/schema.prisma:137-174`**
  ```prisma
  model Client {
    id            String              @id @default(uuid())
    name          String
    ghlLocationId String?             @unique // Used to identify which client sent the webhook
    ghlPrivateKey String?             // The generic API key for this sub-account
    // Email integrations (single-select; EmailBison | SmartLead | Instantly)
    emailProvider         EmailIntegrationProvider?
    emailBisonApiKey     String?
    emailBisonWorkspaceId String?     @unique // EmailBison workspace ID for webhook matching
    emailBisonBaseHostId  String?
    smartLeadApiKey       String?
    smartLeadWebhookSecret String?
    instantlyApiKey       String?
    instantlyWebhookSecret String?
    // Slack integration (workspace-level)
    slackBotToken     String?
    // Resend integration (workspace-level)
    resendApiKey      String?
    resendFromEmail   String?
    userId        String              // Supabase Auth user ID - ties workspace to user
    // LinkedIn/Unipile integration (per-workspace account)
    unipileAccountId        String?      // Unipile account ID for LinkedIn messaging
    // Calendly integration (per-workspace)
    calendlyAccessToken          String?
    createdAt     DateTime            @default(now())
    updatedAt     DateTime            @updatedAt
    members       ClientMember[]
    leads         Lead[]
  }
  ```
- **E7 — `prisma/schema.prisma:204-216`**
  ```prisma
  model ClientMember {
    id        String           @id @default(uuid())
    clientId  String
    userId    String           // Supabase Auth user ID
    role      ClientMemberRole

    client Client @relation(fields: [clientId], references: [id], onDelete: Cascade)

    @@unique([clientId, userId, role])
    @@index([userId])
    @@index([clientId])
  }
  ```
- **E8 — `app/page.tsx:35-53`**
  ```ts
  // If a deep-link includes clientId, initialize the workspace immediately...
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(() => {
    const clientIdParam = searchParams.get("clientId")
    return clientIdParam ? clientIdParam : null
  })

  const syncWorkspaces = (nextWorkspaces: Client[]) => {
    setWorkspaces(nextWorkspaces)
    setActiveWorkspace((prev) => {
      if (nextWorkspaces.length === 0) return null
      if (!prev) return nextWorkspaces[0].id
      if (nextWorkspaces.some((w) => w.id === prev)) return prev
      return nextWorkspaces[0].id
    })
  }
  ```

### SOLVE (Confidence: 0.9)
- **Authentication** is Supabase-based: server code calls `supabase.auth.getUser()` and treats missing/errored user as “Not authenticated”. (E3)
- **Route protection** is enforced by middleware that:
  - skips `/api/*` paths (webhooks/cron) entirely, and
  - redirects non-public routes to `/auth/login` when no Supabase auth cookie is present. (E1, E2)
- A “workspace” is the `Client` model tied to a Supabase auth `userId` (the owner), with additional members stored in `ClientMember`. (E6, E7)
- Workspace access is computed as `owned ∪ member` client IDs, and many operations check this list. (E3)
- “Admin” access is granted to either the `Client.userId` owner or a `ClientMember` row with role `ADMIN`. (E4)
- Effective per-workspace role treats `OWNER` as a derived role and uses precedence among multiple memberships. (E5)
- The dashboard’s active workspace selection supports deep linking via `?clientId=...` and otherwise falls back to the first accessible workspace. (E8)

### VERIFY
- Middleware explicitly skips `/api/*`, so webhook/cron endpoints must implement their own auth/secret checks (documented later in Cron/Webhooks sections). (E2)
- Database-level authorization (RLS policies) is not covered by these excerpts; it must be verified via Supabase policy inspection (covered in Section 15). (E2)

### SYNTHESIZE
- **Mental model:** “Client” is the tenant/workspace boundary; the owner is `Client.userId`, and additional access is through `ClientMember` roles.
- **Debugging checkpoints:**
  - “Why am I redirected to login?” → middleware cookie check + Supabase session (`middleware.ts`, `lib/supabase/middleware.ts`). (E1, E2)
  - “Why can’t this user see a workspace?” → `getAccessibleClientIdsForUser()` (owned vs member). (E3)
  - “Why can’t this user change settings?” → `requireClientAdminAccess()` and role precedence. (E4, E5)

## 3) Settings Surface Area (General / Integrations / AI / Booking / Team)

### PLAN
- Enumerate the Settings tabs and what they expose in the UI.
- Identify which settings are “workspace-level” (stored in DB) vs informational/UI-only.
- Connect Settings UI to the canonical schema fields that represent “settings”.
- Identify role/capability gating in Settings (who can edit what, and who is read-only).

### LOCATE
- `components/dashboard/settings-view.tsx`: keywords `TabsTrigger`, `isClientPortalUser`, `SecretInput`, `AiPersonaManager`, `BookingProcessManager`, `WorkspaceMembersManager`, `ClientPortalUsersManager`
- `prisma/schema.prisma`: `model WorkspaceSettings` (AI personality, automation, notifications, schedule, booking)
- `app/page.tsx`: keywords `settingsTabParam` (deep-link tab allowlist)

### EXTRACT
- **E1 — `components/dashboard/settings-view.tsx:2051-2072`**
  ```tsx
  <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-6">
    <TabsList className="grid w-full max-w-4xl grid-cols-5">
      <TabsTrigger value="general">General</TabsTrigger>
      <TabsTrigger value="integrations">Integrations</TabsTrigger>
      <TabsTrigger value="ai">AI Personality</TabsTrigger>
      <TabsTrigger value="booking">Booking</TabsTrigger>
      <TabsTrigger value="team">Team</TabsTrigger>
    </TabsList>

    {isClientPortalUser ? (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-amber-200">
            <Lock className="h-5 w-5 text-amber-200" />
            Read-only settings
          </CardTitle>
          <CardDescription className="text-amber-200/70">
            Settings are read-only for client portal users. Request changes from ZRG.
          </CardDescription>
        </CardHeader>
      </Card>
    ) : null}
  ```
- **E2 — `components/dashboard/settings-view.tsx:3268-3334`**
  ```tsx
  {/* Integrations */}
  <TabsContent value="integrations" className="space-y-6">
    <fieldset disabled={isClientPortalUser} className="space-y-6">
    {/* GHL Workspaces - Dynamic Multi-Tenancy */}
    <IntegrationsManager onWorkspacesChange={onWorkspacesChange} />

    {/* Slack (bot token + channel selector) */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--brand-slack-bg)]">
            <MessageSquare className="h-5 w-5 text-[color:var(--brand-slack)]" />
          </div>
          <span>Slack Notifications</span>
        </CardTitle>
        <CardDescription>Send notifications to a selected Slack channel using a bot token</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!activeWorkspace ? (
          <p className="text-sm text-muted-foreground">Select a workspace to configure Slack.</p>
        ) : !isWorkspaceAdmin ? (
          <p className="text-sm text-muted-foreground">Only workspace admins can change Slack settings.</p>
        ) : (
          <>
            <Accordion type="multiple" defaultValue={["bot-config"]} className="w-full">
              <AccordionItem value="bot-config">
                <AccordionTrigger>
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4" />
                    <span>Bot Configuration</span>
                    {slackTokenStatus?.configured ? (
                      <Badge variant="secondary" className="ml-2">Connected</Badge>
                    ) : null}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2">
                    <Label>Slack Bot Token</Label>
                    <div className="flex gap-2">
                      <SecretInput
                        placeholder={slackTokenStatus?.configured ? slackTokenStatus.masked || "Configured" : "xoxb-..."}
                        value={slackTokenDraft}
                        onChange={(e) => setSlackTokenDraft(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        onClick={handleSaveSlackToken}
                        disabled={isSavingSlackToken || !slackTokenDraft.trim()}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
  ```
- **E3 — `components/dashboard/settings-view.tsx:4457-4517`**
  ```tsx
  {/* AI Personality */}
  <TabsContent value="ai" className="space-y-6">
    <fieldset disabled={isClientPortalUser} className="space-y-6">
    {/* AI Personas Manager (Phase 39) */}
    {isClientPortalUser ? (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            AI Personality (Read-only)
          </CardTitle>
          <CardDescription>Request changes from ZRG.</CardDescription>
        </CardHeader>
      </Card>
    ) : (
      <AiPersonaManager activeWorkspace={activeWorkspace} />
    )}

    {/* Workspace-Level Settings Card (Qualification Questions, Knowledge Assets) */}
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5" />
          Workspace Settings
        </CardTitle>
        <CardDescription>
          Settings shared across all personas (qualification questions, knowledge assets)
        </CardDescription>
      </CardHeader>
  ```
- **E4 — `components/dashboard/settings-view.tsx:6144-6173`**
  ```tsx
  {/* Booking Processes (Phase 36) */}
  <TabsContent value="booking" className="space-y-6">
    <fieldset disabled={isClientPortalUser} className="space-y-6">
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <AlertTriangle className="h-4 w-4 text-amber-500" />
      <AlertTitle>Booking configuration notes</AlertTitle>
      <AlertDescription>
        <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
          <li>
            Process 5 (lead scheduler links) is manual-review for now. We capture the lead&apos;s link and create a task for
            review with overlap suggestions when possible.
          </li>
        </ul>
      </AlertDescription>
    </Alert>

    {/* Booking Processes Reference (Phase 60) */}
    <BookingProcessReference />

    <BookingProcessManager
      activeWorkspace={activeWorkspace}
      qualificationQuestions={qualificationQuestions}
    />

    {/* Campaign Assignment Panel - moved here for booking context */}
    <AiCampaignAssignmentPanel activeWorkspace={activeWorkspace} />
  ```
- **E5 — `components/dashboard/settings-view.tsx:6177-6189`**
  ```tsx
  {/* Team Management */}
  <TabsContent value="team" className="space-y-6">
    <fieldset disabled={isClientPortalUser} className="space-y-6">
      {!isClientPortalUser ? (
        <>
          <WorkspaceMembersManager
            activeWorkspace={activeWorkspace ?? null}
            isWorkspaceAdmin={isWorkspaceAdmin}
          />
          <ClientPortalUsersManager
            activeWorkspace={activeWorkspace ?? null}
            isWorkspaceAdmin={isWorkspaceAdmin}
          />
        </>
      ) : null}
  ```
- **E6 — `prisma/schema.prisma:243-276`**
  ```prisma
  // Workspace-specific settings (AI personality, automation, etc.)
  model WorkspaceSettings {
    id                   String   @id @default(uuid())
    clientId             String   @unique // Links to workspace
    // AI Personality Settings
    aiPersonaName        String?
    aiTone               String?  @default("friendly-professional")
    aiGreeting           String?  // Default greeting for Email channel
    aiSmsGreeting        String?  // Default greeting for SMS channel (falls back to aiGreeting if null)
    aiSignature          String?  @db.Text
    aiGoals              String?  @db.Text
    // AI Context Fields (for better AI responses)
    serviceDescription      String?  @db.Text  // Business/service description for AI context
    qualificationQuestions  String?  @db.Text  // JSON array of qualification questions
    idealCustomerProfile    String?  @db.Text  // Ideal Customer Profile for lead scoring (Phase 33)
    // Company/Outreach Context
    companyName             String?             // Company name for {company} variable in templates
    targetResult            String?  @db.Text   // Outcome/result for {result} variable (e.g., "growing your client base")
    // Automation Rules
    autoApproveMeetings  Boolean  @default(true)
    flagUncertainReplies Boolean  @default(true)
  ```
- **E7 — `app/page.tsx:118-130`**
  ```ts
  if (
    viewParam === "settings" &&
    (settingsTabParam === "general" ||
      settingsTabParam === "integrations" ||
      settingsTabParam === "ai" ||
      settingsTabParam === "team")
  ) {
    setSettingsTab(settingsTabParam)
  }
  ```

### SOLVE (Confidence: 0.9)
- The Settings UI is organized into five tabs: **General**, **Integrations**, **AI Personality**, **Booking**, and **Team**. (E1)
- Client portal users are treated as **read-only** in Settings: a top-level banner is shown and tab contents are wrapped in `<fieldset disabled={isClientPortalUser}>`. (E1, E3, E4, E5)
- The Integrations tab includes workspace integrations management and Slack configuration that is gated by workspace selection + admin capability, and uses `SecretInput` + brand tokens for a safer, more recognizable UX. (E2)
- The AI Personality tab renders a read-only summary card for client portal users, and otherwise renders `AiPersonaManager` + workspace-level settings (qualification questions, knowledge assets). (E3)
- The Booking tab centralizes booking configuration: booking notices, the booking process editor, and campaign assignment. Booking analytics are in the Analytics view (see Section 18). (E4)
- The Team tab includes both internal team member provisioning and client portal user provisioning, with admin gating. (E5)
- The canonical “settings” data model lives primarily in `WorkspaceSettings` (AI persona fields, company context, automation toggles, booking configuration, schedule/timezone, notification settings). (E6)
- Deep-linking the Settings tab via URL only supports `general|integrations|ai|team` (booking is not included in the allowlist). (E7)

### VERIFY
- **Potential mismatch:** the Settings UI has a `booking` tab (E1), but the dashboard deep-link allowlist omits it (E7), so `?view=settings&settingsTab=booking` will not be honored.
- Client portal users see both global read-only treatment (banner + disabled fieldsets) and tab-specific read-only UI (AI tab summary card). Ensure `isClientPortalUser` capability is derived consistently server-side and client-side. (E1, E3)

### SYNTHESIZE
- **Mental model:** Settings is a mix of (a) workspace-level integration credentials (`Client`), (b) workspace-level behavioral controls (`WorkspaceSettings`), and (c) feature-specific managers (AI Personas, Booking Processes, Team provisioning).
- **Debugging checkpoints:**
  - “Why can’t I edit Slack settings?” → Integrations tab role gating (`settings-view.tsx`), plus admin checks (Section 2). (E2)
  - “Where is this setting stored?” → `WorkspaceSettings` fields in `prisma/schema.prisma`. (E6)
  - “Why doesn’t a booking deep link work?” → Settings tab allowlist in `app/page.tsx`. (E7)

## 4) Integrations Map (Credentials → Storage → Runtime Usage)

### PLAN
- Identify which integration credentials/configs exist per workspace.
- Identify where they are configured in the UI and where they are stored in the DB schema.
- Identify how the app enforces “safe configuration” (e.g., single-select email provider).
- Identify runtime usage points (API clients, webhooks, notifications).

### LOCATE
- `prisma/schema.prisma`: `model Client` (integration credentials) + `model EmailBisonBaseHost`
- `components/dashboard/settings/integrations-manager.tsx`: form fields for workspace integrations
- `actions/client-actions.ts`: create/update workspace; email provider resolution; Calendly token clearing
- `lib/email-integration.ts`: single-select email provider enforcement
- `actions/slack-integration-actions.ts` + `lib/slack-dm.ts`: Slack workspace token vs global DM-by-email token usage
- `lib/unipile-api.ts`: Unipile environment configuration
- `actions/calendly-actions.ts`: Calendly webhook subscription + signing key storage
- `actions/resend-integration-actions.ts`: Resend credential storage
- (Runtime usage is primarily via) `app/api/webhooks/*`, `lib/*` clients, and `lib/notification-center.ts` (documented later).

### EXTRACT
- **E1 — `prisma/schema.prisma:140-170`**
  ```prisma
  ghlLocationId String?             @unique // Used to identify which client sent the webhook
  ghlPrivateKey String?             // The generic API key for this sub-account
  // Email integrations (single-select; EmailBison | SmartLead | Instantly)
  emailProvider         EmailIntegrationProvider?
  emailBisonApiKey     String?
  emailBisonWorkspaceId String?     @unique // EmailBison workspace ID for webhook matching
  emailBisonBaseHostId  String?
  smartLeadApiKey       String?
  smartLeadWebhookSecret String?
  instantlyApiKey       String?
  instantlyWebhookSecret String?
  // Slack integration (workspace-level)
  slackBotToken     String?
  // Resend integration (workspace-level)
  resendApiKey      String?
  resendFromEmail   String?
  // LinkedIn/Unipile integration (per-workspace account)
  unipileAccountId        String?
  // Calendly integration (per-workspace)
  calendlyAccessToken          String?
  calendlyWebhookSubscriptionUri String?
  calendlyWebhookSigningKey    String?
  ```
- **E2 — `prisma/schema.prisma:219-227`**
  ```prisma
  // EmailBison base host allowlist (hostname only). Workspaces can select one base host.
  model EmailBisonBaseHost {
    id        String   @id @default(uuid())
    host      String   @unique
    label     String?
    clients   Client[]
  }
  ```
- **E3 — `components/dashboard/settings/integrations-manager.tsx:123-155`**
  ```ts
  const emptyNewClientForm = {
    name: "",
    ghlLocationId: "",
    ghlPrivateKey: "",
    emailProvider: "NONE" as EmailIntegrationProvider | "NONE",
    emailBisonApiKey: "",
    emailBisonWorkspaceId: "",
    emailBisonBaseHostId: "",
    smartLeadApiKey: "",
    smartLeadWebhookSecret: "",
    instantlyApiKey: "",
    instantlyWebhookSecret: "",
    unipileAccountId: "",
    calendlyAccessToken: "",
    setterEmailsRaw: "",
    inboxManagerEmailsRaw: "",
  };
  ```
- **E4 — `actions/client-actions.ts:251-323`**
  ```ts
  resolvedProvider = resolveEmailIntegrationProvider({
    emailProvider: emailProviderInput ?? undefined,
    emailBisonApiKey,
    emailBisonWorkspaceId,
    smartLeadApiKey,
    smartLeadWebhookSecret,
    instantlyApiKey,
    instantlyWebhookSecret,
  });

  const client = await prisma.client.create({
    data: {
      name,
      ghlLocationId,
      ghlPrivateKey,
      emailProvider: resolvedProvider,
      emailBisonApiKey: resolvedProvider === EmailIntegrationProvider.EMAILBISON ? (emailBisonApiKey || null) : null,
      emailBisonWorkspaceId: resolvedProvider === EmailIntegrationProvider.EMAILBISON ? (emailBisonWorkspaceId || null) : null,
      smartLeadApiKey: resolvedProvider === EmailIntegrationProvider.SMARTLEAD ? (smartLeadApiKey || null) : null,
      smartLeadWebhookSecret: resolvedProvider === EmailIntegrationProvider.SMARTLEAD ? (smartLeadWebhookSecret || null) : null,
      instantlyApiKey: resolvedProvider === EmailIntegrationProvider.INSTANTLY ? (instantlyApiKey || null) : null,
      instantlyWebhookSecret: resolvedProvider === EmailIntegrationProvider.INSTANTLY ? (instantlyWebhookSecret || null) : null,
      ...emailBisonBaseHostConnect,
      unipileAccountId: unipileAccountId || null,
      calendlyAccessToken: calendlyAccessToken || null,
      userId: user.id, // Workspace owner (admin)
    },
  });
  ```
- **E5 — `actions/client-actions.ts:394-401`**
  ```ts
  if (data.calendlyAccessToken !== undefined) {
    updateData.calendlyAccessToken = calendlyAccessToken || null;
    if (!calendlyAccessToken) {
      updateData.calendlyUserUri = null;
      updateData.calendlyOrganizationUri = null;
      updateData.calendlyWebhookSubscriptionUri = null;
      updateData.calendlyWebhookSigningKey = null;
    }
  }
  ```
- **E6 — `actions/client-actions.ts:414-424`**
  ```ts
  if (emailIntegrationTouched) {
    // Explicitly clear all providers.
    if ((data as unknown as Record<string, unknown>).emailProvider === null) {
      updateData.emailProvider = null;
      updateData.emailBisonApiKey = null;
      updateData.emailBisonWorkspaceId = null;
      updateData.smartLeadApiKey = null;
      updateData.smartLeadWebhookSecret = null;
      updateData.instantlyApiKey = null;
      updateData.instantlyWebhookSecret = null;
    }
  }
  ```
- **E7 — `lib/email-integration.ts:19-45`**
  ```ts
  if (configured.length === 0) return null;
  if (configured.length === 1) return configured[0];

  throw new Error(
    "Multiple email providers are configured for this workspace. Select exactly one (EmailBison, SmartLead, Instantly)."
  );
  ```
- **E8 — `actions/slack-integration-actions.ts:22-33`**
  ```ts
  await requireClientAdminAccess(clientId);
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { slackBotToken: true },
  });
  const token = (client?.slackBotToken || "").trim();
  ```
- **E9 — `actions/slack-integration-actions.ts:55-63`**
  ```ts
  // Validate token against Slack API before saving.
  const auth = await slackAuthTest(normalized);
  if (!auth.success) return { success: false, error: auth.error || "Slack token validation failed" };

  await prisma.client.update({
    where: { id: clientId },
    data: { slackBotToken: normalized },
  });
  ```
- **E10 — `lib/slack-dm.ts:31-38`**
  ```ts
  function getSlackBotToken(): string | null {
    const token = (process.env.SLACK_BOT_TOKEN || "").trim();
    return token ? token : null;
  }

  const token = getSlackBotToken();
  if (!token) return { ok: false, error: "SLACK_BOT_TOKEN not configured" };
  ```
- **E11 — `lib/unipile-api.ts:15-22`**
  ```ts
  function getBaseUrl(): string {
    const dsn = process.env.UNIPILE_DSN;
    if (!dsn) {
      throw new Error("UNIPILE_DSN not configured");
    }
    return `${dsn}/api/v1`;
  }
  ```
- **E12 — `lib/unipile-api.ts:134-138`**
  ```ts
  const apiKey = process.env.UNIPILE_API_KEY;
  if (!apiKey) {
    throw new Error("UNIPILE_API_KEY not configured");
  }
  ```
- **E13 — `actions/calendly-actions.ts:103-118`**
  ```ts
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      calendlyAccessToken: true,
      calendlyWebhookSubscriptionUri: true,
      calendlyWebhookSigningKey: true,
    },
  });
  if (!client.calendlyAccessToken) return { success: false, error: "Calendly access token not configured for this workspace" };

  const baseUrl = getPublicAppUrl();
  const webhookUrl = `${baseUrl}/api/webhooks/calendly/${encodeURIComponent(clientId)}`;
  ```
- **E14 — `actions/calendly-actions.ts:174-182`**
  ```ts
  await prisma.client.update({
    where: { id: clientId },
    data: {
      calendlyWebhookSubscriptionUri: subscriptionUri,
      calendlyWebhookSigningKey: signingKey,
    },
  });
  ```
- **E15 — `actions/resend-integration-actions.ts:57-82`**
  ```ts
  export async function updateResendConfig(
    clientId: string,
    opts: { apiKey?: string | null; fromEmail?: string | null }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await requireClientAdminAccess(clientId);

      const data: { resendApiKey?: string | null; resendFromEmail?: string | null } = {};

      if (opts.apiKey !== undefined) {
        const apiKey = (opts.apiKey || "").trim();
        data.resendApiKey = apiKey || null;
      }

      if (opts.fromEmail !== undefined) {
        const fromEmail = (opts.fromEmail || "").trim();
        if (fromEmail && !isValidEmailAddress(fromEmail)) {
          return { success: false, error: "Invalid from email" };
        }
        data.resendFromEmail = fromEmail || null;
      }

      if (Object.keys(data).length === 0) return { success: true };

      await prisma.client.update({ where: { id: clientId }, data });

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Failed to update Resend config" };
    }
  }
  ```

### SOLVE (Confidence: 0.9)
- Workspace integration credentials/configs are stored on the `Client` row (GHL, email provider keys, Slack token, Resend config, Unipile account id, Calendly token + webhook subscription metadata). (E1)
- EmailBison base URLs are governed by an allowlist model (`EmailBisonBaseHost`) that workspaces can select. (E2, E1)
- The Settings → Integrations UI provides the editable surface for these workspace credentials (GHL, single email provider credentials, Unipile account, Calendly access token) plus assignment inputs. (E3)
- Workspace creation and updates enforce a single active email provider via `resolveEmailIntegrationProvider(...)`, with errors for multi-config states. (E4, E7)
- Removing a Calendly access token also clears cached Calendly URIs/subscription metadata, forcing re-discovery on reconnect. (E5)
- Slack “workspace notifications” are configured per workspace using `Client.slackBotToken`, which is validated before saving. (E8, E9)
- Slack “DM-by-email” sending uses a **global** environment token `SLACK_BOT_TOKEN` (not `Client.slackBotToken`). (E10)
- Unipile requires global env `UNIPILE_DSN` and `UNIPILE_API_KEY` (throws if missing). (E11, E12)
- Calendly uses a per-workspace access token and computes a per-workspace webhook URL under `/api/webhooks/calendly/{clientId}`, storing the subscription URI and signing key on the `Client` record. (E13, E14)
- Resend configuration is stored on `Client` and is admin-gated for updates. (E15, E1)

### VERIFY
- Slack has two distinct patterns: (a) workspace-level Slack channel notifications via `Client.slackBotToken` (E8, E9) and (b) global Slack DM-by-email via `SLACK_BOT_TOKEN` (E10). This is easy to misconfigure if you assume the workspace token powers DMs.
- Email provider configuration can be invalid if multiple providers are partially configured; the code explicitly throws in that case. (E7)
- Unipile env vars are required at runtime; missing envs will throw. (E11, E12)

### SYNTHESIZE
- **Integrations map (high-level):**
  - **GHL (SMS):** `Client.ghlLocationId` + `Client.ghlPrivateKey` (E1) configured via Integrations Manager (E3); used by GHL webhook + GHL API client code (detailed in later sections).
  - **Email provider (EmailBison/SmartLead/Instantly):** stored on `Client` + single-select `Client.emailProvider` (E1) enforced by `resolveEmailIntegrationProvider` (E4, E7); used by provider-specific webhook routes + API clients.
  - **Slack workspace notifications:** `Client.slackBotToken` (E1) managed by `actions/slack-integration-actions.ts` (E8, E9); used by notification-center code (documented later).
  - **Slack DM-by-email:** global `SLACK_BOT_TOKEN` (E10); used in auto-send review and setter-request notifications (documented later).
  - **Resend email notifications:** `Client.resendApiKey` + `Client.resendFromEmail` (E1) updated via `actions/resend-integration-actions.ts` (E15); used by notification-center code (documented later).
  - **Unipile (LinkedIn outbound):** global `UNIPILE_DSN` + `UNIPILE_API_KEY` (E11, E12) + per-workspace `Client.unipileAccountId` (E1).
  - **Calendly:** per-workspace `Client.calendlyAccessToken` (E1) and stored subscription/signing key (E14) for `/api/webhooks/calendly/{clientId}` (E13).
- **Debugging checkpoints:**
  - “Email webhooks failing / wrong provider used” → check `Client.emailProvider` resolution and provider key completeness. (E4, E7)
  - “Slack DMs failing” → check global `SLACK_BOT_TOKEN` (not `Client.slackBotToken`). (E10)
  - “Slack channel notifications failing” → check `Client.slackBotToken` is configured and valid. (E8, E9)

## 5) Inbound Ingestion (Per Channel/Provider)

### PLAN
- Enumerate all webhook ingestion endpoints.
- For each endpoint: identify how the workspace (client) is selected, how auth is enforced, what is written to DB, and what is deferred to background jobs.
- Distinguish conversation ingestion (Messages) vs enrichment ingestion (Clay) vs booking ingestion (Calendly).

### LOCATE
- `app/api/webhooks/ghl/sms/route.ts`: keywords `locationId`, `ghlLocationId`, `message.create`, `SMS_INBOUND_POST_PROCESS`
- `app/api/webhooks/email/route.ts`: keywords `findClient`, `workspace_id`, `switch (eventType)`, `EMAIL_INBOUND_POST_PROCESS`
- `app/api/webhooks/smartlead/route.ts`: keywords `clientId`, `provider_mismatch`, `isAuthorized`, `SMARTLEAD_INBOUND_POST_PROCESS`
- `app/api/webhooks/instantly/route.ts`: keywords `clientId`, `provider_mismatch`, `isAuthorized`, `INSTANTLY_INBOUND_POST_PROCESS`
- `app/api/webhooks/linkedin/route.ts`: keywords `verifyUnipileWebhookSecret`, `unipileAccountId`, `LINKEDIN_INBOUND_POST_PROCESS`
- `app/api/webhooks/calendly/[clientId]/route.ts`: keywords `verifyCalendlyWebhookSignature`, `invitee.created`, `applyPostBookingSideEffects`
- `app/api/webhooks/clay/route.ts`: keywords `verifyClayWebhookSignature`, `enrichment`, `resumeAwaitingEnrichmentFollowUpsForLead`

### EXTRACT
- **E1 — `app/api/webhooks/ghl/sms/route.ts:180-185`**
  ```ts
  * - Validate + map tenancy (locationId → client)
  * - Find/create Lead (cross-channel dedupe)
  * - Insert inbound Message (idempotent via webhookDedupeKey)
  * - Enqueue background job for post-processing (sentiment, drafts, booking, etc.)
  *
  * Do NOT do conversation-history sync or AI calls inline.
  ```
- **E2 — `app/api/webhooks/ghl/sms/route.ts:191-219`**
  ```ts
  const locationId = payload.location?.id ?? null;
  const contactId = payload.contact_id ?? null;
  const rawBody = payload.message?.body || payload.customData?.Message || "";
  const messageBody = (rawBody || "").trim();

  console.log("[GHL SMS Webhook] Received", {
    locationId,
    contactId,
    workflowId: payload.workflow?.id ?? null,
    hasCustomData: !!payload.customData,
    bodyLen: messageBody.length,
  });

  if (!locationId) {
    return NextResponse.json({ error: "Missing location.id" }, { status: 400 });
  }

  if (!contactId) {
    return NextResponse.json({ error: "Missing contact_id" }, { status: 400 });
  }

  const client = await prisma.client.findUnique({
    where: { ghlLocationId: locationId },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: `Client not registered for location: ${locationId}` }, { status: 404 });
  }

  if (!messageBody) {
    return NextResponse.json({ success: true, ignored: true, reason: "empty_message" }, { status: 200 });
  }
  ```
- **E3 — `app/api/webhooks/ghl/sms/route.ts:261-327`**
  ```ts
  const leadResult = await findOrCreateLead(
    client.id,
    { email, phone, firstName, lastName },
    { ghlContactId: contactId },
    { smsCampaignId }
  );

  const created = await prisma.message.create({
    data: {
      webhookDedupeKey,
      body: messageBody,
      direction: "inbound",
      channel: "sms",
      leadId: lead.id,
      sentAt,
    },
    select: { id: true },
  });

  const dedupeKey = buildJobDedupeKey(client.id, messageId, BackgroundJobType.SMS_INBOUND_POST_PROCESS);
  jobEnqueued = await enqueueBackgroundJob({
    type: BackgroundJobType.SMS_INBOUND_POST_PROCESS,
    clientId: client.id,
    leadId: lead.id,
    messageId,
    dedupeKey,
  });
  ```
- **E4 — `app/api/webhooks/email/route.ts:133-159`**
  ```ts
  async function findClient(request: NextRequest, payload?: InboxxiaWebhook): Promise<Client | null> {
    const url = new URL(request.url);
    const clientIdParam = url.searchParams.get("clientId");

    // Strategy 1: Look up by clientId query param (explicit, most reliable)
    if (clientIdParam) {
      const client = await prisma.client.findUnique({ where: { id: clientIdParam } });
      if (client) return client;
    }

    // Strategy 2: Look up by EmailBison workspace_id from payload
    const workspaceId = payload?.event?.workspace_id;
    const workspaceIdStr = workspaceId !== undefined && workspaceId !== null ? String(workspaceId).trim() : "";
    if (workspaceIdStr) {
      const client = await prisma.client.findUnique({ where: { emailBisonWorkspaceId: workspaceIdStr } });
      if (client) return client;
    }
  }
  ```
- **E5 — `app/api/webhooks/email/route.ts:162-197`**
  ```ts
  // Strategy 3 (safe backstop): Exact match by workspace name (only if unique globally)
  const rawWorkspaceName = payload?.event?.workspace_name || payload?.event?.name;
  const workspaceName = typeof rawWorkspaceName === "string" ? rawWorkspaceName.trim() : "";
  if (workspaceName) {
    const matches = await prisma.client.findMany({
      where: { name: { equals: candidate, mode: "insensitive" } },
      take: 2,
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      console.warn(`[Email Webhook] Multiple clients match workspace_name "${candidate}". Skipping name-based routing.`);
      break;
    }
  }
  ```
- **E6 — `app/api/webhooks/email/route.ts:2247-2267`**
  ```ts
  switch (eventType) {
    case "LEAD_REPLIED":
      return handleLeadReplied(request, payload);
    case "LEAD_INTERESTED":
      return handleLeadInterested(request, payload);
    case "UNTRACKED_REPLY_RECEIVED":
      return handleUntrackedReply(request, payload);
    case "EMAIL_SENT":
      return handleEmailSent(request, payload);
    case "EMAIL_OPENED":
      return handleEmailOpened(request, payload);
    case "EMAIL_BOUNCED":
      return handleEmailBounced(request, payload);
    case "LEAD_UNSUBSCRIBED":
      return handleLeadUnsubscribed(request, payload);
  }
  ```
- **E7 — `app/api/webhooks/email/route.ts:237-264`**
  ```ts
  await prisma.backgroundJob.upsert({
    where: { dedupeKey: opts.dedupeKey },
    update: { status: BackgroundJobStatus.PENDING, runAt: new Date(), lockedAt: null, lockedBy: null, startedAt: null, finishedAt: null, lastError: null },
    create: {
      type: BackgroundJobType.EMAIL_INBOUND_POST_PROCESS,
      status: BackgroundJobStatus.PENDING,
      dedupeKey: opts.dedupeKey,
      clientId: opts.clientId,
      leadId: opts.leadId,
      messageId: opts.messageId,
      runAt: new Date(),
    },
  });
  ```
- **E8 — `app/api/webhooks/smartlead/route.ts:87-99`**
  ```ts
  const authHeader = params.request.headers.get("authorization") || params.request.headers.get("Authorization") || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token && token === params.expected) return true;

  const headerSecret = params.request.headers.get("x-smartlead-secret");
  if (headerSecret && headerSecret === params.expected) return true;

  const payloadSecret = normalizeOptionalString(params.payload?.secret_key);
  if (payloadSecret && payloadSecret === params.expected) return true;
  ```
- **E9 — `app/api/webhooks/smartlead/route.ts:126-129`**
  ```ts
  if (provider !== EmailIntegrationProvider.SMARTLEAD) {
    console.warn(`[SmartLead Webhook] Ignored: client ${clientId} provider is ${provider || "none"}`);
    return NextResponse.json({ success: true, ignored: true, reason: "provider_mismatch" });
  }
  ```
- **E10 — `app/api/webhooks/smartlead/route.ts:136-139`**
  ```ts
  const expectedSecret = client.smartLeadWebhookSecret || null;
  if (!isAuthorizedSmartLeadWebhook({ request, payload, expected: expectedSecret })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  ```
- **E11 — `app/api/webhooks/smartlead/route.ts:284-297`**
  ```ts
  const dedupeKey = buildJobDedupeKey(
    client.id,
    inboundMessage.id,
    BackgroundJobType.SMARTLEAD_INBOUND_POST_PROCESS
  );

  await enqueueBackgroundJob({
    type: BackgroundJobType.SMARTLEAD_INBOUND_POST_PROCESS,
    clientId: client.id,
    leadId: lead.id,
    messageId: inboundMessage.id,
    dedupeKey,
  });
  ```
- **E12 — `app/api/webhooks/instantly/route.ts:65-76`**
  ```ts
  function isAuthorizedInstantlyWebhook(request: NextRequest, expected: string | null): boolean {
    if (!expected) return false;
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization") || "";
    const [scheme, token] = authHeader.split(" ");
    if (scheme === "Bearer" && token && token === expected) return true;
    const headerSecret = request.headers.get("x-instantly-secret");
    if (headerSecret && headerSecret === expected) return true;
    return false;
  }
  ```
- **E13 — `app/api/webhooks/instantly/route.ts:119-127`**
  ```ts
  if (provider !== EmailIntegrationProvider.INSTANTLY) {
    console.warn(`[Instantly Webhook] Ignored: client ${clientId} provider is ${provider || "none"}`);
    return NextResponse.json({ success: true, ignored: true, reason: "provider_mismatch" });
  }

  const expectedSecret = client.instantlyWebhookSecret || null;
  if (!isAuthorizedInstantlyWebhook(request, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  ```
- **E14 — `app/api/webhooks/instantly/route.ts:259-272`**
  ```ts
  const dedupeKey = buildJobDedupeKey(
    client.id,
    inboundMessage.id,
    BackgroundJobType.INSTANTLY_INBOUND_POST_PROCESS
  );

  await enqueueBackgroundJob({
    type: BackgroundJobType.INSTANTLY_INBOUND_POST_PROCESS,
    clientId: client.id,
    leadId: lead.id,
    messageId: inboundMessage.id,
    dedupeKey,
  });
  ```
- **E15 — `app/api/webhooks/linkedin/route.ts:55-76`**
  ```ts
  // Verify webhook using custom header authentication
  if (!verifyUnipileWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountId = (payload.account_id || "").trim();
  // Find the client (workspace) by Unipile account ID
  const client = await prisma.client.findFirst({
    where: { unipileAccountId: accountId },
  });
  if (!client) {
    // Treat as a non-fatal configuration issue (prevents webhook retry storms).
    return NextResponse.json({ success: true, ignored: true });
  }
  ```
- **E16 — `app/api/webhooks/linkedin/route.ts:213-226`**
  ```ts
  const dedupeKey = buildJobDedupeKey(
    clientId,
    newMessage.id,
    BackgroundJobType.LINKEDIN_INBOUND_POST_PROCESS
  );

  await enqueueBackgroundJob({
    type: BackgroundJobType.LINKEDIN_INBOUND_POST_PROCESS,
    clientId,
    leadId: lead.id,
    messageId: newMessage.id,
    dedupeKey,
  });
  ```
- **E17 — `app/api/webhooks/calendly/[clientId]/route.ts:80-110`**
  ```ts
  const { clientId } = await context.params;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { calendlyWebhookSigningKey: true, calendlyWebhookSubscriptionUri: true },
  });
  if (!client) return NextResponse.json({ error: "Unknown workspace" }, { status: 404 });

  const rawBody = await request.text();
  const signingKey = client.calendlyWebhookSigningKey || process.env.CALENDLY_WEBHOOK_SIGNING_KEY || null;
  if (signingKey) {
    const verified = verifyCalendlyWebhookSignature({ signingKey, headers: request.headers, rawBody });
    if (!verified.ok) return NextResponse.json({ error: "Unauthorized", reason: verified.reason }, { status: 401 });
  } else {
    console.warn("[Calendly Webhook] No signing key configured for client", clientId, "- accepting webhook without signature verification");
  }
  ```
- **E18 — `app/api/webhooks/calendly/[clientId]/route.ts:126-146`**
  ```ts
  // Try to map to a lead deterministically (IDs first, then email fallback).
  let lead =
    (inviteeUri ? await prisma.lead.findUnique({ where: { calendlyInviteeUri: inviteeUri }, select: { id: true, status: true } }) : null) ||
    (scheduledEventUri ? await prisma.lead.findUnique({ where: { calendlyScheduledEventUri: scheduledEventUri }, select: { id: true, status: true } }) : null) ||
    (inviteeEmail ? await prisma.lead.findFirst({
      where: { clientId, email: { equals: inviteeEmail, mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, status: true },
    }) : null);
  ```
- **E19 — `app/api/webhooks/calendly/[clientId]/route.ts:167-200`**
  ```ts
  // Dual-write: create Appointment + update Lead rollups atomically
  if (inviteeUri) {
    await upsertAppointmentWithRollup({
      leadId: lead.id,
      provider: "CALENDLY",
      source: AppointmentSource.WEBHOOK,
      calendlyInviteeUri: inviteeUri,
      calendlyScheduledEventUri: scheduledEventUri,
      startAt: appointmentStartAt,
      endAt: appointmentEndAt,
      status: AppointmentStatus.CONFIRMED,
    });
  } else {
    // Fallback: update lead directly if no invitee URI (legacy support)
    const bookedSlot = startTime ? new Date(startTime).toISOString() : null;
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        calendlyScheduledEventUri: scheduledEventUri,
        appointmentBookedAt: new Date(),
        appointmentStartAt,
        appointmentEndAt,
        appointmentStatus: "confirmed",
        appointmentProvider: "CALENDLY",
        appointmentSource: "webhook",
        bookedSlot: bookedSlot || startTime,
        status: "meeting-booked",
        offeredSlots: null,
      },
    });
  }
  await applyPostBookingSideEffects(lead.id);
  ```
- **E20 — `app/api/webhooks/clay/route.ts:113-120`**
  ```ts
  const signature = request.headers.get("x-clay-signature") ||
    request.headers.get("x-webhook-signature") || "";

  if (!verifyClayWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  ```
- **E21 — `app/api/webhooks/clay/route.ts:228-239`**
  ```ts
  // If we enriched a phone, ensure the lead is linked to a GHL contact and sync the phone over.
  if (payload.enrichmentType === "phone" && effectiveStatus === "success") {
    await ensureGhlContactIdForLead(payload.leadId, { allowCreateWithoutPhone: true });
    await syncGhlContactPhoneForLead(payload.leadId).catch(() => undefined);

    // If any follow-up instances were paused waiting for enrichment, resume them now.
    await resumeAwaitingEnrichmentFollowUpsForLead(payload.leadId).catch(() => undefined);
  }
  ```

### SOLVE (Confidence: 0.85)
- **GHL SMS webhook** (`/api/webhooks/ghl/sms`):
  - Maps tenancy via `locationId → Client.ghlLocationId`. (E2)
  - Creates/links a Lead via `findOrCreateLead(...)`, inserts an inbound SMS Message idempotently, and enqueues `SMS_INBOUND_POST_PROCESS`. (E1, E3)
  - Explicitly avoids AI calls inline on the webhook request path. (E1)
- **EmailBison/Inboxxia webhook** (`/api/webhooks/email`):
  - Resolves client by: (1) `?clientId=...`, else (2) payload `workspace_id → Client.emailBisonWorkspaceId`, else (3) unique workspace name match as a backstop. (E4, E5)
  - Dispatches based on `eventType` to typed handlers like `LEAD_REPLIED`, `EMAIL_SENT`, `EMAIL_BOUNCED`, etc. (E6)
  - Enqueues `EMAIL_INBOUND_POST_PROCESS` via background job upsert (dedupeKey). (E7)
- **SmartLead webhook** (`/api/webhooks/smartlead?clientId=...`):
  - Ignores events when the workspace’s resolved email provider isn’t SMARTLEAD (provider mismatch). (E9)
  - Auth is accepted via `Authorization: Bearer <secret>`, `x-smartlead-secret`, or `payload.secret_key`. (E8, E10)
  - Enqueues `SMARTLEAD_INBOUND_POST_PROCESS` after creating the inbound message. (E11)
- **Instantly webhook** (`/api/webhooks/instantly?clientId=...`):
  - Ignores events when provider isn’t INSTANTLY (provider mismatch). (E13)
  - Auth is accepted via `Authorization: Bearer <secret>` or `x-instantly-secret`. (E12, E13)
  - Enqueues `INSTANTLY_INBOUND_POST_PROCESS` after creating the inbound message. (E14)
- **Unipile LinkedIn webhook** (`/api/webhooks/linkedin`):
  - Rejects requests without a valid Unipile webhook secret. (E15)
  - Routes the event to a workspace by matching `payload.account_id → Client.unipileAccountId`. (E15)
  - Enqueues `LINKEDIN_INBOUND_POST_PROCESS` after creating the inbound LinkedIn message. (E16)
- **Calendly webhook** (`/api/webhooks/calendly/{clientId}`):
  - Routes to workspace by path param `{clientId}` and may verify signature if a signing key exists; otherwise it logs a warning and accepts. (E17)
  - Maps events to a Lead deterministically via stored Calendly URIs, else falls back to email. (E18)
  - On `invitee.created`, upserts Appointment + applies post-booking side effects. (E19)
- **Clay webhook** (`/api/webhooks/clay`):
  - Verifies request signature headers and rejects invalid signatures. (E20)
  - Updates Lead enrichment fields and can resume follow-ups awaiting enrichment after successful phone enrichment. (E21)

### VERIFY
- Email webhook client routing can fall back to workspace-name matching only when the name is globally unique; otherwise it skips name-based routing (to avoid misrouting). (E5)
- SmartLead/Instantly explicitly ignore events when the configured email provider doesn’t match, which can appear as “webhook not working” when it’s actually “provider mismatch”. (E9, E13)
- Calendly explicitly accepts webhooks without signature verification when no signing key is available (expected for Personal Access Tokens). This is an explicit security tradeoff that must be understood operationally. (E17)

### SYNTHESIZE
- **Webhook ingestion pattern:** (verify/auth) → (resolve workspace) → (create/update Lead + Message or Lead enrichment) → (enqueue background job for heavy work).
- **Provider → job type mapping (conversation ingestion):**
  - GHL SMS → `SMS_INBOUND_POST_PROCESS` (E3)
  - Inboxxia/EmailBison → `EMAIL_INBOUND_POST_PROCESS` (E7)
  - SmartLead → `SMARTLEAD_INBOUND_POST_PROCESS` (E11)
  - Instantly → `INSTANTLY_INBOUND_POST_PROCESS` (E14)
  - Unipile LinkedIn → `LINKEDIN_INBOUND_POST_PROCESS` (E16)
- **Debugging checkpoints:**
  - “401 from webhook” → check secret verification path for that provider (E8/E10/E12/E15/E17/E20).
  - “200 but nothing happens” → check provider mismatch ignores (E9/E13) and background job enqueue/run (Section 7).
  - “Email webhook can’t find workspace” → verify `Client.emailBisonWorkspaceId` set; name-based routing is intentionally conservative. (E4, E5)

## 6) Normalization + Lead Matching + Threading

### PLAN
- Identify the canonical entities used to represent a conversation thread across channels.
- Identify how the system deduplicates inbound events and avoids duplicate Messages.
- Identify how the system matches/merges Leads across channels (email/phone/LinkedIn IDs).
- Identify how “CC replier” behavior is tracked (alternate emails, current replier).

### LOCATE
- `lib/lead-matching.ts`: keywords `Matching priority`, `alternateEmails`, `phone contains`, `enrichmentStatus`
- `lib/email-participants.ts`: keywords `detectCcReplier`, `addToAlternateEmails`, `normalizeOptionalEmail`
- `prisma/schema.prisma`: `model Lead` (alternateEmails/currentReplier*), `model Message` (dedupe IDs)

### EXTRACT
- **E1 — `lib/lead-matching.ts:65-75`**
  ```ts
  * Matching priority:
  * 1. ghlContactId (if provided)
  * 2. emailBisonLeadId (if provided)
  * 3. linkedinId / linkedinUrl (if provided)
  * 4. email (case-insensitive)
  * 5. alternateEmails (array membership)
  * 6. phone (normalized digits)
  ```
- **E2 — `lib/lead-matching.ts:121-142`**
  ```ts
  if (!existingLead && normalizedEmail) {
    existingLead = await prisma.lead.findFirst({
      where: { clientId, email: { equals: normalizedEmail, mode: "insensitive" } },
    });
    if (existingLead) matchedBy = "email";
  }

  if (!existingLead && normalizedEmail) {
    existingLead = await prisma.lead.findFirst({
      where: { clientId, alternateEmails: { has: normalizedEmail } },
    });
    if (existingLead) matchedBy = "alternateEmail";
  }

  if (!existingLead && normalizedPhone) {
    // Phone is stored in E.164-like format (`+` + digits). Use a contains match so we can
    // safely migrate older rows that stored digits-only without breaking matching.
    existingLead = await prisma.lead.findFirst({
      where: { clientId, phone: { contains: normalizedPhone } },
    });
    if (existingLead) matchedBy = "phone";
  }
  ```
- **E3 — `lib/lead-matching.ts:218-228`**
  ```ts
  // Determine enrichment status for new lead
  // SMS-only leads (no email) don't need enrichment
  // Email leads need enrichment if missing LinkedIn or phone
  let enrichmentStatus: string | null = null;
  if (!normalizedEmail && normalizedPhone) {
    enrichmentStatus = "not_needed";
  } else if (normalizedEmail && (!normalizedLinkedInUrl || !normalizedPhone)) {
    enrichmentStatus = "pending";
  }
  ```
- **E4 — `prisma/schema.prisma:693-703`**
  ```prisma
  model Message {
    // External system IDs for deduplication
    ghlId     String?  @unique
    emailBisonReplyId String?  @unique
    inboxxiaScheduledEmailId String? @unique
    unipileMessageId String?  @unique
    webhookDedupeKey String?  @unique
    channel   String   @default("sms") // 'sms' | 'email' | 'linkedin'
  }
  ```
- **E5 — `prisma/schema.prisma:430-434`**
  ```prisma
  // Phase 72: CC'd recipient tracking
  alternateEmails         String[]   @default([])  // Email addresses of people who have replied to this thread
  currentReplierEmail     String?
  currentReplierName      String?
  currentReplierSince     DateTime?
  ```
- **E6 — `prisma/schema.prisma:455-456`**
  ```prisma
  @@index([emailBisonLeadId])
  @@index([alternateEmails], type: Gin)
  ```
- **E7 — `lib/email-participants.ts:115-123`**
  ```ts
  export function detectCcReplier(params: { leadEmail: string | null | undefined; inboundFromEmail: string | null | undefined }): { isCcReplier: boolean } {
    const leadEmail = normalizeOptionalEmail(params.leadEmail);
    const inboundFromEmail = normalizeOptionalEmail(params.inboundFromEmail);
    if (!leadEmail || !inboundFromEmail) return { isCcReplier: false };
    return { isCcReplier: leadEmail !== inboundFromEmail };
  }
  ```
- **E8 — `lib/email-participants.ts:139-162`**
  ```ts
  export function addToAlternateEmails(
    existingAlternates: string[],
    newEmail: string | null | undefined,
    primaryEmail: string | null | undefined
  ): string[] {
    const normalizedPrimary = normalizeOptionalEmail(primaryEmail);
    const normalizedNew = normalizeOptionalEmail(newEmail);
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of existingAlternates || []) {
      const normalized = normalizeOptionalEmail(value);
      if (!normalized) continue;
      if (normalizedPrimary && normalized === normalizedPrimary) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
    }

    if (normalizedNew && (!normalizedPrimary || normalizedNew !== normalizedPrimary) && !seen.has(normalizedNew)) {
      result.push(normalizedNew);
    }

    return result;
  }
  ```

### SOLVE (Confidence: 0.9)
- The canonical conversation entity is **Lead**, and messages across channels attach to `Message.leadId` with `Message.channel` distinguishing sms/email/linkedin. (E4)
- Inbound event deduplication is enforced at the **Message** level via unique constraints for provider IDs (`ghlId`, `emailBisonReplyId`, `inboxxiaScheduledEmailId`, `unipileMessageId`) and a computed `webhookDedupeKey` fallback. (E4)
- Cross-channel Lead matching uses a strict priority order: external IDs first, then LinkedIn identifiers, then email, then `alternateEmails` membership, then phone (normalized digits). (E1, E2)
- Phone matching uses `contains` to tolerate migration differences in storage format (digits-only vs `+` + digits). (E2)
- New-lead enrichment state is derived from what identifiers are present (SMS-only leads don’t need enrichment; email leads missing phone/LinkedIn are marked pending). (E3)
- CC replier tracking is based on “inbound from email != lead email” detection, and alternateEmails are normalized/deduped and exclude the current primary. (E7, E8, E5)
- The schema explicitly supports fast alternate email membership queries via a GIN index. (E6)

### VERIFY
- CC replier detection is intentionally simple (`leadEmail !== inboundFromEmail`) after normalization; it assumes the lead’s primary email represents the “intended” thread owner. (E7)
- Phone “contains” matching is explicitly a compatibility strategy; it can be overly permissive in edge cases (e.g., if very short digit strings were used), but the intent is stated in code. (E2)

### SYNTHESIZE
- **Threading rule of thumb:** “One Lead = one cross-channel thread”; messages are deduped by provider IDs and linked to that Lead. (E4)
- **Debugging checkpoints:**
  - Duplicate leads across channels → inspect `lib/lead-matching.ts` matching priority and the stored `Lead.email/phone/linkedinUrl/alternateEmails`. (E1, E2, E3)
  - Duplicate messages → inspect unique IDs in `Message` (`emailBisonReplyId`, `unipileMessageId`, `webhookDedupeKey`, etc.). (E4)
  - CC replies not “routing” to the right person → inspect `detectCcReplier` and how alternate emails are stored. (E7, E8, E5)

## 7) Background Jobs (Enqueue → Lock → Run → Retry)

### PLAN
- Identify the durable background job table + the fields that matter operationally (locking, attempts, errors).
- Identify how jobs are enqueued and deduped (dedupeKey contract).
- Identify how jobs are processed (cron auth, lock acquisition, stale lock release, dispatch, retry/backoff).
- Identify how the durable `WebhookEvent` queue relates (drained before jobs) and why.

### LOCATE
- `prisma/schema.prisma`: `model BackgroundJob`, `model WebhookEvent`, `lockedAt`, `lockedBy`, `attempts`, `maxAttempts`, `lastError`
- `lib/background-jobs/enqueue.ts`: `enqueueBackgroundJob`, `buildJobDedupeKey`
- `lib/background-jobs/runner.ts`: `processBackgroundJobs`, `computeRetryBackoffMs`, `BACKGROUND_JOB_*` env knobs, `processWebhookEvents` drain
- `lib/webhook-events/runner.ts`: `processWebhookEvents`, `WEBHOOK_EVENT_*` env knobs, retry/backoff
- `app/api/cron/background-jobs/route.ts`: `CRON_SECRET` auth contract, maxDuration

### EXTRACT
- **E1 — `prisma/schema.prisma:845-878`**
  ```prisma
  model BackgroundJob {
    id          String            @id @default(uuid())
    type        BackgroundJobType
    status      BackgroundJobStatus @default(PENDING)
    dedupeKey   String            @unique

    clientId    String
    client      Client            @relation(fields: [clientId], references: [id], onDelete: Cascade)
    leadId      String
    lead        Lead              @relation(fields: [leadId], references: [id], onDelete: Cascade)
    messageId   String
    message     Message           @relation(fields: [messageId], references: [id], onDelete: Cascade)
    // Phase 47l: Optional draft ID for delayed auto-send jobs
    draftId     String?
    draft       AIDraft?          @relation(fields: [draftId], references: [id], onDelete: SetNull)

    runAt       DateTime          @default(now())
    attempts    Int               @default(0)
    maxAttempts Int               @default(5)
    lockedAt    DateTime?
    lockedBy    String?
    startedAt   DateTime?
    finishedAt  DateTime?
    lastError   String?           @db.Text
  }
  ```
- **E2 — `prisma/schema.prisma:880-925`**
  ```prisma
  // Phase 53: durable queue for bursty webhook events (e.g., Inboxxia EMAIL_SENT).
  // This avoids doing lead/campaign upserts and follow-up triggers on the request path.
  model WebhookEvent {
    id        String @id @default(uuid())
    provider  WebhookProvider
    eventType String
    dedupeKey String @unique

    status      WebhookEventStatus @default(PENDING)
    runAt       DateTime @default(now())
    attempts    Int      @default(0)
    maxAttempts Int      @default(8)
    lockedAt    DateTime?
    lockedBy    String?
    startedAt   DateTime?
    finishedAt  DateTime?
    lastError   String?  @db.Text

    // Normalized payload fields (primarily Inboxxia/EmailBison today).
    workspaceId     String?
    workspaceName   String?
    campaignId      String?
    campaignName    String?
    emailBisonLeadId String?
    leadEmail       String?
    leadFirstName   String?
    leadLastName    String?
    senderEmailId   String?
    senderEmail     String?
    senderName      String?
    scheduledEmailId String?
    emailSubject    String?
    emailBodyHtml   String? @db.Text
    emailStatus     String?
    emailSentAt     DateTime?

    raw Json?
  }
  ```
- **E3 — `lib/background-jobs/enqueue.ts:16-47`**
  ```ts
  /**
   * Enqueues a background job for async processing.
   * Uses dedupeKey to prevent duplicate jobs.
   * Returns true if job was enqueued, false if duplicate skipped.
   */
  export async function enqueueBackgroundJob(params: EnqueueJobParams): Promise<boolean> {
    try {
      await prisma.backgroundJob.create({
        data: {
          type: params.type,
          clientId: params.clientId,
          leadId: params.leadId,
          messageId: params.messageId,
          dedupeKey: params.dedupeKey,
          status: "PENDING",
          runAt: params.runAt ?? new Date(),
          maxAttempts: params.maxAttempts ?? 5,
          attempts: 0,
        },
      });
      return true;
    } catch (error) {
      // Unique constraint violation on dedupeKey means job already enqueued
      if (isPrismaUniqueConstraintError(error)) {
        return false;
      }
      throw error;
    }
  }
  ```
- **E4 — `lib/background-jobs/enqueue.ts:50-60`**
  ```ts
  /**
   * Generates a deterministic dedupe key for a job.
   * Format: {clientId}:{messageId}:{jobType}
   */
  export function buildJobDedupeKey(clientId: string, messageId: string, jobType: BackgroundJobType): string {
    return `${clientId}:${messageId}:${jobType}`;
  }
  ```
- **E5 — `lib/background-jobs/runner.ts:23-40`**
  ```ts
  function getCronJobLimit(): number {
    return Math.min(200, parsePositiveInt(process.env.BACKGROUND_JOB_CRON_LIMIT, 10));
  }
  function getStaleLockMs(): number {
    return Math.max(60_000, parsePositiveInt(process.env.BACKGROUND_JOB_STALE_LOCK_MS, 10 * 60_000));
  }
  function getCronTimeBudgetMs(): number {
    return Math.max(10_000, parsePositiveInt(process.env.BACKGROUND_JOB_CRON_TIME_BUDGET_MS, 240_000));
  }
  function computeRetryBackoffMs(attempt: number): number {
    const cappedAttempt = Math.max(1, Math.min(10, Math.floor(attempt)));
    const jitter = Math.floor(Math.random() * 1000);
    const base = Math.pow(2, cappedAttempt) * 1000; // 2s, 4s, 8s, ...
    return Math.min(15 * 60_000, base + jitter);
  }
  ```
- **E6 — `lib/background-jobs/runner.ts:60-100`**
  ```ts
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + getCronTimeBudgetMs();
  const invocationId = crypto.randomUUID();

  // Phase 53: drain bursty webhook events first (bounded), then process background jobs.
  const webhookEvents = await processWebhookEvents({ invocationId }).catch((error) => {
    console.error("[Cron] Webhook event processing failed:", error);
    return undefined;
  });

  const staleCutoff = new Date(Date.now() - getStaleLockMs());
  const released = await prisma.backgroundJob.updateMany({
    where: { status: BackgroundJobStatus.RUNNING, lockedAt: { lt: staleCutoff } },
    data: {
      status: BackgroundJobStatus.PENDING,
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      runAt: new Date(),
      lastError: "Released stale RUNNING lock",
    },
  });

  const due = await prisma.backgroundJob.findMany({
    where: { status: BackgroundJobStatus.PENDING, runAt: { lte: now } },
    orderBy: { runAt: "asc" },
    take: limit,
    select: { id: true, type: true },
  });
  ```
- **E7 — `lib/background-jobs/runner.ts:108-137`**
  ```ts
  for (const job of due) {
    // Keep a safety buffer so the cron can respond cleanly.
    if (Date.now() > deadlineMs - 7_500) break;

    const lockAt = new Date();
    const locked = await prisma.backgroundJob.updateMany({
      where: { id: job.id, status: BackgroundJobStatus.PENDING },
      data: {
        status: BackgroundJobStatus.RUNNING,
        lockedAt: lockAt,
        lockedBy: invocationId,
        startedAt: lockAt,
        attempts: { increment: 1 },
      },
    });
    if (locked.count === 0) continue;

    const lockedJob = await prisma.backgroundJob.findUnique({
      where: { id: job.id },
      select: {
        id: true,
        type: true,
        clientId: true,
        leadId: true,
        messageId: true,
        draftId: true,
        attempts: true,
        maxAttempts: true,
      },
    });
  }
  ```
- **E8 — `lib/background-jobs/runner.ts:146-166`**
  ```ts
  const telemetrySource = `background-job/${lockedJob.type.toLowerCase().replace(/_/g, "-")}`;

  switch (lockedJob.type) {
    case BackgroundJobType.EMAIL_INBOUND_POST_PROCESS: {
      await withAiTelemetrySource(telemetrySource, () =>
        runEmailInboundPostProcessJob({ clientId: lockedJob.clientId, leadId: lockedJob.leadId, messageId: lockedJob.messageId })
      );
      break;
    }
    case BackgroundJobType.SMS_INBOUND_POST_PROCESS: {
      await withAiTelemetrySource(telemetrySource, () =>
        runSmsInboundPostProcessJob({ clientId: lockedJob.clientId, leadId: lockedJob.leadId, messageId: lockedJob.messageId })
      );
      break;
    }
  }
  ```
- **E9 — `lib/background-jobs/runner.ts:247-266`**
  ```ts
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 10_000);
    const attempts = lockedJob.attempts;
    const shouldRetry = attempts < lockedJob.maxAttempts;

    await prisma.backgroundJob.update({
      where: { id: lockedJob.id },
      data: {
        status: shouldRetry ? BackgroundJobStatus.PENDING : BackgroundJobStatus.FAILED,
        runAt: shouldRetry ? new Date(Date.now() + computeRetryBackoffMs(attempts)) : new Date(),
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      },
    });
  }
  ```
- **E10 — `lib/webhook-events/runner.ts:14-24`**
  ```ts
  function getWebhookEventLimit(): number {
    return Math.min(200, parsePositiveInt(process.env.WEBHOOK_EVENT_CRON_LIMIT, 25));
  }
  function getWebhookEventStaleLockMs(): number {
    return Math.max(60_000, parsePositiveInt(process.env.WEBHOOK_EVENT_STALE_LOCK_MS, 10 * 60_000));
  }
  function getWebhookEventTimeBudgetMs(): number {
    return Math.max(5_000, parsePositiveInt(process.env.WEBHOOK_EVENT_CRON_TIME_BUDGET_MS, 45_000));
  }
  ```
- **E11 — `lib/webhook-events/runner.ts:59-79`**
  ```ts
  const staleCutoff = new Date(Date.now() - getWebhookEventStaleLockMs());
  const released = await prisma.webhookEvent.updateMany({
    where: { status: WebhookEventStatus.RUNNING, lockedAt: { lt: staleCutoff } },
    data: {
      status: WebhookEventStatus.PENDING,
      lockedAt: null,
      lockedBy: null,
      startedAt: null,
      runAt: new Date(),
      lastError: "Released stale RUNNING lock",
    },
  });

  const due = await prisma.webhookEvent.findMany({
    where: { status: WebhookEventStatus.PENDING, runAt: { lte: new Date() } },
    orderBy: { runAt: "asc" },
    take: limit,
    select: { id: true },
  });
  ```
- **E12 — `app/api/cron/background-jobs/route.ts:8-35`**
  ```ts
  function isAuthorized(request: NextRequest): boolean {
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      console.warn("[Cron] CRON_SECRET not configured - endpoint disabled");
      return false;
    }

    const authHeader = request.headers.get("Authorization");
    const legacy = request.headers.get("x-cron-secret");

    return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
  }

  export async function GET(request: NextRequest) {
    return withAiTelemetrySource(request.nextUrl.pathname, async () => {
      if (!isAuthorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const results = await processBackgroundJobs();
      return NextResponse.json({ success: true, ...results, timestamp: new Date().toISOString() });
    });
  }
  ```

### SOLVE (Confidence: 0.9)
- Background work is represented as a **durable DB row** with operational state (`status`, `runAt`, `attempts/maxAttempts`, `lockedAt/lockedBy`, `lastError`). (E1)
- The system enqueues work via `enqueueBackgroundJob()` with a **caller-provided `dedupeKey`**, and duplicates are prevented by the DB unique constraint (duplicate enqueue returns `false`). (E3, E1)
- A shared helper `buildJobDedupeKey(clientId, messageId, jobType)` encodes the common contract `{clientId}:{messageId}:{jobType}`. (E4)
- The background job cron endpoint is protected by `CRON_SECRET` (Authorization Bearer or legacy header) and returns metrics from the runner. (E12)
- Each cron run:
  - **drains durable `WebhookEvent`s first** (bounded; best-effort), then processes `BackgroundJob`s. (E6, E2)
  - **releases stale RUNNING locks** older than a configurable cutoff, resetting them to `PENDING` and scheduling them immediately. (E6)
  - selects due jobs (`PENDING` + `runAt <= now`), locks each job via an atomic `updateMany` guarded by `status === PENDING`, and increments attempts. (E6, E7)
  - executes a type-specific handler inside an AI telemetry context (e.g., email inbound post-process, sms post-process). (E8)
  - on failure, schedules a retry with exponential backoff + jitter until `maxAttempts`, otherwise marks `FAILED`. (E9, E5)
- Operational knobs are environment variables:
  - Jobs: `BACKGROUND_JOB_CRON_LIMIT`, `BACKGROUND_JOB_STALE_LOCK_MS`, `BACKGROUND_JOB_CRON_TIME_BUDGET_MS`. (E5)
  - Webhook events: `WEBHOOK_EVENT_CRON_LIMIT`, `WEBHOOK_EVENT_STALE_LOCK_MS`, `WEBHOOK_EVENT_CRON_TIME_BUDGET_MS`. (E10)

### VERIFY
- The lock strategy is **cooperative**: jobs are locked by updating `status` from `PENDING → RUNNING` under a guard (`where: { id, status: PENDING }`). This prevents double-execution under concurrent cron invocations. (E7)
- Stale lock release assumes any RUNNING row older than `BACKGROUND_JOB_STALE_LOCK_MS` is safe to re-run; long-running tasks must be idempotent. (E6)
- The runner prioritizes draining `WebhookEvent`s first; this is a deliberate latency vs. throughput tradeoff to keep webhook request handlers thin (queue rows) and process bursts asynchronously. (E2, E6)

### SYNTHESIZE
- **Mental model:** Webhooks enqueue work → DB rows represent “to-do” items → cron runner drains `WebhookEvent` burst queue first → then locks and runs `BackgroundJob`s with retries/backoff.
- **Debugging checkpoints:**
  - “Jobs not running” → check `CRON_SECRET` and `/api/cron/background-jobs` returns 200. (E12)
  - “Jobs stuck RUNNING” → check `lockedAt` vs `BACKGROUND_JOB_STALE_LOCK_MS`; stale locks should self-heal. (E1, E6)
  - “Same work enqueued repeatedly” → inspect `dedupeKey` construction and uniqueness; prefer `buildJobDedupeKey()` for message-scoped jobs. (E4, E1)
  - “Webhook bursts causing slow requests” → confirm the path enqueues `WebhookEvent`/`BackgroundJob` rather than doing heavy DB upserts synchronously. (E2, E6)

## 8) AI Pipeline (Sentiment → Draft Generation → Gating)

### PLAN
- Identify the “AI pipeline” trigger points (what kicks off sentiment + drafting).
- Identify how sentiment is produced (email vs sms, OpenAI-on vs OpenAI-off behavior, fast-path safety).
- Identify how drafting works (idempotency via triggerMessageId, persona/knowledge selection).
- Identify additional email-draft context enrichment (signature/footer extraction, explicit timezone availability formatting).
- Identify how “auto-send vs human review vs skip” is decided (campaign AI auto-send vs legacy auto-reply).
- Identify what gets persisted for observability (draft status + auto-send evaluation metadata).

### LOCATE
- `prisma/schema.prisma`: `model AIDraft`, `model EmailCampaign` (response mode, thresholds, delay window)
- Inbound post-process entrypoints:
  - Email: `lib/background-jobs/email-inbound-post-process.ts`
  - SMS: `lib/background-jobs/sms-inbound-post-process.ts`
  - SmartLead/Instantly: `lib/background-jobs/*-inbound-post-process.ts` + `lib/inbound-post-process/pipeline.ts`
- Sentiment:
  - `lib/sentiment.ts`: `analyzeInboundEmailReply`, `classifySentiment`, `isOptOutText`, bounce fast-paths
- Drafts:
  - `lib/ai-drafts.ts`: `generateResponseDraft`, `shouldGenerateDraft`, persona resolution
  - `lib/email-signature-context.ts`: signature/footer extraction for email drafts (Phase 76)
  - `lib/signature-extractor.ts`: structured signature extraction prompt schema (Phase 77)
  - `lib/ai/prompt-registry.ts`: prompt keys + overrides (signature prompts)
- Auto-send / gating:
  - `lib/auto-send/README.md`, `lib/auto-send/orchestrator.ts`
  - `lib/auto-send-evaluator.ts` (campaign AI auto-send evaluation)
  - `lib/auto-reply-gate.ts` (legacy per-lead auto-reply decision)

### EXTRACT
- **E1 — `prisma/schema.prisma:808-840`**
  ```prisma
  // AI-generated draft messages pending approval
  model AIDraft {
    id        String   @id @default(uuid())
    leadId    String
    lead      Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)
    triggerMessageId String? // Inbound Message.id that triggered this draft (idempotency key)
    content   String   @db.Text
    channel   String   @default("sms") // sms | email
    status    String   @default("pending") // pending, approved, rejected
    createdAt DateTime @default(now())

    // Phase 70: Persist AI auto-send evaluation metadata (for dashboard visibility + filtering).
    autoSendEvaluatedAt   DateTime?
    autoSendConfidence    Float?
    autoSendThreshold     Float?
    autoSendReason        String?   @db.Text
    autoSendAction        String?
    autoSendSlackNotified Boolean   @default(false)

    // Phase 70: Slack notification tracking (for interactive button updates).
    slackNotificationChannelId String?
    slackNotificationMessageTs String?

    @@unique([triggerMessageId, channel])
  }
  ```
- **E2 — `prisma/schema.prisma:961-984`**
  ```prisma
  model EmailCampaign {
    id             String   @id @default(uuid())
    bisonCampaignId String
    name           String
    clientId       String
    client         Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
    responseMode   CampaignResponseMode @default(SETTER_MANAGED)
    autoSendConfidenceThreshold Float @default(0.9)
    // Phase 47l: Auto-send delay window (seconds)
    autoSendDelayMinSeconds Int @default(180) // 3 minutes
    autoSendDelayMaxSeconds Int @default(420) // 7 minutes
    // Booking process assignment (Phase 36)
    bookingProcessId String?
    bookingProcess   BookingProcess? @relation(fields: [bookingProcessId], references: [id], onDelete: SetNull)
    // AI Persona assignment (Phase 39)
    aiPersonaId      String?
    aiPersona        AiPersona? @relation(fields: [aiPersonaId], references: [id], onDelete: SetNull)
  }
  ```
- **E3 — `lib/background-jobs/smartlead-inbound-post-process.ts:3-12`**
  ```ts
  import { runInboundPostProcessPipeline } from "@/lib/inbound-post-process";
  import { smartLeadInboundPostProcessAdapter } from "@/lib/inbound-post-process/adapters/smartlead";

  export async function runSmartLeadInboundPostProcessJob(params: { clientId: string; leadId: string; messageId: string }): Promise<void> {
    await runInboundPostProcessPipeline({ ...params, adapter: smartLeadInboundPostProcessAdapter });
  }
  ```
- **E4 — `lib/inbound-post-process/pipeline.ts:150-209`**
  ```ts
  const contextMessages = await prisma.message.findMany({
    where: { leadId: lead.id },
    orderBy: { sentAt: "desc" },
    take: 40,
    select: { sentAt: true, channel: true, direction: true, body: true, subject: true },
  });

  const transcript = buildSentimentTranscriptFromMessages([
    ...contextMessages.reverse(),
    { sentAt: messageSentAt, channel: "email", direction: "inbound", body: messageBody, subject },
  ]);

  const inboundCombinedForSafety = `Subject: ${subject ?? ""} | ${messageBody}`;
  const mustBlacklist =
    isOptOutText(inboundCombinedForSafety) ||
    detectBounce([{ body: inboundCombinedForSafety, direction: "inbound", channel: "email" }]);

  let sentimentTag: SentimentTag;
  if (mustBlacklist) {
    sentimentTag = "Blacklist";
  } else {
    const analysis = await analyzeInboundEmailReply({ clientId: client.id, leadId: lead.id, clientName: client.name, subject, body_text: rawText, provider_cleaned_text: messageBody, conversation_transcript: transcript });
    sentimentTag = analysis ? mapInboxClassificationToSentimentTag(analysis.classification) : await classifySentiment(transcript, { clientId: client.id, leadId: lead.id });
  }

  const leadStatus = SENTIMENT_TO_STATUS[sentimentTag] || lead.status || "new";
  await prisma.lead.update({ where: { id: lead.id }, data: { sentimentTag, status: leadStatus } });
  ```
- **E5 — `lib/inbound-post-process/pipeline.ts:267-272`**
  ```ts
  if (sentimentTag === "Blacklist" || sentimentTag === "Automated Reply") {
    await prisma.aIDraft.updateMany({
      where: { leadId: lead.id, status: "pending" },
      data: { status: "rejected" },
    });
  }
  ```
- **E6 — `lib/inbound-post-process/pipeline.ts:261-327`**
  ```ts
  const autoBook = await processMessageForAutoBooking(lead.id, inboundText, { channel: "email" });

  if (!autoBook.booked && shouldGenerateDraft(sentimentTag, lead.email)) {
    const draftResult = await generateResponseDraft(
      lead.id,
      `Subject: ${subject ?? ""}\n\n${messageBody}`,
      sentimentTag,
      "email",
      { timeoutMs: webhookDraftTimeoutMs, triggerMessageId: message.id }
    );

    if (draftResult.success) {
      const draftId = draftResult.draftId;
      if (draftId) {
        const autoSendResult = await executeAutoSend({
          clientId: client.id,
          leadId: lead.id,
          triggerMessageId: message.id,
          draftId,
          draftContent: draftResult.content || "",
          channel: "email",
          latestInbound: messageBody,
          subject,
          conversationHistory: transcript,
          sentimentTag,
          messageSentAt,
          emailCampaign,
          autoReplyEnabled: lead.autoReplyEnabled,
          validateImmediateSend: true,
          includeDraftPreviewInSlack: false,
        });
      }
    }
  }
  ```
- **E7 — `lib/sentiment.ts:365-392`**
  ```ts
  export async function analyzeInboundEmailReply(opts: {
    clientId: string;
    leadId?: string | null;
    clientName?: string | null;
    lead?: {
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
      time_received?: string | null;
    } | null;
    subject?: string | null;
    body_text?: string | null;
    provider_cleaned_text?: string | null;
    entire_conversation_thread_html?: string | null;
    automated_reply?: boolean | null;
    conversation_transcript?: string | null;
    availability_text?: string | null;
    maxRetries?: number;
  }): Promise<EmailInboxAnalysis | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    const maxRetries = opts.maxRetries ?? 2;
    const resolved = await resolvePromptTemplate({
      promptKey: "sentiment.email_inbox_analyze.v1",
      clientId: opts.clientId,
      systemFallback: EMAIL_INBOX_MANAGER_SYSTEM,
    });
  ```
- **E8 — `lib/sentiment.ts:634-677`**
  ```ts
  export async function classifySentiment(transcript: string, opts: { clientId: string; leadId?: string | null; maxRetries?: number }): Promise<SentimentTag> {
    if (!transcript || !process.env.OPENAI_API_KEY) {
      return "Neutral";
    }

    const { lastLeadText } = extractLeadTextFromTranscript(transcript);
    if (!lastLeadText.trim()) {
      // No lead reply found; never classify based on agent outbound-only context.
      return "New";
    }

    if (matchesAnyPattern([/\\bnot interested\\b/i, /\\bno thanks\\b/i], lastLeadCombined)) {
      return "Not Interested";
    }
    if (matchesAnyPattern([/\\bout of office\\b/i, /\\bOOO\\b/i], lastLeadCombined)) {
      return "Out of Office";
    }
  }
  ```
- **E9 — `lib/ai-drafts.ts:1037-1051`**
  ```ts
  if (triggerMessageId) {
    const existing = await prisma.aIDraft.findFirst({
      where: { triggerMessageId, channel },
      select: { id: true, content: true, leadId: true },
    });

    if (existing) {
      return { success: true, draftId: existing.id, content: existing.content };
    }
  }
  ```
- **E10 — `lib/ai-drafts.ts:1139-1144`**
  ```ts
  // Resolve AI Persona (Phase 39)
  // Priority: campaign persona > default persona > workspace settings
  const persona = resolvePersona(lead as LeadForPersona, channel);
  ```
- **E11 — `lib/ai-drafts.ts:2366-2375`**
  ```ts
  export function shouldGenerateDraft(sentimentTag: string, email?: string | null): boolean {
    // Never generate drafts for bounce email addresses
    if (isBounceEmailAddress(email)) return false;
    const normalized = sentimentTag === "Positive" ? "Interested" : sentimentTag;
    return normalized === "Follow Up" || isPositiveSentiment(normalized);
  }
  ```
- **E12 — `lib/auto-send/README.md:10-33`**
  ```md
  Auto-send is precedence-based (not enforced by DB constraints):

  1) **EmailCampaign AI auto-send (modern)**
  - Trigger: `lead.emailCampaign?.responseMode === "AI_AUTO_SEND"`
  - Evaluator: `evaluateAutoSend()` (`lib/auto-send-evaluator.ts`)

  2) **Legacy per-lead auto-reply**
  - Trigger: `!lead.emailCampaign && lead.autoReplyEnabled === true`
  - Evaluator: `decideShouldAutoReply()` (`lib/auto-reply-gate.ts`)

  3) **Disabled**
  - Any other configuration is treated as “draft-only”.
  ```
- **E13 — `lib/auto-send/orchestrator.ts:17-40`**
  ```ts
  export function isAutoSendGloballyDisabled(): boolean {
    return process.env.AUTO_SEND_DISABLED === "1";
  }

  export function determineAutoSendMode(context: AutoSendContext): AutoSendMode {
    // Global kill-switch takes precedence over all other logic
    if (isAutoSendGloballyDisabled()) return "DISABLED";

    if (context.emailCampaign && context.emailCampaign.responseMode === "AI_AUTO_SEND") return "AI_AUTO_SEND";
    if (!context.emailCampaign && context.autoReplyEnabled) return "LEGACY_AUTO_REPLY";
    return "DISABLED";
  }
  ```
- **E14 — `lib/auto-send-evaluator.ts:52-88`**
  ```ts
  // Hard safety: never auto-send to opt-outs.
  if (isOptOutText(`Subject: ${subject} | ${latestInbound}`)) {
    return { confidence: 0, safeToSend: false, requiresHumanReview: true, reason: "Opt-out/unsubscribe request detected" };
  }

  // If AI isn't configured, default to safe behavior (no auto-send).
  if (!process.env.OPENAI_API_KEY) {
    return { confidence: 0, safeToSend: false, requiresHumanReview: true, reason: "OPENAI_API_KEY not configured" };
  }
  ```
- **E15 — `lib/auto-reply-gate.ts:42-62`**
  ```ts
  // Hard safety: never auto-reply to opt-outs.
  if (isOptOutText(`Subject: ${subject} | ${latestInbound}`)) {
    return { shouldReply: false, reason: "Opt-out/unsubscribe request detected" };
  }
  if (categorization === "Blacklist" || categorization === "Automated Reply") {
    return { shouldReply: false, reason: `Categorized as ${categorization}` };
  }
  if (isAckOnly(latestInbound)) {
    return { shouldReply: false, reason: "Acknowledgement-only reply" };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { shouldReply: false, reason: "OPENAI_API_KEY not configured" };
  }
  ```
- **E16 — `lib/ai-drafts.ts:1457-1520`**
  ```ts
      // ---------------------------------------------------------------------------
      // Trigger email signature/footer context (Phase 76)
      // ---------------------------------------------------------------------------
      let signatureContextForPrompt: string | null = null;
      if (triggerMessageId) {
        try {
          const triggerMessage = await prisma.message.findUnique({
            where: { id: triggerMessageId },
            select: { rawText: true, rawHtml: true },
          });

          const expectedSignatureName = currentReplierName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null;
          const expectedSignatureEmail = currentReplierEmail || lead.email || null;

          const signatureContext = await extractImportantEmailSignatureContext({
            clientId: lead.clientId,
            leadId,
            leadName: expectedSignatureName,
            leadEmail: expectedSignatureEmail,
            rawText: triggerMessage?.rawText ?? null,
            rawHtml: triggerMessage?.rawHtml ?? null,
            timeoutMs: Math.min(4500, Math.max(1000, Math.floor(timeoutMs * 0.15))),
          });

          signatureContextForPrompt = signatureContext ? formatEmailSignatureContextForPrompt(signatureContext) : null;
        } catch (error) {
          console.warn("[AI Drafts] Failed to extract signature/footer context for prompt:", error);
        }
      }

	      // Split timeout: ~40% for strategy, ~60% for generation
	      const strategyTimeoutMs = Math.max(3000, Math.floor(timeoutMs * 0.4));
	      const generationTimeoutMs = Math.max(3000, timeoutMs - strategyTimeoutMs);

      // Step 1: Strategy
      let strategy: EmailDraftStrategy | null = null;
      let strategyInteractionId: string | null = null;

      let strategyInstructions = buildEmailDraftStrategyInstructions({
        aiName,
        aiTone,
        firstName,
        lastName: lead.lastName,
        leadEmail: lead.email,
        currentReplierName,
        currentReplierEmail,
        leadCompanyName: lead.companyName,
        leadCompanyWebsite: lead.companyWebsite,
        leadCompanyState: lead.companyState,
        leadIndustry: lead.industry,
        leadEmployeeHeadcount: lead.employeeHeadcount,
        leadLinkedinUrl: lead.linkedinUrl,
        ourCompanyName: companyName,
        sentimentTag,
        responseStrategy,
        aiGoals: aiGoals || null,
        serviceDescription: serviceDescription || null,
        qualificationQuestions,
        knowledgeContext,
        availability,
        archetype: preSelectedArchetype,
        shouldSelectArchetype,
        signatureContext: signatureContextForPrompt,
      });
  ```
- **E17 — `lib/email-signature-context.ts:245-333`**
  ```ts
  export async function extractImportantEmailSignatureContext(opts: {
    clientId: string;
    leadId?: string | null;
    leadName?: string | null;
    leadEmail?: string | null;
    rawText?: string | null;
    rawHtml?: string | null;
    timeoutMs?: number;
  }): Promise<EmailSignatureContextExtraction | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    const sourceText = (() => {
      const rawText = (opts.rawText || "").trim();
      if (rawText) return rawText;
      const rawHtml = (opts.rawHtml || "").trim();
      if (rawHtml) return htmlToPlainTextPreservingAnchorHrefs(rawHtml);
      return "";
    })();

    const clamped = clampSignatureCandidate(sourceText);
    if (!clamped) return null;
    if (!hasSignatureSignal(clamped)) return null;

    const signatureFooterCandidate = extractSignatureFooterCandidate(clamped);
    if (!signatureFooterCandidate) return null;

    const detectedUrls = extractUrlsFromText(signatureFooterCandidate);

    const leadName = opts.leadName?.trim() || "Unknown";
    const leadEmail = opts.leadEmail?.trim() || "unknown@example.com";

    const systemFallback =
      "Extract the important contact + scheduling-link info from an email signature/footer. Output valid JSON only.";

    const input = `Expected lead: ${leadName} <${leadEmail}>\n\nSignature/footer candidate (may include junk/disclaimers):\n${signatureFooterCandidate.slice(0, 5000)}\n\nDetected URLs (choose only from these; do not invent):\n${detectedUrls.map((u) => `- ${u}`).join("\n") || "(none)"}`;

    const structured = await runStructuredJsonPrompt<EmailSignatureContextExtraction>({
      pattern: "structured_json",
      clientId: opts.clientId,
      leadId: opts.leadId,
      featureId: "signature.context",
      promptKey: "signature.context.v1",
      model: "gpt-5-nano",
      reasoningEffort: "minimal",
      systemFallback,
      templateVars: { leadName, leadEmail },
      input,
      schemaName: "email_signature_context",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: ["string", "null"] },
          title: { type: ["string", "null"] },
          company: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          linkedinUrl: { type: ["string", "null"] },
          schedulingLinks: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
          otherLinks: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 10 },
          importantLines: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 10 },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: [
          "name",
          "title",
          "company",
          "email",
          "phone",
          "linkedinUrl",
          "schedulingLinks",
          "otherLinks",
          "importantLines",
          "confidence",
        ],
      },
      budget: {
        min: 300,
        max: 900,
        retryMax: 1600,
        retryMinBaseTokens: 600,
        retryExtraTokens: 500,
        overheadTokens: 256,
        outputScale: 0.15,
        preferApiCount: true,
      },
      timeoutMs: typeof opts.timeoutMs === "number" ? Math.max(1000, Math.trunc(opts.timeoutMs)) : 4500,
      maxRetries: 0,
    });
  ```
- **E18 — `lib/ai-drafts.ts:1256-1274`**
  ```ts
  const timeZone = tzResult.timezone || settings?.timezone || "UTC";
  const mode = "explicit_tz"; // Always show explicit timezone (e.g., "EST", "PST")
  ```
- **E19 — `lib/ai-drafts.ts:888-894`**
  ```ts
  const signatureContextSection = opts.signatureContext
    ? `\nTRIGGER EMAIL SIGNATURE/FOOTER (EXTRACTED — IMPORTANT CONTEXT):\n${opts.signatureContext}\nIMPORTANT: If a scheduling link is present above, do NOT claim it "didn't come through" or "wasn't received".`
    : "";

  const availabilitySection = opts.availability.length > 0
    ? `\nAVAILABLE TIMES (use verbatim if scheduling):\n${opts.availability.map(s => `- ${s}`).join("\n")}`
    : "\nNo specific availability times provided.";
  ```

### SOLVE (Confidence: 0.85)
- **Trigger:** The AI pipeline runs during inbound post-processing (background jobs per channel/provider). SmartLead is wired into the shared pipeline (`runInboundPostProcessPipeline`). (E3)
- **Transcript & safety:** The system builds a transcript from recent messages and uses hard safety checks (opt-out/bounce) to force `sentimentTag = "Blacklist"`. (E4)
- **Sentiment production:**
  - If OpenAI is configured, email replies can be analyzed via `analyzeInboundEmailReply` (structured email inbox analysis). Otherwise it returns `null` and the pipeline falls back to `classifySentiment`. (E7, E4)
  - `classifySentiment` returns `Neutral` when OpenAI is not configured, and it has fast-path pattern matches for common replies (e.g., “Not Interested”, “Out of Office”). (E8)
  - Sentiment is persisted onto the Lead and mapped to a Lead status. (E4)
- **Draft generation gating:**
  - Draft generation is a whitelist: only positive intents plus `Follow Up`, and never for bounce-like email addresses. (E11)
  - Draft generation is **idempotent** per inbound trigger message + channel (DB uniqueness + runtime “reuse existing draft” behavior). (E1, E9)
  - Persona resolution is explicit: campaign persona > default persona > workspace settings. (E10, E2)
  - For email drafts, availability times are formatted with an explicit timezone abbreviation (e.g., “EST”, “PST”) rather than “(your time)”. (E18)
  - For email drafts, the system can extract signature/footer context from the trigger email and inject it into instructions (including a hard rule not to claim scheduling links were “missing”). (E16, E17, E19)
- **Auto-send decision (post-draft):**
  - The system uses precedence-based auto-send modes: campaign AI auto-send, else legacy per-lead auto-reply, else disabled (draft-only). (E12, E13)
  - There is a global kill-switch `AUTO_SEND_DISABLED=1`. (E13)
  - Campaign AI auto-send evaluation is conservatively blocked for opt-outs, Blacklist/Automated Reply, or missing `OPENAI_API_KEY`. (E14)
- **Draft suppression on compliance signals:** If a lead is Blacklisted or detected as automated reply, any pending drafts are rejected. (E5)

### VERIFY
- The pipeline is designed to be safe when OpenAI is unavailable: `analyzeInboundEmailReply` returns `null` and `classifySentiment` returns `Neutral`, which reduces downstream auto-actions (no “positive” sentiment) at the cost of less automation. (E7, E8, E11)
- “Campaign exists but not AI_AUTO_SEND” is treated as draft-only; legacy per-lead auto-reply won’t run in that case. This is explicitly documented as a nuance. (E12)
- Idempotency for drafts depends on callers providing `triggerMessageId` consistently; the DB unique constraint helps detect duplicates but can still throw if violated (callers should reuse). (E1, E9)
- Signature/footer extraction is best-effort and safety-gated: it’s disabled without `OPENAI_API_KEY`, passes a detected-URL allowlist into the prompt, and uses a bounded timeout. (E17, E16)

### SYNTHESIZE
- **End-to-end AI loop (in words):** inbound message → transcript → sentiment classification (safety-first) → lead status update → (optional) AI draft generation → auto-send mode selection → send/schedule/Slack-review/skip.
- **Operational “knobs” (where to set behavior):**
  - “Draft only” vs “AI auto-send”: set `EmailCampaign.responseMode` (`SETTER_MANAGED` vs `AI_AUTO_SEND`). (E2, E12)
  - Threshold + delay window: `EmailCampaign.autoSendConfidenceThreshold`, `autoSendDelayMinSeconds/MaxSeconds`. (E2)
  - Emergency stop: `AUTO_SEND_DISABLED=1`. (E13)
  - OpenAI enablement: `OPENAI_API_KEY` gates both classification and auto-send evaluation. (E7, E8, E14)

## 9) Auto-Send + Slack Human Approval (Buttons → Webhook → Send Attribution)

### PLAN
- Identify how “needs_review” happens in auto-send and what Slack message is sent.
- Identify what the Slack buttons encode (payload) and where they deep-link in the dashboard.
- Identify how Slack interactions are verified (signature/timestamp) and how “Approve & Send” is executed.
- Identify how sends are attributed (`sentBy: ai` vs `sentBy: setter`) and what is persisted for audit.

### LOCATE
- `lib/auto-send/orchestrator.ts`: `sendReviewNeededSlackDm`, `approve_send` button value, `safeRecord` action `needs_review`
- `lib/auto-send/record-auto-send-decision.ts`: how `AIDraft.autoSend*` + Slack metadata fields are persisted
- `lib/slack-dm.ts`: `sendSlackDmByEmail`, `updateSlackMessage`, required env vars (`SLACK_BOT_TOKEN`)
- `app/api/webhooks/slack/interactions/route.ts`: signature verification (`SLACK_SIGNING_SECRET`), parse `payload`, `approve_send` handler
- `lib/email-send.ts`: `sendEmailReplyForDraftSystem` (system send; compliance; idempotency)

### EXTRACT
- **E1 — `lib/auto-send/orchestrator.ts:85-160`**
  ```ts
  // Deep-link to the correct workspace + lead (+ draft) to avoid Slack vs dashboard mismatches.
  const dashboardUrl = `${deps.getPublicAppUrl()}/?view=inbox&clientId=${encodeURIComponent(context.clientId)}&leadId=${encodeURIComponent(context.leadId)}&draftId=${encodeURIComponent(context.draftId)}`;

  // Phase 70: Build button action value with IDs needed for approval webhook
  const buttonValue = JSON.stringify({
    draftId: context.draftId,
    leadId: context.leadId,
    clientId: context.clientId,
  });

  {
    type: "actions",
    block_id: `review_actions_${context.draftId}`,
    elements: [
      { type: "button", text: { type: "plain_text", text: "Edit in dashboard", emoji: true }, url: dashboardUrl, action_id: "view_dashboard" },
      { type: "button", text: { type: "plain_text", text: "Approve & Send", emoji: true }, style: "primary", action_id: "approve_send", value: buttonValue },
    ],
  }
  ```
- **E2 — `lib/auto-send/orchestrator.ts:350-368`**
  ```ts
  const dmResult = await sendReviewNeededSlackDm({ context, confidence: evaluation.confidence, threshold, reason: evaluation.reason });

  await safeRecord({
    draftId: context.draftId,
    evaluatedAt,
    confidence: evaluation.confidence,
    threshold,
    reason: evaluation.reason,
    action: "needs_review",
    slackNotified: dmResult.success,
    // Phase 70: Persist Slack message metadata for interactive button updates
    slackNotificationChannelId: dmResult.channelId,
    slackNotificationMessageTs: dmResult.messageTs,
  });
  ```
- **E3 — `lib/auto-send/orchestrator.ts:304-314`**
  ```ts
  const sendResult = await deps.approveAndSendDraftSystem(context.draftId, { sentBy: "ai" });
  if (sendResult.success) {
    await safeRecord({ draftId: context.draftId, evaluatedAt, confidence: evaluation.confidence, threshold, reason: evaluation.reason, action: "send_immediate", slackNotified: false });
  }
  ```
- **E4 — `lib/auto-send/record-auto-send-decision.ts:18-50`**
  ```ts
  export async function recordAutoSendDecision(record: AutoSendDecisionRecord): Promise<void> {
    const data = {
      autoSendEvaluatedAt: record.evaluatedAt,
      autoSendConfidence: typeof record.confidence === "number" ? record.confidence : null,
      autoSendThreshold: typeof record.threshold === "number" ? record.threshold : null,
      autoSendReason: record.reason ? record.reason : null,
      autoSendAction: record.action,
      autoSendSlackNotified: Boolean(record.slackNotified),
      slackNotificationChannelId: record.slackNotificationChannelId ?? null,
      slackNotificationMessageTs: record.slackNotificationMessageTs ?? null,
    };

    await prisma.aIDraft.updateMany({ where: { id: record.draftId }, data });
  }
  ```
- **E5 — `lib/slack-dm.ts:125-173`**
  ```ts
  export async function sendSlackDmByEmail(opts: {
    email: string;
    text: string;
    blocks?: SlackBlock[];
    dedupeKey?: string;
    dedupeTtlMs?: number;
  }): Promise<SlackDmResult> {
    const ttlMs = Math.max(1_000, opts.dedupeTtlMs ?? 10 * 60 * 1000);

    if (opts.dedupeKey) {
      const last = dedupeCache.get(opts.dedupeKey);
      const now = Date.now();
      if (last && now - last < ttlMs) {
        return { success: true, skipped: true };
      }
      dedupeCache.set(opts.dedupeKey, now);
    }

    const userId = await lookupSlackUserIdByEmail(opts.email);
    if (!userId) return { success: false, error: "Slack user lookup failed" };

    const channelId = await openDmChannel(userId);
    if (!channelId) return { success: false, error: "Slack DM channel open failed" };

    const res = await slackPost<{ ts?: string }>("chat.postMessage", {
      channel: channelId,
      text: opts.text,
      ...(opts.blocks ? { blocks: opts.blocks } : {}),
    });

    if (!res.ok) {
      return { success: false, error: res.error || "Slack message failed" };
    }

    // Phase 70: Return message metadata for interactive button updates
    return {
      success: true,
      messageTs: res.ts,
      channelId,
    };
  }
  ```
- **E6 — `app/api/webhooks/slack/interactions/route.ts:29-60`**
  ```ts
  function verifySlackSignature(opts: { signature: string; timestamp: string; body: string }): boolean {
    if (!SLACK_SIGNING_SECRET) return false;
    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);
    if (Math.abs(currentTime - requestTime) > 300) return false;

    const sigBasestring = `v0:${timestamp}:${body}`;
    const expectedSignature =
      "v0=" + crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(sigBasestring, "utf8").digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  }
  ```
- **E7 — `app/api/webhooks/slack/interactions/route.ts:93-156`**
  ```ts
  // 3. Send the email
  // Slack approval is human-in-the-loop, so attribute this send as a human ("setter") send.
  const sendResult = await sendEmailReplyForDraftSystem(value.draftId, undefined, { sentBy: "setter" });
  ```
- **E8 — `app/api/webhooks/slack/interactions/route.ts:268-334`**
  ```ts
  export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const signature = request.headers.get("x-slack-signature") || "";
    const timestamp = request.headers.get("x-slack-request-timestamp") || "";
    if (!verifySlackSignature({ signature, timestamp, body: rawBody })) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");
    const payload = JSON.parse(payloadStr!) as SlackInteractionPayload;

    if (payload.type === "block_actions") {
      const actions = payload.actions || [];
      const channelId = payload.channel?.id || "";
      const messageTs = payload.message?.ts || "";
      const userName = payload.user?.name || payload.user?.username || "Unknown";

      for (const action of actions) {
        if (action.action_id === "approve_send" && action.value) {
          const value = JSON.parse(action.value) as ApproveButtonValue;
          await handleApproveSend({ value, channelId, messageTs, userName });
        }
      }
    }

    return NextResponse.json({ ok: true });
  }
  ```
- **E9 — `lib/email-send.ts:556-620`**
  ```ts
  const existingMessage = await prisma.message.findFirst({ where: { aiDraftId: draftId }, select: { id: true } });
  if (existingMessage) {
    await prisma.aIDraft.updateMany({ where: { id: draftId, status: "pending" }, data: { status: "approved" } }).catch(() => undefined);
    return { success: true, messageId: existingMessage.id };
  }

  // Compliance/backstop: never send to blacklisted/opted-out leads.
  if (lead.status === "blacklisted" || lead.sentimentTag === "Blacklist") {
    await prisma.aIDraft.update({ where: { id: draftId }, data: { status: "rejected" } });
    return { success: false, error: "Lead is blacklisted (opted out)" };
  }
  ```

### SOLVE (Confidence: 0.9)
- When campaign AI auto-send decides a draft needs review, it sends a Slack DM with:
  - a deep-link into the dashboard that includes `clientId`, `leadId`, and `draftId`, and
  - an **Approve & Send** button whose `value` is JSON containing `{ draftId, leadId, clientId }`. (E1, E2)
- The auto-send subsystem persists review/send metadata onto the draft (evaluatedAt, confidence, threshold, action, and Slack message identifiers). (E2, E4)
- Slack DMs are sent via Slack Web API:
  - user lookup by email → open DM channel → `chat.postMessage`, returning `channelId` and `ts` (message timestamp). (E5)
- Slack interactivity is handled by `POST /api/webhooks/slack/interactions` and is protected by Slack signature verification using `SLACK_SIGNING_SECRET` with a 5-minute timestamp window and HMAC. (E6, E8)
- When a human clicks **Approve & Send**, the interactions handler:
  - parses the `approve_send` action value JSON into IDs, and
  - sends the email via `sendEmailReplyForDraftSystem(..., { sentBy: "setter" })` (explicit human attribution). (E8, E7)
- Outbound sending is **idempotent** for drafts: if a message already exists with `aiDraftId`, the system returns success and marks the draft approved. (E9)

### VERIFY
- The approval webhook is only as reliable as Slack credentials:
  - `SLACK_SIGNING_SECRET` must be set or all interactions are rejected. (E6)
  - `SLACK_BOT_TOKEN` must be set or DMs cannot be delivered. (E5)
- Slack approval explicitly attributes sending as a human (`sentBy: "setter"`) even though it originates from AI review flow. This is intentional and documented in code comments. (E7)
- `sendEmailReplyForDraftSystem` includes a compliance backstop: blacklisted leads cannot be sent to, and the draft is rejected if attempted. (E9)

### SYNTHESIZE
- **Mental model:** AI generates a draft → auto-send evaluator either sends or asks for review → Slack DM carries a button with the draft ID → Slack interactions webhook verifies signature → “Approve & Send” triggers the system email sender and updates the Slack message.
- **Operational checklist for Slack review to work:**
  - Configure Slack App interactivity URL → `/api/webhooks/slack/interactions`. (E8)
  - Set `SLACK_SIGNING_SECRET` (interactions) and `SLACK_BOT_TOKEN` (sending + updating messages). (E6, E5)
  - Ensure the workspace has a functioning email integration so `sendEmailReplyForDraftSystem` can resolve a provider/thread handle. (E9)

## 10) Human Setter Workflow (UI → Server Actions → Outbound Send)

### PLAN
- Identify the UI surfaces setters use to work a conversation (view messages, compose, drafts).
- Identify how pending AI drafts are fetched and displayed (including Slack deep-links).
- Identify how setters send messages manually vs approve an AI draft (email/sms/linkedin).
- Identify draft lifecycle actions (reject, regenerate, reset).
- Identify access controls + attribution fields for outbound messages.

### LOCATE
- UI:
  - `components/dashboard/inbox-view.tsx`: renders `ActionStation` per selected conversation
  - `components/dashboard/action-station.tsx`: fetch drafts, compose box, approve/send/reject/regenerate, manual send
  - `components/dashboard/chat-message.tsx`: safe message rendering + “Show Original” for email rawHtml/rawText
- Message rendering:
  - `lib/safe-html.ts`: `safeLinkifiedHtmlFromText` (safe `<a>` + markdown-link support)
- Inbox payload shaping:
  - `actions/lead-actions.ts`: email-body link enhancement using `Message.rawHtml`
- Server actions:
  - `actions/message-actions.ts`: `getPendingDrafts`, `sendMessage` (SMS), `sendEmailMessage` (manual email), `sendLinkedInMessage`, `approveAndSendDraft`, `rejectDraft`, `regenerateDraft`
  - `actions/email-actions.ts`: `sendEmailReply` (AI draft email send wrapper)
- System send plumbing (for email): `lib/email-send.ts` (provider-aware, thread-handle aware, idempotent)

### EXTRACT
- **E1 — `components/dashboard/action-station.tsx:422-463`**
  ```ts
  // Fetch real AI drafts when conversation or active channel changes
  useEffect(() => {
    async function fetchDrafts() {
      const result = await getPendingDrafts(conversation.id, activeChannel)
      if (result.success && result.data && result.data.length > 0) {
        const draftData = result.data as AIDraft[]
        // If we were deep-linked from Slack, prefer the referenced draft to avoid mismatch.
        const preferredDrafts =
          deepLinkedDraftId && draftData.some((draft) => draft.id === deepLinkedDraftId)
            ? [...draftData].sort((a, b) => (a.id === deepLinkedDraftId ? -1 : b.id === deepLinkedDraftId ? 1 : 0))
            : draftData
        setDrafts(preferredDrafts)
        setComposeMessage(preferredDrafts[0].content)
        setOriginalDraft(preferredDrafts[0].content)
        setHasAiDraft(true)
      }
    }
    fetchDrafts()
  }, [conversation?.id, activeChannel, deepLinkedDraftId])
  ```
- **E2 — `components/dashboard/action-station.tsx:465-506`**
  ```ts
  const handleSendMessage = async () => {
    if (!composeMessage.trim() || !conversation) return
    if (isEmail && !toEmail) {
      toast.error("Select a recipient before sending.")
      return
    }

    let result
    if (isLinkedIn) {
      result = await sendLinkedInMessage(conversation.id, composeMessage, connectionNote || undefined)
    } else if (isEmail) {
      // Manual email reply (no AI draft required)
      result = await sendEmailMessage(conversation.id, composeMessage, {
        cc: ccRecipients,
        ...(hasEditedTo ? { toEmail, toName: selectedToName } : {}),
      })
    } else {
      // Regular SMS send
      result = await sendMessage(conversation.id, composeMessage)
    }
  }
  ```
- **E3 — `components/dashboard/action-station.tsx:535-547`**
  ```ts
  // If we have a real AI draft, approve it
  if (drafts.length > 0) {
    const result = await approveAndSendDraft(
      drafts[0].id,
      composeMessage,
      isEmail
        ? {
            cc: ccRecipients,
            ...(hasEditedTo ? { toEmail, toName: selectedToName } : {}),
          }
        : undefined
    )
    if (result.success) {
      toast.success("Draft approved and sent!")
      setDrafts([])
      setHasAiDraft(false)
    }
  }
  ```
- **E4 — `components/dashboard/action-station.tsx:467-489`**
  ```ts
  const handleRegenerateDraft = async () => {
    // Reject existing draft first if any
    if (drafts.length > 0) {
      await rejectDraft(drafts[0].id)
    }
    const result = await regenerateDraft(conversation.id, activeChannel)
    if (result.success && result.data) {
      setDrafts([{ id: result.data.id, content: result.data.content, status: "pending", createdAt: new Date() }])
      setComposeMessage(result.data.content)
      setOriginalDraft(result.data.content)
      setHasAiDraft(true)
    }
  }
  ```
- **E5 — `actions/message-actions.ts:1093-1108`**
  ```ts
  export async function getPendingDrafts(leadId: string, channel?: "sms" | "email" | "linkedin") {
    await requireLeadAccess(leadId);
    const drafts = await prisma.aIDraft.findMany({
      where: { leadId, status: "pending", channel: channel || undefined },
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data: drafts };
  }
  ```
- **E6 — `actions/message-actions.ts:876-886`**
  ```ts
  export async function sendMessage(leadId: string, message: string): Promise<SendMessageResult> {
    const user = await requireAuthUser();
    await requireLeadAccess(leadId);
    const result = await sendSmsSystem(leadId, message, { sentBy: "setter", sentByUserId: user.id });
    if (result.success) revalidatePath("/");
    return result;
  }
  ```
- **E7 — `actions/message-actions.ts:902-927`**
  ```ts
  export async function sendEmailMessage(
    leadId: string,
    message: string,
    options?: { cc?: string[]; toEmail?: string; toName?: string | null }
  ): Promise<SendMessageResult> {
    const user = await requireAuthUser();
    await requireLeadAccess(leadId);
    const result = await sendEmailReplyForLead(leadId, message, {
      sentBy: "setter",
      sentByUserId: user.id,
      cc: options?.cc,
      toEmail: options?.toEmail,
      toName: options?.toName,
    });
    return result.success ? { success: true, messageId: result.messageId } : { success: false, error: result.error };
  }
  ```
- **E8 — `actions/message-actions.ts:1383-1429`**
  ```ts
  // Reject any existing pending drafts for this channel
  await prisma.aIDraft.updateMany({
    where: { leadId, status: "pending", channel },
    data: { status: "rejected" },
  });

  // Build conversation transcript from recent messages (chronological)
  const recentMessages = await prisma.message.findMany({
    where: { leadId },
    orderBy: { sentAt: "desc" },
    take: 80,
    select: { sentAt: true, channel: true, direction: true, body: true, subject: true },
  });
  const transcript = buildSentimentTranscriptFromMessages(recentMessages.reverse());

  if (!shouldGenerateDraft(sentimentTag, email)) {
    return { success: false, error: "Cannot generate draft for this sentiment" };
  }

  const draftResult = await generateResponseDraft(leadId, transcript, sentimentTag, channel);
  ```
- **E9 — `actions/message-actions.ts:1132-1175`**
  ```ts
  export async function approveAndSendDraftSystem(
    draftId: string,
    opts: {
      sentBy: "ai" | "setter";
      sentByUserId?: string | null;
      editedContent?: string;
      cc?: string[];
      toEmail?: string;
      toName?: string | null;
    } = { sentBy: "setter" }
  ): Promise<SendMessageResult> {
    const draft = await prisma.aIDraft.findUnique({ where: { id: draftId }, select: { id: true, leadId: true, content: true, channel: true, status: true } });
    if (!draft || draft.status !== "pending") return { success: false, error: "Draft is not pending" };

    // Email drafts: use dedicated sender (keeps existing behavior)
    if (draft.channel === "email") {
      const result = await sendEmailReply(draftId, opts.editedContent, {
        sentBy: opts.sentBy,
        sentByUserId: opts.sentByUserId,
        cc: opts.cc,
        toEmail: opts.toEmail,
        toName: opts.toName,
      });
      return result.success ? { success: true, messageId: result.messageId } : { success: false, error: result.error };
    }
  }
  ```
- **E10 — `actions/email-actions.ts:14-33`**
  ```ts
  async function sendEmailReplyInternal(params: {
    lead: LeadForEmailSend;
    provider: EmailIntegrationProvider;
    messageContent: string;
    aiDraftId?: string;
    sentBy?: OutboundSentBy | null;
    sentByUserId?: string | null;
    ccOverride?: string[];
    toEmailOverride?: string;
    toNameOverride?: string | null;
  }): Promise<SendEmailResult> {
    const result = await sendEmailReplySystem(params);
    if (result.success) {
      revalidatePath("/");
    }
    return result;
  }
  ```

- **E11 — `components/dashboard/action-station.tsx:277-346`**
  ```ts
  const emailThreadProvider = useMemo(() => {
    const replyId = typeof latestInboundEmail?.emailBisonReplyId === "string" ? latestInboundEmail.emailBisonReplyId : ""
    if (!replyId) return null
    if (replyId.startsWith("instantly:")) return "instantly"
    if (replyId.startsWith("smartlead:")) return "smartlead"
    return "emailbison"
  }, [latestInboundEmail?.emailBisonReplyId])

  const toOptions = useMemo<EmailRecipientOption[]>(() => {
    // Prefer the current replier (if set), then latest inbound sender, then lead primary.
    push(lead.currentReplierEmail, lead.currentReplierName)
    push(latestInboundEmail?.fromEmail, latestInboundEmail?.fromName ?? null)
    push(lead.email, lead.name)
    for (const alt of lead.alternateEmails || []) push(alt, null)
    return options
  }, [conversation?.lead, latestInboundEmail?.fromEmail, latestInboundEmail?.fromName])

  const toDisabledReason =
    emailThreadProvider === "instantly" ? "Instantly replies do not support overriding the To recipient." : null
  ```

- **E12 — `actions/lead-actions.ts:241-282`**
  ```ts
  function enhanceEmailBodyWithLinkTargets(body: string, rawHtml?: string | null): string {
    const base = body || "";
    const links = rawHtml ? extractHttpLinksFromEmailHtml(rawHtml) : [];
    if (links.length === 0) return base;

    const missing = links.filter((l) => !base.includes(l.href));
    if (missing.length === 0) return base;

    const lines = missing.slice(0, 10).map((l) => `- [${l.label}](${l.href})`);
    return `${base.trim() ? base + "\n\n" : ""}Links:\n${lines.join("\n")}`;
  }
  ```

- **E13 — `lib/safe-html.ts:39-125`**
  ```ts
  /**
   * Convert plain text to safe HTML with:
   * - escaped text
   * - newline preservation via <br />
   * - linkified http(s) URLs
   * - linkified markdown-style links: [text](https://example.com)
   */
  export function safeLinkifiedHtmlFromText(
    input: string,
    opts?: { linkTarget?: "_blank" | "_self" }
  ): string {
    const text = normalizeNewlines(input || "");
    if (!text) return "";

    // Rough URL matcher; we validate further before emitting <a>.
    const urlRegex = /\bhttps?:\/\/[^\s<>()]+/gi;
    const markdownLinkRegex = /\[([^\]\n]{1,200})\]\(([^)\s]+)\)/gi;

    type Token =
      | { kind: "url"; start: number; end: number; raw: string; url: string }
      | { kind: "md"; start: number; end: number; raw: string; label: string; url: string };

    const mdTokens: Token[] = [];
    for (const match of text.matchAll(markdownLinkRegex)) {
      const start = match.index ?? 0;
      const raw = match[0] ?? "";
      const label = match[1] ?? "";
      const url = match[2] ?? "";
      if (!raw || !label || !url) continue;
      mdTokens.push({ kind: "md", start, end: start + raw.length, raw, label, url });
    }

    const urlTokens: Token[] = [];
    for (const match of text.matchAll(urlRegex)) {
      const start = match.index ?? 0;
      const raw = match[0] ?? "";
      if (!raw) continue;
      urlTokens.push({ kind: "url", start, end: start + raw.length, raw, url: raw });
    }

    const urlTokensFiltered = urlTokens.filter((token) => {
      // Avoid double-linkifying URLs that are inside a markdown link token.
      return !mdTokens.some((md) => token.start >= md.start && token.start < md.end);
    });

    const tokens: Token[] = [...mdTokens, ...urlTokensFiltered].sort((a, b) => a.start - b.start);

    let out = "";
    let lastIndex = 0;

    for (const token of tokens) {
      if (token.start < lastIndex) continue;

      out += escapeHtmlText(text.slice(lastIndex, token.start));

      const target = opts?.linkTarget ?? "_blank";

      if (token.kind === "md") {
        const rawUrl = token.url.trim();
        const { url: strippedUrl, trailing } = stripTrailingPunctuation(rawUrl);
        const normalizedUrl = strippedUrl.startsWith("www.") ? `https://${strippedUrl}` : strippedUrl;

        if (normalizedUrl && isSafeHttpUrl(normalizedUrl)) {
          const escapedHref = escapeHtmlText(normalizedUrl);
          const escapedLabel = escapeHtmlText(token.label);
          out += `<a href="${escapedHref}" target="${target}" rel="noopener noreferrer">${escapedLabel}</a>`;
          if (trailing) out += escapeHtmlText(trailing);
        } else {
          out += escapeHtmlText(token.raw);
        }
      } else {
        const { url, trailing } = stripTrailingPunctuation(token.url);
        if (url && isSafeHttpUrl(url)) {
          const escapedUrl = escapeHtmlText(url);
          out += `<a href="${escapedUrl}" target="${target}" rel="noopener noreferrer">${escapedUrl}</a>`;
          if (trailing) out += escapeHtmlText(trailing);
        } else {
          out += escapeHtmlText(token.raw);
        }
      }

      lastIndex = token.end;
    }

    out += escapeHtmlText(text.slice(lastIndex));
    return out.replace(/\n/g, "<br />");
  }
  ```

- **E14 — `components/dashboard/chat-message.tsx:191-207`**
  ```tsx
  {showOriginal && (message.rawHtml || message.rawText) ? (
    <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-64 overflow-auto">
      {originalText}
    </pre>
  ) : (
    <div
      className="text-sm leading-relaxed text-foreground whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: safeLinkifiedHtmlFromText(message.content || "") }}
    />
  )}
  ```

### SOLVE (Confidence: 0.85)
- Setters primarily operate through `InboxView` → `ActionStation` (per selected conversation) and a compose box that is **draft-aware**.
- Draft lifecycle in the UI:
  - `getPendingDrafts(leadId, channel)` returns `AIDraft` rows with `status="pending"`. (E5)
  - `ActionStation` automatically hydrates the compose box with the newest pending draft (and will prefer a deep-linked draftId to prevent Slack-vs-dashboard mismatch). (E1)
  - Setters can reject drafts (`rejectDraft`) or regenerate drafts (`regenerateDraft` rejects existing pending drafts and creates a new one from the last ~80 messages transcript). (E4, E8)
- Sending messages:
  - Manual SMS uses `sendMessage()` → `sendSmsSystem(...)` and attributes the send as `sentBy: "setter"` + `sentByUserId`. (E6)
  - Manual email uses `sendEmailMessage()` → `sendEmailReplyForLead(...)` and supports custom CC **and** an optional To override from the email composer. (E2, E7, E10, E11)
  - LinkedIn sends use `sendLinkedInMessage(...)` (Unipile waterfall path; see Section 5 for webhook ingestion and Section 12 for booking linkage). (E2)
- Approving an AI draft is a distinct path:
  - UI calls `approveAndSendDraft(draftId, editedContent, { cc, toEmail?, toName? })`, which routes to `approveAndSendDraftSystem`. (E3, E9)
  - For email drafts, the system routes through `sendEmailReply(...)`, which wraps the system sender and triggers cache invalidation. (E9, E10)

### VERIFY
- `regenerateDraft` explicitly gates draft creation on `shouldGenerateDraft(sentimentTag, email)`; if sentiment is not eligible, setters will see a “Cannot generate draft for this sentiment” error rather than getting a misleading draft. (E8)
- The UI currently treats the “active draft” as `drafts[0]` (first pending draft for the channel). Deep-link sorting reduces mismatch risk but multiple pending drafts are still possible. (E1)
- For email sends, the composer blocks sending when no To recipient is selected, and To overrides may be disabled for Instantly threads due to provider limitations. (E2, E11)
- Email message rendering is explicitly “safe HTML only”: server-side inbox payload can append extracted anchor links as markdown (`Links:\n- [label](url)`), and the client renders via `safeLinkifiedHtmlFromText` (only emits `<a>`/`<br />`, never raw provider HTML). (E12, E13, E14)

### SYNTHESIZE
- **Mental model:** Setter sees conversation → if a pending AI draft exists it is preloaded → setter can edit and approve/send (draft becomes approved and an outbound `Message` is created) or send manually without any draft.
- **What “production ready” depends on here:** correct workspace access enforcement in server actions + provider configuration for outbound sends (email provider keys, GHL keys for SMS, Unipile account for LinkedIn).

## 11) Follow-Ups Engine (Templates → Instances → Cron Processing)

### PLAN
- Identify the follow-up data model (sequence templates, steps, per-lead instances).
- Identify what triggers a sequence to start and how scheduling is anchored (relative to outbound touches).
- Identify cron processing rules (which instances are eligible; how pausing works on replies; how advancement works).
- Identify follow-up message generation (variables, booking link, availability selection, qualification question gating).
- Identify template safety policy (unknown variables blocked at save/activate; missing referenced values block sends and pause instances with `missing_*`).
- Identify operational controls (workspace pause, business hours, dry-run, “Airtable mode”).

### LOCATE
- `prisma/schema.prisma`: `FollowUpSequence`, `FollowUpStep`, `FollowUpInstance`
- `lib/followup-automation.ts`: sequence start triggers + outbound-touch scheduling policy (Phase 66/71)
- `lib/followup-engine.ts`: `processFollowUpsDue`, `executeFollowUpStep`, `generateFollowUpMessage`
- `lib/followup-template.ts`: template token registry + strict rendering (Phase 73)
- `actions/followup-sequence-actions.ts`: save/update validation + activation gating (Phase 73)
- `app/api/cron/followups/route.ts`: cron orchestration (resume categories + run process)

### EXTRACT
- **E1 — `prisma/schema.prisma:1013-1072`**
  ```prisma
  model FollowUpSequence {
    id          String   @id @default(uuid())
    name        String
    clientId    String
    isActive    Boolean  @default(true)
    triggerOn   String   @default("no_response")  // 'no_response' | 'meeting_selected' | 'manual'
    steps       FollowUpStep[]
    instances   FollowUpInstance[]
  }

  model FollowUpStep {
    id               String   @id @default(uuid())
    sequenceId       String
    stepOrder        Int               // Order within the sequence (1, 2, 3...)
    dayOffset        Int               // Day number in the sequence (1 = Day 1, 2 = Day 2, etc.). Backward compatible: 0 treated as Day 1.
    minuteOffset     Int      @default(0)
    channel          String            // 'email' | 'sms' | 'linkedin' | 'ai_voice'
    messageTemplate  String?  @db.Text
    subject          String?
    condition        String?  @db.Text
    requiresApproval Boolean  @default(false)
  }

  model FollowUpInstance {
    id             String   @id @default(uuid())
    leadId         String
    sequenceId     String
    currentStep    Int      @default(0)
    status         String   @default("active")  // 'active' | 'paused' | 'completed' | 'cancelled'
    pausedReason   String?
    nextStepDue    DateTime?
    completedAt    DateTime?
    @@unique([leadId, sequenceId])
    @@index([status])
    @@index([nextStepDue])
  }
  ```
- **E2 — `app/api/cron/followups/route.ts:16-77`**
  ```ts
  /**
   * GET /api/cron/followups
   * Processes all due follow-up instances.
   * Called automatically by Vercel Cron (configured in vercel.json)
   */
  export async function GET(request: NextRequest) {
    const authHeader = request.headers.get("Authorization");
    const expectedSecret = process.env.CRON_SECRET;
    if (authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const snoozed = await resumeSnoozedFollowUps({ limit: 200 });
    const resumed = await resumeGhostedFollowUps({ days: 7, limit: 100 });
    const enrichmentResumed = await resumeAwaitingEnrichmentFollowUps({ limit: 200 });
    const smsDndRetry = await retrySmsDndHeldLeads({ limit: 50 });
    const backfill = await backfillNoResponseFollowUpsDueOnCron();
    const results = await processFollowUpsDue();
    const notificationDigests = await processDailyNotificationDigestsDue({ limit: 50 });
  }
  ```
- **E3 — `lib/followup-engine.ts:1348-1412`**
  ```ts
  const instances = await prisma.followUpInstance.findMany({
    where: {
      status: "active",
      nextStepDue: { lte: now },
      lead: {
        autoFollowUpEnabled: true,
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      },
    },
    include: { lead: true, sequence: { include: { steps: { orderBy: { stepOrder: "asc" } } } } },
  });

  // Safety: if the lead has replied since the latest outbound touch, pause the instance
  const leadHasRepliedSinceLatestOutbound =
    instance.lead.lastMessageDirection === "inbound" ||
    (instance.lead.lastInboundAt && instance.lead.lastOutboundAt && instance.lead.lastInboundAt > instance.lead.lastOutboundAt);

  if (leadHasRepliedSinceLatestOutbound) {
    await prisma.followUpInstance.update({ where: { id: instance.id }, data: { status: "paused", pausedReason: "lead_replied" } });
    continue;
  }
  ```
- **E4 — `lib/followup-engine.ts:520-588`**
  ```ts
  if (process.env.FOLLOWUPS_DRY_RUN === "true") {
    return { success: true, action: "skipped", message: "FOLLOWUPS_DRY_RUN enabled - skipping follow-up execution" };
  }

  // Workspace-level pause: block automated follow-up execution while paused.
  if (isWorkspaceFollowUpsPaused({ followUpsPausedUntil: settings?.followUpsPausedUntil, now })) {
    await prisma.followUpInstance.update({ where: { id: instanceId }, data: { nextStepDue: pausedUntil } });
    return { success: true, action: "skipped", message: `Workspace follow-ups paused until ${pausedUntil.toISOString()}` };
  }

  // Check business hours
  if (!isWithinBusinessHours(settings)) {
    await prisma.followUpInstance.update({ where: { id: instanceId }, data: { nextStepDue: nextBusinessHour } });
    return { success: true, action: "skipped", message: `Rescheduled to next business hour: ${nextBusinessHour.toISOString()}` };
  }

  // Airtable Mode: email is handled externally (Airtable/n8n via EmailBison).
  if (settings?.airtableMode && step.channel === "email") {
    return { success: true, action: "skipped", message: "Airtable Mode enabled - email steps are disabled", advance: true };
  }
  ```
- **E5 — `lib/followup-engine.ts:386-437`**
  ```ts
  // Provider-aware booking link for {calendarLink}/{link}
  let bookingLink: string | null = null;
  bookingLink = await getBookingLink(lead.clientId, settings as any);

  const availabilityTokens = ["{availability}", "{time 1 day 1}", "{time 2 day 2}", "{x day x time}", "{y day y time}"];
  const needsAvailability = availabilityTokens.some((token) => (step.messageTemplate || "").includes(token) || (step.subject || "").includes(token));

  if (needsAvailability) {
    const answerState = await getLeadQualificationAnswerState({ leadId: lead.id, clientId: lead.clientId });
    const requestedAvailabilitySource: AvailabilitySource =
      answerState.requiredQuestionIds.length > 0 && !answerState.hasAllRequiredAnswers ? "DIRECT_BOOK" : "DEFAULT";
    const availability = await getWorkspaceAvailabilitySlotsUtc(lead.clientId, { refreshIfStale: true, availabilitySource: requestedAvailabilitySource });
    if (availability.slotsUtc.length > 0) {
      const tzResult = await ensureLeadTimezone(lead.id);
      const timeZone = tzResult.timezone || settings?.timezone || "UTC";
      const mode = "explicit_tz"; // Always show explicit timezone (e.g., "EST", "PST")
    }
  }
  ```
- **E6 — `lib/followup-engine.ts:342-536`**
  ```ts
  /**
   * Policy (Phase 73): never send placeholders/fallbacks.
   * - Unknown template variables block sends.
   * - Missing referenced values block sends.
   */

  const values: FollowUpTemplateValues = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    leadCompanyName: lead.companyName,
    aiPersonaName: settings?.aiPersonaName ?? null,
    companyName: settings?.companyName ?? null,
    targetResult: settings?.targetResult ?? null,
    qualificationQuestion1: question1,
    qualificationQuestion2: question2,
    bookingLink,
    availability: availabilityText,
    timeOption1: slotOption1,
    timeOption2: slotOption2,
  };

  const renderedContent = renderFollowUpTemplateStrict({ template: step.messageTemplate, values });
  if (!renderedContent.ok) {
    return { ok: false, error: formatTemplateErrors(renderedContent.errors), templateErrors: renderedContent.errors, offeredSlots };
  }
  ```
- **E7 — `lib/followup-automation.ts:366-483`**
  ```ts
  export async function autoStartMeetingRequestedSequenceOnSetterEmailReply(opts: { leadId: string; messageId: string; outboundAt: Date; sentByUserId: string | null }): Promise<{ started: boolean; reason?: string }> {
    // Must be a manual send (from dashboard) not a system/auto send
    if (!opts.sentByUserId) return { started: false, reason: "not_manual_sender" };

    if (!lead.autoFollowUpEnabled) {
      // Phase 71: if a setter is replying (first reply), enable follow-ups so the workflow can start.
      await prisma.lead.updateMany({ where: { id: lead.id, autoFollowUpEnabled: false }, data: { autoFollowUpEnabled: true } });
    }

    // Find the Meeting Requested sequence (supports both legacy + ZRG Workflow V1 names).
    const candidates = await prisma.followUpSequence.findMany({
      where: { clientId: lead.clientId, isActive: true, name: { in: [...MEETING_REQUESTED_SEQUENCE_NAMES] } },
      select: { id: true, name: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    await startSequenceInstance(lead.id, sequence.id, { startedAt: opts.outboundAt });
    return { started: true };
  }
  ```
- **E8 — `lib/followup-automation.ts:269-316`**
  ```ts
  // Policy (Phase 71): if an instance is paused due to a lead reply, re-enable it on the next outbound touch.
  if (pausedReplied.length > 0) {
    for (const instance of pausedReplied) {
      const nextStepDue = new Date(startAt.getTime() + deltaMs);
      await prisma.followUpInstance.update({ where: { id: instance.id }, data: { status: "active", pausedReason: null, nextStepDue } });
    }
  }
  ```
- **E9 — `lib/followup-engine.ts:389-426`**
  ```ts
  function buildTemplateBlockedPauseReason(errors: FollowUpTemplateError[]): string {
    const orderedTokens = [
      ...leadTokens,
      ...workspaceTokens,
      ...bookingTokens,
      ...availabilityTokens,
    ];
    const suffix = orderedTokens.length > 0 ? `: ${orderedTokens.join(", ")}` : "";
    if (leadTokens.size > 0) return `missing_lead_data${suffix}`;
    if (workspaceTokens.size > 0) return `missing_workspace_setup${suffix}`;
    if (bookingTokens.size > 0) return `missing_booking_link${suffix}`;
    if (availabilityTokens.size > 0) return `missing_availability${suffix}`;
    return `missing_workspace_setup${suffix}`;
  }
  ```
- **E10 — `lib/followup-engine.ts:1194-1209`**
  ```ts
  // Generate message content (strict: never send placeholders/fallbacks)
  const generated = await generateFollowUpMessage(step, lead, settings);
  if (!generated.ok) {
    await prisma.followUpInstance.update({
      where: { id: instanceId },
      data: { status: "paused", pausedReason: buildTemplateBlockedPauseReason(generated.templateErrors) },
    });
    return { success: true, action: "skipped", message: `Sequence paused - follow-up template blocked: ${generated.error}` };
  }
  ```
- **E11 — `actions/followup-sequence-actions.ts:288-478`**
  ```ts
  // Create/update: block unknown variables
  const unknownErrors = getUnknownTokenErrors(data.steps);
  if (unknownErrors.length > 0) {
    return { success: false, error: `Unknown template variables: ${unknownErrors.join(" | ")}` };
  }

  // Activation: block unknown variables + missing workspace setup
  if (!sequence.isActive) {
    const unknownErrors = getUnknownTokenErrors(sequence.steps);
    if (unknownErrors.length > 0) return { success: false, error: `Unknown template variables: ${unknownErrors.join(" | ")}` };

    const tokens = collectTemplateTokensFromSteps(sequence.steps);
    const { missing } = await getMissingWorkspaceSetup(sequence.clientId, tokens);
    if (missing.length > 0) return { success: false, error: `Follow-up setup incomplete: ${missing.join(", ")}` };
  }
  ```

### SOLVE (Confidence: 0.85)
- **Data model:** A follow-up sequence is a per-workspace template (`FollowUpSequence`) with ordered steps (`FollowUpStep`) and per-lead run state (`FollowUpInstance`). (E1)
- **Scheduling:** Steps carry `dayOffset` + `minuteOffset`; instances track `currentStep` and `nextStepDue`. (E1)
- **Start triggers (high-signal paths):**
  - “Meeting Requested” workflow now starts on the **first setter outbound email reply** (manual send) and is anchored to that outbound’s `sentAt`. This is explicitly not triggered by sentiment anymore. (E7)
  - When a lead has replied and follow-ups were paused, the policy is to resume on the next outbound touch (AI or setter), continuing from the current step. (E8)
- **Cron processing:** `/api/cron/followups` runs multiple “resume/maintenance” routines and then runs `processFollowUpsDue()`. (E2)
  - Instances are eligible only when `status="active"` and `nextStepDue <= now` and the lead is not snoozed and has `autoFollowUpEnabled=true`. (E3)
  - Safety rule: if the lead has replied since the last outbound touch, the instance is paused with reason `lead_replied`. (E3)
  - Execution is further gated by ops controls (dry run, workspace follow-ups pause, business hours, Airtable mode disables email steps). (E4)
- **Message generation:** follow-up templates support a variable system including booking links and availability slots.
  - Booking links are provider-aware (`getBookingLink`) and availability is fetched (refresh-if-stale) and timezone-formatted, with a “DIRECT_BOOK vs DEFAULT” selection based on qualification answer state. (E5)
  - Variables include `{senderName}` and `{companyName}` derived from workspace settings, `{availability}` and `{calendarLink}`, etc. (E6)
- **Template safety (Phase 73):**
  - Sequences are blocked from saving/updating/activating when templates contain unknown variables, and activation is blocked when required workspace setup (AI persona/company/target result/qualification questions/default calendar link) is missing. (E11)
  - Runtime sends are blocked when a referenced template variable cannot be resolved; the instance is paused with a `missing_*` reason (e.g., `missing_lead_data`, `missing_workspace_setup`, `missing_booking_link`, `missing_availability`). (E6, E9, E10)

### VERIFY
- Follow-up execution can be globally or locally “paused” without disabling manual messaging:
  - `FOLLOWUPS_DRY_RUN=true` disables all sends but still exercises the cron loop. (E4)
  - `followUpsPausedUntil` on workspace settings delays execution by moving `nextStepDue`. (E4)
- Sequence start semantics are explicit: Meeting Requested starts on **manual setter email** only, which means AI auto-send does not start that workflow. (E7)
- Phase 73 strictness removes placeholders/fallbacks: missing/unknown variables block sends and pause instances with `missing_*` reasons. (E6, E9, E10)

### SYNTHESIZE
- **Mental model:** sequences define “what to send when” → instances track each lead’s progress → cron processes due instances → step execution either sends or reschedules/skips based on safety/business rules → outbound touches reset/resume workflows to avoid overlapping with human conversation.
- **Where to debug first when follow-ups “don’t send”:**
  - `FollowUpInstance.status` (active vs paused) and `pausedReason` (e.g., `lead_replied` or `missing_*` categories). (E1, E3, E9, E10)
  - `Lead.autoFollowUpEnabled` and `Lead.snoozedUntil`. (E3)
  - Workspace `followUpsPausedUntil`, business hours, and `FOLLOWUPS_DRY_RUN`. (E4)
  - Cron endpoint auth (`CRON_SECRET`) and cron logs for the resume steps. (E2)

## 12) Booking + Availability (Provider Selection, Slot Logic, Booking Process)

### PLAN
- Identify booking providers (GHL vs Calendly) and how “meeting booked” is determined.
- Identify how booking links are resolved and where they come from (default CalendarLink, workspace overrides).
- Identify availability cache system (what’s cached, TTL, refresh strategy, failure/backoff).
- Identify booking process system (campaign-assigned stages/waves) and how it influences AI drafting + channel behavior.
- Identify auto-booking flow (inbound acceptance/proposed times → booking attempt vs follow-up task).

### LOCATE
- Schema:
  - `prisma/schema.prisma`: `CalendarLink`, `WorkspaceAvailabilityCache`, `WorkspaceOfferedSlot`, `BookingProcess`, `BookingProcessStage`, `LeadCampaignBookingProgress`
- Provider logic:
  - `lib/meeting-booking-provider.ts`: `isMeetingBooked`, `getBookingLink`
  - `lib/booking.ts`: `shouldAutoBook`, `bookMeetingForLead`, provider routing + overrides
- Availability:
  - `lib/availability-cache.ts`: cache TTL/backoff; provider fetch; `refreshAvailabilityCachesDue`
  - `app/api/cron/availability/route.ts`: cron refresh + advisory lock + budgets
- Campaign booking-process workflow:
  - `lib/booking-process-instructions.ts`: `getBookingProcessInstructions` (wave/stage → instruction block)
  - `lib/booking-progress.ts`: wave semantics + freeze semantics + outbound integration hook
- Inbound booking automation:
  - `lib/followup-engine.ts`: `processMessageForAutoBooking` (used by inbound post-process jobs)

### EXTRACT
- **E1 — `prisma/schema.prisma:1203-1248`**
  ```prisma
  model CalendarLink {
    id         String   @id @default(uuid())
    clientId   String
    name       String
    url        String
    publicUrl  String?
    type       String
    isDefault  Boolean  @default(false)
  }

  model WorkspaceAvailabilityCache {
    id                  String      @id @default(uuid())
    clientId            String
    availabilitySource  AvailabilitySource @default(DEFAULT)
    calendarLinkId      String?
    calendarType        String
    calendarUrl         String
    slotDurationMinutes Int         @default(30)
    slotsUtc            Json        // JSON array of ISO datetimes in UTC
    fetchedAt           DateTime
    staleAt             DateTime
    lastError           String?
    @@unique([clientId, availabilitySource])
  }
  ```
- **E2 — `prisma/schema.prisma:1275-1385`**
  ```prisma
  model BookingProcess {
    id          String   @id @default(uuid())
    clientId    String
    name        String
    maxWavesBeforeEscalation Int @default(5)
    stages      BookingProcessStage[]
    campaigns   EmailCampaign[]
  }

  model BookingProcessStage {
    id                String   @id @default(uuid())
    bookingProcessId  String
    stageNumber       Int
    includeBookingLink        Boolean @default(false)
    includeSuggestedTimes     Boolean @default(false)
    includeQualifyingQuestions Boolean @default(false)
    qualificationQuestionIds  String[] @default([])
    includeTimezoneAsk        Boolean @default(false)
    applyToEmail    Boolean @default(true)
    applyToSms      Boolean @default(true)
    applyToLinkedin Boolean @default(true)
  }

  model LeadCampaignBookingProgress {
    leadId            String
    emailCampaignId   String
    activeBookingProcessId String?
    currentWave Int @default(1)
    waveEmailSent    Boolean @default(false)
    waveSmsSent      Boolean @default(false)
    waveLinkedinSent Boolean @default(false)
    @@unique([leadId, emailCampaignId])
  }
  ```
- **E3 — `lib/meeting-booking-provider.ts:15-34`**
  ```ts
  export function isMeetingBooked(
    lead: Pick<Lead, "ghlAppointmentId" | "calendlyInviteeUri" | "calendlyScheduledEventUri" | "appointmentStatus">,
    settings: Pick<WorkspaceSettings, "meetingBookingProvider">
  ): boolean {
    if (lead.appointmentStatus) {
      if (lead.appointmentStatus === APPOINTMENT_STATUS.CANCELED) return false;
      return hasProviderEvidence(lead);
    }
    const provider: MeetingBookingProvider = settings.meetingBookingProvider;
    return provider === "CALENDLY"
      ? Boolean(lead.calendlyInviteeUri || lead.calendlyScheduledEventUri)
      : Boolean(lead.ghlAppointmentId);
  }
  ```
- **E4 — `lib/meeting-booking-provider.ts:36-68`**
  ```ts
  export async function getBookingLink(
    clientId: string,
    settings: Pick<WorkspaceSettings, "meetingBookingProvider" | "calendlyEventTypeLink"> | null
  ): Promise<string | null> {
    const provider = settings?.meetingBookingProvider ?? "GHL";
    const calendarLink = await prisma.calendarLink.findFirst({ where: { clientId, isDefault: true }, select: { url: true, publicUrl: true } });
    const publicUrl = (calendarLink?.publicUrl || "").trim();
    const url = (calendarLink?.url || "").trim();
    return provider === "CALENDLY" ? ((settings?.calendlyEventTypeLink || "").trim() || url || null) : (publicUrl || url || null);
  }
  ```
- **E5 — `lib/booking.ts:75-158`**
  ```ts
  export async function shouldAutoBook(leadId: string): Promise<{ shouldBook: boolean; reason?: string }> {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { client: { include: { settings: true } } } });
    const alreadyBooked = lead.status === "meeting-booked" || !!lead.ghlAppointmentId || !!lead.calendlyInviteeUri || !!lead.calendlyScheduledEventUri || !!lead.appointmentBookedAt;
    const workspaceEnabled = lead.client.settings?.autoBookMeetings ?? false;
    const leadEnabled = lead.autoBookMeetingsEnabled ?? true;
    if (alreadyBooked || !workspaceEnabled || !leadEnabled) return { shouldBook: false };
    return { shouldBook: true };
  }

  export async function bookMeetingForLead(leadId: string, selectedSlot: string, opts?: { calendarIdOverride?: string; availabilitySource?: AvailabilitySource }): Promise<BookingResult> {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { client: { include: { settings: true } } } });
    const provider = lead.client.settings?.meetingBookingProvider === "CALENDLY" ? "calendly" : "ghl";
    if (provider === "calendly") return bookMeetingOnCalendly(leadId, selectedSlot, { availabilitySource: opts?.availabilitySource });
    return bookMeetingOnGHL(leadId, selectedSlot, undefined, { availabilitySource: opts?.availabilitySource });
  }
  ```
- **E6 — `lib/availability-cache.ts:24-33`**
  ```ts
  function getCacheTtlMs(): number {
    const fromEnv = parsePositiveInt(process.env.AVAILABILITY_CACHE_TTL_MS);
    // Default: 60s (Phase 61 requirement: minute-level freshness).
    return Math.max(5_000, Math.min(60 * 60_000, fromEnv ?? 60_000));
  }
  ```
- **E7 — `lib/availability-cache.ts:203-243`**
  ```ts
  if (!calendarLink) {
    const error = "No default calendar link configured";
    await prisma.workspaceAvailabilityCache.upsert({
      where: { clientId_availabilitySource: { clientId, availabilitySource } },
      update: { calendarLinkId: null, calendarType: "unknown", calendarUrl: "", slotsUtc: [], staleAt: new Date(now.getTime() + UNCONFIGURED_BACKOFF_MS), lastError: error },
      create: { clientId, availabilitySource, calendarLinkId: null, calendarType: "unknown", calendarUrl: "", slotsUtc: [], staleAt: new Date(now.getTime() + UNCONFIGURED_BACKOFF_MS), lastError: error },
    });
    return { success: false, error, availabilitySource };
  }
  ```
- **E8 — `lib/availability-cache.ts:291-328`**
  ```ts
  const meetingDuration = settings?.meetingDurationMinutes ?? REQUIRED_DURATION_MINUTES;
  if (meetingDuration !== REQUIRED_DURATION_MINUTES) {
    const error = `Unsupported meeting duration (${meetingDuration}m). Set Meeting Duration to 30 minutes to use live availability.`;
    await prisma.workspaceAvailabilityCache.upsert({ where: { clientId_availabilitySource: { clientId, availabilitySource } }, update: { slotsUtc: [], staleAt: new Date(now.getTime() + UNSUPPORTED_DURATION_BACKOFF_MS), lastError: error }, create: { clientId, availabilitySource, slotsUtc: [], staleAt: new Date(now.getTime() + UNSUPPORTED_DURATION_BACKOFF_MS), lastError: error } });
    return { success: false, error, availabilitySource };
  }
  ```
- **E9 — `app/api/cron/availability/route.ts:10-29`**
  ```ts
  function isAuthorized(request: NextRequest): boolean {
    const expectedSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("Authorization");
    const legacy = request.headers.get("x-cron-secret");
    return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
  }

  const LOCK_KEY = BigInt("61061061061");
  async function tryAcquireLock(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    return Boolean(rows?.[0]?.locked);
  }
  ```
- **E10 — `app/api/cron/availability/route.ts:71-88`**
  ```ts
  const defaultResult = await refreshAvailabilityCachesDue({ mode: "all", timeBudgetMs: defaultBudgetMs, concurrency, invocationId, availabilitySource: "DEFAULT" });
  const directBookResult =
    directBudgetMs >= 10_000
      ? await refreshAvailabilityCachesDue({ mode: "all", timeBudgetMs: directBudgetMs, concurrency, invocationId, availabilitySource: "DIRECT_BOOK" })
      : null;
  ```
- **E11 — `lib/booking-process-instructions.ts:48-123`**
  ```ts
  // Get booking process instructions for AI draft generation.
  // Returns null instructions if:
  // - Lead has no campaign
  // - Campaign has no booking process
  export async function getBookingProcessInstructions(context: BookingProcessContext): Promise<BookingProcessInstructionsResult> {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { emailCampaignId: true, emailCampaign: { select: { bookingProcessId: true } } } });
    if (!lead?.emailCampaignId) return { instructions: null, requiresHumanReview: false };

    const existingProgress = await prisma.leadCampaignBookingProgress.findUnique({ where: { leadId_emailCampaignId: { leadId, emailCampaignId } }, select: { activeBookingProcessId: true } });
    if (!existingProgress) {
      if (!lead.emailCampaign?.bookingProcessId) return { instructions: null, requiresHumanReview: false };
      await getOrCreateBookingProgress({ leadId, emailCampaignId, freezeBookingProcessId: lead.emailCampaign.bookingProcessId });
    } else if (!existingProgress.activeBookingProcessId) {
      return { instructions: null, requiresHumanReview: false };
    }
    const stage = await getCurrentBookingStage({ leadId, emailCampaignId });
  }
  ```
- **E12 — `lib/booking-progress.ts:1-13`**
  ```ts
  /**
   * Booking Process Wave Progress Tracking (Phase 36)
   * Key semantics:
   * - Wave advances only after all stage-enabled channels have been sent (or skipped)
   * - SMS DND holds the wave (don't skip) until cleared or 72h timeout
   * - activeBookingProcessId is frozen on first outbound (don't change mid-stream)
   */
  ```
- **E13 — `lib/booking-progress.ts:591-631`**
  ```ts
  // Call this AFTER successfully creating an outbound Message row.
  export async function recordOutboundForBookingProgress(params: { leadId: string; channel: MessageChannel; smsPartCount?: number }): Promise<void> {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { emailCampaignId: true, emailCampaign: { select: { bookingProcessId: true } } } });
    if (!lead?.emailCampaignId) return;
    const existingProgress = await prisma.leadCampaignBookingProgress.findUnique({ where: { leadId_emailCampaignId: { leadId, emailCampaignId: lead.emailCampaignId } }, select: { activeBookingProcessId: true } });
    if (!existingProgress) { if (!lead.emailCampaign?.bookingProcessId) return; } else if (!existingProgress.activeBookingProcessId) { return; }
  }
  ```
- **E14 — `lib/followup-engine.ts:2197-2312`**
  ```ts
  export async function processMessageForAutoBooking(leadId: string, messageBody: string): Promise<{ booked: boolean; appointmentId?: string; error?: string }> {
    const autoBookResult = await shouldAutoBook(leadId);
    if (!autoBookResult.shouldBook) return { booked: false };

    const offeredSlots = await getOfferedSlots(leadId);
    if (offeredSlots.length > 0) {
      const isMeetingAccepted = await detectMeetingAcceptedIntent(messageBody, { clientId: leadMeta.clientId, leadId: leadMeta.id });
      if (!isMeetingAccepted) return { booked: false };

      const acceptedSlot = await parseAcceptedTimeFromMessage(messageBody, offeredSlots, { clientId: leadMeta.clientId, leadId: leadMeta.id });
      if (!acceptedSlot) {
        await prisma.followUpTask.create({ data: { leadId, type, dueDate: new Date(), status: "pending", suggestedMessage: suggestion } });
        return { booked: false };
      }

      const bookingResult = await bookMeetingForLead(leadId, acceptedSlot.datetime, { availabilitySource: acceptedSlot.availabilitySource });
      return bookingResult.success ? { booked: true, appointmentId: bookingResult.appointmentId } : { booked: false, error: bookingResult.error };
    }
    return { booked: false };
  }
  ```
- **E15 — `lib/followup-engine.ts:2317-2386`**
  ```ts
  // Scenario 3: no offered slots; lead proposes their own time.
  const proposed = await parseProposedTimesFromMessage(messageTrimmed, { clientId: leadMeta.clientId, leadId: leadMeta.id, leadTimezone: tzResult.timezone || null });
  const match = proposed.proposedStartTimesUtc.find((iso) => availabilitySet.has(iso)) ?? null;
  const HIGH_CONFIDENCE_THRESHOLD = 0.9;
  if (match && proposed.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
    const bookingResult = await bookMeetingForLead(leadId, match, { availabilitySource: availability.availabilitySource });
    if (bookingResult.success) return { booked: true, appointmentId: bookingResult.appointmentId };
  }
  ```

### SOLVE (Confidence: 0.85)
- **Providers + “booked” semantics:** The workspace chooses a booking provider (GHL vs Calendly). `isMeetingBooked` uses appointment lifecycle status when available, and falls back to provider evidence for older leads. (E3)
- **Booking links:** Outbound copy uses a provider-aware `getBookingLink` that prefers a workspace default `CalendarLink` and can use either `publicUrl` or underlying `url`. (E4, E1)
- **Availability caching:**
  - Availability is cached per workspace with a TTL (default 60s) and a `staleAt` timestamp. (E6, E1)
  - If no default CalendarLink is configured, the system writes an explicit empty cache entry with a long backoff (24h) to avoid repeated failures. (E7)
  - Meeting duration is constrained to 30 minutes for live slot support; unsupported durations are backoff’d for 2 hours with an explicit error. (E8)
  - Cron refresh runs under `CRON_SECRET` auth and uses a Postgres advisory lock to prevent concurrent refresh. It refreshes both `DEFAULT` and (optionally) `DIRECT_BOOK` sources. (E9, E10)
- **Booking process (campaign-driven booking wave logic):**
  - Campaigns can be assigned to a `BookingProcess` with stages/waves and channel applicability. (E2)
  - Booking progress is tracked per lead+campaign with freeze semantics (don’t change booking process mid-stream), and wave advancement requires all stage-enabled channels to have been sent/handled. (E12, E2)
  - AI draft generation can ask for booking instructions; it only returns instructions if the lead is in a campaign with a booking process, and it initializes/freeze-tracks booking progress when needed. (E11)
  - After outbound sends, the system can record booking wave progress (no-op if no campaign/booking process). (E13)
- **Auto-booking on inbound replies:** On inbound messages, `processMessageForAutoBooking` attempts auto-booking only when enabled and safe:
  - If a lead “accepts” but the accepted time is ambiguous, the system creates a `FollowUpTask` with a clarification suggestion instead of booking. (E14)
  - If the lead proposes their own time, the system only books if there is a direct match to availability and confidence ≥ 0.9; otherwise it avoids booking. (E15)

### VERIFY
- Availability and booking are intentionally conservative:
  - Missing CalendarLink results in “no slots” behavior rather than guessing. (E7)
  - Auto-booking uses explicit intent detection + parsing, and requires either a matched offered slot or a high-confidence match to known availability. (E14, E15)
- Booking process instructions are only present for leads with an `emailCampaign` that has a booking process assigned (and after progress freeze). If a workspace expects booking instructions for non-campaign leads, it won’t happen by design. (E11)

### SYNTHESIZE
- **Mental model:** availability is cached from a default calendar link → AI drafts/follow-ups can include booking links and slot suggestions → booking waves are tracked per lead+campaign → inbound replies can trigger safe auto-booking when acceptance is unambiguous.
- **Configuration checklist:**
  - Set a default `CalendarLink` (and optional `publicUrl`) per workspace. (E1, E7)
  - Ensure meeting duration is 30 minutes if you expect live availability. (E8)
  - Assign booking process to campaigns where you want wave-based booking behavior. (E2, E11)

## 13) Notification Center (Slack Channels, Resend Email, Digests)

### PLAN
- Identify where notification settings live and how they’re configured.
- Identify what “notification events” exist and how they’re deduped.
- Identify how realtime notifications are sent (Slack bot + Resend) and gated (rules).
- Identify how daily digests are computed (timezone + time-of-day window) and deduped.
- Identify other notification-like alerts (integration health Slack webhook).

### LOCATE
- `prisma/schema.prisma`: notification settings + `NotificationEvent` + `NotificationSendLog`
- `actions/settings-actions.ts`: default settings values returned to UI
- `lib/notification-center.ts`: realtime sentiment notifications + daily digest processor
- `app/api/cron/followups/route.ts`: digest processor invocation on cron
- `lib/workspace-integration-health.ts`: Unipile disconnect notifications
- `lib/slack-notifications.ts`: Slack webhook sender (`SLACK_WEBHOOK_URL`)

### EXTRACT
- **E1 — `prisma/schema.prisma:274-281`**
  ```prisma
  // Notification Settings
  emailDigest          Boolean  @default(true)
  slackAlerts          Boolean  @default(true)
  notificationEmails         String[] @default([])
  notificationPhones         String[] @default([])
  notificationSlackChannelIds String[] @default([]) // Slack conversation IDs (C*/G*)
  notificationSentimentRules Json? // Sentiment -> { mode, destinations }
  notificationDailyDigestTime String? @default("09:00") // Local time in workspace timezone (HH:mm)
  ```
- **E2 — `prisma/schema.prisma:771-806`**
  ```prisma
  model NotificationEvent {
    id        String   @id @default(uuid())
    clientId  String
    leadId    String
    kind      String   // 'sentiment'
    sentimentTag String?
    messageId  String?
    dedupeKey String @unique
    createdAt DateTime @default(now())
  }

  model NotificationSendLog {
    id        String   @id @default(uuid())
    clientId  String
    leadId    String?
    kind      String   // 'sentiment_realtime' | 'daily_digest'
    sentimentTag String?
    destination String // 'slack' | 'email' | 'sms'
    dedupeKey String @unique
    createdAt DateTime @default(now())
  }
  ```
- **E3 — `lib/notification-center.ts:116-169`**
  ```ts
  export async function notifyOnLeadSentimentChange(opts: {
    clientId: string;
    leadId: string;
    previousSentimentTag: string | null;
    newSentimentTag: string | null;
    messageId?: string | null;
    latestInboundText?: string | null;
  }): Promise<void> {
    const next = opts.newSentimentTag;
    if (!next) return;
    if (next === opts.previousSentimentTag) return;

    await recordSentimentNotificationEvent({
      clientId: opts.clientId,
      leadId: opts.leadId,
      sentimentTag: next,
      messageId: opts.messageId ?? null,
    });

    const [client, lead, settings] = await Promise.all([
      prisma.client.findUnique({ where: { id: opts.clientId }, select: { id: true, name: true, slackBotToken: true, resendApiKey: true, resendFromEmail: true } }),
      prisma.lead.findUnique({ where: { id: opts.leadId }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } }),
      prisma.workspaceSettings.findUnique({ where: { clientId: opts.clientId }, select: { slackAlerts: true, emailDigest: true, notificationEmails: true, notificationPhones: true, notificationSlackChannelIds: true, notificationSentimentRules: true } }),
    ]);
  ```
- **E4 — `lib/notification-center.ts:387-455`**
  ```ts
  export async function processDailyNotificationDigestsDue(opts?: { limit?: number }): Promise<{
    checked: number;
    sent: number;
    skipped: number;
    errors: number;
  }> {
    const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
    const settingsRows = await prisma.workspaceSettings.findMany({
      take: limit,
      select: {
        clientId: true,
        timezone: true,
        emailDigest: true,
        slackAlerts: true,
        notificationEmails: true,
        notificationSlackChannelIds: true,
        notificationSentimentRules: true,
        notificationDailyDigestTime: true,
        client: { select: { name: true, slackBotToken: true, resendApiKey: true, resendFromEmail: true } },
      },
    });

    let checked = 0;
    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of settingsRows) {
      checked += 1;

      if (!row.emailDigest) {
        skipped += 1;
        continue;
      }
      const tz = row.timezone || "America/New_York";
      const now = new Date();
      const nowParts = getTimeZoneParts(now, tz);
      const digestAt = parseTimeOfDay(row.notificationDailyDigestTime) ?? { hour: 9, minute: 0 };

      const windowMinutes = 12;
      const nowMinutes = nowParts.hour * 60 + nowParts.minute;
      const digestMinutes = digestAt.hour * 60 + digestAt.minute;
      if (Math.abs(nowMinutes - digestMinutes) > windowMinutes) {
        skipped += 1;
        continue;
      }

      const localDayKey = toIsoDateKey({ year: nowParts.year, month: nowParts.month, day: nowParts.day });
      const rules = normalizeRules(row.notificationSentimentRules);

      const dailyByDest: Record<NotificationDestination, string[]> = {
        slack: [],
        email: [],
        sms: [],
      };

      for (const [sentiment, rule] of Object.entries(rules)) {
        if (!rule || rule.mode !== "daily") continue;
        for (const dest of ["slack", "email", "sms"] as const) {
          if (rule.destinations[dest]) dailyByDest[dest].push(sentiment);
        }
      }

      // Nothing to do.
      if (dailyByDest.slack.length === 0 && dailyByDest.email.length === 0 && dailyByDest.sms.length === 0) {
        skipped += 1;
        continue;
      }
    }
  }
  ```
- **E5 — `lib/notification-center.ts:520-596`**
  ```ts
  // Slack digest
  if (dailyByDest.slack.length > 0 && row.slackAlerts !== false && row.client.slackBotToken && row.notificationSlackChannelIds.length > 0) {
    const bodyChunks = chunkLines(bodyLines, Math.max(800, maxSlackChars - headerOverhead));

    for (let part = 0; part < totalParts; part += 1) {
      const dedupeKey = `daily_digest:${row.clientId}:slack:${localDayKey}:${part + 1}`;
      const gate = await logNotificationSendOnce({ clientId: row.clientId, kind: "daily_digest", destination: "slack", dedupeKey });
      if (!gate.ok) continue;

      for (const channelId of row.notificationSlackChannelIds) {
        const trimmed = (channelId || "").trim();
        if (!trimmed) continue;
        const res = await slackPostMessage({ token: row.client.slackBotToken, channelId: trimmed, text });
      }
    }
  }

  // Email digest
  if (dailyByDest.email.length > 0) {
    const recipients = row.notificationEmails.map((v) => v.trim()).filter(Boolean);
    if (recipients.length > 0 && row.client.resendApiKey && row.client.resendFromEmail) {
      const dedupeKey = `daily_digest:${row.clientId}:email:${localDayKey}`;
      const gate = await logNotificationSendOnce({ clientId: row.clientId, kind: "daily_digest", destination: "email", dedupeKey });
      if (gate.ok) {
        await sendResendEmail({ apiKey: row.client.resendApiKey, fromEmail: row.client.resendFromEmail, to: recipients, subject: `[${row.client.name}] Daily Digest (${localDayKey})`, text });
      }
    }
  }

  // SMS digest is intentionally a no-op placeholder for now.
  ```
- **E6 — `actions/settings-actions.ts:151-158`**
  ```ts
  emailDigest: true,
  slackAlerts: true,
  notificationEmails: [],
  notificationPhones: [],
  notificationSlackChannelIds: [],
  notificationSentimentRules: null,
  notificationDailyDigestTime: "09:00",
  timezone: "America/New_York",
  ```
- **E7 — `lib/workspace-integration-health.ts:21-72`**
  ```ts
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  export async function updateUnipileConnectionHealth(opts: UpdateUnipileHealthOpts): Promise<void> {
    const { clientId, isDisconnected, errorDetail } = opts;

    if (isDisconnected) {
      // Mark as disconnected
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: {
          id: true,
          name: true,
          unipileConnectionStatus: true,
          unipileDisconnectedAt: true,
          unipileLastNotifiedAt: true,
          settings: { select: { slackAlerts: true } },
        },
      });

      if (!client) return;

      const now = new Date();
      const wasAlreadyDisconnected = client.unipileConnectionStatus === "DISCONNECTED";
      const lastNotified = client.unipileLastNotifiedAt?.getTime() ?? 0;
      const shouldNotify = !wasAlreadyDisconnected || now.getTime() - lastNotified > ONE_DAY_MS;

      // Update health fields
      await prisma.client.update({
        where: { id: clientId },
        data: {
          unipileConnectionStatus: "DISCONNECTED",
          unipileDisconnectedAt: wasAlreadyDisconnected ? undefined : now,
          unipileLastErrorAt: now,
          unipileLastErrorMessage: errorDetail ?? "Account disconnected",
          ...(shouldNotify ? { unipileLastNotifiedAt: now } : {}),
        },
      });

      // Send Slack notification (deduped to 1/day)
      if (shouldNotify && client.settings?.slackAlerts !== false) {
        console.log(`[Unipile Health] Sending disconnect notification for workspace ${client.name} (${clientId})`);
        await sendSlackNotification({
          text: `🚨 *LinkedIn Integration Disconnected*\n\n*Workspace:* ${client.name}\n*Error:* ${errorDetail || "Account disconnected"}\n\n*Action:* Please visit Settings > Integrations to reconnect your LinkedIn account.`,
        }).catch((err) => {
          console.error(`[Unipile Health] Failed to send Slack notification for ${clientId}:`, err);
        });
      } else if (wasAlreadyDisconnected) {
        console.log(`[Unipile Health] Skipping notification for ${clientId} - already notified within 24h`);
      }
    }
  }
  ```
- **E8 — `lib/slack-notifications.ts:28-34`**
  ```ts
  export async function sendSlackNotification(params: SlackNotificationParams): Promise<boolean> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.log("Slack webhook URL not configured, skipping notification");
      return false;
    }
  }
  ```

### SOLVE (Confidence: 0.9)
- **Where settings live:** Notification knobs are persisted in `WorkspaceSettings` (master switches + recipients + per-sentiment rules + digest time). (E1)
- **Event model + dedupe strategy:** The system records `NotificationEvent` rows (for digesting/auditing) and writes `NotificationSendLog` rows with a unique `dedupeKey` so repeated cron runs don’t double-send. (E2)
- **Realtime notifications are “rules-based”:** On sentiment change, the system records the event, loads `Client` + `Lead` + `WorkspaceSettings`, and (if the sentiment’s rule is `mode: "realtime"`) attempts destination-specific sends. (E3)
- **Daily digest mechanics:** A cron-driven processor scans workspaces, checks timezone + `notificationDailyDigestTime` within a narrow window, groups daily sentiment tags by destination, and sends Slack + email digests with destination-level dedupe keys. (E4, E5)
- **Slack variants:** There are two Slack pathways in this repo:
  - Per-workspace Slack **bot token** + channel IDs for Notification Center alerts/digests. (E5, E1)
  - A “global” Slack webhook (`SLACK_WEBHOOK_URL`) for integration-health notifications like Unipile disconnects. (E7, E8)
- **SMS destination is not implemented:** Digest SMS is explicitly a no-op placeholder today. (E5)

### VERIFY
- Notification delivery is best-effort and will silently “skip” when the corresponding integration isn’t configured (no Slack token / no Resend config / no recipients). This is by design in the current implementation. (E5, E8)
- Daily digests are time-windowed; if cron runs outside the window, it will skip sending for that workspace. Ensure workspace timezone + digest time are correct. (E4, E6)

### SYNTHESIZE
- **Mental model:** inbound processing can tag a lead’s sentiment → `NotificationEvent` is recorded → realtime notifications may fire immediately (rule-gated) → daily digests are sent by cron in the workspace’s local morning window, with idempotent dedupe. (E2, E3, E4, E5)
- **Configuration checklist (per workspace):**
  - Turn on `slackAlerts` / `emailDigest` and configure sentiment rules + recipients. (E1, E6)
  - For Slack digest: ensure workspace has a Slack bot token and channel IDs. (E1, E5)
  - For email digest: ensure workspace has Resend keys and notification email recipients. (E5, E6)
  - For Unipile health alerts: set `SLACK_WEBHOOK_URL` (global) if you want those alerts in addition to per-workspace notifications. (E7, E8)

## 14) Cron Endpoints + Secrets + Operational Contracts

### PLAN
- Enumerate cron endpoints and what each one is responsible for.
- Identify the security model (headers, env vars, “dev-mode” behavior).
- Identify concurrency controls / locks (where used, why).
- Identify operational controls (limits, time budgets, dry-run flags).

### LOCATE
- `vercel.json`: Vercel Cron schedules
- `app/api/cron/**/route.ts`: cron endpoints and auth checks
- `lib/background-jobs/runner.ts`: cron limit/time budget env vars
- `lib/availability-cache.ts`: availability refresh worker used by cron

### EXTRACT
- **E1 — `vercel.json:1-35`**
  ```json
  {
    "crons": [
      { "path": "/api/cron/followups", "schedule": "* * * * *" },
      { "path": "/api/cron/reactivations", "schedule": "*/10 * * * *" },
      { "path": "/api/cron/background-jobs", "schedule": "* * * * *" },
      { "path": "/api/cron/insights/booked-summaries", "schedule": "*/10 * * * *" },
      { "path": "/api/cron/insights/context-packs", "schedule": "* * * * *" },
      { "path": "/api/cron/appointment-reconcile", "schedule": "* * * * *" },
      { "path": "/api/cron/emailbison/availability-slot", "schedule": "* * * * *" },
      { "path": "/api/cron/availability", "schedule": "* * * * *" }
    ]
  }
  ```
- **E2 — `app/api/cron/followups/route.ts:16-88`**
  ```ts
  /**
   * Security: Requires Authorization: Bearer <CRON_SECRET> header
   * Vercel automatically adds this header when invoking cron jobs
   */
  export async function GET(request: NextRequest) {
    const authHeader = request.headers.get("Authorization");
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret) return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
    if (authHeader !== `Bearer ${expectedSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const snoozed = await resumeSnoozedFollowUps({ limit: 200 });
    const resumed = await resumeGhostedFollowUps({ days: 7, limit: 100 });
    const enrichmentResumed = await resumeAwaitingEnrichmentFollowUps({ limit: 200 });
    const smsDndRetry = await retrySmsDndHeldLeads({ limit: 50 });
    const backfill = await backfillNoResponseFollowUpsDueOnCron();
    const results = await processFollowUpsDue();
    const notificationDigests = await processDailyNotificationDigestsDue({ limit: 50 });
  }
  ```
- **E3 — `app/api/cron/background-jobs/route.ts:8-20`**
  ```ts
  function isAuthorized(request: NextRequest): boolean {
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret) return false;
    const authHeader = request.headers.get("Authorization");
    const legacy = request.headers.get("x-cron-secret");
    return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
  }
  ```
- **E4 — `app/api/cron/availability/route.ts:10-33`**
  ```ts
  function isAuthorized(request: NextRequest): boolean {
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret) return false;
    const authHeader = request.headers.get("Authorization");
    const legacy = request.headers.get("x-cron-secret");
    return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
  }

  const LOCK_KEY = BigInt("61061061061");
  async function tryAcquireLock(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    return Boolean(rows?.[0]?.locked);
  }
  ```
- **E5 — `app/api/cron/appointment-reconcile/route.ts:8-24`**
  ```ts
  /**
   * Query parameters:
   * - workspaceLimit: Max workspaces to process (default: 10)
   * - leadsPerWorkspace: Max leads per workspace (default: 50)
   * - staleDays: Re-check leads not checked in N days (default: 7)
   * - clientId: Only process a specific workspace
   * - dryRun: If "true", don't write to database
   */
  export async function GET(request: NextRequest) {
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      console.warn("[Appointment Reconcile Cron] CRON_SECRET not configured - endpoint disabled");
      return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
    }

    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${expectedSecret}`) {
      console.warn("[Appointment Reconcile Cron] Invalid authorization attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;

    const workspaceLimit = Math.max(1, parseInt(searchParams.get("workspaceLimit") || process.env.RECONCILE_WORKSPACE_LIMIT || "10", 10) || 10);
    const leadsPerWorkspace = Math.max(1, parseInt(searchParams.get("leadsPerWorkspace") || process.env.RECONCILE_LEADS_PER_WORKSPACE || "50", 10) || 50);
    const staleDays = Math.max(1, parseInt(searchParams.get("staleDays") || process.env.RECONCILE_STALE_DAYS || "7", 10) || 7);
    const clientId = searchParams.get("clientId") || undefined;
    const dryRun = searchParams.get("dryRun") === "true";
  }
  ```
- **E6 — `app/api/cron/insights/context-packs/route.ts:9-17`**
  ```ts
  // Circuit breaker: stop processing after this many consecutive P1001 errors
  const MAX_CONNECTION_ERRORS = 3;

  function isAuthorized(request: NextRequest): boolean {
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret) return false;
    const authHeader = request.headers.get("Authorization");
    const legacySecret = request.headers.get("x-cron-secret");
    return authHeader === `Bearer ${expectedSecret}` || legacySecret === expectedSecret;
  }
  ```
- **E7 — `app/api/cron/enrichment/route.ts:14-25`**
  ```ts
  function verifyCronSecret(request: NextRequest): boolean {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.warn("[Enrichment Cron] CRON_SECRET not configured");
      return true; // Allow in development
    }

    return authHeader === `Bearer ${cronSecret}`;
  }
  ```
- **E8 — `app/api/cron/emailbison/availability-slot/route.ts:8-37`**
  ```ts
  function isAuthorized(request: NextRequest): boolean {
    const expectedSecret = process.env.CRON_SECRET;
    if (!expectedSecret) return false;
    const authHeader = request.headers.get("Authorization");
    const legacy = request.headers.get("x-cron-secret");
    return authHeader === `Bearer ${expectedSecret}` || legacy === expectedSecret;
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";
  const timeBudgetMsParam = request.nextUrl.searchParams.get("timeBudgetMs");
  const timeBudgetMs = timeBudgetMsParam ? Number.parseInt(timeBudgetMsParam, 10) : undefined;
  ```
- **E9 — `app/api/cron/ai-retention/route.ts:4-14`**
  ```ts
  export async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  ```

### SOLVE (Confidence: 0.9)
- **Scheduling:** Vercel Cron is configured in `vercel.json` for follow-ups, background jobs, availability refresh, reactivations, EmailBison slot injection, and insights workloads. (E1)
- **Auth contract:** Most cron endpoints require `Authorization: Bearer ${CRON_SECRET}` (and some also accept legacy `x-cron-secret`). Many explicitly 503 when `CRON_SECRET` is missing (endpoint disabled), which is safe for production. (E2, E3, E4)
- **Concurrency control:** Availability refresh uses a Postgres advisory lock so only one refresh run can proceed at a time. (E4)
- **Operational controls:** Some crons support explicit `dryRun` and/or `timeBudgetMs` query parameters to bound behavior during debugging and incident response. (E5, E8)
- **Resilience:** Insights context-pack processing includes a circuit breaker for repeated DB connection errors (P1001). (E6)

### VERIFY
- **Production expectation:** `CRON_SECRET` must be configured in production, or most cron endpoints will either return 503 (disabled) or 401. (E2, E3, E4)
- **Potential misconfiguration footgun:** the enrichment cron explicitly allows requests when `CRON_SECRET` is missing (intended “development mode”). Ensure prod always has `CRON_SECRET` set so this cannot become an unintended public endpoint. (E7)

### SYNTHESIZE
- **Mental model:** Vercel Cron hits `/api/cron/*` on schedule → endpoints authenticate using `CRON_SECRET` → each endpoint runs a bounded batch of work (often with limits/time budgets) → some endpoints use DB locks or circuit breakers to avoid thundering herds. (E1, E2, E4, E6)
- **Ops checklist:**
  - Set `CRON_SECRET` in production and verify Vercel Cron requests include the bearer token. (E2, E3)
  - For availability refresh concurrency issues, confirm the advisory lock key can be acquired (and check for stuck locks in DB). (E4)
  - Use `dryRun=true` on reconcile/EmailBison-slot endpoints when validating behavior in production without writes. (E5, E8)

## 15) Supabase Ground Truth (Tables / RLS Policies / Indexes + Safe Checks)

### PLAN
- Enumerate the major tables that back the dashboard and automation.
- Verify whether RLS is enabled and whether policies exist.
- Verify whether “external” roles (anon/authenticated) have privileges on sensitive tables.
- Capture a minimal index snapshot for the hottest tables (Lead, Message, FollowUps, Jobs, Webhooks).
- Capture key installed extensions (for operational expectations).

### LOCATE
- Supabase DB introspection (safe, schema-only queries):
  - `information_schema.tables` (table list)
  - `pg_class.relrowsecurity` (RLS enabled flags)
  - `pg_policies` (policy count/definitions)
  - `information_schema.role_table_grants` (role privileges)
  - `pg_indexes` (index inventory)
  - `pg_extension` (installed extensions)

### EXTRACT
- **E1 — Supabase `information_schema.tables` (2026-02-01)**
  ```json
  [
    { "table_name": "AIDraft" },
    { "table_name": "AIInteraction" },
    { "table_name": "AiPersona" },
    { "table_name": "Appointment" },
    { "table_name": "BackgroundJob" },
    { "table_name": "BookingProcess" },
    { "table_name": "BookingProcessStage" },
    { "table_name": "CalendarLink" },
    { "table_name": "Campaign" },
    { "table_name": "Client" },
    { "table_name": "ClientMember" },
    { "table_name": "EmailBisonBaseHost" },
    { "table_name": "EmailBisonSenderEmailSnapshot" },
    { "table_name": "EmailCampaign" },
    { "table_name": "FollowUpInstance" },
    { "table_name": "FollowUpSequence" },
    { "table_name": "FollowUpStep" },
    { "table_name": "FollowUpTask" },
    { "table_name": "InsightChatAuditEvent" },
    { "table_name": "InsightChatMessage" },
    { "table_name": "InsightChatSession" },
    { "table_name": "InsightChatUserPreference" },
    { "table_name": "InsightContextPack" },
    { "table_name": "KnowledgeAsset" },
    { "table_name": "Lead" },
    { "table_name": "LeadCampaignBookingProgress" },
    { "table_name": "LeadConversationInsight" },
    { "table_name": "Message" },
    { "table_name": "NotificationEvent" },
    { "table_name": "NotificationSendLog" },
    { "table_name": "PromptOverride" },
    { "table_name": "PromptSnippetOverride" },
    { "table_name": "ReactivationCampaign" },
    { "table_name": "ReactivationEnrollment" },
    { "table_name": "ReactivationSendLog" },
    { "table_name": "ReactivationSenderDailyUsage" },
    { "table_name": "SmsCampaign" },
    { "table_name": "WebhookEvent" },
    { "table_name": "WorkspaceAvailabilityCache" },
    { "table_name": "WorkspaceOfferedSlot" },
    { "table_name": "WorkspaceSettings" }
  ]
  ```
- **E2 — Supabase RLS summary (`pg_class.relrowsecurity`) (2026-02-01)**
  ```json
  [{ "rls_enabled_tables": 0, "total_tables": 41 }]
  ```
- **E3 — Supabase policy count (`pg_policies`) (2026-02-01)**
  ```json
  [{ "policy_count": 0 }]
  ```
- **E4 — Supabase privileges for `anon` / `authenticated` on sensitive tables (2026-02-01)**
  ```json
  [
    { "table_name": "Lead", "grantee": "anon", "privileges": "DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE" },
    { "table_name": "Lead", "grantee": "authenticated", "privileges": "DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE" },
    { "table_name": "Message", "grantee": "anon", "privileges": "DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE" },
    { "table_name": "Message", "grantee": "authenticated", "privileges": "DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE" }
  ]
  ```
- **E5 — Supabase installed extensions (`pg_extension`) (2026-02-01)**
  ```json
  [
    { "extname": "pg_graphql", "extversion": "1.5.11", "schema": "graphql" },
    { "extname": "pg_stat_statements", "extversion": "1.11", "schema": "extensions" },
    { "extname": "pgcrypto", "extversion": "1.3", "schema": "extensions" },
    { "extname": "plpgsql", "extversion": "1.0", "schema": "pg_catalog" },
    { "extname": "supabase_vault", "extversion": "0.3.1", "schema": "vault" },
    { "extname": "uuid-ossp", "extversion": "1.1", "schema": "extensions" }
  ]
  ```

### SOLVE (Confidence: 0.95)
- **Schema coverage:** Core entities for inbox + automation are present (`Lead`, `Message`, `WebhookEvent`, `BackgroundJob`, follow-up tables, settings tables). (E1)
- **RLS posture:** RLS is enabled on 0 out of 41 public tables, and there are 0 policies in `public`. (E2, E3)
- **External access risk:** The `anon` and `authenticated` roles have full DML privileges on sensitive tables like `Lead` and `Message`. If PostgREST is reachable with an anon key (common in Supabase apps), this is a critical production risk (data exfiltration + tampering). (E4)
- **Operational expectations:** The DB has extensions commonly used in Supabase setups (pgcrypto, pg_stat_statements, uuid-ossp), plus pg_graphql and supabase_vault. (E5)

### VERIFY
- These findings are **database-state truth** for the connected Supabase project as of 2026-02-01; if you are deploying to a different project/environment, re-run the introspection queries there. (E1-E5)
- If you intend the client-side Supabase anon key to exist (for auth), you should treat `public` tables with no RLS + broad grants as externally reachable unless proven otherwise. (E2, E4)

### SYNTHESIZE
- **Mental model:** Supabase is providing Auth + Postgres; Prisma is operating against the same Postgres. The current DB has “open” table privileges in `public` with no RLS policies, which is unsafe if PostgREST access is possible with anon/authenticated roles. (E2, E4)
- **Immediate production checklist (security):**
  - Confirm whether any client can reach PostgREST for `public.*` tables (most Supabase projects can).
  - If yes, **fix before production**: enable RLS + add strict policies and/or revoke anon/authenticated grants on sensitive tables. (E2, E4)

## 16) Debugging Playbook (Where to Look When X Breaks)

### PLAN
- Provide the fastest source-of-truth file/entrypoint to check for each major symptom.
- Identify the log prefixes and env vars that control the runtime behavior.
- Identify “first failure domain” to isolate issues (webhook auth vs ingestion vs background jobs vs cron vs outbound provider).

### LOCATE
- Cron auth failures: `app/api/cron/*/route.ts` (look for `CRON_SECRET` checks)
- Webhook ingestion: `app/api/webhooks/**/route.ts`
- Webhook event drain + background jobs: `app/api/cron/background-jobs/route.ts`, `lib/background-jobs/runner.ts`
- Follow-ups: `app/api/cron/followups/route.ts`, `lib/followup-engine.ts`
- Availability: `app/api/cron/availability/route.ts`, `lib/availability-cache.ts`
- Notifications: `lib/notification-center.ts`
- Insights: `app/api/cron/insights/*`, `lib/insights-chat/*`

### EXTRACT
- **E1 — `app/api/cron/followups/route.ts:28-46`**
  ```ts
  const authHeader = request.headers.get("Authorization");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret) {
    console.warn("[Cron] CRON_SECRET not configured - endpoint disabled");
    return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    console.warn("[Cron] Invalid authorization attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  ```
- **E2 — `lib/background-jobs/runner.ts:23-33`**
  ```ts
  function getCronJobLimit(): number {
    return Math.min(200, parsePositiveInt(process.env.BACKGROUND_JOB_CRON_LIMIT, 10));
  }

  function getCronTimeBudgetMs(): number {
    return Math.max(10_000, parsePositiveInt(process.env.BACKGROUND_JOB_CRON_TIME_BUDGET_MS, 240_000));
  }
  ```
- **E3 — `lib/background-jobs/runner.ts:64-68`**
  ```ts
  const webhookEvents = await processWebhookEvents({ invocationId }).catch((error) => {
    console.error("[Cron] Webhook event processing failed:", error);
    return undefined;
  });
  ```
- **E4 — `lib/notification-center.ts:208-243`**
  ```ts
  if (!sent.success) {
    console.error("[NotificationCenter] Slack post failed:", sent.error);
  }

  if (!emailResult.success) {
    console.error("[NotificationCenter] Email send failed:", emailResult.error);
  }
  ```

### SOLVE (Confidence: 0.85)
- **Cron returns 401/503:** Start with the auth guard. If you see 503, `CRON_SECRET` isn’t configured. If you see 401, the bearer token doesn’t match. (E1)
- **“Webhooks are arriving but nothing happens after”:** The next hop is background jobs / webhook-event draining; look for `"[Cron] Webhook event processing failed"` and inspect `/api/cron/background-jobs` runs. (E3)
- **Background jobs are “stuck” or slow:** Tune `BACKGROUND_JOB_CRON_LIMIT` and `BACKGROUND_JOB_CRON_TIME_BUDGET_MS` (and confirm the runner is executing on cron). (E2)
- **Notifications aren’t sending:** Check for `"[NotificationCenter]"` errors and confirm Slack/Resend configuration for the workspace. (E4)

### VERIFY
- This playbook assumes you have access to server logs for cron + webhooks. Log prefixes in these excerpts are intended to be grep-able across providers. (E1, E3, E4)

### SYNTHESIZE
- **Triage order:** auth → ingestion → background jobs/webhook events → follow-ups/availability cron → outbound providers → notifications. (E1, E3)
- **Rule of thumb:** if inbound DB writes are present but downstream automation isn’t, the gap is usually “cron not running / unauthorized” or “background jobs stuck/over budget.” (E1, E2)

## 17) Known Gaps / Risks / Uncertainties (Explicit)

### PLAN
- List the highest-risk production blockers discovered during this end-to-end review.
- Provide source-grounded evidence for each risk.
- Separate “must fix before launch” from “acceptable known limitations”.

### LOCATE
- Supabase security posture: see Section 15 (RLS + grants)
- Follow-up template strictness + blocking behavior: `lib/followup-template.ts`, `lib/followup-engine.ts`
- Pending migration note: `docs/planning/phase-71/review.md`
- Pending DB push note: `docs/planning/phase-72/review.md`
- Dev-mode cron auth behavior: `app/api/cron/enrichment/route.ts`

### EXTRACT
- **E1 — `docs/planning/phase-71/review.md:10-11`**
  > ⏳ Migration not yet run on production (script ready, awaiting user confirmation)
- **E2 — `docs/planning/phase-72/review.md:9-10`**
  > **Remaining:** `npm run db:push` (requires DB credentials), manual smoke tests for CC replier flows + promotion
- **E3 — `lib/followup-engine.ts:858-872`**
  ```ts
  const generated = await generateFollowUpMessage(step, lead, settings);
  if (!generated.ok) {
    await prisma.followUpInstance.update({
      where: { id: instanceId },
      data: { status: "paused", pausedReason: buildTemplateBlockedPauseReason(generated.templateErrors) },
    });

    return { success: true, action: "skipped", message: `Sequence paused - follow-up template blocked: ${generated.error}` };
  }
  ```
- **E4 — `app/api/cron/enrichment/route.ts:19-22`**
  ```ts
  if (!cronSecret) {
    console.warn("[Enrichment Cron] CRON_SECRET not configured");
    return true; // Allow in development
  }
  ```

### SOLVE (Confidence: 0.8)
- **Critical security risk (must fix before launch):** Supabase `public` tables have no RLS policies and `anon/authenticated` have broad DML privileges on sensitive tables. This is externally risky if PostgREST is reachable with the anon key. (See Section 15 E2/E4)
- **Follow-up template strictness (implemented; must validate in prod):** Follow-up execution now blocks sends when templates reference unknown/missing variables and pauses the instance with a `missing_*` paused reason (e.g., `missing_lead_data`, `missing_workspace_setup`, `missing_booking_link`, `missing_availability`). This prevents placeholders from being sent, but may surface configuration gaps that need admin attention. (E3)
- **Operational completeness (must schedule before launch):**
  - Phase 71 requires running a production migration script to finalize the “ZRG Workflow V1” rename. (E1)
  - Phase 72 requires running `npm run db:push` against the intended DB and doing a smoke test for CC + promotion workflows. (E2)
- **Cron hardening:** Enrichment cron has an explicit “allow in development” path when `CRON_SECRET` is missing; ensure production always sets `CRON_SECRET`. (E4)

### VERIFY
- If your deployment model never exposes the Supabase anon key and never enables PostgREST access, the Supabase RLS/grants risk may be mitigated — but that must be proven; the default Supabase posture typically includes an anon key in the client for auth. (Section 15 E4)
- After enabling strict follow-ups, expect some instances to pause with `missing_*` reasons until workspace settings (AI persona name, company name, target result, calendar link, qualification questions) and lead fields are fully populated for the templates in use. (E3)

### SYNTHESIZE
- **Launch blockers (recommended):**
  1) Close the Supabase RLS/grants exposure (either enable RLS + policies or revoke grants / move tables out of `public`). (Section 15 E2/E4)
  2) Run Phase 71 migration + Phase 72 DB push and confirm with smoke tests. (E1, E2)
  3) Validate follow-up sequences in production: ensure templates + workspace settings resolve, and clear any `missing_*` pauses. (E3)

## 18) Analytics (Windows, Tabs, Workflow Attribution, Reactivation, CRM Sheet)

### PLAN
- Identify the Analytics UI surface area (tabs) and how it is windowed (7d/30d/90d/custom).
- Identify how workflow attribution analytics are computed (initial vs workflow attribution).
- Identify how reactivation KPIs are computed.
- Identify how the CRM sheet is populated and how inline edits are persisted safely.

### LOCATE
- `components/dashboard/analytics-view.tsx`: keywords `TabsTrigger`, `datePreset`, `windowRange`, `getWorkflowAttributionAnalytics`, `getReactivationCampaignAnalytics`, `BookingProcessAnalytics`, `AnalyticsCrmTable`
- `actions/analytics-actions.ts`: keywords `resolveAnalyticsWindow`, `getWorkflowAttributionAnalytics`, `updateCrmSheetCell`
- `components/dashboard/analytics-crm-table.tsx`: keywords `EditableTextCell`, `handleSave`, `handleBlur`, `updateAutomation`

### EXTRACT
- **E1 — `components/dashboard/analytics-view.tsx:277-327`**
  ```tsx
  return (
    <Tabs defaultValue="overview" className="flex flex-col h-full overflow-auto">
      <div className="border-b px-6 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-muted-foreground">Track your outreach performance</p>
          </div>
          <div className="flex items-center gap-2">
            <ChatgptExportControls activeWorkspace={activeWorkspace} />
            <Select value={datePreset} onValueChange={(value) => setDatePreset(value as typeof datePreset)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="booking">Booking</TabsTrigger>
          <TabsTrigger value="crm">CRM</TabsTrigger>
        </TabsList>
      </div>
  ```
- **E2 — `components/dashboard/analytics-view.tsx:92-193`**
  ```tsx
  const windowRange = useMemo(() => {
    if (datePreset === "custom") {
      if (!customFrom || !customTo) return null
      const from = new Date(customFrom)
      const to = new Date(customTo)
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return null
      // Make the end date inclusive by adding a day.
      to.setDate(to.getDate() + 1)
      return { from: from.toISOString(), to: to.toISOString() }
    }

    const now = new Date()
    const days = datePreset === "7d" ? 7 : datePreset === "30d" ? 30 : 90
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    return { from: from.toISOString(), to: now.toISOString() }
  }, [datePreset, customFrom, customTo])

  const windowParams = useMemo(
    () => (windowRange ? { from: windowRange.from, to: windowRange.to } : undefined),
    [windowRange]
  )
  const windowKey = windowRange ? `${windowRange.from}:${windowRange.to}` : datePreset

  useEffect(() => {
    let cancelled = false

    async function fetchWorkflowAnalytics() {
      setWorkflowLoading(true)
      const result = await getWorkflowAttributionAnalytics(
        windowParams ? { clientId: activeWorkspace, ...windowParams } : { clientId: activeWorkspace }
      )
      if (!cancelled) {
        if (result.success && result.data) {
          setWorkflowData(result.data)
        } else {
          setWorkflowData(null)
        }
        setWorkflowLoading(false)
      }
    }

    fetchWorkflowAnalytics()

    return () => {
      cancelled = true
    }
  }, [activeWorkspace, windowKey, windowParams])
  ```
- **E3 — `actions/analytics-actions.ts:47-102`**
  ```ts
  export async function getWorkflowAttributionAnalytics(opts?: {
    clientId?: string | null;
    from?: string;
    to?: string;
  }): Promise<{ success: boolean; data?: WorkflowAttributionData; error?: string }> {
    try {
      const user = await requireAuthUser();
      const now = new Date();
      const windowState = resolveAnalyticsWindow({ from: opts?.from, to: opts?.to });
      const to = windowState.to ?? now;
      const from =
        windowState.from ?? new Date(to.getTime() - DEFAULT_ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      const { totalsRows } = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = 10000`;

        const totalsRows = await tx.$queryRaw<
          Array<{ total_booked: bigint; workflow_booked: bigint }>
        >`
          WITH booked AS (
            SELECT l.id AS lead_id, l."appointmentBookedAt" AS booked_at
            FROM "Lead" l
            WHERE l."appointmentBookedAt" >= ${from}
              AND l."appointmentBookedAt" < ${to}
          ),
          matched AS (
            SELECT
              b.lead_id,
              fi."sequenceId" AS sequence_id,
              fi."lastStepAt" AS last_step_at,
              ROW_NUMBER() OVER (PARTITION BY b.lead_id ORDER BY fi."lastStepAt" ASC) AS rn
            FROM booked b
            JOIN "FollowUpInstance" fi ON fi."leadId" = b.lead_id
            WHERE fi."lastStepAt" IS NOT NULL
              AND fi."lastStepAt" < b.booked_at
          )
          SELECT
            (SELECT COUNT(*) FROM booked) AS total_booked,
            (SELECT COUNT(*) FROM matched WHERE rn = 1) AS workflow_booked
        `;

        return { totalsRows };
      });
  ```
- **E4 — `actions/analytics-actions.ts:369-400`**
  ```ts
  export interface AnalyticsWindow {
    from?: string; // ISO string (inclusive)
    to?: string; // ISO string (exclusive)
  }

  const DEFAULT_ANALYTICS_WINDOW_DAYS = 30;

  function resolveAnalyticsWindow(window?: AnalyticsWindow, fallbackDays = DEFAULT_ANALYTICS_WINDOW_DAYS): {
    from: Date | null;
    to: Date | null;
    key: string;
  } {
    if (!window?.from && !window?.to) {
      return { from: null, to: null, key: "all" };
    }

    const now = new Date();
    const to = window?.to ? new Date(window.to) : now;
    const from = window?.from
      ? new Date(window.from)
      : new Date(to.getTime() - fallbackDays * 24 * 60 * 60 * 1000);

    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      return { from: null, to: null, key: "all" };
    }

    if (from > to) {
      return { from: to, to: from, key: `${to.toISOString()}_${from.toISOString()}` };
    }

    return { from, to, key: `${from.toISOString()}_${to.toISOString()}` };
  }
  ```
- **E5 — `actions/analytics-actions.ts:2054-2108`**
  ```ts
  export async function updateCrmSheetCell(params: {
    leadId: string;
    field: CrmEditableField;
    value: string | null;
    updateAutomation?: boolean;
    expectedUpdatedAt?: string | null;
  }): Promise<{ success: boolean; error?: string; newValue?: string | null }> {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: params.leadId },
        select: { id: true, clientId: true, updatedAt: true, email: true },
      });

      if (!lead) {
        return { success: false, error: "Lead not found" };
      }

      const { capabilities } = await requireWorkspaceCapabilities(lead.clientId);
      if (capabilities.isClientPortalUser) {
        return { success: false, error: "Unauthorized" };
      }

      const expectedUpdatedAt = parseExpectedUpdatedAt(params.expectedUpdatedAt ?? null);

      const assertNotStale = (current: Date | null | undefined) => {
        if (!expectedUpdatedAt) return;
        if (!current || current.getTime() !== expectedUpdatedAt.getTime()) {
          throw new Error("Row was modified by another user");
        }
      };
  ```
- **E6 — `actions/analytics-actions.ts:2122-2145`**
  ```ts
  case "email": {
    assertNotStale(lead.updatedAt);
    const normalizedEmail = value ? normalizeEmail(value) : null;
    if (normalizedEmail === (lead.email ?? null)) {
      return { success: true, newValue: lead.email ?? null };
    }
    if (normalizedEmail) {
      const duplicate = await prisma.lead.findFirst({
        where: {
          clientId: lead.clientId,
          id: { not: lead.id },
          email: { equals: normalizedEmail, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (duplicate) {
        return { success: false, error: "Email is already used by another lead" };
      }
    }
    await prisma.lead.update({
      where: { id: lead.id },
      data: { email: normalizedEmail },
    });
    return { success: true, newValue: normalizedEmail };
  }
  ```
- **E7 — `components/dashboard/analytics-crm-table.tsx:95-156`**
  ```tsx
  const handleSave = async () => {
    if (isSaving) return
    const trimmed = multiline ? draftValue : draftValue.trim()
    const nextValue = trimmed.length > 0 ? trimmed : null
    setIsSaving(true)
    const result = await onSave({
      rowId,
      leadId,
      field,
      value: nextValue,
      updateAutomation: showAutomationToggle ? updateAutomation : undefined,
    })
    setIsSaving(false)
    if (!result.success) {
      setError(result.error || "Failed to save")
      return
    }
    setError(null)
    setIsEditing(false)
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    if (isEditing) void handleSave()
  }
  ```

### SOLVE (Confidence: 0.85)
- Analytics is a first-class dashboard view with tabs: **Overview**, **Workflows**, **Campaigns**, **Booking**, and **CRM**, and a shared date window selector (7/30/90/custom). (E1)
- The date window is computed client-side into `{ from, to }` ISO strings; custom end dates are made inclusive by adding one day, and analytics refetch on `windowKey` changes. (E2)
- Workflow attribution analytics are computed server-side by selecting booked leads within the window and joining `FollowUpInstance` rows that have a `lastStepAt` before the booking time; this supports “booked from workflow” attribution. (E3)
- CRM sheet edits are persisted via a server action (`updateCrmSheetCell`) that:
  - blocks client portal users via capabilities,
  - rejects stale edits via an `expectedUpdatedAt` equality check, and
  - performs field-specific validations (e.g., normalized email uniqueness per workspace). (E5, E6)
- CRM inline editing is “spreadsheet-like”: click-to-edit, save on blur/Enter, with an optional “Also update automation” toggle per edit. (E7)

### VERIFY
- Analytics window semantics are “inclusive start, exclusive end” on the backend (`to` is treated as an exclusive upper bound), while the UI makes custom end dates inclusive by adding one day. Ensure this is the intended contract for reporting. (E2, E4)
- CRM “stale edit” protection depends on exact `updatedAt` equality; if DB timestamp precision differs from client serialization, conflicts may appear more often than expected. (E5)

### SYNTHESIZE
- **Mental model:** Analytics is a read-only reporting plane layered over the same unified Lead/Message/FollowUp/Booking data, with a shared window driving all tabs. CRM is a “view + edit” overlay where writes go through strict server actions with RBAC + validation.
- **Where to debug:**
  - “Analytics numbers look wrong” → window range logic (`analytics-view.tsx`) and attribution query (`getWorkflowAttributionAnalytics`). (E1–E4)
  - “CRM edit doesn’t save” → `updateCrmSheetCell` capability check + stale edit check. (E5)

## 19) Lead Assignment (Weighted Round-Robin, Email-Only Gating, Audit Log)

### PLAN
- Identify how round-robin assignment is configured (settings UI + schema fields).
- Identify how/when assignment triggers (which inbound paths call it).
- Identify the core algorithm and its concurrency guarantees.
- Identify audit trail and operational alerts.

### LOCATE
- `prisma/schema.prisma`: keywords `roundRobinEnabled`, `roundRobinSetterSequence`, `roundRobinEmailOnly`, `LeadAssignmentEvent`
- `components/dashboard/settings/integrations-manager.tsx`: keyword `Assignments`
- `lib/lead-assignment.ts`: keywords `FOR UPDATE`, `computeEffectiveSetterSequence`, `isChannelEligibleForLeadAssignment`, `leadAssignmentEvent`
- Trigger sites: `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/*-inbound-post-process.ts`: keyword `maybeAssignLead`

### EXTRACT
- **E1 — `prisma/schema.prisma:285-290`**
  ```prisma
  // Round-robin lead assignment (Phase 43)
  roundRobinEnabled         Boolean  @default(false)  // When true, new positive leads are assigned to setters in rotation
  roundRobinLastSetterIndex Int?                      // Index of last assigned setter (for rotation)
  // Weighted round-robin sequence (Phase 89)
  roundRobinSetterSequence  String[] @default([])     // Ordered Supabase Auth user IDs; duplicates allowed for weighting
  roundRobinEmailOnly       Boolean  @default(false)  // When true, only Email inbound triggers assignment
  ```
- **E2 — `components/dashboard/settings/integrations-manager.tsx:1622-1683`**
  ```tsx
  <div className="space-y-2 border-t pt-2 mt-2">
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={`roundRobinEnabled-${client.id}`} className="text-xs">
        Round robin enabled
      </Label>
      <Switch
        id={`roundRobinEnabled-${client.id}`}
        checked={assignmentsForm.roundRobinEnabled}
        onCheckedChange={(checked) =>
          setAssignmentsForm({
            ...assignmentsForm,
            roundRobinEnabled: checked,
            roundRobinEmailOnly: checked ? assignmentsForm.roundRobinEmailOnly : false,
          })
        }
      />
    </div>
  </div>

  <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={`roundRobinEmailOnly-${client.id}`} className="text-xs">
        Email-only assignment
      </Label>
      <Switch
        id={`roundRobinEmailOnly-${client.id}`}
        checked={assignmentsForm.roundRobinEmailOnly}
        disabled={!assignmentsForm.roundRobinEnabled}
        onCheckedChange={(checked) =>
          setAssignmentsForm({
            ...assignmentsForm,
            roundRobinEmailOnly: checked,
          })
        }
      />
    </div>
  </div>

  <div className="space-y-2">
    <Label htmlFor={`roundRobinSequence-${client.id}`} className="text-xs">
      Round robin sequence (optional)
    </Label>
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {parseUniqueEmailList(assignmentsForm.setterEmailsRaw).map((email) => (
          <Button
            key={email}
            type="button"
            size="sm"
            variant="outline"
            disabled={!assignmentsForm.roundRobinEnabled}
            onClick={() =>
              setAssignmentsForm((prev) => ({
                ...prev,
                roundRobinSequence: [...prev.roundRobinSequence, email],
              }))
            }
          >
            + {email}
          </Button>
        ))}
      </div>
  ```
- **E3 — `lib/lead-assignment.ts:32-49`**
  ```ts
  export function computeEffectiveSetterSequence(opts: {
    activeSetterUserIds: string[];
    configuredSequence: string[] | null | undefined;
  }): string[] {
    const configured = Array.isArray(opts.configuredSequence) ? opts.configuredSequence : [];
    if (configured.length === 0) return opts.activeSetterUserIds;

    const activeSet = new Set(opts.activeSetterUserIds);
    return configured.filter((userId) => activeSet.has(userId));
  }

  export function isChannelEligibleForLeadAssignment(opts: {
    emailOnly: boolean;
    channel?: LeadAssignmentChannel;
  }): boolean {
    if (!opts.emailOnly) return true;
    return opts.channel === "email";
  }
  ```
- **E4 — `lib/lead-assignment.ts:111-195`**
  ```ts
  const assignedToUserId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "WorkspaceSettings" WHERE "clientId" = ${clientId} FOR UPDATE`;

    const settings = await tx.workspaceSettings.findUnique({
      where: { clientId },
      select: {
        roundRobinEnabled: true,
        roundRobinLastSetterIndex: true,
        roundRobinSetterSequence: true,
        roundRobinEmailOnly: true,
      },
    });

    if (!settings?.roundRobinEnabled) {
      return null;
    }

    if (!isChannelEligibleForLeadAssignment({ emailOnly: settings.roundRobinEmailOnly, channel })) {
      return null;
    }

    const effectiveSequence = computeEffectiveSetterSequence({
      activeSetterUserIds,
      configuredSequence: settings.roundRobinSetterSequence,
    });

    const nextIndex = getNextRoundRobinIndex(settings.roundRobinLastSetterIndex, effectiveSequence.length);
    const nextSetterUserId = effectiveSequence[nextIndex];

    const updateResult = await tx.lead.updateMany({
      where: { id: leadId, assignedToUserId: null },
      data: { assignedToUserId: nextSetterUserId, assignedAt: now },
    });
  });
  ```
- **E5 — `prisma/schema.prisma:905-920`**
  ```prisma
  // Lead assignment audit trail (Phase 89e)
  model LeadAssignmentEvent {
    id        String   @id @default(uuid())
    clientId  String
    leadId    String
    assignedToUserId String
    assignedByUserId String?
    source    String   // round_robin | backfill | manual
    channel   String?  // sms | email | linkedin
    createdAt DateTime @default(now())

    @@index([clientId, createdAt(sort: Desc)])
    @@index([leadId, createdAt(sort: Desc)])
    @@index([assignedToUserId])
  }
  ```
- **E6 — `lib/background-jobs/sms-inbound-post-process.ts:204-216`**
  ```ts
  await maybeAssignLead({
    leadId: lead.id,
    clientId: client.id,
    sentimentTag: finalSentiment,
    channel: "sms",
  });
  ```

### SOLVE (Confidence: 0.85)
- Round-robin assignment is workspace-configured via `WorkspaceSettings`:
  - enable/disable (`roundRobinEnabled`),
  - pointer/index (`roundRobinLastSetterIndex`),
  - weighted sequence list where duplicates are allowed for weighting (`roundRobinSetterSequence`),
  - and an email-only gate (`roundRobinEmailOnly`). (E1)
- The settings UI exposes these controls inside the Integrations manager “Assignments” section; the UI explicitly allows duplicates by appending emails into `roundRobinSequence`. (E2)
- The assignment algorithm:
  - filters the configured sequence to active setters while preserving ordering/duplicates,
  - skips non-email channels when `roundRobinEmailOnly=true`,
  - and assigns only when `assignedToUserId` is still null (idempotency). (E3, E4)
- Concurrency hardening is done by locking the workspace settings row (`FOR UPDATE`) and using `updateMany` with `assignedToUserId: null` as a guard to prevent double-assign. (E4)
- Assignment triggers occur from inbound post-process jobs and include an explicit `channel` value (e.g., `"sms"` shown), enabling the email-only gate. (E6)
- Assignments are auditable via the `LeadAssignmentEvent` model, which records lead/workspace, assignee, source, channel, and timestamp. (E5)

### VERIFY
- The UI shown uses setter emails as the sequence builder input; the persisted sequence is documented in schema comments as “Supabase Auth user IDs”. Ensure the server action that saves assignments resolves emails → userIds consistently. (E1, E2)

### SYNTHESIZE
- **Mental model:** inbound sentiment hits “positive” → round-robin may assign the lead to a setter → downstream workflows (human/AI replies, follow-ups) can use `Lead.assignedToUserId` as the primary owner signal.
- **Where to debug:**
  - “No leads are being assigned” → check `roundRobinEnabled` + `roundRobinEmailOnly` + sequence emptiness after filtering. (E1, E3, E4)
  - “Wrong person got assigned” → verify configured sequence order/duplicates in Integrations → Assignments UI. (E2)

## 20) Phase 93 (WIP) Persona-Routed Follow-Up Workflows (Chris + Aaron)

### PLAN
- Identify the intended routing basis and scope for persona-routed follow-ups.
- Identify schema and server-action changes that enable persona-bound sequences and a `setter_reply` trigger.
- Identify the runtime routing behavior (which sequence is picked for a lead).
- Identify follow-up template token changes required for persona signatures.

### LOCATE
- `docs/planning/phase-93/plan.md`: keywords `Routing basis`, `Scope`, `routeSequenceByPersona`, `setter_reply`, `meeting_selected`
- `prisma/schema.prisma`: `FollowUpSequence.aiPersonaId`, `triggerOn` includes `setter_reply`
- `lib/followup-sequence-router.ts`: keyword `routeSequenceByPersona`
- `lib/followup-automation.ts`: keyword `Auto-start routing`
- `components/dashboard/followup-sequence-manager.tsx`: keywords `setter_reply`, `AI Persona (optional)`, `{signature}`
- `lib/followup-persona.ts`, `lib/followup-template.ts`, `lib/__tests__/followup-template.test.ts`

### EXTRACT
- **E1 — `docs/planning/phase-93/plan.md:1-28`**
  ```md
  # Phase 93 — Persona-Routed Follow-Up Workflows (All Trigger Types)

  Decisions locked from the conversation:
  * **Routing basis:** by `EmailCampaign.aiPersonaId` (campaign assignment panel).
  * **Scope:** Persona routing applies to ALL trigger types:
    - `setter_reply` — On first manual email reply
    - `no_response` — On outbound email (Day 2/5/7 sequences)
    - `meeting_selected` — After meeting booked (Post-Booking sequences)
    - `manual` — Manual trigger only (persona routing still applies to template resolution)
  * **Signature:** workflow templates should support persona-driven tokens (not hardcoded per-template text), and the UI should clearly explain this.
  ```
- **E2 — `prisma/schema.prisma:1133-1144`**
  ```prisma
  model FollowUpSequence {
    id          String   @id @default(uuid())
    clientId    String
    isActive    Boolean  @default(true)
    triggerOn   String   @default("no_response")  // 'no_response' | 'meeting_selected' | 'manual' | 'setter_reply'
    aiPersonaId String?
    aiPersona   AiPersona? @relation(fields: [aiPersonaId], references: [id], onDelete: SetNull)
    steps       FollowUpStep[]
    instances   FollowUpInstance[]
  }
  ```
- **E3 — `lib/followup-sequence-router.ts:12-44`**
  ```ts
  export async function routeSequenceByPersona(opts: {
    clientId: string;
    triggerOn: string;
    routingPersonaId: string | null;
    fallbackNames?: string[];
  }): Promise<{ sequence: FollowUpSequenceCandidate | null; reason: string }> {
    const candidates = await prisma.followUpSequence.findMany({
      where: {
        clientId: opts.clientId,
        isActive: true,
        triggerOn: opts.triggerOn,
      },
      select: { id: true, name: true, aiPersonaId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    if (candidates.length > 0) {
      const personaMatch = opts.routingPersonaId
        ? candidates.find((seq) => seq.aiPersonaId === opts.routingPersonaId)
        : null;
      const generic = candidates.find((seq) => !seq.aiPersonaId);
      const selected = personaMatch ?? generic ?? candidates[0] ?? null;
      const reason = personaMatch
        ? "matched_persona"
        : generic
          ? "generic_fallback"
          : "latest_fallback";
      return { sequence: selected, reason };
    }
  ```
- **E4 — `lib/followup-automation.ts:468-509`**
  ```ts
  const routingPersonaId = lead.emailCampaign?.aiPersonaId ?? lead.client.aiPersonas?.[0]?.id ?? null;
  const routed = await routeSequenceByPersona({
    clientId: lead.clientId,
    triggerOn: "setter_reply",
    routingPersonaId,
    fallbackNames: [ZRG_WORKFLOW_V1_SEQUENCE_NAME, MEETING_REQUESTED_SEQUENCE_NAME_LEGACY],
  });

  if (!routed.sequence) {
    return { started: false, reason: routed.reason };
  }

  await startSequenceInstance(lead.id, routed.sequence.id, { startedAt: opts.outboundAt });

  console.log("[FollowUp] Auto-start routing", {
    triggerOn: "setter_reply",
    leadId: lead.id,
    clientId: lead.clientId,
    emailCampaignId: lead.emailCampaign?.id ?? null,
    routingPersonaId,
    sequenceId: routed.sequence.id,
    sequenceName: routed.sequence.name,
    reason: routed.reason,
  });
  ```
- **E5 — `components/dashboard/followup-sequence-manager.tsx:899-926`**
  ```tsx
  <div className="space-y-2">
    <Label>AI Persona (optional)</Label>
    <Select
      value={formData.aiPersonaId ?? "auto"}
      onValueChange={(value) =>
        setFormData({
          ...formData,
          aiPersonaId: value === "auto" ? null : value,
        })
      }
    >
      <SelectTrigger>
        <SelectValue placeholder="Use campaign/default persona" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Use campaign/default persona</SelectItem>
      </SelectContent>
    </Select>
    <p className="text-[11px] text-muted-foreground">
      {`{senderName}`} and {`{signature}`} resolve from the selected persona (or campaign/default when set to auto).
      Missing persona fields will pause follow-ups until configured.
    </p>
  </div>
  ```
- **E6 — `lib/followup-persona.ts:44-73`**
  ```ts
  const campaignPersona = lead?.emailCampaign?.aiPersona ?? null;
  const defaultPersona = lead?.client?.aiPersonas?.[0] ?? null;

  const selectedPersona = sequencePersona ?? campaignPersona ?? defaultPersona;
  const settings = lead?.client?.settings ?? null;

  const senderName = normalize(selectedPersona?.personaName) ?? normalize(settings?.aiPersonaName);
  const signature = normalize(selectedPersona?.signature) ?? normalize(settings?.aiSignature);
  ```
- **E7 — `lib/followup-template.ts:43-47`**
  ```ts
  { token: "{senderName}", valueKey: "aiPersonaName", source: "workspace" },
  { token: "{name}", valueKey: "aiPersonaName", source: "workspace", isAlias: true },
  { token: "{signature}", valueKey: "signature", source: "workspace" },
  ```
- **E8 — `lib/__tests__/followup-template.test.ts:112-123`**
  ```ts
  it("blocks rendering when signature is missing", () => {
    const res = renderFollowUpTemplateStrict({
      template: "Thanks,{signature}",
      values: { ...BASE_VALUES, signature: null },
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.errors.some((e) => e.type === "missing_value" && e.token === "{signature}"), true);
    }
  });
  ```

### SOLVE (Confidence: 0.8)
- Phase 93’s intended behavior is persona-aware workflow selection based on `EmailCampaign.aiPersonaId`, with persona routing applied across trigger types and persona-driven `{signature}` support. (E1)
- Schema supports persona-bound sequences via `FollowUpSequence.aiPersonaId`, and introduces `setter_reply` as an explicit trigger value. (E2)
- Routing is implemented via `routeSequenceByPersona()`:
  - if persona-specific sequences exist for a trigger, pick the one matching the routing persona id,
  - else fall back to a generic sequence (`aiPersonaId IS NULL`),
  - else fall back to the newest sequence. (E3)
- The “Meeting Requested” auto-start on first manual email reply now uses persona routing and logs its selection decision with `routingPersonaId` and chosen `sequenceId`. (E4)
- Follow-up template rendering now supports `{signature}` and blocks sends when it’s missing, preserving strict “never send placeholders” policy. (E7, E8)
- The UI exposes persona binding and explicitly documents `{senderName}` / `{signature}` sourcing behavior for admins. (E5)
- Runtime token resolution supports precedence: sequence persona → campaign persona → default persona → workspace settings. (E6)

### VERIFY
- The Phase 93 plan states persona routing should apply to **all trigger types**; the extracts show `setter_reply` routing explicitly, and schema supports trigger-based routing generally, but this section does not prove every trigger path is wired to `routeSequenceByPersona` yet. (E1, E3, E4)
- `FollowUpSequence.aiPersonaId` is a schema change; production rollout requires DB schema application (`npm run db:push` against the intended DB) before merging. (E2, E1)

### SYNTHESIZE
- **Mental model:** follow-ups gain a “persona layer”: sequence selection can be persona-specific, and template rendering can pull persona identity/signature from either the selected sequence persona or the campaign persona.
- **Operational takeaway:** to run Chris + Aaron concurrently, you configure two sequences with the same trigger but different persona bindings; the router selects based on campaign persona at runtime. (E1, E3, E5)

## 21) Recent Phase Updates (94–108) + Where Multi‑Agent / Memory / Eval Fit

### PLAN
- Add a compact, source‑grounded summary of the last 15 phases (94–108) so End2End reflects current platform reality.
- Use those updates to identify where multi‑agent overseer, memory, and evaluation improvements would plug in to maximize booking + messaging outcomes (and align with Phase 108).

### LOCATE
- Phase review docs: `docs/planning/phase-94/review.md` through `docs/planning/phase-107/review.md`
- Phase plan docs where review is absent: `docs/planning/phase-99/plan.md`, `docs/planning/phase-108/plan.md`

### EXTRACT
- **E94 — `docs/planning/phase-94/review.md:8`**
  > Phase 94 successfully implemented timeout/budget mitigations for the AI pipeline and added cron hardening. All code changes match the plan, quality gates pass, and documentation is updated.
- **E95 — `docs/planning/phase-95/review.md:5`**
  > - **Status**: ✅ **COMPLETE**
- **E96 — `docs/planning/phase-96/review.md:4`**
  > - AI-driven availability refresh shipped with all success criteria met
- **E97 — `docs/planning/phase-97/review.md:5`**
  > - ✅ **All objectives met** — Evaluator prompt updated, output interpretation tightened, UI warnings added, stats surfaced
- **E98 — `docs/planning/phase-98/review.md:4`**
  > - All planned booking-stop functionality implemented across GHL and Calendly reconciliation paths
- **E99 — `docs/planning/phase-99/plan.md:4`**
  > Tighten authentication for `/api/admin/followup-sequences/reengagement/backfill` so it only accepts admin/provisioning secrets via headers, handles multiple configured secrets correctly, and removes query-string auth.
- **E100 — `docs/planning/phase-100/review.md:7`**
  > - ✅ Fixed OpenAI 400s caused by sending `reasoning.effort="none"` to `gpt-5-mini`
- **E101 — `docs/planning/phase-101/review.md:4`**
  > - Outcome tracking added for AI drafts across SMS/email/LinkedIn with per‑draft classification.
- **E102 — `docs/planning/phase-102/review.md:4`**
  > - Table-based Campaign Assignment UI restored; Phase 97 header insights preserved.
- **E103 — `docs/planning/phase-103/review.md:4`**
  > - Fixed Step 3 verifier 400s by making prompt runner model/effort resolution **model-aware** and applied to the **effective model actually sent** to OpenAI.
- **E104 — `docs/planning/phase-104/review.md:4`**
  > - Added per-workspace UI control for Email Draft Verification (Step 3) model selection (admin-gated).
- **E105 — `docs/planning/phase-105/review.md:4`**
  > - Shipped deterministic follow-up draft keys + task dedupe to prevent duplicate follow-ups.
- **E106 — `docs/planning/phase-106/review.md:4`**
  > - Shipped: primary website asset field + prompt injection, meeting overseer extraction/gate + persistence, inbound-channel auto-booking confirmations, LinkedIn auto-booking wiring, availability blank-slot guard, regression tests, and “more info” response guidance to use offer/knowledge context.
- **E107 — `docs/planning/phase-107/review.md:4`**
  > - Shipped EmailBison reply payload change to stop copying lead signatures/links into outbound replies.
- **E108 — `docs/planning/phase-108/plan.md:4`**
  > Build a repeatable, workspace-scoped way to compare what outbound messages *work* (book meetings) vs *don’t* across **setters vs AI**, so we can systematically improve confidence gates, drafts, and prompts based on real outcomes.

### SOLVE (Confidence: 0.82)
- **Core reliability + safety hardening (94, 100, 103–104):** The AI pipeline now has tighter timeouts/budgets (E94), model‑aware prompt runner safeguards (E100, E103), and admin‑gated verifier model selection (E104), reducing 400s and stabilizing drafting.
- **Booking + availability correctness (96, 98, 105–106):** Availability refresh shipped (E96); meeting‑booked stops are enforced (E98); follow‑up dedupe prevents duplicate outreach (E105); and overseer‑gated auto‑booking plus confirmations and “more info” handling are in place (E106).
- **Messaging quality + insight readiness (97, 101–102, 107–108):** Evaluator interpretation tightened (E97), AI draft outcome tracking added (E101), and campaign assignment UI restored (E102). Email signature contamination is fixed (E107). Phase 108 defines the measurement layer for “what actually books” (E108).
- **Security gap queued (99):** Admin auth hardening for re‑engagement backfill is planned but not yet recorded as shipped. (E99)

**Placement + impact for Multi‑Agent Overseer / Memory / Eval (inference):**
- **Multi‑Agent Overseer** should sit *between* “draft generation” and “auto‑send/booking” and use the existing overseer gate (E106) as the control point; a multi‑agent supervisor can arbitrate between candidate drafts and enforce strict scheduling behavior learned from Phase 108’s performance data (E108).
- **Memory System** should attach to the same overseer/draft stages and inject lead‑specific history (prior objections, last‑offered slots, timezone, “not now” constraints) to reduce re‑asks and mismatch, directly improving booking conversion on follow‑ups (E96, E98, E106).
- **Evaluation Improvements** (LLM‑as‑judge) should use Phase 108’s booked/not‑booked labels (E108) to score drafts, and feed back into the evaluator already tightened in Phase 97 (E97), creating a closed loop to improve messaging quality.

### VERIFY
- Phase 108 is a plan (not shipped), so performance‑data‑driven evaluation and learning loops are not yet implemented. (E108)
- Phase 99 is a plan (not shipped) and still needs execution. (E99)

### SYNTHESIZE
- End2End now includes a concise update of phases 94–108, reflecting reliability hardening, booking correctness, messaging quality fixes, and the upcoming performance‑insight layer.
- The next highest‑leverage AI improvements are **multi‑agent overseer + memory + eval**, but they should be built explicitly **on top of** Phase 106’s gate and **aligned to** Phase 108’s booked/not‑booked outcome labels to maximize booking and response quality. (E106, E108)

## 22) Phase 169 (2026-02-18) — Log-Driven Inngest Offload + Verification Status

### PLAN
- Capture the operational reason for Phase 169 and the failure signatures it targeted.
- Document the final scope lock (migrated routes vs routes that must stay synchronous).
- Capture dispatch contract details (events, idempotency, concurrency, rollback flags).
- Record production verification outcomes, including root-cause remediation and current flag state.
- Preserve remaining open verification gaps so operators know exactly what is still required.

### LOCATE
- `docs/planning/phase-169/plan.md`
- `docs/planning/phase-169/a/plan.md`
- `docs/planning/phase-169/artifacts/inngest-offload-spec.md`
- `docs/planning/phase-169/d/plan.md`
- `docs/planning/phase-169/artifacts/signing-key-remediation-summary-2026-02-18T05-59-49Z.md`
- `docs/planning/phase-169/artifacts/post-fix-cron-flag-snapshot-2026-02-18T06-21-26Z.md`
- `docs/planning/phase-169/artifacts/phase-168-residual-risk-closure-2026-02-18T06-30-00Z.md`

### EXTRACT
- **E1 — `docs/planning/phase-169/plan.md:1-14`**
  ```md
  # Phase 169 — Log-driven Inngest offload for failing webhook + cron routes

  Break the log-driven timeout/retry “reversal loop” by moving eligible high-error routes (webhook + cron) off the synchronous request path into durable execution (Inngest + existing DB queues), while keeping user-facing inbox read APIs synchronous.
  ```
- **E2 — `docs/planning/phase-169/plan.md:14-24`**
  ```md
  - `/api/webhooks/email`: `21,050` × `504` + `310` × blank status
  - `/api/inbox/conversations`: `8,718` × `504` + `4,938` × `500` + `1,443` × blank status
  - `/api/cron/response-timing`: `545` × `500` + `18` × blank status
  - `/api/cron/background-jobs`: `77` × `500`
  ```
- **E3 — `docs/planning/phase-169/artifacts/inngest-offload-spec.md:5-18`**
  ```md
  ### Migrate to durable offload
  - `/api/webhooks/email` (`EMAIL_SENT`) via existing `WebhookEvent` queue-first behavior.
  - `/api/cron/background-jobs` via existing dispatch-only Inngest flow.
  - New dispatch-only cron offloads:
    - `/api/cron/response-timing`
    - `/api/cron/appointment-reconcile`
    - `/api/cron/followups`
    - `/api/cron/availability`
    - `/api/cron/emailbison/availability-slot`
  ```
- **E4 — `docs/planning/phase-169/artifacts/inngest-offload-spec.md:37-77`**
  ```md
  ## Canonical Event Names
  - `cron/response-timing.requested`
  - `cron/appointment-reconcile.requested`
  - `cron/followups.requested`
  - `cron/availability.requested`
  - `cron/emailbison-availability-slot.requested`

  Function-level idempotency for every new cron function:
  - `idempotency: "event.data.dispatchKey"`

  For each new cron function:
  - `retries: 3`
  - `concurrency: { limit: 1 }`
  ```
- **E5 — `docs/planning/phase-169/plan.md:141-149`**
  ```md
  - 2026-02-18T05:47:36Z (UTC) — Root cause identified: `Invalid signature` (`401`) traced to trailing whitespace/newline in production `INNGEST_SIGNING_KEY`.
  - 2026-02-18T05:50Z–05:57Z (UTC) — Remediated signing key (trimmed) + redeployed; zero new `Invalid signature` failures and durable run ledger repopulation.
  - 2026-02-18T06:19:20Z (UTC) — Enabled and verified emailbison availability-slot slice; dispatch `202`, then durable `SUCCEEDED`.
  ```
- **E6 — `docs/planning/phase-169/d/plan.md:94-103`**
  ```md
  - Root cause confirmed: production `INNGEST_SIGNING_KEY` contained trailing whitespace/newline causing `Invalid signature` (`401`) failures.
  - `Invalid signature` failures after `2026-02-18T05:51:00Z` dropped to zero.
  - Current production flag state:
    `CRON_RESPONSE_TIMING_USE_INNGEST=true`
    `CRON_APPOINTMENT_RECONCILE_USE_INNGEST=true`
    `CRON_FOLLOWUPS_USE_INNGEST=true`
    `CRON_AVAILABILITY_USE_INNGEST=true`
    `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST=true`
    `BACKGROUND_JOBS_USE_INNGEST=true`
    `INBOXXIA_EMAIL_SENT_ASYNC=true`
  ```
- **E7 — `docs/planning/phase-169/artifacts/phase-168-residual-risk-closure-2026-02-18T06-30-00Z.md:20-30`**
  ```md
  ### Risk 2: Matched-window dashboard export parity
  - Status: Still open (verification confidence gap).
  - Required to fully close:
    - attach matched baseline/post dashboard exports for all migrated routes, then append route-signature deltas into phase artifacts.
  ```

### SOLVE (Confidence: 0.9)
- Phase 169 converted high-error webhook/cron execution from synchronous request handling to durable dispatch patterns, while explicitly keeping inbox read APIs synchronous to avoid UX regressions. (E1, E3)
- Scope lock is clear:
  - queue-first webhook handling remains for EmailBison `EMAIL_SENT`,
  - background jobs stay dispatch-only,
  - five cron routes now support dispatch-only mode behind per-route flags. (E3)
- The rollout contract is deterministic and rollback-friendly:
  - canonical event names are fixed,
  - event idempotency is tied to `dispatchKey`,
  - function settings are conservative (`retries: 3`, `concurrency limit 1`),
  - each route has its own `*_USE_INNGEST` rollback toggle. (E4, E6)
- Production verification identified and fixed the core blocker:
  - `INNGEST_SIGNING_KEY` whitespace/newline caused callback signature failures (`401`),
  - trimming the key restored durable run ingestion,
  - post-fix failure counts dropped to zero in the sampled window. (E5, E6)
- End-state from phase artifacts shows all planned cron offload flags enabled, webhook queue-first enabled, and emailbison availability-slot moved from timeout risk to durable `SUCCEEDED` execution. (E6)
- The remaining gap is not route health; it is strict matched-window dashboard-export parity evidence for formal closure. (E7)

### VERIFY
- The phase itself records verification as operationally healthy but not fully closed until dashboard export parity packets are attached per migrated route. (E7)
- `BackgroundDispatchWindow.status=ENQUEUED` should not be interpreted as execution success; terminal health must be read from `BackgroundFunctionRun` outcomes (noted in Phase 169 RED TEAM findings). (`docs/planning/phase-169/plan.md`)
- Secret hygiene is now a required invariant for rollout operations: trim + whitespace-check critical secrets (`INNGEST_SIGNING_KEY`, `CRON_SECRET`) before deploy and probe windows. (E5, E6)

### SYNTHESIZE
- **Operational runbook (current):**
  1. Keep per-route offload flags as the primary rollout/rollback control.
  2. Confirm dispatch-only routes return `202` with deterministic `dispatchKey` + `correlationId`.
  3. Confirm durable completion in `BackgroundFunctionRun` (`SUCCEEDED`), not just dispatch ledger enqueue.
  4. Confirm `WebhookEvent` queue backlog remains stable (`duePending=0`, `runningCount=0` in the latest captured snapshot).
  5. For formal closure, attach matched-window baseline/post dashboard exports and compute route-signature deltas.
- **Cross-phase status:** Phase 168’s emailbison timeout residual is operationally addressed in Phase 169, while dashboard-export parity remains the open verification requirement. (E7)
