# Phase 106i — Implementation: Primary Website Asset + Prompt Injection

## Focus
Add a dedicated “Primary Website URL” field (stored as a Knowledge Asset) and inject it into AI prompts so responses can include our website **only when relevant/asked**.

## Inputs
- Settings UI: `components/dashboard/settings-view.tsx`
- Knowledge asset actions: `actions/settings-actions.ts`
- Knowledge context builder: `lib/knowledge-asset-context.ts`
- Draft generation: `lib/ai-drafts.ts`

## Work
1. Add a **Primary Website URL** input in Settings → AI Personality / Knowledge Assets.
2. Store/update the URL as a Knowledge Asset named `Primary: Website URL` (type `text`).
3. Add helper to extract and normalize the URL from Knowledge Assets.
4. Inject the URL into draft prompts with explicit “only when relevant” instructions.
5. Add unit tests for URL extraction/normalization.

## Output
- Primary website URL can be set and is available to AI prompts.

## Handoff
Proceed to Meeting Overseer persistence (Phase 106j).
