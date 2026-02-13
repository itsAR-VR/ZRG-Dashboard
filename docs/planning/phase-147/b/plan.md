# Phase 147b - LinkedIn Unstick Fix (Company URL and Unresolvable Member Handling)

## Focus
Prevent LinkedIn steps from stalling follow-up instances when the target URL is not a person profile or member resolution is unrecoverable.

## Inputs
- Phase 147a runtime contract
- `lib/followup-engine.ts`
- `lib/unipile-api.ts`
- Existing LinkedIn URL helper modules (for normalization/classification reuse)

## Work

### 1. Add person-profile pre-check in `lib/followup-engine.ts`

**Insert at ~line 1241** (after the `!linkedinUrl` check at line 1206, before the `accountId` check at line 1277):

```typescript
// Company/non-person LinkedIn URLs cannot receive messages — skip and advance
if (!/\/in\/[^/]+/i.test(currentLead.linkedinUrl)) {
  await ensureFollowUpTaskRecorded({
    leadId: lead.id,
    type: "linkedin",
    instanceId,
    stepOrder: step.stepOrder,
    status: "pending",
    suggestedMessage: "LinkedIn skipped — URL is not a person profile (company/non-person URL).",
  });
  return {
    success: true,
    action: "skipped",
    message: "LinkedIn skipped — URL is not a person profile",
    advance: true,
  };
}
```

**Why here:** This prevents reaching `extractLinkedInPublicIdentifier` (in `lib/unipile-api.ts:175-179`) which has a dangerous fallback that extracts company names as person identifiers, causing incorrect Unipile API calls. Pre-checking avoids unnecessary API quota consumption.

**No changes to `lib/unipile-api.ts`** — the pre-check in the engine is sufficient.

### 2. Handle unrecoverable member-resolution failures

For send/invite failures where member ID cannot be resolved from the profile target:
- Record `"LinkedIn skipped — unresolvable member target."` in FollowUpTask.
- Return `skipped + advance`.
- This applies to the error path after `checkLinkedInConnection` / `sendLinkedInConnectionRequest` when the identifier is valid (`/in/...`) but the user cannot be found.

### 3. Update backstop filter at `lib/followup-engine.ts:2741`

Current: `if (channel === "linkedin" && !instance.lead.linkedinUrl) continue;`

Add company-URL detection to the backstop so overdue instances with company URLs also get skip-and-advanced during cron sweeps instead of re-entering execution on every cycle:

```typescript
if (channel === "linkedin" && (!instance.lead.linkedinUrl || !/\/in\/[^/]+/i.test(instance.lead.linkedinUrl))) {
  // Skip-and-advance with FollowUpTask, then continue
}
```

### 4. Preserve existing behavior

- Disconnected account (`pausedReason: "unipile_disconnected"`, lines 1262-1274): unchanged — admin-recoverable.
- Unreachable recipient (`pausedReason: "linkedin_unreachable"`, lines 1245-1258): unchanged — health-gated.
- Transient provider failures: unchanged — retried on next cron cycle.

### 5. No changes to replay/judge files

Files currently modified by other agents (`lib/ai-replay/judge.ts`, `lib/ai-replay/run-case.ts`, `scripts/live-ai-replay.ts`) must not be edited.

## Output
LinkedIn execution path that cannot be starved by company/invalid profile targets and unrecoverable member-resolution failures.

## Handoff
Phase 147c applies equivalent skip-and-advance reliability normalization to SMS blocked-phone paths.
