# Phase 72g — Contact Promotion UI

## Focus

Add server action and UI elements to:
1. Display alternate emails associated with a lead
2. Allow promoting a CC'd person to become the primary contact (**admin-only**)
3. Allow setters to **request approval** (non-mutating) to promote an alternate contact

## Inputs

- Phase 72a: Lead has `alternateEmails`, `currentReplierEmail`, `currentReplierName`
- Phase 72c: Alternate emails populated by webhooks
- Existing lead detail/inbox UI in `components/dashboard/`
- Workspace roles: `lib/workspace-access.ts` (`getUserRoleForClient`, `requireClientAdminAccess`)

## Work

### 1. Add Server Action (`actions/lead-actions.ts`)

Implement two actions:

1) `promoteAlternateContactToPrimary(leadId, newPrimaryEmail)` — **admin-only mutation**
2) `requestPromoteAlternateContactToPrimary(leadId, requestedEmail)` — **setter request** (no mutation)

```typescript
import { emailsMatch, normalizeEmail } from "@/lib/email-participants";
import { requireClientAdminAccess, requireLeadAccessById, requireAuthUser, getUserRoleForClient } from "@/lib/workspace-access";

/**
 * Promote an alternate contact to become the lead's primary email.
 * The previous primary email moves to alternateEmails.
 */
export async function promoteAlternateContactToPrimary(
  leadId: string,
  newPrimaryEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { clientId } = await requireLeadAccessById(leadId);
    await requireClientAdminAccess(clientId);

    // Fetch lead with current state
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        clientId: true,
        email: true,
        alternateEmails: true,
        currentReplierEmail: true,
        currentReplierName: true,
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const normalizedNew = normalizeEmail(newPrimaryEmail);
    if (!normalizedNew) {
      return { success: false, error: "Invalid email address" };
    }

    // Verify the email is in alternateEmails
    const isAlternate = lead.alternateEmails.some(alt => emailsMatch(alt, normalizedNew));
    if (!isAlternate) {
      return { success: false, error: "Email is not an alternate contact for this lead" };
    }

    const oldPrimary = lead.email;

    // Build new alternates list: add old primary, remove new primary
    const newAlternates = [
      ...(oldPrimary ? [oldPrimary] : []),
      ...lead.alternateEmails.filter(e => !emailsMatch(e, normalizedNew)),
    ];

    // Update lead
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        email: normalizedNew,
        alternateEmails: newAlternates,
        // Clear current replier if they're now primary
        currentReplierEmail: emailsMatch(lead.currentReplierEmail, normalizedNew)
          ? null
          : lead.currentReplierEmail,
        currentReplierName: emailsMatch(lead.currentReplierEmail, normalizedNew)
          ? null
          : lead.currentReplierName,
        currentReplierSince: emailsMatch(lead.currentReplierEmail, normalizedNew)
          ? null
          : undefined, // Keep existing value
      },
    });

    return { success: true };
  } catch (error) {
    console.error("[promoteAlternateContactToPrimary] Error:", error);
    return { success: false, error: "Failed to promote contact" };
  }
}

/**
 * Setter-only request flow to ask an admin to promote an alternate contact.
 * This action must NOT mutate Lead.email.
 */
export async function requestPromoteAlternateContactToPrimary(
  leadId: string,
  requestedEmail: string
): Promise<{ success: boolean; error?: string }> {
  const user = await requireAuthUser();
  const { clientId } = await requireLeadAccessById(leadId);
  const role = await getUserRoleForClient(user.id, clientId);
  if (role !== "SETTER") {
    return { success: false, error: "Only setters can request promotion approval" };
  }

  // Implementation: best-effort notify an admin (e.g., Slack channel / DM) with lead link + requested email.
  // Do not block the UI if Slack isn't configured; return success with a message telling the setter what to do next.
  return { success: true };
}
```

### 2. Display Alternate Emails in Lead Details

In the lead detail view (likely `components/dashboard/inbox-view.tsx` or a detail panel):

```tsx
// Fetch lead with alternateEmails
const lead = /* ... include alternateEmails, currentReplierEmail, currentReplierName */;

// Display alternate contacts section (only if there are alternates)
{lead.alternateEmails.length > 0 && (
  <div className="mt-4">
    <h4 className="text-sm font-medium text-muted-foreground mb-2">
      Other Contacts in Thread
    </h4>
    <ul className="space-y-1">
      {lead.alternateEmails.map((email) => (
        <li key={email} className="flex items-center justify-between text-sm">
          <span className="text-foreground">{email}</span>
          {isAdmin ? (
            <Button variant="ghost" size="sm" onClick={() => handlePromoteContact(email)}>
              Make Primary
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => handleRequestPromoteContact(email)}>
              Request Primary
            </Button>
          )}
        </li>
      ))}
    </ul>
  </div>
)}
```

### 3. Add Admin Promotion + Setter Request Handlers

```tsx
const handlePromoteContact = async (email: string) => {
  const confirmed = window.confirm(
    `Make ${email} the primary contact? The current email will be saved as an alternate.`
  );

  if (!confirmed) return;

  const result = await promoteAlternateContactToPrimary(lead.id, email);

  if (result.success) {
    toast.success("Contact promoted to primary");
    // Refresh lead data
    router.refresh();
  } else {
    toast.error(result.error || "Failed to promote contact");
  }
};

const handleRequestPromoteContact = async (email: string) => {
  const confirmed = window.confirm(
    `Request to make ${email} the primary contact? An admin must approve this change.`
  );
  if (!confirmed) return;

  const result = await requestPromoteAlternateContactToPrimary(lead.id, email);
  if (result.success) {
    toast.success("Request sent to admin");
  } else {
    toast.error(result.error || "Failed to request promotion");
  }
};
```

### 4. Show Current Replier Badge (Optional Enhancement)

If there's an active CC replier, show a visual indicator:

```tsx
{lead.currentReplierEmail && (
  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
    <span>Recent reply from:</span>
    <Badge variant="secondary">
      {lead.currentReplierName || lead.currentReplierEmail}
    </Badge>
  </div>
)}
```

### 5. Update Lead Fetch Queries

Ensure queries that fetch leads include the new fields:

```typescript
// In getConversationsCursor, lead detail fetches, etc.
select: {
  // ... existing fields
  alternateEmails: true,
  currentReplierEmail: true,
  currentReplierName: true,
  currentReplierSince: true,
}
```

## Output

- Added admin-only `promoteAlternateContactToPrimary` and setter `requestPromoteAlternateContactToPrimary` in `actions/lead-actions.ts` (role checks + Slack DM notification).
- Extended lead payloads with `alternateEmails` and `currentReplier*` fields (conversation list + detail) and added viewer role to `getConversation`.
- Updated UI: `components/dashboard/crm-drawer.tsx` shows current replier badge + alternate contacts list with Make/Request Primary actions.
- Wired viewer role + new lead fields through `components/dashboard/inbox-view.tsx` and `lib/mock-data.ts` types.

## Coordination Notes

**Files modified:** `actions/lead-actions.ts`, `components/dashboard/inbox-view.tsx`, `components/dashboard/crm-drawer.tsx`, `lib/mock-data.ts`  
**Potential conflicts with:** Phase 70 (overlapping lead-actions/inbox-view changes) — re-read and merged in place.

## Handoff

Proceed to Phase 72h to harden lead matching via `alternateEmails` so promotion doesn't split threads for provider webhooks.
