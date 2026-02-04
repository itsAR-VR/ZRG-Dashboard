# Phase 104b — Settings UI Control

## Focus
Add an admin-gated dropdown to Settings → AI Personality so admins can select the Step 3 verifier model.

## Inputs
- `components/dashboard/settings-view.tsx`
- `actions/settings-actions.ts`

## Work
- Add local state for `emailDraftVerificationModel`.
- Load initial state from `getUserSettings`.
- Include in admin save payload.
- Add a card UI section near Email Draft Generation:
  - Model selector options: `gpt-5.2` (recommended), `gpt-5.1`, `gpt-5-mini`
  - Note that the verifier runs deterministic (`temperature: 0`) and uses lowest compatible reasoning effort.

## Validation
- Manual smoke: change value, Save, reload workspace → value persists.

## Output
Added Settings → AI Personality control:
- New card: **Email Draft Verification (Step 3)**
- Admin-gated model dropdown (`gpt-5.2`, `gpt-5.1`, `gpt-5-mini`)
- Save/load wired through existing settings fetch/save flow.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added UI state, load, and save wiring for `emailDraftVerificationModel`.
- Commands run:
  - (Covered in Phase 104d) `npm run build` / `npm run lint` verified.
- Blockers:
  - None
- Next concrete steps:
  - Wire Step 3 runtime to use the workspace setting; update tests.

## Handoff
Proceed to Phase 104c to wire runtime usage + adjust tests.
