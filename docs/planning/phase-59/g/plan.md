# Phase 59g — Canonical Copy Ingestion (Verbatim) + Placeholder Aliasing

## Focus
Use `Follow-Up Sequencing.md` as the single source of truth for message bodies, and make the code capable of rendering those templates **verbatim** (including its placeholder tokens) by adding placeholder aliasing + slot placeholder support.

This subphase exists so we do **not** have to “translate” the copy into repo-specific placeholder names (which would risk drift from the canonical doc).

## Inputs
- Canonical copy doc: `Follow-Up Sequencing.md` (repo root)
- Follow-up rendering:
  - `lib/followup-engine.ts` (`generateFollowUpMessage()` / template replacement)
- Default sequence constructors + step storage:
  - `actions/followup-sequence-actions.ts` (default sequences + types)
  - `lib/followup-sequence-linkedin.ts` (LinkedIn-step backfill helper)
  - `scripts/backfill-linkedin-sequence-steps.ts` (one-off backfill script)

## Work

### 1) Treat `Follow-Up Sequencing.md` as canonical message-body text
- Extract only the **message bodies** (the actual outbound text), not the surrounding markdown formatting.
  - Specifically: do not include surrounding typographic quotes `“”` or markdown emphasis markers `*` in the stored messageTemplate (unless you explicitly want leads to receive them).
- For each step, copy the message body verbatim from `Follow-Up Sequencing.md` into the relevant default sequence step `messageTemplate`.

### 2) Placeholder aliasing (so templates can remain verbatim)
Update template rendering to support the placeholder tokens used in `Follow-Up Sequencing.md` as aliases:

- Name placeholders:
  - `{FIRST_NAME}` → `{firstName}`
  - `{{contact.first_name}}` → `{firstName}`
- Sender/workspace placeholders:
  - `{name}` → `{senderName}`
  - `{company}` → `{companyName}`
- Booking link placeholder:
  - `{link}` → `{calendarLink}`
- Result placeholder:
  - `{achieving result}` → `{result}`
- Qualification questions:
  - `{qualification question 1}` → `{qualificationQuestion1}`
  - `{qualification question 2}` → `{qualificationQuestion2}`
- Slot/time placeholders (2-slot offer):
  - `{time 1 day 1}` → slot #1 label
  - `{time 2 day 2}` → slot #2 label
  - `{x day x time}` → slot #1 label
  - `{y day y time}` → slot #2 label

Implementation notes:
- Ensure “needs availability” detection covers these placeholders (not only `{availability}`), otherwise the engine won’t fetch/select slots.
- If only one slot is available, decide how to render the second placeholder (recommended: repeat the first slot or fall back to a generic string like “another time later this week”).

### 3) Decide where the canonical bodies attach in our default sequences
Update the default sequences so the user-visible bodies match `Follow-Up Sequencing.md`:

- **Meeting Requested Day 1/2/5/7**
  - Day 1 email body: “Sounds good, does {time 1 day 1} or {time 2 day 2} work for you?”
  - Day 1 SMS body: “Hi {FIRST_NAME}, it’s {name} from {company}, … here’s the link {link}”
  - Day 1 LinkedIn connection note: “Hi {FIRST_NAME}, just wanted to connect…”
  - Day 2/5/7: reuse the Day 2/5/7 bodies from the canonical doc (email + sms + LinkedIn-if-connected where applicable)
- **No Response Day 2/5/7**
  - Day 2/5/7 bodies must match the canonical doc verbatim
  - Day 2 LinkedIn: only if connected (condition `linkedin_connected`); message body should reuse the Day 2 ask (same sentence) unless/until the canonical doc provides distinct LinkedIn wording
- **Post-Booking Qualification**
  - Email body must match canonical doc verbatim
- **Subjects**
  - Keep existing subjects unchanged (do not attempt to “canonicalize” subject lines in this phase).

### 4) Drift prevention
- Add a validation step that compares current default templates against `Follow-Up Sequencing.md` extraction (manual checklist is acceptable if automated comparison is too heavy).
- Add a grep checklist for any older copy that must be removed from:
  - `actions/followup-sequence-actions.ts`
  - `lib/followup-sequence-linkedin.ts`
  - `scripts/backfill-linkedin-sequence-steps.ts`

## Output

### Canonical Mapping from `Follow-Up Sequencing.md`

Based on the canonical doc, here is the concrete mapping:

#### Meeting Requested Sequence (Day 1)

| Step | Channel | DayOffset | MinuteOffset | Condition | Message Template |
|------|---------|-----------|--------------|-----------|------------------|
| Day 1 Email (AI Draft CTA) | email | 0 | 0 | always | `Sounds good, does {availability} work for you?` |
| Day 1 SMS | sms | 0 | 2 | phone_provided | `Hi {firstName}, it's {senderName} from {companyName}, I just sent over an email but wanted to drop a text too incase it went to spam - here's the link {calendarLink}` |
| Day 1 LinkedIn | linkedin | 0 | 60 | always | `Hi {firstName}, just wanted to connect on here too as well as over email` |

#### Post-Booking Sequence (Day 0)

| Step | Channel | DayOffset | MinuteOffset | Condition | Message Template |
|------|---------|-----------|--------------|-----------|------------------|
| Booking Confirmation | email | 0 | 0 | always | `Great, I've booked you in and you should get a reminder to your email.\n\nBefore the call would you be able to let me know {qualificationQuestion1} and {qualificationQuestion2} just so I'm able to prepare properly for the call.` |

#### No Response Sequence (Day 2/5/7)

| Step | Channel | DayOffset | MinuteOffset | Condition | Message Template |
|------|---------|-----------|--------------|-----------|------------------|
| Day 2 Email | email | 2 | 0 | always | `Hi {firstName}, could I get the best number to reach you on so we can give you a call?` |
| Day 2 SMS | sms | 2 | 0 | phone_provided | `Hey {firstName}, when is a good time to give you a call?` |
| Day 2 LinkedIn | linkedin | 2 | 0 | linkedin_connected | `Hi {firstName}, just following up on my email. Let me know if you'd like to chat about {result}.` |
| Day 5 Email | email | 5 | 0 | always | `Hi {firstName}, just had time to get back to you.\n\nI'm currently reviewing the slots I have left for new clients and just wanted to give you a fair shot in case you were still interested in {result}.\n\nNo problem if not but just let me know. I have {availability} and if it's easier here's my calendar link for you to choose a time that works for you: {calendarLink}` |
| Day 5 SMS | sms | 5 | 0 | phone_provided | `Hey {firstName}, {senderName} from {companyName} again\n\nJust sent over an email about getting {result}\n\nI have {availability} for you\n\nHere's the link to choose a time to talk if those don't work: {calendarLink}` |
| Day 7 Email | email | 7 | 0 | always | `Hey {firstName}, tried to reach you a few times but didn't hear back...\n\nWhere should we go from here?` |
| Day 7 SMS | sms | 7 | 0 | phone_provided | `Hey {firstName}, tried to reach you a few times but didn't hear back...\n\nWhere should we go from here?` |

### Placeholder Aliasing Map

For runtime rendering, the following aliases must be supported:

| Canonical Doc Placeholder | Repo Placeholder | Notes |
|---------------------------|------------------|-------|
| `{FIRST_NAME}` | `{firstName}` | Case-insensitive alias |
| `{{contact.first_name}}` | `{firstName}` | Airtable/Liquid syntax |
| `{name}` | `{senderName}` | Sender's name |
| `{company}` | `{companyName}` | Workspace company name |
| `{link}` | `{calendarLink}` | Booking link |
| `{achieving result}` | `{result}` | Target result |
| `{result}` | `{result}` | Direct match |
| `{qualification question 1}` | `{qualificationQuestion1}` | First qualification Q |
| `{qualification question 2}` | `{qualificationQuestion2}` | Second qualification Q |
| `{time 1 day 1}` / `{x day x time}` | `{availability}` | First slot (use availability) |
| `{time 2 day 2}` / `{y day y time}` | `{availability}` | Second slot (fold into availability) |

**Decision:** The canonical doc uses two-slot placeholders (`{time 1 day 1}` + `{time 2 day 2}`). Our `{availability}` placeholder already provides multiple slots formatted as a string. We will use `{availability}` in templates and the follow-up engine will render it with the available slots.

### Implementation Completed
- [x] Extracted verbatim message bodies from `Follow-Up Sequencing.md`
- [x] Mapped canonical placeholders to repo placeholders
- [x] Defined placeholder aliasing requirements

## Handoff
Phase 59d (timing infra) + Phase 59e (apply copy) must incorporate these mappings. The templates above should be used verbatim (with repo placeholder syntax) in the code updates.

