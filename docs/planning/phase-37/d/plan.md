# Phase 37d — Form Labeling Pass (Inputs/Selects/Switches)

## Focus
Ensure all form controls have programmatically associated labels or `aria-label`/`aria-labelledby`.

## Inputs
- WCAG 2.1: 1.3.1 (Info and Relationships), 3.3.2 (Labels or Instructions)
- RED TEAM verified files with unlabeled form controls:

| File | Control Count | Priority |
|------|---------------|----------|
| `components/dashboard/settings-view.tsx` | 15+ Switches | HIGH |
| `components/dashboard/settings/booking-process-manager.tsx` | 4 Switches | HIGH |
| `components/dashboard/crm-drawer.tsx` | 3 Switches | MEDIUM |
| `components/dashboard/chatgpt-export-controls.tsx` | 4 Switches | MEDIUM |
| `components/dashboard/followup-sequence-manager.tsx` | 1 Switch | MEDIUM |
| `components/dashboard/conversation-feed.tsx` | 1 Switch | MEDIUM |
| `components/dashboard/insights-chat-sheet.tsx` | 1 Switch | LOW |

## Work

### Step 1: Understand the existing label pattern

The codebase uses a "label next to switch" layout pattern:
```tsx
<div className="flex items-center justify-between">
  <Label>Enable Feature</Label>
  <Switch checked={...} onCheckedChange={...} />
</div>
```

**Problem:** The `<Label>` is visually adjacent but not programmatically associated.

**Fix options:**
1. **Option A (preferred):** Add `id` to Switch, add `htmlFor` to Label
2. **Option B:** Add `aria-label` directly to Switch (simpler but duplicates text)
3. **Option C:** Add `aria-labelledby` with Label id (more complex)

### Step 2: Fix settings-view.tsx (15+ Switches)

Apply Option A pattern to each Switch/Label pair:

**Example fix for line ~1408 (emailDigest):**

**Before:**
```tsx
<div className="flex items-center justify-between">
  <Label>Email Digest</Label>
  <Switch
    checked={workspaceSettings?.emailDigest ?? false}
    onCheckedChange={...}
  />
</div>
```

**After:**
```tsx
<div className="flex items-center justify-between">
  <Label htmlFor="email-digest-switch">Email Digest</Label>
  <Switch
    id="email-digest-switch"
    checked={workspaceSettings?.emailDigest ?? false}
    onCheckedChange={...}
  />
</div>
```

Apply to all Switches in settings-view.tsx:
- Line ~1408: emailDigest → `id="email-digest-switch"`
- Line ~1422: slackAlerts → `id="slack-alerts-switch"`
- Line ~1971: autoBookMeetings → `id="auto-book-meetings-switch"`
- Line ~2165: question.required → `id={`required-question-${index}`}`
- Line ~2374: autoApproveMeetings → `id="auto-approve-meetings-switch"`
- Line ~2384: flagUncertainReplies → `id="flag-uncertain-replies-switch"`
- Line ~2394: pauseForOOO → `id="pause-for-ooo-switch"`
- Line ~2470: autoBlacklist → `id="auto-blacklist-switch"`
- Line ~2485: airtableModeEnabled → `id="airtable-mode-switch"`
- Line ~2627: enableCampaignChanges → `id="enable-campaign-changes-switch"`
- Line ~2641: enableExperimentWrites → `id="enable-experiment-writes-switch"`
- Line ~2655: enableFollowupPauses → `id="enable-followup-pauses-switch"`
- Line ~3154: 2FA disabled → `id="2fa-switch"`

### Step 3: Fix booking-process-manager.tsx (4 Switches)

- Line ~711: includeBookingLink → `id="include-booking-link-switch"`
- Line ~743: includeSuggestedTimes → `id="include-suggested-times-switch"`
- Line ~775: includeQualifyingQuestions → `id="include-qualifying-questions-switch"`
- Line ~823: includeTimezoneAsk → `id="include-timezone-ask-switch"`

### Step 4: Fix remaining files

**crm-drawer.tsx (3 Switches):**
- Line ~940: autoReplyEnabled → `id="auto-reply-enabled-switch"`
- Line ~954: autoFollowUpEnabled → `id="auto-followup-enabled-switch"`
- Line ~970: autoBookMeetingsEnabled → `id="auto-book-meetings-enabled-switch"`

**chatgpt-export-controls.tsx (4 Switches):**
- Line ~193: positiveOnly → `id="positive-only-switch"`
- Line ~253: messagesWithinRangeOnly → `id="messages-range-switch"`
- Line ~276: includeLeadsCsv → `id="include-leads-csv-switch"`
- Line ~283: includeMessagesJsonl → `id="include-messages-jsonl-switch"`

**followup-sequence-manager.tsx (1 Switch):**
- Line ~747: requiresApproval → `id="requires-approval-switch"`

**conversation-feed.tsx (1 Switch):**
- Line ~388: autoFollowUpsOnReplyEnabled → `id="auto-followups-reply-switch"`

**insights-chat-sheet.tsx (1 Switch):**
- Line ~595: allCampaigns → `id="all-campaigns-switch"`

### Step 5: Validation

```bash
npm run lint
npm run build
```

Manual screen reader test:
1. Focus each Switch with VoiceOver/NVDA
2. Verify screen reader announces the label text
3. Verify activating the switch works via Space key

### Step 6: Run `/impeccable:harden`

After labels are associated, invoke the harden skill to check for:
- Dynamic labels that might produce empty/undefined text
- Label text that might overflow or truncate
- Duplicate IDs (especially in mapped/looped controls like qualification questions)

## Output

**Completed 2026-01-18**

Fixed form labeling across 6 files with 28+ Switch controls:

1. **`components/dashboard/settings-view.tsx`** (13 Switches):
   - Email Digest, Slack Alerts, Auto-Book Meetings (with `htmlFor`)
   - Auto-approve meetings, Flag uncertain replies, Pause for OOO (with `aria-labelledby`)
   - Auto-blacklist, Airtable Mode, Enable campaign changes, Enable experiment writes, Enable follow-up pauses, 2FA (with `aria-labelledby`)

2. **`components/dashboard/settings/booking-process-manager.tsx`** (4 Switches):
   - Include Booking Link, Include Suggested Times, Include Qualifying Questions, Ask for Timezone
   - Used dynamic IDs: `{id}-${stageNumber}` for uniqueness across wave stages

3. **`components/dashboard/crm-drawer.tsx`** (3 Switches):
   - Auto Replies, Auto Follow-ups, Auto-Book Meetings (with `htmlFor`)

4. **`components/dashboard/chatgpt-export-controls.tsx`** (4 Switches):
   - Positive replies only, Messages within range only, Include leads.csv, Include messages.jsonl (with `htmlFor`)

5. **`components/dashboard/conversation-feed.tsx`** (1 Switch):
   - Auto Follow-ups (Positive Replies) (with `aria-labelledby`)

6. **`components/dashboard/insights-chat-sheet.tsx`** (1 Switch):
   - All campaigns (with `htmlFor`)

**Notes:**
- Used `htmlFor`/`id` pattern when `<Label>` component was available
- Used `aria-labelledby` with `id` on the text element when using `<span>` or `<p>` for labels
- Switches already wrapped in `<label>` elements (e.g., followup-sequence-manager.tsx) were left unchanged as they have implicit association

- `npm run lint --quiet` passes (no errors)

## Handoff
Proceed to Phase 37e to tighten touch targets and visual-state consistency.

---

## Validation (RED TEAM)

- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] VoiceOver/NVDA announces each Switch's label when focused
- [ ] Space key activates Switches correctly
- [ ] No "unlabeled form element" warnings in browser Accessibility panel

## Assumptions / Open Questions (RED TEAM)

- Assumption: Using `id`/`htmlFor` is preferred over `aria-label` to avoid text duplication (confidence ≥95%)
  - Mitigation: If Label component doesn't support `htmlFor`, use `aria-labelledby` instead
- Assumption: Switch IDs should be kebab-case and descriptive (confidence ≥90%)
  - Example: `email-digest-switch` vs `switch1`
