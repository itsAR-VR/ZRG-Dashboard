# Phase 44b — Calendly Webhook Signing Key Code Fix

## Focus

Modify `ensureCalendlyWebhookSubscriptionForWorkspace` in `actions/calendly-actions.ts` to detect when a webhook subscription exists but the signing key is missing locally, and force recreation of the webhook to capture the signing key.

## Inputs

- Phase 44a completed (Email Bison base hosts assigned)
- Database shows Founders Club has `calendlyWebhookSubscriptionUri` set but `calendlyWebhookSigningKey` is NULL
- Calendly API only returns `signing_key` at webhook creation time (POST response), not on GET requests

## Work

### Step 1: Understand current logic

Current flow in `actions/calendly-actions.ts` (lines 127-150):
1. If `subscriptionUri` exists, fetch existing subscription from Calendly
2. Validate callback URL, events, and organization
3. Try to extract `signing_key` from GET response (but Calendly doesn't return it on GET)
4. If validation fails, delete and recreate

**Problem:** If the subscription is valid but we have no local signing key, the code does nothing - it keeps the subscription without a key.

### Step 2: Add signing key check

Add logic after the existing validation checks (around line 142) to detect missing local signing key:

```typescript
// After existing validation checks...

// NEW: If we have a valid subscription but no local signing key, force recreation
// Calendly only returns signing_key on POST (creation), not on GET
if (!client.calendlyWebhookSigningKey) {
  console.log("[Calendly] Subscription exists but signing key missing locally; recreating webhook to capture signing key");
  await deleteCalendlyWebhookSubscription(client.calendlyAccessToken, subscriptionUri).catch(() => undefined);
  subscriptionUri = null;
  signingKey = null;
}
```

### Step 3: File to modify

**File:** `actions/calendly-actions.ts`

**Location:** Inside `ensureCalendlyWebhookSubscriptionForWorkspace`, after the existing validation checks (around lines 138-144), add the signing key check before the `else if` that tries to extract the key.

### Step 4: Test the fix

After deployment:
1. Go to Founders Club → Settings → Integrations → Calendly
2. Click "Ensure Webhooks" button
3. Verify the function:
   - Deletes the existing webhook (no signing key)
   - Creates a new webhook (Calendly returns signing key)
   - Stores the signing key in `Client.calendlyWebhookSigningKey`
4. Query database to confirm `calendlyWebhookSigningKey` is now set

## Output

**Status:** Implemented in working tree (not deployed)

**Code Change:**
- **File:** `actions/calendly-actions.ts`
- **Lines:** 142-149 (new block inserted)
- **Change:** Added check for missing local signing key after subscription validation. When a valid subscription exists but `client.calendlyWebhookSigningKey` is null, the code now:
  1. Logs the situation for debugging
  2. Deletes the existing webhook subscription
  3. Resets `subscriptionUri` and `signingKey` to null
  4. Allows the subsequent creation logic to create a fresh webhook (which returns the signing key in the POST response)

**Diff:**
```diff
+        } else if (!client.calendlyWebhookSigningKey) {
+          // Subscription is valid but we have no local signing key stored.
+          // Calendly only returns signing_key on POST (creation), not on GET requests.
+          // Force recreation to capture the signing key.
+          console.log("[Calendly] Subscription exists but signing key missing locally; recreating webhook to capture signing key");
+          await deleteCalendlyWebhookSubscription(client.calendlyAccessToken, subscriptionUri).catch(() => undefined);
+          subscriptionUri = null;
+          signingKey = null;
```

**Build Status:** ✅ `npm run lint` and `npm run build` pass (see `docs/planning/phase-44/review.md`)

## Handoff

Phase 44b implementation complete in this repo. Deploy to production, then click "Ensure Webhooks" in Founders Club Settings → Integrations → Calendly to trigger webhook recreation and capture the signing key. Proceed to Phase 44c for verification.
