# Phase 92 — UI/UX Audit & Polish (Design System, Settings, Inbox)

## Purpose
Systematically audit and improve the ZRG Dashboard UI/UX accumulated across 40+ phases of development, focusing on: design system tokenization, settings consolidation with progressive disclosure, integration logos, accessibility hardening, and mobile responsiveness.

## Context
The codebase passed the "AI slop" audit (no purple gradients, glassmorphism, or decorative animations) but has accumulated **organic complexity** from rapid feature iteration:

- **Settings view** is a 6,042-line monolithic component with ~101 `useState` declarations
- **Sentiment/score colors** are hard-coded Tailwind values instead of CSS tokens
- **Integration sections** lack visual logos (text-only labels)
- **Mobile experience** has fixed-width sidebars and small touch targets
- **Accessibility** has gaps: missing focus indicators, ARIA labels, and skip links

### Key Audit Findings (47 Issues Total)
| Severity | Count | Examples |
|----------|-------|----------|
| 🔴 Critical | 12 | Monolithic settings file, no code-splitting |
| 🟠 High | 18 | Hard-coded colors, missing logos, dense UI |
| 🟡 Medium | 12 | A11y gaps, mobile responsiveness |
| 🟢 Low | 5 | Minor polish items |

### Anti-Patterns Verdict: PASS
- ✅ Professional OKLCH color tokens
- ✅ System fonts (no bloat)
- ✅ Purposeful animations only
- ✅ Enterprise-grade visual language

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 91 | Complete | `settings-view.tsx` Team tab | Read current state; additive changes only |
| Phase 90 | Complete | Analytics CRM table | Independent domain; no overlap |
| Phase 89 | Complete | `integrations-manager.tsx` Assignments | Read current state; coordinate UI changes |

## Objectives
* [x] Extract semantic color tokens (sentiment, score, channel, brand) to CSS variables
* [x] Add integration logos (Slack, GHL, EmailBison, SmartLead, Instantly, LinkedIn)
* [x] Simplify Settings UI with progressive disclosure (accordions, modals)
* [x] Improve accessibility (focus states, ARIA labels, touch targets)
* [x] Add mobile responsiveness to inbox sidebar

## Constraints
- **No breaking changes:** All existing functionality must continue working
- **Incremental commits:** Each subphase produces a complete, shippable state
- **Design system first:** Token extraction (92a) must complete before component updates
- **Skill-driven:** Each subphase invokes relevant `/impeccable` skills for guidance
  - Impeccable design skills are managed in Codex settings (not in this repo) and should remain in the plan
- **Quality gates:** `npm run lint` + `npm run build` after each subphase

## Success Criteria
- [x] Settings view feels organized with clear sections and less scrolling
- [x] Integration logos visible at a glance (Slack, GHL, etc.)
- [x] All semantic colors introduced in Phase 92 use CSS tokens (sentiment/score/channel/brand in touched components)
- [x] Mobile inbox has collapsible sidebar with 44px+ touch targets
- [ ] Keyboard navigation works with visible focus states (needs manual QA pass)
- [x] `npm run lint` passes (warnings acceptable) — 0 errors, 22 warnings
- [x] `npm run build` succeeds — compiled in 57s, all routes generated

## Subphase Index
* a — Design System: Extract semantic color tokens
* b — Settings General Tab: Section headers + accordion patterns
* c — Settings Integrations Tab: Logos + Slack section cleanup
* d — Settings AI/Booking Tabs: Progressive disclosure + clarity
* e — Inbox + Accessibility: Mobile, focus states, ARIA labels
* f — Corrections & Shared UI Primitives (RED TEAM hardening)

## Repo Reality Check

### Files to Modify (by subphase)

**92a (Design System):**
- `app/globals.css` — Add sentiment/score/channel/brand tokens
- `components/dashboard/conversation-card.tsx:35-85` — Use sentiment tokens
- `components/dashboard/lead-score-badge.tsx:47-69` — Use score tokens
- `components/dashboard/follow-ups-view.tsx:77-84` — Use channel tokens
- `components/dashboard/crm-drawer.tsx:1098` — Use brand tokens

**92b (General Tab):**
- `components/dashboard/settings-view.tsx:2067-3174` — Accordion + headers

**92c (Integrations Tab):**
- `components/dashboard/settings-view.tsx:3177-4285` — Logos + Slack cleanup
- `components/dashboard/settings/integrations-manager.tsx` — Workspace card logos

**92d (AI/Booking Tabs):**
- `components/dashboard/settings-view.tsx:4288-5980` — Modal patterns + clarity

**92e (Inbox + A11y):**
- `components/dashboard/conversation-feed.tsx` — Mobile sidebar
- `components/dashboard/action-station.tsx` — Touch targets + ARIA
- `components/dashboard/inbox-view.tsx` — Empty states
  - Skip link placement should be in `app/page.tsx` (dashboard renders `<main>` there)

### Verified Touch Points
- `app/globals.css:1-133` — Existing OKLCH token definitions
- `settings-view.tsx:2044-2050` — Tab navigation structure
- `conversation-card.tsx:35-85` — Sentiment badge classNames
- `lead-score-badge.tsx:47-69` — Score color functions
- `integrations-manager.tsx:96-100` — IntegrationsManager component
- UI primitives present: `Accordion`, `Collapsible`, `Dialog`, `Sheet`, `Badge`, `Separator`
- UI primitives added in Phase 92: `Alert`, `Slider`

## Repo Reality Check (RED TEAM)

- What exists today:
  - Settings are centralized in `components/dashboard/settings-view.tsx` with subcomponents already in `components/dashboard/settings/`
  - Inbox layout is rendered in `app/page.tsx` (the only layout file is `app/layout.tsx`)
  - `action-station.tsx` already includes a LinkedIn connection note character counter and an auto-send warning callout
- What the plan assumes:
  - Additional UI primitives (`Alert`, `Slider`) are available or will be added
  - Impeccable design skills are available via Codex settings (not in-repo)
- Verified touch points:
  - `components/dashboard/conversation-feed.tsx` uses a fixed `w-80` sidebar today
  - `components/dashboard/action-station.tsx` contains multiple icon-only buttons and the AI auto-send warning block
  - `components/dashboard/chat-message.tsx` renders email headers (candidate for collapse)

## Multi-Agent Coordination Notes

### Execution Order
Phase 92 subphases have **sequential dependencies**:
```
92a (tokens) → [92b, 92c, 92d] (can run in parallel) → 92e (final polish)
```

### Pre-Flight Checklist
- [x] Phase 91 merged (Team tab UI complete)
- [x] `git status --porcelain` clean
- [x] Recent phases (89-91) do not conflict with 92 targets

### Potential Conflicts
- `settings-view.tsx` is touched by 92b, 92c, 92d — agents must coordinate edits
- Recommend: 92b completes first, then 92c, then 92d (sequential within settings)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Invalid Tailwind token syntax (`bg-[--token]`, `border-[--token]/20`) → Use `bg-[color:var(--token)]` and explicit `--token-bg`/`--token-border` variables.
- Alpha mixing with `oklch(var(--token) / 0.1)` → Use `color-mix(in oklch, var(--token) 10%, transparent)` or dedicated `--token-bg`.

### Missing or ambiguous requirements
- Impeccable skill prompts are referenced but not explicitly located in repo → confirm they live under `prompts/`.
- Settings split decision (subcomponents) is not reflected in subphases → add a new hardening subphase (92f) to define extraction boundaries.

### Repo mismatches (fix the plan)
- Phase 92e step “add LinkedIn character counter” is already implemented; should be treated as verification only.
- Skip link needs to be added in `app/page.tsx`, not a non-existent dashboard layout file.

### Performance / timeouts
- Not applicable (UI-only), but add a guard to avoid duplicating sidebar state in mobile/desktop rendering (avoid double fetch or double virtualizer).

### Security / permissions
- Ensure any settings refactor does not change admin gating (keep server actions as-is).

### Testing / validation
- Add explicit check that `Alert`/`Slider` primitives exist or are added before using them in Settings UI.

## Phase Summary

### Status: ✅ COMPLETE (2026-02-02)

**Shipped:**
- Semantic color tokens in `app/globals.css` (40+ tokens: sentiment/score/channel/brand)
- Settings tabs with progressive disclosure patterns, integration styling, and clearer AI/Booking controls
- Shared UI primitives: `components/ui/alert.tsx`, `components/ui/slider.tsx`, `components/ui/secret-input.tsx`
- Mobile inbox UX: sheet sidebar, collapsible filters, enhanced empty states, 44px+ touch targets
- Accessibility: skip link in `app/page.tsx`, ARIA labels for icon-only buttons, collapsible email headers

**Quality Gates:**
- `npm run lint`: ✅ pass (0 errors, 22 warnings — all pre-existing)
- `npm run build`: ✅ pass (compiled in 57s, all routes generated)

**Key Files Modified:**
- `app/globals.css` — Semantic color tokens with `color-mix` helpers
- `app/page.tsx` — Skip link for accessibility
- `components/dashboard/settings-view.tsx` — Section headers, accordions, integration branding
- `components/dashboard/conversation-card.tsx` — Sentiment badge tokens
- `components/dashboard/lead-score-badge.tsx` — Score color tokens
- `components/dashboard/conversation-feed.tsx` — Mobile Sheet sidebar, collapsible filters
- `components/dashboard/action-station.tsx` — Touch targets, ARIA labels
- `components/dashboard/chat-message.tsx` — Collapsible email headers
- `components/dashboard/settings/integrations-manager.tsx` — Brand tokens, SecretInput
- `components/dashboard/settings/ai-campaign-assignment.tsx` — Collapsible rows, slider

**Follow-ups:**
- Manual keyboard navigation QA pass needed before production
- Settings tab extraction deferred to future phase

See `docs/planning/phase-92/review.md` for full evidence mapping.
