# Phase 110 — Monday Reconciliation Matrix (Working Doc)

Board: “AI Bugs + Feature Requests” (`18395010806`)

This file is the **single source of truth** for the Phase 110 audit. Every Monday item should appear exactly once, with one bucket classification and evidence.

Buckets (pick one):
- Fixed (Shipped)
- Fixed (Verified)
- Open (Not Fixed)
- Out of Scope (Other System/Repo)
- Needs Repro / Missing Info

> Note: do not paste PII (lead names/emails/phone numbers). Evidence should be phase refs, file paths, and Jam links.

| itemId | title | tool/system | type | priority | boardStatus | bucket | evidence (phase/code) | verification-needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 11196938130 | AI not drafting responses | Master Inbox | Bug | 🔴 Critical | (unset) | Fixed (Shipped) | Phase 109 shipped fix for missing drafts after manual sentiment becomes draft-eligible + compose UI refetch on sentiment. Touchpoints: `actions/crm-actions.ts` (`updateLeadSentimentTag`), `lib/manual-draft-generation.ts`, `components/dashboard/action-station.tsx`. If issue is a different path (cron/webhook/gating), needs new repro. | Yes |
| 11177972285 | 6 follow up emails sent | Master Inbox | Bug | — | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/1bdce0a8-ce7e-4a4b-9837-34321eaef8c1` | No |
| 11174440376 | Website link not generated | Master Inbox | Bug | — | (unset) | Fixed (Shipped) | Phase 106 shipped website asset extraction + prompt injection. | Yes |
| 11113733932 | Workflows automatic paused | Master Inbox | Bug | 🔴 Critical | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/82f4216e-0e62-470f-9978-53d9853edd30` | No |
| 11117718920 | Someone else replied to our email (not original receiver) | Master Inbox | Bug | 🟠 High | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/c8700102-9423-4464-af62-3165a8d16fd5` | No |
| 11137256668 | Vercel not recognizing calendar links embedded in signatures | Master Inbox | Bug | 🟡 Medium | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/c094f375-4eb0-4d55-af87-893facb67c91` | No |
| 11123230228 | Hyperlinks shared by leads not working | Master Inbox | Bug | 🟡 Medium | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/ae89a090-f6db-46f3-87c2-488532e42108` | No |
| 11132081497 | Proposed time no longer available; show specific timezone | Master Inbox | Bug | 🟢 Low | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/4e7c2035-2d19-4f56-8d1f-3d537f58948c` | No |
| 11119891261 | AI suggesting times the same day | Master Inbox | Bug | 🟢 Low | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/cd165111-59f8-4020-a0e0-92a5cd208d32` | No |
| 11133778270 | Vercel not CC’ing sender; manual inputs not accepted | Master Inbox | Feature Request | — | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/c10bc563-cb21-422c-8209-b6fd1f9ec9eb` | No |
| 10970951274 | AI suggests current-week slots when lead says next week | Master Inbox | Bug | — | Done | Fixed (Verified) | Board Status Done | No |
| 11130366573 | New workflows haven’t been activated | Master Inbox | Bug | — | Done | Fixed (Verified) | Board Status Done | No |
| 11133376940 | AI suggests slots when lead provides their own calendar link | Master Inbox | Bug | — | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/1787b6d4-3aa7-4f61-b372-dbdee3e34203` | No |
| 11142663930 | Hard reset workflows; ensure everyone is on meeting requested | Unspecified | — | — | Done | Fixed (Verified) | Board Status Done | No |
| 11140167745 | Bug on AI responses review | Master Inbox | Bug | 🔴 Critical | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/21a61d78-9b63-4a8d-9d54-a4020ff7f682` | No |
| 11164010014 | Missing AI responses | Master Inbox | Bug | 🔴 Critical | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/678ee571-e8e8-458b-a9af-c815a1e37dfc` | No |
| 11175058428 | Booking doesn’t stop workflows/sequences | Master Inbox | Bug | 🟠 High | Done | Fixed (Verified) | Board Status Done; Jam: `https://jam.dev/c/aaf7e47d-a3d9-4053-b578-a27e8cafc26c` | No |
| 11183404766 | Blank slot + “more info” after yes | Master Inbox | Bug | 🟡 Medium | (unset) | Fixed (Shipped) | Phase 106 shipped blank-slot guard + post-yes behavior; Jam: `https://jam.dev/c/780becbd-0a32-4817-93ab-30ee41d45a58` | Yes |
| 11185162432 | Asking questions post booking | Master Inbox | Bug | 🟠 High | (unset) | Fixed (Shipped) | Phase 106 shipped post-booking overseer behavior; Jam: `https://jam.dev/c/7885b3fa-b274-4ea3-9bc3-3f82fdb6d13e` | Yes |
| 11188016134 | Bad response for meeting request | Master Inbox | Bug | 🟠 High | (unset) | Fixed (Shipped) | Phase 106 shipped meeting-request strategy; Jam: `https://jam.dev/c/479a2962-1f36-47b6-915d-b620395e0671` | Yes |
| 11195846714 | Reactivation campaigns not sending SMS (+ LinkedIn?) | Master Inbox | Bug | 🟠 High | (unset) | Fixed (Shipped) | Phase 106r shipped reactivation follow-up prerequisite evaluation + send-path behavior that prevents silent failure (marks enrollment `needs_review` with clear reasons). Touchpoints: `lib/reactivation-sequence-prereqs.ts`, `lib/reactivation-engine.ts`, `lib/__tests__/reactivation-sequence-prereqs.test.ts`. Jam: `https://jam.dev/c/47562dd5-3cb7-4839-9fe3-12a3f1a83e91`. If prereqs are satisfied and SMS still not sending, needs new repro. | Yes |
| 11127290781 | Round robin changed from Jon to Emar | Master Inbox | Feature Request | 🔴 Critical | Done | Fixed (Verified) | Board Status Done | No |
| 11127247655 | CRM integration w/ automated lead updates | Master Inbox | Feature Request | 🟠 High | Done | Fixed (Verified) | Board Status Done | No |
| 11127267338 | Calling System | Master Inbox | Feature Request | 🟠 High | (unset) | Open (Not Fixed) | Phase 106 snapshot only; no implementation evidence in this repo. | Yes (spec) |
| 11127271384 | Mobile App | Master Inbox | Feature Request | 🟠 High | (unset) | Open (Not Fixed) | Phase 106 snapshot only; likely separate repo/product work. | Yes (scope/spec) |
| 11041785461 | Add spintax on sequences | Master Inbox | Feature Request | 🟡 Medium | Done | Fixed (Verified) | Board Status Done | No |
| 11054456881 | Show timezone instead of “(your time)” | Master Inbox | Feature Request | 🟡 Medium | Done | Fixed (Verified) | Board Status Done | No |
| 11127267869 | Client logins | Master Inbox | Feature Request | 🟡 Medium | Done | Fixed (Verified) | Board Status Done | No |
| 11133221013 | Weekly calendar check for enough slots | Master Inbox | Feature Request | 🟡 Medium | Done | Fixed (Verified) | Board Status Done | No |
| 11049445047 | Command AI to adjust draft (tone/edit) instead of full regen | Master Inbox | Feature Request | Minimal | (unset) | Open (Not Fixed) | Phase 106 snapshot only; no implementation evidence in this repo. | Yes (spec) |
| 11075133751 | All Replies filter w/ date ranges + email status | Master Inbox | Feature Request | Minimal | (unset) | Open (Not Fixed) | Phase 106 snapshot only; no implementation evidence in this repo. | Yes (spec) |
| 11127264464 | Workflow Performance | Master Inbox | Feature Request | — | Done | Fixed (Verified) | Board Status Done | No |
| 11127267231 | Reactivation Performance | Master Inbox | Feature Request | — | Done | Fixed (Verified) | Board Status Done | No |
| 11127299140 | Rename “insights” → “campaign strategist” | Master Inbox | Feature Request | — | Done | Fixed (Verified) | Board Status Done | No |
| 11137804370 | Google Sheet recreation for CRM view | Master Inbox | Feature Request | — | Done | Fixed (Verified) | Board Status Done | No |
| 11144264316 | Slack notif has approval/edit buttons to Vercel | Master Inbox | Feature Request | — | Done | Fixed (Verified) | Board Status Done | No |
| 11155102345 | Sales Call AI | Master Inbox | Feature Request | — | (unset) | Open (Not Fixed) | Phase 106 snapshot only; no implementation evidence in this repo. | Yes (scope/spec) |
| 11155120538 | AI growth strategist + auto-optimizations | Master Inbox | Feature Request | — | (unset) | Open (Not Fixed) | Phase 106 snapshot only; no implementation evidence in this repo. | Yes (spec) |
| 11156639467 | Refresh availability on drafts button | Unspecified | — | 🟠 High | Done | Fixed (Verified) | Board Status Done | No |
| 11157618838 | Create setter accounts from dashboard UI | Unspecified | — | — | Done | Fixed (Verified) | Board Status Done | No |
| 11157946059 | Admins change default sequences across client workspaces | Unspecified | — | 🟡 Medium | (unset) | Open (Not Fixed) | Phase 106 snapshot only; no implementation evidence yet. | Yes (spec) |
| 11161793269 | Slack notif: add regenerate button for AI responses | Unspecified | — | — | Done | Fixed (Verified) | Board Status Done | No |
| 11161795603 | Auto-activate workflows for chris/aaron by booking process | Unspecified | — | — | Done | Fixed (Verified) | Board Status Done | No |
| 11177342525 | Edited vs auto-sent vs approved | Unspecified | — | — | (unset) | Fixed (Shipped) | Phase 101 shipped edited vs auto-sent vs approved analytics (`responseDisposition`). | Yes (UX/prod verify) |
| 11177512976 | Preview lead email in Slack | Master Inbox | Feature Request | — | (unset) | Open (Not Fixed) | Phase 106 snapshot only; no implementation evidence in this repo. | Yes (spec) |
| 11177594620 | AI Responses improvement | Master Inbox | Feature Request | 🔴 Critical | (unset) | Open (Not Fixed) | Spec doc exists on item; no implementation evidence found in this repo yet. | Yes (split into tasks) |
