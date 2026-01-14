# Phase 18b — Persistence Model (Memory), Permissions, Retention, Audit

## Focus
Implement the database “memory system” so chat sessions are shared per workspace, versioned by context pack scope, and manageable by admins (soft delete + restore + audit).

## Inputs
- Phase 18a tool/data contracts (window/campaign scope; context pack status)
- Existing workspace roles + access patterns

## Work
- Add Prisma models for:
  - Chat sessions (workspace-scoped)
  - Chat messages (author attribution; assistant/system messages supported)
  - Context packs (keyed by session + scopeKey; status/progress; stored synthesis + metrics snapshot)
  - Lead-level cached thread summaries (Conversation Insights)
  - User preferences (default window preset + custom range + campaign cap) stored in DB (cross-device)
  - Audit events (append-only) for delete/restore/recompute actions
- Enforce permissions:
  - View + run insights: any workspace member with access (align with existing access helpers)
  - Delete/restore/recompute/delete packs: admin only

## Output
- Added Prisma “memory system” models + enums in `prisma/schema.prisma`:
  - Enums: `InsightsWindowPreset`, `InsightChatRole`, `InsightContextPackStatus`, `ConversationInsightOutcome`, `InsightChatAuditAction`
  - Models: `InsightChatSession`, `InsightChatMessage`, `InsightContextPack`, `LeadConversationInsight`, `InsightChatUserPreference`, `InsightChatAuditEvent`
  - Relations:
    - `Client` → sessions/packs/prefs/audit events
    - `Lead` → `conversationInsight`
    - session/packs → `auditEvents`
  - Workspace AI Personality settings fields:
    - `WorkspaceSettings.insightsChatModel` (default `gpt-5-mini`)
    - `WorkspaceSettings.insightsChatReasoningEffort` (default `medium`)
    - action toggles: `insightsChatEnableCampaignChanges`, `insightsChatEnableExperimentWrites`, `insightsChatEnableFollowupPauses` (default `false`)
- Applied schema to DB via `npm run db:push` (required when editing `prisma/schema.prisma`).
- Enforced permissions in `actions/insights-chat-actions.ts`:
  - workspace access via `requireClientAccess`
  - admin-only soft delete/restore + pack recompute/delete via `requireClientAdminAccess`
  - audit events recorded to `InsightChatAuditEvent` for admin actions and message creation

## Handoff
Phase 18c uses the persisted pack + lead-level caches to run context-efficient LLM calls (extract → synthesize) and to reuse those artifacts across follow-up questions without re-sending raw threads.

