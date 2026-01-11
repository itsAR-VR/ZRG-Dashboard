# Phase 16 — ChatGPT Export Settings (Filterable + Saved Defaults + Modal UI)

## Purpose
Make the “Download dataset for ChatGPT” export **customizable** (filters + time window + included files) and **saveable** (workspace defaults), while keeping the primary download button as a one-click download.

## Context
The current export downloads a full workspace dataset (`leads.csv` + `messages.jsonl`) which is often too large for quick analysis. Operators need smaller, targeted exports (e.g. only positive replies in a date range), and want “default export settings” that persist per workspace so the main download button uses them automatically.

## Objectives
* [x] Define export filter schema (what can be filtered and how)
* [x] Persist export defaults per workspace (server-side)
* [x] Update export endpoint to honor filters + produce smaller zips
* [x] Add a modal UI (settings icon) next to the download button to customize + save defaults + download
* [x] Ensure Analytics download button uses saved defaults by default

## Constraints
- Export contains PII (emails + message bodies); must remain **authenticated and workspace-scoped**.
- Avoid adding new dependencies unless necessary; reuse existing shadcn components.
- Filters must be represented in both:
  - the modal UI state (editable)
  - URL/query params to the export endpoint (for the actual download)
- Saved defaults should not break existing “download everything” behavior; allow “All time / All leads” presets.

## Success Criteria
- [x] Clicking “Download dataset for ChatGPT” downloads using the saved defaults for that workspace.
- [x] Clicking the adjacent settings icon opens a modal where the user can:
  - toggle “positive replies only”
  - choose a time range (preset or custom from/to)
  - choose what to include (leads.csv, messages.jsonl) and message filters
  - save as workspace defaults
  - download immediately using the current settings (without saving)
- [x] Export zip reflects filters (smaller dataset) and still includes required columns (`sentBy`, campaign IDs/names, booking fields).

## Subphase Index
* a — Export filter spec + persistence model
* b — Backend: save/load defaults + filtered export endpoint
* c — Frontend: modal UI + settings icon + download wiring
* d — QA + polish

## Phase Summary
- Shared export options + helpers: `lib/chatgpt-export.ts` (normalize/serialize, date range computation, URL builder, summary string).
- Persisted defaults per workspace: `prisma/schema.prisma` adds `WorkspaceSettings.chatgptExportDefaults`; actions in `actions/chatgpt-export-actions.ts`.
- Filtered export zip: `app/api/export/chatgpt/route.ts` honors `opts` query param and falls back to saved defaults when omitted.
- Analytics UI: `components/dashboard/chatgpt-export-controls.tsx` adds settings-modal + “Download now”; `components/dashboard/analytics-view.tsx` uses it in the header.
