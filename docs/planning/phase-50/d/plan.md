# Phase 50d — UI: Add EmailParticipantHeader to chat-message.tsx

## Focus

Add a participant header component to display From/To/CC information on email messages in the conversation view.

## Inputs

- Schema from subphase a (Message has fromEmail/fromName/toEmail/toName/cc)
- Helpers from subphase c (`formatEmailParticipant`, optional `formatCcList`)
- UI message shape updated in subphase c (`lib/mock-data.ts` + `actions/lead-actions.ts`)
- Current `chat-message.tsx` structure (lines 1-107)

## Work

### 1. Update ChatMessage Props

Add optional props for email participant data:
```typescript
interface ChatMessageProps {
  message: Message;
  leadName?: string;
  leadEmail?: string;  // NEW
  userName?: string;
  userAvatar?: string | null;
}
```

### 2. Create EmailParticipantHeader Sub-Component

```typescript
import { formatEmailParticipant } from "@/lib/email-participants"

interface EmailParticipantHeaderProps {
  message: Message;
  leadName?: string;
  leadEmail?: string;
  isInbound: boolean;
}

function EmailParticipantHeader({
  message,
  leadName,
  leadEmail,
  isInbound
}: EmailParticipantHeaderProps) {
  // Only show for email channel
  if (message.channel !== "email") return null;

  // Determine From/To based on direction
  const from = isInbound
    ? formatEmailParticipant(message.fromEmail || leadEmail || "Unknown", message.fromName || leadName)
    : formatEmailParticipant(message.fromEmail || "You", message.fromName);

  const to = isInbound
    ? formatEmailParticipant(message.toEmail || "You", message.toName)
    : formatEmailParticipant(message.toEmail || leadEmail || "Unknown", message.toName || leadName);

  const ccList = message.cc || [];
  const bccList = message.bcc || [];

  return (
    <div className="text-xs text-muted-foreground space-y-0.5 mb-2 pb-2 border-b border-border/50">
      <div>
        <span className="font-medium text-foreground/70">From:</span>{" "}
        <span>{from}</span>
      </div>
      <div>
        <span className="font-medium text-foreground/70">To:</span>{" "}
        <span>{to}</span>
      </div>
      {ccList.length > 0 && (
        <div>
          <span className="font-medium text-foreground/70">CC:</span>{" "}
          <span>{ccList.join(", ")}</span>
        </div>
      )}
      {/* BCC is view-only; show whenever present (inbound or outbound) */}
      {bccList.length > 0 && (
        <div>
          <span className="font-medium text-foreground/70">BCC:</span>{" "}
          <span>{bccList.join(", ")}</span>
        </div>
      )}
    </div>
  );
}
```

### 3. Integrate into ChatMessage Component

Insert `<EmailParticipantHeader />` inside the message bubble, before the subject line:

```typescript
<div className={cn("rounded-lg px-4 py-2.5 space-y-1", config.bubbleClass)}>
  {/* NEW: Email participant header */}
  <EmailParticipantHeader
    message={message}
    leadName={leadName}
    leadEmail={leadEmail}
    isInbound={isLead}
  />

  {/* Existing: Subject line */}
  {isEmail && message.subject && (
    <p className="text-xs font-semibold text-foreground">Subject: {message.subject}</p>
  )}

  {/* Existing: Message content */}
  ...
</div>
```

### 4. Update Parent Component (action-station.tsx)

Pass `leadEmail` to ChatMessage:
```typescript
<ChatMessage
  message={msg}
  leadName={conversation.lead.name}
  leadEmail={conversation.lead.email}  // NEW
  userName={user?.fullName || "You"}
  userAvatar={user?.avatarUrl}
/>
```

## Output

- Added `EmailParticipantHeader` sub-component to `chat-message.tsx`
- Added `leadEmail` prop to `ChatMessageProps`
- Header displays From/To/CC/BCC for email messages inside the bubble
- Styled as muted text with border separator
- Updated `action-station.tsx` to pass `leadEmail` to ChatMessage

## Handoff

Subphase e will add the editable recipient section to the compose area in action-station.tsx.
