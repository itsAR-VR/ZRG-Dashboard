# Phase 73 — QA Checklist (Follow-Up Template Strictness)

Goal: prove we never send follow-ups with unknown/missing variables or placeholders.

## Setup

- [ ] Ensure a workspace has:
  - [ ] `WorkspaceSettings.aiPersonaName`
  - [ ] `WorkspaceSettings.companyName`
  - [ ] `WorkspaceSettings.targetResult`
  - [ ] `WorkspaceSettings.qualificationQuestions` (at least 1–2 questions)
  - [ ] A **default** calendar link configured (so `{calendarLink}` can resolve)
- [ ] Ensure availability is configured (so `{availability}` / `{time 1 day 1}` / `{time 2 day 2}` can resolve)

## Template validation (save/activate time)

- [ ] Create a follow-up step with an **unknown** variable (e.g., `{first_name}`) and verify:
  - [ ] Save is blocked with an error listing the unknown variable(s)
- [ ] Create a sequence that references `{senderName}`, `{companyName}`, `{result}`, `{calendarLink}`, `{qualificationQuestion1}` and verify:
  - [ ] Activation is blocked if any required workspace setup is missing
  - [ ] Activation succeeds once setup is complete

## Runtime blocking (send time)

- [ ] Create a template that references lead variables:
  - [ ] `{firstName}`, `{lastName}`, `{email}`, `{phone}`, `{leadCompanyName}`
- [ ] Test with a lead **missing** one required field (e.g., `firstName = null`) and verify:
  - [ ] Follow-up does **not** send
  - [ ] The instance is paused with a `pausedReason` starting with `missing_*`
  - [ ] UI surfaces the pause reason clearly (Follow-ups view + Master Inbox badge)
- [ ] Test with a lead where all referenced fields are present and verify:
  - [ ] Follow-up sends and no `missing_*` pause reason is recorded

## Availability strictness

- [ ] Create a template that references `{availability}` and both time options:
  - [ ] `{availability}`, `{time 1 day 1}`, `{time 2 day 2}`
- [ ] Temporarily make availability return no slots and verify:
  - [ ] Follow-up does **not** send
  - [ ] Instance is paused with `missing_availability`
  - [ ] No placeholder availability text is sent

## Booking link strictness

- [ ] Create a template that references `{calendarLink}` and verify:
  - [ ] With no default calendar link configured, follow-up does **not** send and pauses with `missing_booking_link`
  - [ ] After setting a default calendar link, follow-up can send and includes a real URL (no `[calendar link]`)

## Manual start blocking (CRM Drawer)

- [ ] Start a sequence for a lead that is missing required lead variables and verify:
  - [ ] Start is blocked with a clear toast listing missing lead data

## Quality gates

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npm run build`

