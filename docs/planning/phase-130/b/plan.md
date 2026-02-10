# Phase 130b — Server Action + Pipeline Passthrough + UI Toggle

## Focus

Wire `autoSendSkipHumanReview` through the full data pipeline (DB queries → orchestrator context) and expose it in the Campaign Assignment UI as a checkbox toggle.

## Inputs

- Phase 130a: Schema field exists, types updated, orchestrator logic reads `context.emailCampaign?.autoSendSkipHumanReview`
- Existing UI patterns in `components/dashboard/settings/ai-campaign-assignment.tsx`
- Existing server action patterns in `actions/email-campaign-actions.ts`

## Work

### 1. Server action: save + return the toggle

**File:** `actions/email-campaign-actions.ts`

**In `getEmailCampaigns()` (~line 70):**
- Add `autoSendSkipHumanReview: true` to the Prisma `select`
- Add `autoSendSkipHumanReview: c.autoSendSkipHumanReview` to the returned data

**In `updateEmailCampaignConfig()` (~line 106-220):**
- Add `autoSendSkipHumanReview?: boolean` to the opts type (~line 110)
- Add persistence logic:
  ```typescript
  if (opts.autoSendSkipHumanReview !== undefined) {
    data.autoSendSkipHumanReview = Boolean(opts.autoSendSkipHumanReview);
  }
  ```
- Add `autoSendSkipHumanReview: true` to the update `select`
- Add to the return data shape

### 2. Pipeline passthrough: add field to all DB selects

These files query `emailCampaign` fields and pass them to `executeAutoSend`. Add `autoSendSkipHumanReview: true` to each select:

| File | Approximate Line |
|------|-----------------|
| `lib/inbound-post-process/pipeline.ts` | ~123 |
| `lib/background-jobs/email-inbound-post-process.ts` | ~615, ~662, ~766, ~825 |
| `lib/background-jobs/sms-inbound-post-process.ts` | ~45 |

### 3. UI toggle in Campaign Assignment table

**File:** `components/dashboard/settings/ai-campaign-assignment.tsx`

**Type update (~line 21):**
Add `autoSendSkipHumanReview: boolean` to `CampaignRow`.

**Data initialization (~line 200):**
Add `autoSendSkipHumanReview: c.autoSendSkipHumanReview ?? false` to the row mapping.

**Dirty detection (~line 133 / ~301):**
Add comparison for `autoSendSkipHumanReview` in the dirty check logic.

**Save logic (~line 314):**
Include `autoSendSkipHumanReview: row.autoSendSkipHumanReview` in the save payload.

**UI rendering (~line 530-553, near the confidence threshold input):**
Add a Checkbox below the threshold input, only visible when `responseMode === "AI_AUTO_SEND"`:

```tsx
<div className="flex items-center gap-2 mt-1">
  <Checkbox
    id={`skip-review-${row.id}`}
    checked={row.autoSendSkipHumanReview}
    disabled={thresholdDisabled}
    onCheckedChange={(checked) =>
      updateRow(row.id, { autoSendSkipHumanReview: checked === true })
    }
  />
  <Label htmlFor={`skip-review-${row.id}`} className="text-xs text-muted-foreground">
    Skip human review check
  </Label>
</div>
```

Add a helper text below explaining the behavior: "Uses only confidence threshold. Hard blocks (opt-out, blacklist) still apply."

## Output

- Toggle is visible and functional in the Campaign Assignment UI for AI_AUTO_SEND campaigns
- Changing the toggle persists to the database via server action
- All inbound pipelines (email, SMS, SmartLead, Instantly) pass the field to the orchestrator
- End-to-end data flow: UI → server action → DB → pipeline query → orchestrator context

## Handoff

Subphase **c** adds test coverage for the new toggle and performs end-to-end verification.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `autoSendSkipHumanReview` to `getEmailCampaigns()` return shape and persisted it via `updateEmailCampaignConfig()`. (`actions/email-campaign-actions.ts`)
  - Passed `autoSendSkipHumanReview` through all inbound `emailCampaign` selects feeding `executeAutoSend()`. (`lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`)
  - Added a per-campaign checkbox UI (AI Auto-Send only) + dirty detection + save wiring. (`components/dashboard/settings/ai-campaign-assignment.tsx`)
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Add orchestrator unit tests for both toggle states + hard blocks (Phase 130c).
