# Phase 75 — Always Show Explicit Timezone in AI-Proposed Availability Slots

## Purpose

Change AI-generated availability time slots from "(your time)" format to explicit timezone format (e.g., "EST", "PST") so recipients know exactly what timezone is being referenced.

## Context

### User Request

From [Jam c/4e7c2035-2d19-4f56-8d1f-3d537f58948c](https://jam.dev/c/4e7c2035-2d19-4f56-8d1f-3d537f58948c):

> AI generated proposed time is no longer available. Instead of (Your Time) can it show specific timezone? And that will be the lead's time zone that we are pulling in based on the custom variables that they are using.

### Problem Statement

AI-generated draft emails and follow-ups show availability times with "(your time)" instead of the lead's explicit timezone:

```
Current:  "2:00 PM (your time) on Feb 7"
Desired:  "2:00 PM EST on Feb 7"
```

The "(your time)" format is less actionable because leads don't know which timezone is being referenced.

### Technical Discovery

**Current Logic:**

```typescript
// lib/ai-drafts.ts:1221, lib/followup-engine.ts:494, lib/followup-engine.ts:2512
const mode = tzResult.source === "workspace_fallback" ? "explicit_tz" : "your_time";
```

Current behavior:
- If timezone is **workspace fallback** → show explicit timezone ("EST")
- If timezone is **inferred from lead** → show "(your time)"

This is backwards. When we confidently know the lead's timezone (from `companyState` custom variable or other inference), we should show it explicitly.

**Timezone Inference Sources (`lib/timezone-inference.ts`):**

1. **Existing** — Lead has `Lead.timezone` stored
2. **Deterministic** — Inferred from UK signals (`.co.uk`, `+44`) or US state mapping (`companyState` → IANA)
3. **AI** — OpenAI inference from lead signals
4. **Workspace Fallback** — `WorkspaceSettings.timezone` or "UTC"

**Formatting (`lib/availability-format.ts`):**

```typescript
if (opts.mode === "your_time") {
  return { label: `${timePart} (your time) on ${dayPart}` };
}
const tzName = getShortTimeZoneName(date, opts.timeZone); // e.g., "EST", "PST"
return { label: `${timePart} ${tzName} on ${dayPart}` };
```

The `explicit_tz` mode already correctly displays short timezone names.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 73 | Complete | `lib/followup-engine.ts` (template validation) | Independent — different code paths |
| Phase 74 | Complete | `action-station.tsx`, `lib/email-send.ts` | No overlap |

## Pre-Flight Conflict Check (Multi-Agent)

- [x] Run `git status --porcelain` and confirm state of:
  - `lib/ai-drafts.ts` (clean)
  - `lib/followup-engine.ts` (clean)
  - `lib/availability-format.ts` (clean)

## Objectives

* [x] Update `lib/ai-drafts.ts` to always use `explicit_tz` mode for availability formatting
* [x] Update `lib/followup-engine.ts` (2 locations) to always use `explicit_tz` mode
* [x] Verify with `npm run lint && npm run build`

## Constraints

- Keep changes minimal — only change the mode selection logic
- Do not remove the `"your_time"` mode from `AvailabilityLabelMode` type (optional cleanup for later)
- Ensure timezone display uses short format (EST, PST, CST) not IANA names

## Success Criteria

- [x] AI drafts show explicit timezone (e.g., "2:00 PM EST on Wed, Feb 5") instead of "(your time)"
- [x] Follow-up availability also shows explicit timezone
- [x] `npm run lint` passes
- [x] `npm run build` passes

## Key Files

| File | Line(s) | Change |
|------|---------|--------|
| `lib/ai-drafts.ts` | 1221 | Change `mode` to always be `"explicit_tz"` |
| `lib/followup-engine.ts` | 494, 2512 | Same change — always use `"explicit_tz"` |
| `lib/availability-format.ts` | — | No changes needed (already handles `explicit_tz` correctly) |

## Subphase Index

* a — Update availability mode to always use explicit timezone
* b — Verification and testing

## Phase Summary

**Completed 2026-01-31**

### What Changed

Changed availability slot formatting from conditional `"your_time"` / `"explicit_tz"` mode to always use `"explicit_tz"`.

**Before:**
```
"2:00 PM (your time) on Wed, Feb 5"
```

**After:**
```
"2:00 PM EST on Wed, Feb 5"
```

### Files Modified

| File | Line | Change |
|------|------|--------|
| `lib/ai-drafts.ts` | 1221 | `const mode = "explicit_tz";` |
| `lib/followup-engine.ts` | 494 | `const mode = "explicit_tz";` |
| `lib/followup-engine.ts` | 2512 | `const mode = "explicit_tz";` |

### Verification

- `npm run lint` — pass (0 errors, 18 warnings) — 2026-01-31 17:21 EST
- `npm run build` — pass (warnings: baseline-browser-mapping outdated, multiple lockfiles root selection, middleware deprecation) — 2026-01-31 17:21 EST
