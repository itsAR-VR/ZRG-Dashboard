# Phase 69a — Fix Slack OAuth Scopes

## Focus

Fix the Slack bot OAuth scopes so that DM notifications work correctly for the AI auto-send confidence gate.

## Inputs

- Current Slack bot scopes: `assistant:write, channels:read, chat:write, chat:write.public, users:write`
- Current user token scopes: `users:read`
- Target email: `jon@zeroriskgrowth.com`

## Work

### Problem

The Slack bot is missing two critical OAuth scopes:

1. **`users:read.email`** — Required for `users.lookupByEmail` API
   - Current `users:read` scope does NOT include email lookup capability
   - Without this, the bot cannot resolve `jon@zeroriskgrowth.com` to a Slack user ID

2. **`conversations:write`** — Required for `conversations.open` API
   - Without this, the bot cannot create/open DM channels with users

### Solution (User Action Required)

1. Go to https://api.slack.com/apps
2. Select the "Airtable-Notification-of-new-respon" app
3. Navigate to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**
4. Click **Add an OAuth Scope** and add:
   - `users:read.email`
   - `conversations:write`
5. Scroll up and click **Reinstall to Workspace** (required after scope changes)
6. Copy the new **Bot User OAuth Token**
7. Update `SLACK_BOT_TOKEN` in Vercel environment variables

### Final Required Scopes

After adding the missing scopes, bot token should have:
```
assistant:write
channels:read
chat:write
chat:write.public
conversations:write  ← NEW
users:read.email  ← NEW
users:write
```

## Output

- [ ] Slack bot has `users:read.email` scope
- [ ] Slack bot has `conversations:write` scope
- [ ] App reinstalled to workspace
- [ ] New token deployed to Vercel `SLACK_BOT_TOKEN`

**Output notes (2026-01-29):**
- Verified required scopes via Slack Web API docs (Context7): `users:read.email` for `users.lookupByEmail`, `conversations:write` for `conversations.open`.
- User action still required to update app scopes and reinstall the Slack app; no code changes made in this subphase.

## Handoff

Once scopes are fixed and the new bot token is deployed, proceed to Phase 69b to verify Slack DMs work by sending 10 test messages.
