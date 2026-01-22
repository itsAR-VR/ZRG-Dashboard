# Phase 50e — UI: Add EmailRecipientEditor to action-station.tsx

## Focus

Add an editable recipient section above the compose textarea when the email channel is active, showing To (read-only) and CC (editable) recipients.

## Inputs

- Helpers from subphase c (`formatEmailParticipant`, `validateEmail`, `deduplicateEmails`)
- Current `action-station.tsx` compose area (lines 645-838)
- Conversation data includes lead email and message CC arrays

## Work

### 1. Add CC State Management

```typescript
// Near other state declarations (~line 62)
const [ccRecipients, setCcRecipients] = useState<string[]>([]);
const [ccInput, setCcInput] = useState("");
```

### 2. Initialize CC from Latest Inbound Email

```typescript
// In useEffect for conversation changes
useEffect(() => {
  if (activeChannel === "email" && conversation?.messages) {
    const latestInbound = conversation.messages
      .filter(m => m.direction === "inbound" && m.channel === "email")
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    if (latestInbound?.cc) {
      setCcRecipients(latestInbound.cc);
    } else {
      setCcRecipients([]);
    }
  }
}, [conversation?.id, activeChannel]);
```

### 3. Create EmailRecipientEditor Component

```typescript
import { X, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { validateEmail, formatEmailParticipant } from "@/lib/email-participants"

interface EmailRecipientEditorProps {
  toEmail: string;
  toName?: string | null;
  ccList: string[];
  onCcChange: (cc: string[]) => void;
  ccInput: string;
  onCcInputChange: (value: string) => void;
  disabled?: boolean;
}

function EmailRecipientEditor({
  toEmail,
  toName,
  ccList,
  onCcChange,
  ccInput,
  onCcInputChange,
  disabled = false,
}: EmailRecipientEditorProps) {
  const handleAddCc = () => {
    const trimmed = ccInput.trim();
    if (trimmed && validateEmail(trimmed) && !ccList.includes(trimmed.toLowerCase())) {
      onCcChange([...ccList, trimmed]);
      onCcInputChange("");
    }
  };

  const handleRemoveCc = (email: string) => {
    onCcChange(ccList.filter(e => e.toLowerCase() !== email.toLowerCase()));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddCc();
    }
  };

  return (
    <div className="text-xs border rounded-md p-3 mb-3 bg-muted/30 space-y-2">
      {/* To field (read-only) */}
      <div className="flex items-center gap-2">
        <span className="font-medium text-muted-foreground w-8">To:</span>
        <Badge variant="secondary" className="font-normal">
          {formatEmailParticipant(toEmail, toName)}
        </Badge>
      </div>

      {/* CC field (editable) */}
      <div className="flex items-start gap-2">
        <span className="font-medium text-muted-foreground w-8 pt-1">CC:</span>
        <div className="flex-1 flex flex-wrap gap-1.5 items-center">
          {ccList.map((email) => (
            <Badge
              key={email}
              variant="outline"
              className="font-normal pr-1 gap-1"
            >
              {email}
              {!disabled && (
                <button
                  onClick={() => handleRemoveCc(email)}
                  className="hover:bg-destructive/20 rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
          {!disabled && (
            <div className="flex items-center gap-1">
              <Input
                type="email"
                placeholder="Add CC..."
                value={ccInput}
                onChange={(e) => onCcInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-6 w-32 text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleAddCc}
                disabled={!ccInput.trim() || !validateEmail(ccInput)}
                className="h-6 w-6 p-0"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
```

### 4. Integrate into Compose Area

Insert before the compose textarea (around line 717):

```typescript
{/* Email Recipient Editor - shown when email channel is active */}
{isEmail && conversation?.lead?.email && (
  <EmailRecipientEditor
    toEmail={conversation.lead.email}
    toName={conversation.lead.name}
    ccList={ccRecipients}
    onCcChange={setCcRecipients}
    ccInput={ccInput}
    onCcInputChange={setCcInput}
    disabled={isSending}
  />
)}
```

### 6. Pass CC to Send Actions

Update send handlers to pass `ccRecipients`:
```typescript
const handleSendMessage = async () => {
  // ... existing logic ...
  if (isEmail) {
    await sendEmailMessage(conversation.id, composeMessage, { cc: ccRecipients });
  }
  // ...
};

const handleApproveAndSend = async () => {
  // ... existing logic ...
  if (drafts.length > 0 && isEmail) {
    await approveAndSendDraft(drafts[0].id, composeMessage, { cc: ccRecipients });
  }
  // ...
};
```

## Output

- Added `EmailRecipientEditor` component to `action-station.tsx`
- Added CC state management (`ccRecipients`, `ccInput`)
- CC initialized from latest inbound email on conversation/channel change
- Users can view To (read-only) and edit CC (add/remove)
- Updated `handleSendMessage` to pass `{ cc: ccRecipients }` for email sends
- Updated `handleApproveAndSend` to pass `{ cc: ccRecipients }` for email draft approvals

## Handoff

Subphase f will update the email send actions to accept and use the custom CC list.
