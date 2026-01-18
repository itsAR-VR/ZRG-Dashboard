# Phase 32a — Schema Update: Add sentByUserId to Message

## Focus

Add a `sentByUserId` field to the Message model to enable per-setter response time attribution. This field will be populated when a setter sends a message through the UI.

## Inputs

- Current `prisma/schema.prisma` with Message model
- Current `sentBy` field only tracks 'ai' | 'setter' (string literal, not user ID)
- `ClientMember` model exists with userId field

## Work

1. **Add field to Message model** (`prisma/schema.prisma`):
   ```prisma
   model Message {
     // ... existing fields ...
     sentByUserId String?  // Supabase Auth user ID of setter who sent this message
     // ... rest of model ...
   }
   ```

2. **Add index for efficient per-setter queries**:
   ```prisma
   @@index([sentByUserId])
   ```

3. **Run migration**:
   ```bash
   npm run db:push
   ```

4. **Update outbound message creation points** to populate `sentByUserId`:
   - `actions/message-actions.ts` - `sendMessage` action (setter sends from inbox)
   - Any other places where outbound messages are created by setters

5. **Verify AI-sent messages remain null** for sentByUserId (auto-replies should not have a setter attributed)

## Output

**Schema changes:**
- Added `sentByUserId String?` to Message model in `prisma/schema.prisma` (line 536)
- Added `@@index([sentByUserId])` for efficient per-setter queries (line 551)
- Database schema successfully pushed via `npm run db:push`

**Type updates:**
- Updated `SystemSendMeta` type in `lib/system-sender.ts` to include `sentByUserId?: string | null`
- Updated opts type in `actions/email-actions.ts` for `sendEmailReply` and `sendEmailReplyForLead`
- Updated meta type in `actions/message-actions.ts` for `sendLinkedInMessage`
- Updated opts type in `actions/message-actions.ts` for `approveAndSendDraftSystem`

**Message creation points updated:**
- `lib/system-sender.ts:sendSmsSystem` - Passes `sentByUserId` to Message create
- `actions/email-actions.ts:sendEmailReply` - Passes `sentByUserId` to Message create
- `actions/email-actions.ts:sendEmailReplyForLead` - Passes `sentByUserId` to Message create
- `actions/message-actions.ts:sendMessage` - Gets user ID from `requireAuthUser()` and passes to `sendSmsSystem`
- `actions/message-actions.ts:sendEmailMessage` - Gets user ID and passes to `sendEmailReplyForLead`
- `actions/message-actions.ts:sendLinkedInMessage` - Passes `sentByUserId` from meta to Message create
- `actions/message-actions.ts:approveAndSendDraft` - Gets user ID and passes to downstream functions
- `actions/message-actions.ts:approveAndSendDraftSystem` - Passes `sentByUserId` to SMS, Email, and LinkedIn send functions

**AI/System messages:**
- `sentByUserId` remains `null` for AI-sent messages (auto-replies via `approveAndSendDraftSystem` with `sentBy: "ai"`)
- `sentByUserId` remains `null` for system-triggered messages (webhooks, cron jobs)

**Validation:**
- `npm run lint` passes (0 errors)
- `npm run build` succeeds

## Handoff

Subphase b will use the `sentByUserId` field to filter and group response time calculations by setter. The field is now populated for all UI-initiated setter sends across SMS, Email, and LinkedIn channels.
