# Phase 137b — UX Architecture & Discoverability Refinement Spec

Date: 2026-02-11
Input: `docs/planning/phase-137/a/baseline-audit-dossier.md`

## Goal
Reduce operator cognitive load and navigation friction across high-frequency dashboard flows while preserving existing behavior and permissions.

## Core UX Problems to Solve
1. Settings view is too dense for fast task completion.
2. Inbox/Action Station requires too much contextual parsing before taking action.
3. CRM drawer mixes many actions/states with weak prioritization hierarchy.
4. Analytics/Insights readability is uneven (high information density, inconsistent visual emphasis).

## Information Architecture Changes

### 1) Settings IA (Highest Priority)
Current issue: many heterogeneous controls in one large shell (`components/dashboard/settings-view.tsx`).

Refinement model:
- Keep top-level tabs, but standardize each tab into repeatable sections:
  - `Status` (health + required setup state)
  - `Core Actions` (primary controls)
  - `Advanced` (optional/rare controls)
  - `History / Debug` (audit and diagnostics)
- Move heavy dialogs/history editors behind explicit “Open Advanced Editor” triggers.
- Collapse low-frequency controls by default.

### 2) Inbox + Action Station
Current issue: high-action density with competing controls.

Refinement model:
- Explicit action ladder in Action Station:
  - Primary: send/approve
  - Secondary: draft transform/insertions
  - Tertiary: diagnostics and advanced utilities
- Keep response context visible with minimal scanning:
  - inbound signal summary
  - selected channel context
  - approval state

### 3) CRM / Lead Drawer
Current issue: mixed operational + administrative actions in same visual layer.

Refinement model:
- Separate “lead state controls” from “advanced maintenance actions”.
- Promote top 3 most common actions into persistent top action row.
- Move destructive operations into secondary action group with stronger confirmation language.

### 4) Analytics / Insights
Current issue: strong data volume, weak priority cues.

Refinement model:
- Enforce fixed reading order:
  - KPI overview -> distribution breakdown -> drill-down table.
- Cap simultaneous visual accents to prevent chart competition.
- Improve labeling of filters/time windows near chart titles.

## Discoverability Standards
- Every section must expose:
  - what this control changes
  - where it applies (workspace/campaign/lead/global)
  - what happens next after save
- All advanced actions must include plain-language guard copy.
- Empty states must include next-step CTA, not just “no data”.
- Error states must include recovery action and ownership hint (“contact admin” vs “retry now”).

## Microcopy Standards
- Replace ambiguous verbs (“Apply”, “Update”) with explicit outcomes (“Save Workspace Schedule”, “Reconnect LinkedIn”).
- Avoid internal jargon where possible; when unavoidable, add short helper text.
- Ensure consistency for “workspace”, “campaign”, “lead”, and “sequence” terms.

## Priority Implementation Slices

### Slice B1 — Settings Shell Simplification
- Targets:
  - `components/dashboard/settings-view.tsx`
- Changes:
  - Introduce section framing pattern (`Status`, `Core Actions`, `Advanced`, `History/Debug`)
  - Collapse low-frequency blocks by default
  - Standardize heading/action spacing and affordance
- Acceptance:
  - First meaningful action for each tab reachable within one viewport on desktop

### Slice B2 — Action Station Hierarchy
- Targets:
  - `components/dashboard/action-station.tsx`
- Changes:
  - Primary/secondary/tertiary action grouping
  - Reduce button competition in compose region
- Acceptance:
  - Primary send/approve action identifiable in <2 seconds

### Slice B3 — CRM Drawer Task Layering
- Targets:
  - `components/dashboard/crm-drawer.tsx`
- Changes:
  - Group high-frequency lead status actions separate from advanced controls
  - Improve destructive action placement and wording
- Acceptance:
  - Lead status update path requires fewer context switches

### Slice B4 — Analytics/Insights Readability Pass
- Targets:
  - `components/dashboard/analytics-view.tsx`
  - `components/dashboard/analytics-crm-table.tsx`
  - `components/dashboard/insights-view.tsx`
  - `components/dashboard/insights-chat-sheet.tsx`
- Changes:
  - Reading order normalization and filter/label clarity
  - Visual accent simplification
- Acceptance:
  - Primary KPI and selected filter context are always visible without scrolling on desktop

## Explicit Skill Routing for 137b
- Primary:
  - `impeccable-clarify`
  - `impeccable-simplify`
  - `impeccable-normalize`
  - `impeccable-adapt`
- Verification:
  - `impeccable-critique`
  - `impeccable-rams` (for focus/keyboard/semantic checks after structural changes)

## Non-Goals (for 137b)
- No schema, API contract, or permission model changes.
- No deep render optimization work (reserved for 137c).
- No visual flourish/motion additions beyond readability-driven adjustments.
