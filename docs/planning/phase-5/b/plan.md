# Phase 5b — Implement Server-Side Global Lead Search (Limit 50)

## Focus
Make search query the full dataset (by lead name/email) while keeping the list capped at 50 results for performance.

## Inputs
- Current inbox/lead list UI showing only first 50 leads.
- Current search implementation (likely client-side filtering of already-loaded leads).
- Prisma model for leads and any existing query helpers.

## Work
1. Locate the lead list query and current search logic.
2. Implement server-side search:
   - Accept a query string (via URL params or an API route/server action).
   - Query `Lead` with appropriate `contains` filters (case-insensitive where supported).
   - Return only 50 results, ordered sensibly (recent activity first).
3. Wire the UI search bar to the server-side search result set with debouncing.
4. Keep the “default view” behavior unchanged when the search query is empty.

## Output
- Searching by lead name/email returns correct matches across all leads.
- UI still renders a maximum of 50 results per query.

## Handoff
After search is complete, address inbound email sender attribution (Phase 5c).

