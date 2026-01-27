# Phase 60e — RED TEAM Hardening (Repo Reality + Drift-Proof Content)

## Focus
Patch plan/implementation details that could cause drift or mismatches (template names, existing Booking Notices UI, and UI primitives). This subphase exists to make Phase 60 resilient and accurate without touching booking logic.

## Inputs
- Root plan: `docs/planning/phase-60/plan.md`
- Source-of-truth booking processes + caveats: `docs/planning/phase-52/plan.md`
- Template names/descriptions: `lib/booking-process-templates.ts` (`BOOKING_PROCESS_TEMPLATES`)
- Settings Booking tab layout: `components/dashboard/settings-view.tsx`
- UI primitives already present: `components/ui/accordion.tsx`, `components/ui/card.tsx`, `components/ui/badge.tsx`

## Work

### 1) Reconcile with existing UI (“Booking Notices”)
- Confirm `components/dashboard/settings-view.tsx` already includes a “Booking Notices” card (and that it calls out Process 5 manual-review).
- Ensure the new reference panel **complements** this content:
  - Avoid duplicating the same Process 5 warning copy verbatim.
  - Keep the reference panel focused on “what each process is / when it triggers / what happens”.

### 2) Drift-proof template mapping (avoid hardcoded names)
- Treat `BOOKING_PROCESS_TEMPLATES.slice(0, 5)` as the source-of-truth for template names.
- In the reference panel content, ensure each process’s displayed “Template” label matches exactly:
  - `Link + Qualification (No Times)`
  - `Initial Email Times (EmailBison availability_slot)`
  - `Lead Proposes Times (Auto-Book When Clear)`
  - `Call Requested (Create Call Task)`
  - `Lead Provided Calendar Link (Escalate or Schedule)`

### 3) Content accuracy tightening (Phase 52/55 behaviors)
- Process 2: note dependency on EmailBison first-touch offered times (`availability_slot`) and `Lead.offeredSlots` being present (Phase 55); do not imply it works for SMS/LinkedIn.
- Process 3: describe the **conservative fallback**: unclear/ambiguous acceptance should create a follow-up task (not auto-book).
- Process 4: be explicit that “notify” is contingent on Notification Center rule configuration; call task creation is the primary guaranteed behavior.
- Process 5: explicitly state manual-review (no third-party scheduler auto-booking shipped yet).

### 4) Integration correctness (avoid churn in Settings imports)
- Use the same import style as `components/dashboard/settings-view.tsx` (`./settings/...`) when wiring in the new component.

### 5) Avoid unnecessary CLI changes
- Do **not** run `npx shadcn@latest add accordion`; the repo already has `components/ui/accordion.tsx` and Settings already uses it.

## Output
- A tightened execution checklist that prevents template-name drift, avoids redundant UI messaging, and aligns integration with repo conventions.

## Handoff
Proceed with Phase 60 implementation using this subphase’s “source-of-truth” constraints (especially template-name mapping and prerequisite caveats).
