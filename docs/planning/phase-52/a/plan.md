# Phase 52a — Requirements + Current-State Coverage Map

## Focus
Turn the five requested booking processes into precise, testable flows and map each flow onto the current codebase to confirm what is already supported vs what needs implementation.

## Inputs
- Stakeholder list of five booking processes (Phase 52 root Context).
- Existing booking primitives from Phase 36 (`lib/booking-process-instructions.ts`, `lib/booking.ts`, `lib/followup-engine.ts`).
- Existing availability modules (`lib/availability-cache.ts`, `lib/calendar-availability.ts`).
- Sentiment classification rules (`lib/sentiment.ts`) including scheduling-link guardrails.

## Work
- Define triggers for each process:
  - Which inbound categories (“Interested”, “Meeting Requested”, “Call Requested”, “Meeting Booked”) should activate which booking process?
  - Which cues should be treated as high-confidence vs ambiguous (and should escalate)?
- For each of the 5 processes, document:
  - **Entry conditions** (lead status, workspace settings, campaign booking process assignment, provider configured).
  - **Data dependencies** (offered slots present, phone present, timezone known, external calendar link extractable).
  - **System action** (draft reply, auto-book, follow-up task, Slack notification).
  - **Exit criteria** (appointment created + rollups updated; task created; human review required).
- Produce a coverage matrix:
  - ✅ Already implemented
  - 🟡 Partially implemented (missing trigger or persistence)
  - ❌ Not implemented
- Identify “must-answer” questions before implementation (examples):
  - Does “initial email with times” mean campaign-provider outbound (EmailBison/SmartLead/Instantly) or the AI’s first response email?
  - For lead-proposed times: should we book the *first matching slot* or ask them to confirm the exact time we selected?
  - For lead calendar link: is “schedule it in” satisfied by booking on our side (and emailing an invite), or must we book via their scheduler link?

## Output
- A finalized flow spec + coverage matrix embedded back into `docs/planning/phase-52/plan.md` (or as an addendum section).
- A short list of stakeholder questions required to unblock subphases b–d.

## Handoff
Proceed to Phase 52b with clarified definitions for:
- “initial email times” source-of-truth and persistence strategy
- what “schedule it in” means for lead-provided calendar links

## Output (Completed)

### Confirmed requirements / decisions (from stakeholder answers)

- **Templates:** All five booking processes must exist as **booking process templates** (selectable in UI).
- **Bulk template creation:** UI should support creating **default templates** and creating **multiple templates at once**.
- **Stage content order:** When a stage includes both **questions + link**, default order is **questions first, then link**.
  - Exception: when a stage includes **times**, order must be configurable to support **times first**, **link first**, or **questions first** per booking process/stage.
- **Process (2) ownership:** “Initial EmailBison email includes `availability_slot`” is implemented in **Phase 55**; Phase 52 must avoid overlap and remain compatible (downstream relies on `Lead.offeredSlots`).
- **Process (3) booking behavior:** If a lead proposes a time and is clearly requesting to book it (“I want to book Tue 3pm”), and the system can match it to availability with high confidence, **auto-book immediately** (reuse existing conservative auto-book posture).
- **Process (4) call tasks:** Create a **FollowUpTask(type="call")** when sentiment is **Call Requested** and a **phone exists**.
- **Notifications roadmap (new scope):** Add a “Notification Center” settings UI:
  - choose **which sentiments** should trigger notifications (e.g., positive sentiments, call requested)
  - choose **which platforms** to notify (email / phone / Slack)
  - store **contact email + contact phone** in General Settings
  - store **Slack API key** in Integrations tab

### Current-state coverage matrix (as-of 2026-01-24 working tree)

| Process | Requirement | Current coverage | Gap / Work |
|--------:|-------------|------------------|------------|
| (1) | Link-first + qualification questions (no times) | 🟡 Partial | Booking process stages support link + questions, but **order + first-class template + bulk creation** are missing. |
| (2) | Initial outbound email includes 2 times via `availability_slot` + persist to `Lead.offeredSlots` | ✅ Implemented in Phase 55 | Phase 52 must not duplicate; Phase 52 inbound must stay compatible with `Lead.offeredSlots`. |
| (3) | Lead proposes times → auto-book on high confidence | ❌ Missing | Need parsing → availability intersection → safe auto-book / escalation task. |
| (4) | “Call me” + phone → create call task + notify | 🟡 Partial | Sentiment + phone extraction exists; need **call-task creation + dedupe + notification plumbing**. |
| (5) | Lead provides calendar link → schedule or escalate | 🟡 Partial | Scheduling link extraction exists (`scheduling_link`), and availability fetchers exist, but no wiring / storage / safe automation decision. |

### Open questions (still needed before full automation)

1. **Process (5) “schedule it in” semantics:** when the lead provides *their* scheduling link, do we:
   - A) schedule on **our** calendar by intersecting availabilities and sending an invite, or
   - B) actually book via **their scheduler link** (Calendly/HubSpot/GHL) as an invitee?
2. **Slack integration details:** is “Slack API key” a **webhook URL** or a **bot token**? If bot token, what destination (channel ID vs DM)?
3. **Email + phone notifications:** what provider(s) should send these notifications (and do we ship Slack-first with email/SMS as config-only until provider is selected)?

## Handoff
- Proceed to **Phase 52b** focusing on:
  - booking-process template set for all 5 processes (UI + bulk creation)
  - stage content-order configurability (schema + UI + instruction builder)
  - explicitly **excluding** Phase 55’s `availability_slot` cron implementation from Phase 52 work
