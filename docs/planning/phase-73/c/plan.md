# Phase 73c — UI: Variable Visibility + Vivid Warnings/Toasts

## Focus

Make it impossible to miss misconfiguration by:
- showing all supported variables and where they come from
- warning clearly when setup is incomplete
- blocking actions (save/activate/start) with toasts + inline UI messages when required setup/data is missing

## Inputs

- Phase 73a: `lib/followup-template.ts` token registry + extraction helpers (client-safe)
- Phase 73b: server action validation errors from `actions/followup-sequence-actions.ts`
- UI surfaces:
  - `components/dashboard/followup-sequence-manager.tsx` (template editor)
  - `components/dashboard/settings-view.tsx` (workspace setup)
  - `components/dashboard/crm-drawer.tsx` (lead-level start sequence)

## Work

### Step 1 — Follow-up Sequence Manager: variable picker + inline validation

**File:** `components/dashboard/followup-sequence-manager.tsx`

Add:
- A “Variables” panel that lists all supported tokens (import from `lib/followup-template.ts`) grouped by source:
  - Lead fields (including `{leadCompanyName}`)
  - Workspace settings
  - Booking link
  - Availability
  - Qualification questions
- Insert buttons (or a searchable dropdown) for these variables, not just `{calendarLink}`.
- Inline “Template issues” panel per step:
  - Unknown variables (client-side detection using `getUnknownFollowUpTemplateTokens`)
  - Workspace setup missing for referenced workspace-level tokens (client-side detection using `getRequiredWorkspaceSetupForTokens(...)` from the same module, or by calling a server helper and caching result)
  - Copy should be explicit: “This step cannot send until you set: Company name, AI Persona name, Default calendar link…”

Ensure actions are blocked with vivid feedback:
- On save error from `createFollowUpSequence` / `updateFollowUpSequence`, display:
  - toast error
  - an inline alert in the dialog with the missing/unknown variable list
- On activation error from `toggleSequenceActive`, display:
  - toast error
  - an inline alert on the sequence card (or inside the expanded view) with the missing setup list and a link hint (“Go to Settings → General/Booking”)

Recommended copy (keep consistent across UI):
- Toast title: `Follow-ups blocked`
- Toast description: `Your setup is incomplete. Set up required variables to enable sending.`
- Inline banner: `You need to set these things up correctly in order for follow-ups to send: <missing list>.`

### Step 2 — Settings View: update follow-up setup warnings to reflect “blocked”, not “fallback”

**File:** `components/dashboard/settings-view.tsx`

Update the existing warning card copy to match the new policy:
- Replace “may fall back to placeholders or generic wording” with “follow-ups will be blocked from sending until these are configured”.
- Include explicit bullets for what’s missing and where to configure it (AI tab, Company context, Calendar links, Qualification questions).

### Step 3 — CRM Drawer: show lead-level variable status when starting sequences

**File:** `components/dashboard/crm-drawer.tsx`

When starting a sequence (manual trigger):
- show a small “Follow-up variables” section for the selected lead:
  - Lead values used by templates (firstName/lastName/email/phone/linkedinUrl/linkedinId/leadCompanyName)
  - Highlight missing fields that would block steps for this lead
- block `startFollowUpSequence(...)` if the sequence references lead variables missing on this specific lead, with:
  - toast error
  - inline message telling the user to enrich/fill lead info
- also block `startFollowUpSequence(...)` if the sequence references workspace-level variables that are missing in settings (this can happen for already-active sequences created before Phase 73 gating), with a toast that clearly blames missing setup (user action required)

### Step 4 — Master Inbox: label blocked follow-ups clearly

**Files:** `actions/lead-actions.ts`, `components/dashboard/conversation-card.tsx`

Add a small badge/label on the conversation card when:
- lead has a follow-up instance `status="paused"` due to missing variables/setup (Phase 73d reason codes)

Label requirements:
- Clearly indicates **blocked** (not generic “paused”)
- Indicates what to do next (e.g., “Missing lead data” vs “Missing workspace setup”)
- Uses the same “Follow-ups blocked” tone (explicitly user-actionable)

## Output

- `components/dashboard/followup-sequence-manager.tsx` now renders grouped variable buttons, per-step unknown token warnings, and workspace-setup blockers (toast + inline).
- `components/dashboard/settings-view.tsx` warning copy now states follow-ups are blocked until setup is complete (incl. qualification questions).
- `components/dashboard/crm-drawer.tsx` now shows lead variable status and blocks manual starts when lead/workspace data is missing.
- `actions/lead-actions.ts` + `components/dashboard/conversation-card.tsx` now surface “Follow-ups blocked” badges in the Master Inbox.

## Handoff

Phase 73d implements send-time blocking in `lib/followup-engine.ts` so automated follow-ups can never send with missing variables, even if a lead becomes incomplete later.
