# Phase 92a — Design System: Extract Semantic Color Tokens

## Focus
Extract hard-coded Tailwind color values into semantic CSS custom properties, establishing a design system foundation that enables consistent theming and easier maintenance. This subphase must complete before other 92 subphases can reference the new tokens.

## Inputs
- Audit findings from conversation: 47 issues identified, 6 related to `/normalize` skill
- Existing token system in `app/globals.css` using OKLCH color space
- Hard-coded colors in:
  - `conversation-card.tsx:35-85` (sentiment badges)
  - `lead-score-badge.tsx:47-69` (score colors)
  - `follow-ups-view.tsx:77-84` (channel type colors)
  - `crm-drawer.tsx:1098` (LinkedIn brand color)

## Work

### Step 1: Invoke Skill
```
/impeccable:normalize
```
Follow skill guidance for extracting design tokens.

### Step 2: Add Semantic Tokens to globals.css

Add after the existing chart colors (~line 48) in `:root`:

```css
/* Sentiment tokens */
--sentiment-meeting-requested: oklch(0.6 0.15 160);
--sentiment-meeting-requested-bg: oklch(0.6 0.15 160 / 0.1);
--sentiment-call-requested: oklch(0.55 0.15 270);
--sentiment-call-requested-bg: oklch(0.55 0.15 270 / 0.1);
--sentiment-interested: oklch(0.6 0.15 145);
--sentiment-interested-bg: oklch(0.6 0.15 145 / 0.1);
--sentiment-not-interested: var(--muted-foreground);
--sentiment-not-interested-bg: var(--muted);
--sentiment-out-of-office: oklch(0.7 0.15 85);
--sentiment-out-of-office-bg: oklch(0.7 0.15 85 / 0.1);
--sentiment-automated-reply: oklch(0.55 0.05 260);
--sentiment-automated-reply-bg: oklch(0.55 0.05 260 / 0.1);
--sentiment-follow-up: oklch(0.6 0.15 240);
--sentiment-follow-up-bg: oklch(0.6 0.15 240 / 0.1);
--sentiment-information-requested: oklch(0.65 0.15 200);
--sentiment-information-requested-bg: oklch(0.65 0.15 200 / 0.1);
--sentiment-blacklist: var(--destructive);
--sentiment-blacklist-bg: oklch(var(--destructive) / 0.1);
--sentiment-neutral: oklch(0.5 0.02 260);
--sentiment-neutral-bg: oklch(0.5 0.02 260 / 0.1);
--sentiment-new: var(--primary);
--sentiment-new-bg: oklch(var(--primary) / 0.1);
--sentiment-positive: oklch(0.6 0.15 145);
--sentiment-positive-bg: oklch(0.6 0.15 145 / 0.1);

/* Lead score tokens */
--score-1: oklch(0.6 0.2 25);
--score-1-bg: oklch(0.6 0.2 25 / 0.1);
--score-2: oklch(0.7 0.15 85);
--score-2-bg: oklch(0.7 0.15 85 / 0.1);
--score-3: oklch(0.6 0.15 145);
--score-3-bg: oklch(0.6 0.15 145 / 0.1);
--score-4: oklch(0.65 0.17 160);
--score-4-bg: oklch(0.65 0.17 160 / 0.1);

/* Channel type tokens */
--channel-email: oklch(0.6 0.15 240);
--channel-sms: oklch(0.6 0.15 300);
--channel-linkedin: oklch(0.5 0.15 240);
--channel-call: oklch(0.6 0.15 145);
--channel-meeting-canceled: oklch(0.6 0.2 25);
--channel-meeting-rescheduled: oklch(0.7 0.17 50);

/* Brand tokens (integration logos) */
--brand-slack: oklch(0.6 0.15 340);
--brand-gohighlevel: oklch(0.55 0.2 145);
--brand-emailbison: oklch(0.6 0.15 200);
--brand-smartlead: oklch(0.55 0.18 270);
--brand-instantly: oklch(0.7 0.15 50);
--brand-linkedin: oklch(0.45 0.15 240);
--brand-unipile: oklch(0.55 0.15 270);
--brand-calendly: oklch(0.5 0.2 240);
```

Also add corresponding dark mode overrides in `.dark` selector.

### Step 3: Update conversation-card.tsx

Replace the `classificationStyles` object to use CSS variables:

```typescript
const classificationStyles: Record<string, { label: string; className: string }> = {
  "meeting-requested": {
    label: "Meeting Requested",
    className: "bg-[--sentiment-meeting-requested-bg] text-[--sentiment-meeting-requested] border-[--sentiment-meeting-requested]/20"
  },
  // ... repeat for all sentiments
}
```

### Step 4: Update lead-score-badge.tsx

Replace `getScoreColorClasses()` function to use CSS variables:

```typescript
function getScoreColorClasses(score: number | null | undefined): string {
  switch (score) {
    case 1: return "bg-[--score-1-bg] text-[--score-1]";
    case 2: return "bg-[--score-2-bg] text-[--score-2]";
    case 3: return "bg-[--score-3-bg] text-[--score-3]";
    case 4: return "bg-[--score-4-bg] text-[--score-4] font-semibold";
    default: return "bg-muted text-muted-foreground";
  }
}
```

### Step 5: Update follow-ups-view.tsx

Replace `typeColors` object:

```typescript
const typeColors: Record<FollowUpTaskType, string> = {
  email: "text-[--channel-email]",
  call: "text-[--channel-call]",
  linkedin: "text-[--channel-linkedin]",
  sms: "text-[--channel-sms]",
  "meeting-canceled": "text-[--channel-meeting-canceled]",
  "meeting-rescheduled": "text-[--channel-meeting-rescheduled]",
}
```

### Step 6: Update crm-drawer.tsx

Replace hard-coded LinkedIn color:

```tsx
// Before
<Linkedin className="h-4 w-4 text-[#0A66C2]" />

// After
<Linkedin className="h-4 w-4 text-[--brand-linkedin]" />
```

### Step 7: Verify

1. `npm run lint` — no new errors
2. `npm run build` — succeeds
3. Visual check: Open dashboard, verify colors look correct in light/dark mode
4. Inspect DevTools: Confirm CSS variables are applied

## Output
- `app/globals.css` with 40+ new semantic color tokens
- `conversation-card.tsx` using `--sentiment-*` tokens
- `lead-score-badge.tsx` using `--score-*` tokens
- `follow-ups-view.tsx` using `--channel-*` tokens
- `crm-drawer.tsx` using `--brand-*` tokens

**Execution Output (2026-02-02)**
- Added sentiment/score/channel/brand tokens with `color-mix` bg/border helpers in `app/globals.css`.
- Updated `conversation-card.tsx`, `lead-score-badge.tsx`, `follow-ups-view.tsx`, `crm-drawer.tsx` to use token-driven colors with `bg-[color:var(--...)]` syntax.

**Validation**
- Not run in this subphase: `npm run lint`, `npm run build` (defer to phase end).

## Handoff
Phase 92b, 92c, 92d can now reference the semantic tokens when adding new UI elements. The brand tokens (`--brand-*`) are ready for integration logo styling in 92c.

Proceed to Phase 92b (Settings General Tab) and begin section headers + accordion refactor, with Settings tabs extracted into subcomponents per Phase 92 decisions.
