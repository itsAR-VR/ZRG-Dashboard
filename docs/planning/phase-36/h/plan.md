# Phase 36h — Implementation Addendum (Wave Semantics + SMS 160)

## Focus

Lock the implementation details implied by the now-confirmed product decisions:

- Stage numbers are **global waves shared across channels**
- SMS output is **strict ≤ 160 characters**
- Booking links inserted by booking process always use the **workspace default** booking link
- Qualifying questions always include **`required: true`** questions when enabled

This addendum is the authoritative reference for Phase 36 implementation where subphases a–f are ambiguous or conflict with these decisions.

## Inputs

- Root plan: `docs/planning/phase-36/plan.md`
- Existing primitives (repo reality):
  - `prisma/schema.prisma` (`Lead.emailCampaignId`, `EmailCampaign`, `WorkspaceSettings.qualificationQuestions`, `Message.channel`, `CalendarLink`)
  - Booking link: `lib/meeting-booking-provider.ts:getBookingLink()`
  - Availability + offered slots: `lib/availability-cache.ts:getWorkspaceAvailabilitySlotsUtc`, `lib/availability-distribution.ts`, `lib/availability-format.ts`
  - Meeting lifecycle semantics: `lib/meeting-lifecycle.ts`, `lib/meeting-booking-provider.ts:isMeetingBooked()`

## Work

### 1) Schema addendum: wave-progress tracking (supersedes Phase 36a “Reply Counter” model)

Replace the “per-channel reply # → stageNumber” design with a single **wave** index and per-wave channel completion flags.

Recommended model (naming can vary, but keep semantics):

```prisma
model LeadCampaignBookingProgress {
  id            String   @id @default(uuid())

  // Scope: per lead + per EmailCampaign
  leadId        String
  lead          Lead     @relation(fields: [leadId], references: [id], onDelete: Cascade)

  emailCampaignId String
  emailCampaign   EmailCampaign @relation(fields: [emailCampaignId], references: [id], onDelete: Cascade)

  // Freeze booking process at conversation start (do not change mid-stream)
  activeBookingProcessId String?
  activeBookingProcess   BookingProcess? @relation(fields: [activeBookingProcessId], references: [id], onDelete: SetNull)

  // Global wave number (1-indexed). Stage selection uses this.
  currentWave Int @default(1)

  // “This wave already sent a message on channel X”
  waveEmailSent    Boolean @default(false)
  waveSmsSent      Boolean @default(false)
  waveLinkedinSent Boolean @default(false)

  // Lifetime outbound counters (used for analytics)
  emailOutboundCount    Int @default(0)
  smsOutboundCount      Int @default(0)
  linkedinOutboundCount Int @default(0)

  lastEmailOutboundAt    DateTime?
  lastSmsOutboundAt      DateTime?
  lastLinkedinOutboundAt DateTime?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([leadId, emailCampaignId])
  @@index([leadId])
  @@index([emailCampaignId])
  @@index([activeBookingProcessId])
}
```

Also update `BookingProcessStage` to use consistent field naming:

- `qualificationQuestionIds String[] @default([])` (IDs from `WorkspaceSettings.qualificationQuestions`)
- `linkType` should be an enum (preferred) or constrained string (`plain_url` | `hyperlinked_text`)

### 2) Wave advancement rules (authoritative)

When generating booking process instructions, use:

- `wave = progress.currentWave` (or `1` if no progress row exists yet)
- `stage = bookingProcess.stages.find(stageNumber === wave) || lastStage`

When an outbound message is sent (AI auto-send OR manual send), update progress **after** the outbound `Message` row is successfully created:

1. Ensure a progress row exists (upsert).
2. If `activeBookingProcessId` is null, set it from `EmailCampaign.bookingProcessId` at that moment (freezes assignment).
3. Increment the lifetime outbound count for that message’s channel and update `last*OutboundAt`.
4. Mark the per-wave `wave{Channel}Sent = true` for that channel.
5. Compute whether the wave is complete:
   - Required channels = stage `applyTo*` flags, filtered by channel sendability for this lead (see below).
   - Wave is complete if all required+sendable channels are either:
     - marked sent, OR
     - explicitly skipped (e.g., SMS when lead has no phone).
6. When wave completes: `currentWave += 1` and reset per-wave sent flags back to false.

**Channel sendability checks (minimum):**

- Email sendable if lead has `email`.
- SMS sendable if lead has `phone`.
  - If SMS is blocked by GHL DND (`Lead.smsDndActive === true` or `sendSmsSystem` returns `errorCode: "sms_dnd"`), the wave must **hold** and retry every **2 hours** (do not skip/advance).
  - If DND blocks for **>72 hours** in a row, stop holding and treat SMS as **skipped for that wave** so the wave can advance.
- LinkedIn sendable if lead has a usable LinkedIn identifier (define explicitly; e.g., `linkedinId` or connected status).

### 3) Instructions builder addendum (supersedes Phase 36e stage lookup)

Stage selection is wave-based and must be lead-derived (campaign context comes from `Lead.emailCampaignId`):

- If `Lead.emailCampaignId` is null → no booking process instructions (return null).
- If campaign has no booking process assigned (`EmailCampaign.bookingProcessId` null) → return null.
- Otherwise:
  - Load progress row (if any) to get `currentWave` and `activeBookingProcessId`.
  - Use active booking process if set; else use campaign booking process (and do not persist here — only persist when sending the first outbound message).

**Booking link rules:**

- Always use `getBookingLink(lead.clientId, settings)` (workspace default). Do not use per-lead overrides for booking process insertion.
- Hyperlinked text vs plain URL:
  - Email/LinkedIn: allow both.
  - SMS: plain URL only.

**Qualifying questions rules:**

- Source: `WorkspaceSettings.qualificationQuestions` (JSON array of `{ id, question, required }`).
- If stage enables questions:
  - Include `required: true` questions PLUS the stage-selected questions (dedupe by `id`).
  - SMS constraint: include **at most 2** required questions in SMS (rotate/cycle if more exist) and allow paraphrasing for brevity.

### 4) SMS hard limit (≤ 160 chars) — implementation constraints

SMS is strict **≤160 characters per message part**.

This section is superseded by `docs/planning/phase-36/i/plan.md`, which defines multipart SMS (1–3 parts) and the required schema/send-flow changes.

### 5) Analytics addendum (supersedes Phase 36f “meeting_booked” + stage math)

Align metrics with repo reality:

- “Booked” should be computed from provider-backed semantics (Phase 28):
  - Prefer `Lead.status === "meeting-booked"` and/or `isMeetingBooked()` / `isMeetingVerifiedBooked()`
  - `Lead.sentimentTag === "Meeting Booked"` may be displayed but should not be the only signal unless verified reliable in production data.
- “Avg replies to book”:
  - Use `LeadCampaignBookingProgress.{channel}OutboundCount` summed across channels for booked leads.
- “Drop-off by stage”:
  - Use `currentWave` (global wave) at the time the lead goes cold / stops responding.
  - For MVP, approximate with the max wave reached for non-booked leads.

## Output

- A single authoritative set of implementation semantics for waves, SMS 160, booking link source, and required questions.
- Implementers use this addendum to adjust subphases a–f during execution.

## Handoff

Proceed with Phase 36 implementation, treating this addendum as the source of truth where earlier subphase docs conflict.
