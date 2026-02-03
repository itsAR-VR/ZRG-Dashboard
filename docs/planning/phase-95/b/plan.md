# Phase 95b — Slack Integration (Regenerate Button + Interaction Handler)

## Focus
Add a `Regenerate` button to the **AI Auto-Send: Review Needed** Slack DM and implement the Slack interaction handler that:
- Runs fast regeneration against the current draft
- Creates a new pending `AIDraft` (rejecting the previous)
- Updates the Slack message preview + button payloads to point at the new draft

## Inputs
- Fast regen core from Phase 95a (✅ complete): `lib/ai-drafts/fast-regenerate.ts`
  - `fastRegenerateDraftContent(...)` — content-only rewrite (no DB writes)
  - `pickCycledEmailArchetypeId({ cycleSeed, regenCount })` — deterministic archetype cycling
- Slack DM blocks builder: `lib/auto-send/orchestrator.ts` (`sendReviewNeededSlackDm` blocks)
- Slack interactions webhook: `app/api/webhooks/slack/interactions/route.ts`
- Slack messaging helpers: `lib/slack-dm.ts:updateSlackMessageWithToken`
- DB models:
  - `AIDraft` (status/content/channel/autoSend fields)
  - `Client.slackBotToken`

## Work

### 1) Add `Regenerate` button to the review DM blocks
File: `lib/auto-send/orchestrator.ts`
- In the existing `actions` block (currently `Edit in dashboard` + `Approve & Send`), add:
  - Button label: `Regenerate`
  - `action_id`: `regenerate_draft_fast`
  - `style`: default (no primary/danger)
  - `value`: JSON string:

```ts
type SlackFastRegenValue = {
  draftId: string;
  leadId: string;
  clientId: string;
  cycleSeed: string; // stable per Slack thread; set to the initial draftId
  regenCount: number; // 0-based; initial DM uses 0
};
```

- Initial value should be:
  - `draftId = context.draftId`
  - `cycleSeed = context.draftId`
  - `regenCount = 0`

### 2) Implement Slack interaction handler
File: `app/api/webhooks/slack/interactions/route.ts`
- Extend the `SlackInteractionPayload` action handler loop:
  - If `action.action_id === "regenerate_draft_fast"`:

Handler algorithm (decision complete):
1. Parse `SlackFastRegenValue`.
2. Load the referenced draft:
   - `prisma.aIDraft.findUnique({ where: { id: value.draftId }, select: { id, leadId, channel, status, content, triggerMessageId, autoSend* fields, slackNotification* fields } })`
   - Validate: `draft.status === "pending"` and `draft.channel === "email"` (initial scope).
3. Load `Client.slackBotToken` for `value.clientId`.
4. Generate new content:
   - Pick archetype using `pickCycledEmailArchetype({ cycleSeed: value.cycleSeed, regenCount: value.regenCount })`.
   - Call `fastRegenerateDraftContent({ clientId, leadId, channel: "email", sentimentTag, previousDraft: draft.content, archetypeId, latestInbound })`.
   - `sentimentTag` source: load `Lead.sentimentTag` (fallback `Neutral`).
   - `latestInbound`: load latest inbound email `Message` for lead (subject + body), trimmed.
5. DB write (single transaction):
   - Reject the old draft (`status = rejected`) AND reject any other pending drafts for the lead/channel.
   - Create new `AIDraft`:
     - `leadId`, `channel="email"`, `status="pending"`, `content=newContent`, `triggerMessageId = null`
     - Copy auto-send metadata fields from old draft (confidence/threshold/reason/action/evaluatedAt/slackNotified)
     - Copy slack notification metadata if present (optional, but recommended for dashboard visibility)
6. Update Slack message (`chat.update`) using `updateSlackMessageWithToken`:
   - Draft preview section reflects `newContent`.
   - `Approve & Send` button `value` updated to new draft id.
   - `Edit in dashboard` URL updated to include new draft id.
   - `Regenerate` button value updated:
     - `draftId = newDraft.id`
     - `regenCount = value.regenCount + 1`
     - `cycleSeed` unchanged
7. Error handling:
   - If draft not found / not pending / wrong channel: update Slack message to a completed/error block and return `{ ok: true }`.
   - If regen generation fails: update Slack message to show error and keep buttons disabled (no-op update).

Implementation note:
- Add a `buildReviewNeededBlocks(...)` helper inside this route for the “review needed” state so regen can update the message consistently. This helper should mirror orchestrator formatting:
  - Header
  - Lead/campaign/sentiment/confidence fields
  - Reason
  - Draft preview
  - Actions (Edit / Approve / Regenerate)

### 3) Update unit tests for Slack blocks
File: `lib/auto-send/__tests__/orchestrator.test.ts`
- Add assertions that the Slack blocks include a button with `action_id === "regenerate_draft_fast"`.
- Assert the button value JSON includes `cycleSeed` and `regenCount`.

### 4) Error block template (RED TEAM)
Add to the interactions route (or extract to shared helper):

```ts
function buildRegenErrorBlocks(opts: {
  reason: string;
  dashboardUrl: string;
  userName: string;
}): SlackBlock[] {
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Regeneration Failed*\n${opts.reason}\n\n<${opts.dashboardUrl}|Edit in dashboard>\n\n_Attempted by ${opts.userName} at ${timestamp}_`,
      },
    },
  ];
}
```

**Error recovery (confirmed)**: If regen succeeds but Slack message update fails:
- Keep the new draft in DB
- Log the error prominently
- User recovers via dashboard link or retrying Regenerate

### 5) Type definition location (RED TEAM)
Define `SlackFastRegenValue` in `lib/auto-send/types.ts` for reuse:

```ts
export type SlackFastRegenValue = {
  draftId: string;
  leadId: string;
  clientId: string;
  cycleSeed: string;
  regenCount: number;
};
```

Import in both `orchestrator.ts` and `interactions/route.ts`.

## Validation (RED TEAM)

Before marking this subphase complete, verify:
- [ ] Slack DM blocks include `Regenerate` button with `action_id === "regenerate_draft_fast"`
- [ ] Button value JSON parses correctly and includes all required fields
- [ ] Clicking Regenerate creates new draft and rejects old draft
- [ ] Slack message is updated with new draft preview
- [ ] `Approve & Send` button value is updated to reference new draft
- [ ] Dashboard link is updated to include new draft id
- [ ] Malformed JSON in button value is handled gracefully (returns error, doesn't crash)
- [ ] Draft not found / not pending returns appropriate error message

## Output
- Added Slack `Regenerate` button to the auto-send review DM blocks:
  - File: `lib/auto-send/orchestrator.ts`
  - `action_id: "regenerate_draft_fast"`
  - Value includes `{ draftId, leadId, clientId, cycleSeed, regenCount }`
- Implemented Slack interaction handler for `regenerate_draft_fast`:
  - File: `app/api/webhooks/slack/interactions/route.ts`
  - Calls `fastRegenerateDraftContent(...)`, rejects pending drafts, creates a new pending draft (`triggerMessageId` stays `null`), and updates the Slack message blocks/buttons to point at the new draft id.
- Updated unit test coverage:
  - File: `lib/auto-send/__tests__/orchestrator.test.ts` asserts `regenerate_draft_fast` button is present and its value parses as expected.

## Handoff
Proceed to Phase 95c to add the dashboard `Fast Regen` server action + UI buttons, reusing the same fast regen core.
