# Phase 90e — Fix Response Attribution + Interest Upsert Semantics

## Focus
Align stored CRM row behavior with the agreed definitions:
- CRM rows are created/updated on **positive inbound interest**
- "AI vs Human Response" reflects **our outbound response after interest**, not outbound before interest.

## Inputs
- `lib/lead-crm-row.ts:14-93` — `upsertLeadCrmRowOnInterest` function
- Inbound post-process entrypoints:
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/background-jobs/*-inbound-post-process.ts`

## Work
### 1) Update `upsertLeadCrmRowOnInterest` semantics

**Current behavior (BUG):**
Lines 31-39 query for `lastOutbound` where `sentAt <= params.messageSentAt` (BEFORE interest).
Lines 51-56 derive `responseMode` from this pre-interest outbound.
Lines 70-72 and 83-85 persist this wrong attribution.

**New behavior:**
- **REMOVE** the `lastOutbound` query entirely (lines 31-39)
- **REMOVE** `responseMode` derivation (lines 51-56)
- **Set to null** in create/update:
  ```ts
  responseMode: null,           // Computed at query time (Phase 90c)
  responseMessageId: null,      // Computed at query time (Phase 90c)
  responseSentByUserId: null,   // Computed at query time (Phase 90c)
  ```
- **Keep** `interestRegisteredAt` stable (line 58 already handles this correctly)
- **Keep** all other interest snapshot fields (type/channel/campaign/score)

**Simplified upsert logic:**
```ts
export async function upsertLeadCrmRowOnInterest(params: LeadCrmRowInterestParams) {
  if (!isPositiveSentiment(params.sentimentTag)) {
    return { skipped: "not_positive" as const };
  }

  const [lead, existing] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: params.leadId },
      select: {
        fitScore: true,
        intentScore: true,
        overallScore: true,
        emailCampaign: { select: { name: true } },
        smsCampaign: { select: { name: true } },
        campaign: { select: { name: true } },
      },
    }),
    prisma.leadCrmRow.findUnique({
      where: { leadId: params.leadId },
      select: { interestRegisteredAt: true },
    }),
  ]);

  if (!lead) {
    return { skipped: "lead_not_found" as const };
  }

  const interestRegisteredAt = existing?.interestRegisteredAt ?? params.messageSentAt;
  const campaignName = lead.emailCampaign?.name ?? lead.smsCampaign?.name ?? lead.campaign?.name ?? null;

  await prisma.leadCrmRow.upsert({
    where: { leadId: params.leadId },
    create: {
      leadId: params.leadId,
      interestRegisteredAt: params.messageSentAt,
      interestType: params.sentimentTag,
      interestMessageId: params.messageId,
      interestChannel: params.channel,
      interestCampaignName: campaignName,
      // Response attribution is computed at query time (Phase 90c)
      responseMode: null,
      responseMessageId: null,
      responseSentByUserId: null,
      leadScoreAtInterest: lead.overallScore ?? null,
      leadFitScoreAtInterest: lead.fitScore ?? null,
      leadIntentScoreAtInterest: lead.intentScore ?? null,
    },
    update: {
      interestRegisteredAt,  // Keep stable after first set
      interestType: params.sentimentTag,
      interestMessageId: params.messageId,
      interestChannel: params.channel,
      interestCampaignName: campaignName,
      // Response attribution is computed at query time (Phase 90c)
      responseMode: null,
      responseMessageId: null,
      responseSentByUserId: null,
      leadScoreAtInterest: lead.overallScore ?? null,
      leadFitScoreAtInterest: lead.fitScore ?? null,
      leadIntentScoreAtInterest: lead.intentScore ?? null,
    },
  });

  return { updated: true as const };
}
```

### 2) Verify inbound post-process calls remain best-effort
Check these files to ensure `upsertLeadCrmRowOnInterest` is wrapped in try/catch:
- `lib/inbound-post-process/pipeline.ts`
- `lib/background-jobs/email-inbound-post-process.ts`
- `lib/background-jobs/sms-inbound-post-process.ts`
- `lib/background-jobs/linkedin-inbound-post-process.ts`

If not already wrapped, add try/catch to prevent CRM upsert failures from blocking the pipeline.

### 3) Backfill consideration (optional, deferred)
Existing LeadCrmRow records have responseMode set from pre-interest outbound.
Options:
- **Option A (recommended):** Let Phase 90c query-time computation override stored values
- **Option B:** Add a migration script to null out responseMode/responseMessageId/responseSentByUserId

Choose Option A for now; if performance issues arise, consider Option B.

## Validation (RED TEAM)
- [ ] `upsertLeadCrmRowOnInterest` no longer queries for pre-interest outbound
- [ ] New CRM rows have `responseMode = null`
- [ ] `getCrmSheetRows` (Phase 90c) correctly computes post-interest response attribution
- [ ] Inbound post-process pipelines don't fail if CRM upsert throws
- [ ] `npm run build` passes

## Output
- `upsertLeadCrmRowOnInterest` no longer writes pre-interest response attribution
- Response completion and AI/Human response in the CRM table reflect post-interest outbound behavior (query-time)

## Coordination Notes
**Inbound post-process calls already wrapped in try/catch**, no changes required.

## Validation Notes
- Manual validation not run in this environment.

## Handoff
Proceed to Phase 90f to add tests, run quality gates, and document a QA runbook (including importer execution).
