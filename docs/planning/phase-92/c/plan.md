# Phase 92c — Settings Integrations Tab: Logos + Slack Section Cleanup

## Focus
Add visual integration logos for immediate recognition and reorganize the Slack section using accordion patterns. This subphase addresses the "wall of text" problem in the Integrations tab where all platforms look identical.

## Inputs
- Phase 92a completed (brand tokens: `--brand-slack`, `--brand-gohighlevel`, etc.)
- Phase 92b patterns (section headers, accordions)
- Audit findings:
  - I2: No integration logos (text-only labels)
  - I3: Slack section cramped (bot token + channels + recipients in one card)
  - I4: Inconsistent secret masking
  - I5: EmailBison host management inline

## Work

### Step 1: Invoke Skills
```
/impeccable:polish
/impeccable:simplify
```
Follow skill guidance for visual hierarchy and progressive disclosure.

### Step 2: Create Integration Logo Components

Create a shared component for integration branding. Options:

**Option A: SVG Icons (recommended)**
Create `components/ui/integration-icons.tsx`:

```tsx
export function SlackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-5 w-5", className)} fill="currentColor">
      {/* Slack SVG path */}
    </svg>
  )
}

export function GoHighLevelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-5 w-5", className)} fill="currentColor">
      {/* GHL SVG path - use simple "GHL" text or their icon */}
    </svg>
  )
}

// ... EmailBison, SmartLead, Instantly, LinkedIn, Unipile, Calendly
```

**Option B: Lucide + Color (simpler)**
Use existing Lucide icons with brand colors from tokens:

```tsx
<Mail className="h-5 w-5 text-[--brand-emailbison]" />
<MessageSquare className="h-5 w-5 text-[--brand-gohighlevel]" />
<Linkedin className="h-5 w-5 text-[--brand-linkedin]" />
```

### Step 3: Add Logos to Integration Cards

Update card headers in `settings-view.tsx` Integrations tab:

```tsx
{/* Slack Card Header */}
<CardHeader>
  <CardTitle className="flex items-center gap-3">
    <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[--brand-slack]/10">
      <SlackIcon className="h-5 w-5 text-[--brand-slack]" />
    </div>
    <span>Slack Notifications</span>
  </CardTitle>
  <CardDescription>
    Configure Slack bot for approval requests and notifications
  </CardDescription>
</CardHeader>
```

Apply similar pattern to:
- GoHighLevel integration rows in IntegrationsManager
- EmailBison/SmartLead/Instantly provider sections
- Resend card
- Any other integration sections

### Step 4: Refactor Slack Section with Accordion

Replace cramped Slack card with accordion subsections:

```tsx
<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-3">
      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[--brand-slack]/10">
        <SlackIcon className="h-5 w-5 text-[--brand-slack]" />
      </div>
      <span>Slack Notifications</span>
    </CardTitle>
  </CardHeader>
  <CardContent>
    <Accordion type="multiple" defaultValue={["bot-config"]}>
      <AccordionItem value="bot-config">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            <span>Bot Configuration</span>
            {hasSlackBotToken && (
              <Badge variant="secondary" className="ml-2">Connected</Badge>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent>
          {/* Bot token input + status */}
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="channels">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4" />
            <span>Notification Channels</span>
            <Badge variant="outline" className="ml-2">
              {selectedChannels.length} selected
            </Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          {/* Channel selector + selected list */}
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="recipients">
        <AccordionTrigger>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>Approval Recipients</span>
            <Badge variant="outline" className="ml-2">
              {selectedRecipients.length} members
            </Badge>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          {/* Recipient selector + refresh button */}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </CardContent>
</Card>
```

### Step 5: Standardize Secret Input Pattern

Create a reusable secret input with eye toggle:

```tsx
function SecretInput({
  value,
  onChange,
  placeholder,
  ...props
}: InputProps) {
  const [showSecret, setShowSecret] = useState(false)

  return (
    <div className="relative">
      <Input
        type={showSecret ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="pr-10"
        {...props}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
        onClick={() => setShowSecret(!showSecret)}
        aria-label={showSecret ? "Hide secret" : "Show secret"}
      >
        {showSecret ? (
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Eye className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  )
}
```

Apply to: Slack bot token, Resend API key, GHL private key, etc.

### Step 6: Move EmailBison Host Management to Modal

Replace inline add/delete with a "Manage Hosts" button → Dialog:

```tsx
<Dialog open={hostDialogOpen} onOpenChange={setHostDialogOpen}>
  <DialogTrigger asChild>
    <Button variant="outline" size="sm">
      <Settings2 className="h-4 w-4 mr-2" />
      Manage Hosts
    </Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>EmailBison Base Hosts</DialogTitle>
      <DialogDescription>
        Configure custom base hosts for EmailBison API connections
      </DialogDescription>
    </DialogHeader>
    {/* Host list + add form */}
  </DialogContent>
</Dialog>
```

### Step 7: Update IntegrationsManager Workspace Cards

Add logos to each workspace row in the table:

```tsx
<TableCell>
  <div className="flex items-center gap-3">
    {client.hasGhlLocationId && (
      <div className="flex items-center justify-center h-6 w-6 rounded bg-[--brand-gohighlevel]/10">
        <MessageSquare className="h-3.5 w-3.5 text-[--brand-gohighlevel]" />
      </div>
    )}
    {client.emailProvider === "EMAILBISON" && (
      <div className="flex items-center justify-center h-6 w-6 rounded bg-[--brand-emailbison]/10">
        <Mail className="h-3.5 w-3.5 text-[--brand-emailbison]" />
      </div>
    )}
    {/* Similar for SmartLead, Instantly, LinkedIn */}
  </div>
</TableCell>
```

### Step 8: Verify

1. `npm run lint` — no new errors
2. `npm run build` — succeeds
3. Visual check: Integration logos visible and recognizable
4. Slack accordion: Bot config, channels, recipients expand/collapse
5. Secret inputs: Eye toggle works consistently
6. Dark mode: Logos and colors work in dark theme

## Output
- `components/ui/integration-icons.tsx` (new file) — SVG integration logos
- `settings-view.tsx` Integrations tab refactored with:
  - Logo containers on all integration cards
  - Slack section using accordion pattern
  - Standardized secret input with eye toggle
  - EmailBison host management in modal
- `integrations-manager.tsx` workspace rows with integration status logos

**Execution Output (2026-02-02)**
- Implemented Lucide + brand-token styling for integration headers (Slack/Resend/EmailBison) in `components/dashboard/settings-view.tsx`.
- Refactored Slack settings into accordion sections (Bot Configuration, Notification Channels, Approval Recipients).
- Added reusable `SecretInput` (`components/ui/secret-input.tsx`) and applied to Slack/Resend plus all secret fields in `components/dashboard/settings/integrations-manager.tsx`.
- Moved EmailBison base host selection into a dialog with a “Manage hosts” launcher.
- Updated workspace row badges in `components/dashboard/settings/integrations-manager.tsx` to use brand tokens for SMS/Email/LinkedIn/Calendly status.
- Note: no SVG icon file created (Lucide + brand colors per decision).

**Validation**
- Not run in this subphase: `npm run lint`, `npm run build` (defer to phase end).

## Handoff
Phase 92d can apply similar logo + accordion patterns to AI and Booking tabs. The SecretInput component is available for reuse in any tab with API keys.

Proceed to Phase 92d (AI/Booking tabs). Keep Settings tab extraction queued for Phase 92f.
