# Phase 21c — UI Recovery: Retry Ingestion + Status Messaging

## Focus
Make it obvious when a website Knowledge Asset is pending ingestion and provide a one-click “Retry/Refresh” action to process existing assets.

## Inputs
- Existing Settings UI rendering for Knowledge Assets
- New retry server action from Phase 21b

## Work
- Add a “Retry/Refresh scrape” control for URL assets that lack extracted text.
- Show clear, compact status messaging for URL assets (e.g., “Pending extraction”).
- Ensure the UI list shows assets even when ingestion fails (revalidation and local state updates).

## Output
- Users can recover previously-entered URLs without needing to delete/re-add them.

## Handoff
Proceed to Phase 21d for validation and docs updates.

