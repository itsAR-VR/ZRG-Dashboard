# Phase 72 — Review

## Summary

- **Shipped:** Complete CC'd recipient handling infrastructure across schema, utilities, webhooks, AI drafts, email send, follow-ups, and UI
- **Quality gates pass:** `npm run lint` (warnings only), `npm run build` (success)
- **Remaining:** `npm run db:push` (requires DB credentials), manual smoke tests for CC replier flows + promotion

## What Shipped

### Schema (Phase 72a)
- `prisma/schema.prisma`: Added Lead fields `alternateEmails`, `currentReplierEmail`, `currentReplierName`, `currentReplierSince`
- Added GIN index on `alternateEmails` for array membership queries

### Utilities (Phase 72b)
- `lib/email-participants.ts`: Extended with `normalizeOptionalEmail`, `emailsMatch`, `detectCcReplier`, `extractFirstName`, `addToAlternateEmails`
- `lib/__tests__/email-participants.test.ts`: Unit tests for new helpers

### Webhook Ingestion (Phase 72c)
- `app/api/webhooks/smartlead/route.ts`: CC replier detection + Lead update
- `app/api/webhooks/instantly/route.ts`: CC replier detection + Lead update
- `app/api/webhooks/email/route.ts`: CC replier detection + Lead update

### AI Drafts (Phase 72d)
- `lib/ai-drafts.ts`: Replier context passed to draft generation, greeting uses replier name when applicable

### Email Send (Phase 72e)
- `lib/email-send.ts`: Smart TO/CC resolution via `resolveOutboundRecipients()` — TO = replier, CC = original lead when CC person replied

### Follow-Ups (Phase 72f)
- Verified follow-ups route through `sendEmailReply(draft.id)` and inherit Phase 72 recipient swap logic — no code changes needed

### Contact Promotion (Phase 72g)
- `actions/lead-actions.ts`: Added `promoteAlternateContactToPrimary` (admin-only) + `requestPromoteAlternateContactToPrimary` (setter request via Slack)
- `components/dashboard/crm-drawer.tsx`: Current replier badge + alternate contacts list + Make/Request Primary buttons
- `components/dashboard/inbox-view.tsx`: Extended lead payloads with `alternateEmails` + `currentReplier*` fields + viewer role

### Lead Matching (Phase 72h)
- `lib/lead-matching.ts`: Added `alternateEmails` array membership matching + `matchedBy: "alternateEmail"` tracking + logging

## Verification

### Commands
- `npm run lint` — **pass** (18 warnings, 0 errors) — Jan 30, 2026
- `npm run build` — **pass** — Jan 30, 2026
- `npm run db:push` — **skip** (requires DB credentials; schema ready for push)

### Notes
- Lint warnings are pre-existing (React hooks, img elements) — not introduced by Phase 72
- Build compiled successfully in ~20s with no TypeScript errors

## Success Criteria → Evidence

| Criterion | Evidence | Status |
|-----------|----------|--------|
| When CC person replies, `Lead.currentReplierEmail` is populated | `app/api/webhooks/*/route.ts` — CC replier detection logic updates Lead | ✅ Met |
| AI drafts greet the replier's name when they replied | `lib/ai-drafts.ts` — replier context + greeting resolution | ✅ Met |
| Outbound replies go TO the CC person with original lead in CC | `lib/email-send.ts:resolveOutboundRecipients()` — swaps TO/CC | ✅ Met |
| Follow-up emails go TO the current replier with original lead in CC | Follow-ups use `sendEmailReply()` → inherits swap logic | ✅ Met |
| UI shows alternate emails and allows promotion to primary | `components/dashboard/crm-drawer.tsx` — badge + list + buttons | ✅ Met |
| After promotion, provider webhooks still match the same lead | `lib/lead-matching.ts` — `alternateEmails` membership check | ✅ Met |
| `npm run lint` and `npm run build` pass | Commands executed successfully | ✅ Met |
| Existing email flows (original lead replies) work unchanged | Behavior gates on `isCcReplier` — original lead path unchanged | ✅ Met |

## Plan Adherence

| Planned | Implemented | Impact |
|---------|-------------|--------|
| Create new `lib/email-participants.ts` | Extended existing file (Phase 50) | Better — avoided file proliferation |
| Follow-up engine needs CC override | No changes needed — inherits from email-send | Simpler — less code |
| Subphase h (lead matching hardening) | Added as planned | Prevents thread splits after promotion |

## Risks / Rollback

| Risk | Mitigation |
|------|------------|
| Schema migration issues | Fields are nullable with defaults — safe additive change |
| CC replier detection false positives | Only triggers when `fromEmail !== lead.email` after normalization |
| Promotion breaks thread association | Lead matching includes `alternateEmails` check |

## Follow-ups

1. **Run `npm run db:push`** — Apply schema changes to database
2. **Manual smoke tests:**
   - SmartLead/Instantly/EmailBison: CC person replies → verify Lead updates
   - Generate AI draft for CC replier → verify greeting
   - Send reply → verify TO/CC are correct
   - Trigger follow-up → verify CC includes replier
   - Promote alternate contact → verify webhooks still match same lead
3. **Monitor production** — Log `[Lead Matching] Matched via alternateEmails` for visibility

## Multi-Agent Coordination

| Phase | Overlap | Resolution |
|-------|---------|------------|
| Phase 70 | `prisma/schema.prisma`, `actions/lead-actions.ts`, `lib/email-send.ts` | Re-read files before modifying; Phase 72 changes layered on Phase 70's AIDraft fields |
| Phase 71 | `actions/lead-actions.ts`, `lib/followup-engine.ts` | Verified no conflicts; Phase 71 focused on workflow naming, Phase 72 on recipients |

All concurrent phase changes are compatible and build passes with combined state.
