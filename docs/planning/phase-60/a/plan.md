# Phase 60a — Design Reference Panel Content

## Focus
Define the content structure and detailed descriptions for all 5 booking processes. This subphase produces the canonical reference content that will be rendered in the UI.

## Inputs
- Phase 52 plan.md (booking process definitions)
- `lib/booking-process-templates.ts` (template implementations)
- `lib/booking-process-instructions.ts` (instruction generation logic)
- `lib/call-requested.ts` (call task creation)
- `lib/scheduling-link.ts` + `lib/lead-scheduler-link.ts` (scheduler link handling)

## Work

### 1. Define the 5 Booking Processes

| # | Name | Type | Trigger | Behavior | Example |
|---|------|------|---------|----------|---------|
| 1 | **Link + Qualification** | Outbound | Lead shows interest | AI draft includes booking link + qualifying question(s), no suggested times | "I'd love to chat! What's your timeline for implementing this? Here's my calendar: calendly.com/..." |
| 2 | **Initial Email Times** | Inbound | First outbound email included times via EmailBison `availability_slot` | Lead picks a time → system auto-books that slot | Lead replies "Tuesday 2pm works" → auto-booked |
| 3 | **Lead Proposes Times** | Inbound | Lead suggests times in their message | High-confidence match to availability → auto-book; otherwise escalate | Lead says "I'm free Thursday 3-5pm" → system finds match and books |
| 4 | **Call Requested** | Inbound | Lead asks for a call + provides phone | Creates call task + sends notification to client | Lead: "Just call me at 555-1234" → task created, Slack/email notification sent |
| 5 | **Lead Calendar Link** | Inbound | Lead sends their own scheduler link | AI captures link, checks availability overlap, creates manual review task | Lead: "Book time on my calendar: calendly.com/lead/30min" → flagged for human action |

### 2. Process Type Definitions

**Outbound Processes** — Control what goes into AI-generated drafts:
- Configure via BookingProcess stages (link, times, questions, timezone ask)
- Affects what the AI includes when replying to interested leads

**Inbound Processes** — React to lead messages:
- Triggered by sentiment/content classification
- Execute system actions (auto-book, create task, send notification)
- Not configured via stages; behavior is built into the system

### 3. Process Maturity Indicators

| Process | Automation Level | Notes |
|---------|-----------------|-------|
| 1 - Link + Qualification | Fully automated | Draft generation follows stage configuration |
| 2 - Initial Email Times | Fully automated | Auto-books when lead selects offered time |
| 3 - Lead Proposes Times | Mostly automated | Auto-books on high confidence; escalates if unclear |
| 4 - Call Requested | Fully automated | Task + notification always created |
| 5 - Lead Calendar Link | **Manual review** | Captures link; human must complete booking |

### 4. UI Content Structure

```
Booking Processes Reference
├── Introduction text explaining outbound vs inbound
├── Process 1: Link + Qualification
│   ├── Type badge: "Outbound"
│   ├── Description
│   ├── When it triggers
│   ├── What it does
│   └── Template: "Link + Qualification (No Times)"
├── Process 2: Initial Email Times
│   ├── Type badge: "Inbound"
│   ├── Description
│   ├── When it triggers
│   ├── What it does
│   └── Template: "Initial Email Times (EmailBison)"
├── Process 3: Lead Proposes Times
│   ├── Type badge: "Inbound"
│   ├── Description
│   ├── When it triggers
│   ├── What it does
│   └── Template: "Lead Proposes Times"
├── Process 4: Call Requested
│   ├── Type badge: "Inbound"
│   ├── Description
│   ├── When it triggers
│   ├── What it does
│   ├── Requires: Notification Center configured
│   └── Template: "Call Requested"
└── Process 5: Lead Calendar Link
    ├── Type badge: "Inbound"
    ├── Automation badge: "Manual Review"
    ├── Description
    ├── When it triggers
    ├── What it does (capture + escalate)
    ├── Note: Full automation planned as follow-on
    └── Template: "Lead Provided Calendar Link"
```

## Output
- Canonical content definitions for all 5 processes
- UI structure specification
- Badge/indicator definitions (type, automation level)

## Handoff
Pass the content specification to Phase 60b for component implementation.
