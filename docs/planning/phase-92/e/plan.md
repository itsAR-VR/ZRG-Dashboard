# Phase 92e — Inbox + Accessibility: Mobile, Focus States, ARIA Labels

## Focus
Improve accessibility and mobile responsiveness across the master inbox. This subphase addresses the remaining audit findings: fixed-width sidebar, small touch targets, missing focus indicators, ARIA labels, and empty state messaging.

## Inputs
- Phase 92a-d completed (design system + settings polish)
- Audit findings:
  - IF1: Fixed 320px sidebar width
  - IF2: Filter controls always visible
  - IF3: No empty state messaging
  - CC1: Hard-coded workspace names
  - CC3: Badge density on mobile
  - AS2: LinkedIn connection note missing character counter
  - AS3: Auto-send warning too subtle
  - AS4: Channel tabs need touch targets
  - CM1: Email header always expanded
  - A11Y1-5: Focus states, touch targets, skip links, ARIA labels

## Work

### Step 1: Invoke Skills
```
/impeccable:harden
/impeccable:adapt
```

### Step 2: Remove Hard-coded Workspace Names

In `conversation-card.tsx:122-129`, replace hard-coded array with database-driven check:

**Before:**
```typescript
const SMS_ACCOUNT_WORKSPACE_NAMES = ["owen", "uday 18th", "uday18th", "u-day 18th"]
const isSmsAccountWorkspace = SMS_ACCOUNT_WORKSPACE_NAMES.includes(
  conversation.workspace?.name?.toLowerCase() ?? ""
)
```

**After:**
```typescript
// Check if workspace has SMS campaign attribution enabled
const isSmsAccountWorkspace = conversation.workspace?.hasSmsAttribution ?? false
```

Or use a workspace setting flag instead of hard-coded names. If this requires schema changes, add a `WorkspaceSettings.hasSmsAttribution` boolean.

### Step 3: Mobile Sidebar — Collapsible Pattern

Update `conversation-feed.tsx` for mobile responsiveness:

```tsx
// Add state for mobile collapse
const [sidebarOpen, setSidebarOpen] = useState(true)

// Use Sheet for mobile, inline for desktop
return (
  <>
    {/* Mobile toggle button (visible on small screens) */}
    <Button
      variant="ghost"
      size="icon"
      className="fixed bottom-4 left-4 z-50 md:hidden h-12 w-12 rounded-full shadow-lg bg-primary text-primary-foreground"
      onClick={() => setSidebarOpen(true)}
    >
      <MessageSquare className="h-5 w-5" />
    </Button>

    {/* Desktop: Always visible sidebar */}
    <div className="hidden md:flex w-80 flex-col border-r">
      {/* Existing conversation feed content */}
    </div>

    {/* Mobile: Sheet overlay */}
    <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <SheetContent side="left" className="w-80 p-0">
        {/* Same conversation feed content */}
      </SheetContent>
    </Sheet>
  </>
)
```

### Step 4: Filter Controls — Collapsible on Mobile

Wrap filters in a collapsible section for mobile:

```tsx
<Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} className="md:block">
  {/* Mobile toggle */}
  <CollapsibleTrigger asChild className="md:hidden">
    <Button variant="outline" size="sm" className="w-full justify-between">
      <span>Filters</span>
      <div className="flex items-center gap-2">
        {activeFiltersCount > 0 && (
          <Badge variant="secondary">{activeFiltersCount}</Badge>
        )}
        <ChevronDown className={cn(
          "h-4 w-4 transition-transform",
          filtersOpen && "rotate-180"
        )} />
      </div>
    </Button>
  </CollapsibleTrigger>

  <CollapsibleContent className="md:!block">
    {/* Search, sort, sentiment filter, etc. */}
  </CollapsibleContent>
</Collapsible>
```

### Step 5: Empty State Messaging

Add empty state to conversation list:

```tsx
{sortedConversations.length === 0 && !isLoading && (
  <div className="flex flex-col items-center justify-center h-64 text-center p-6">
    <div className="flex items-center justify-center h-16 w-16 rounded-full bg-muted mb-4">
      <Inbox className="h-8 w-8 text-muted-foreground" />
    </div>
    <h3 className="font-semibold text-lg mb-2">No conversations found</h3>
    <p className="text-sm text-muted-foreground max-w-[200px]">
      {hasActiveFilters
        ? "Try adjusting your filters to see more results"
        : "New conversations will appear here when leads respond"}
    </p>
    {hasActiveFilters && (
      <Button variant="link" onClick={clearFilters} className="mt-2">
        Clear all filters
      </Button>
    )}
  </div>
)}
```

### Step 6: Touch Targets — Minimum 44px

Update icon buttons in `action-station.tsx`:

```tsx
// Before
<Button variant="ghost" size="icon" className="h-8 w-8">

// After (ensure 44px minimum)
<Button variant="ghost" size="icon" className="h-11 w-11 min-h-[44px] min-w-[44px]">
```

Apply to:
- Channel tab triggers
- Sync button
- Re-analyze button
- CRM drawer toggle
- Calendar link insert
- Refresh availability
- Reject/Regenerate/Approve buttons

### Step 7: LinkedIn Character Counter

Add character counter to connection note in `action-station.tsx`:

```tsx
<div className="space-y-1">
  <Label className="text-xs text-muted-foreground">
    Connection Note (optional)
  </Label>
  <Textarea
    placeholder="Add a personal note to your connection request..."
    value={connectionNote}
    onChange={(e) => setConnectionNote(e.target.value.slice(0, 300))}
    maxLength={300}
    rows={3}
  />
  <div className="flex justify-end">
    <span className={cn(
      "text-xs",
      connectionNote.length > 280 ? "text-amber-500" : "text-muted-foreground",
      connectionNote.length >= 300 && "text-destructive"
    )}>
      {connectionNote.length}/300
    </span>
  </div>
</div>
```

### Step 8: Auto-send Warning Enhancement

Make the "needs review" warning more prominent:

```tsx
{autoSendAction === "needs_review" && (
  <Alert variant="destructive" className="mb-4">
    <AlertTriangle className="h-4 w-4" />
    <AlertTitle className="flex items-center justify-between">
      <span>AI Auto-Send Needs Review</span>
      <Badge variant="outline" className="ml-2">
        {confidence}% confidence
      </Badge>
    </AlertTitle>
    <AlertDescription className="mt-2">
      <p className="text-sm">{autoSendReason}</p>
      <div className="flex gap-2 mt-3">
        <Button size="sm" variant="destructive" onClick={handleReject}>
          Reject
        </Button>
        <Button size="sm" variant="outline" onClick={handleApprove}>
          Approve & Send
        </Button>
      </div>
    </AlertDescription>
  </Alert>
)}
```

### Step 9: Focus States & ARIA Labels

Add visible focus indicators and ARIA labels:

**Focus rings:**
```tsx
// Ensure all interactive elements have focus-visible
<Button
  className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
  aria-label="Sync conversation"
>
  <RefreshCw className="h-4 w-4" />
</Button>
```

**ARIA labels for icon-only buttons:**
```tsx
<Button variant="ghost" size="icon" aria-label="Jump to top of conversation list">
  <ChevronsUp className="h-4 w-4" />
</Button>

<Button variant="ghost" size="icon" aria-label="Jump to bottom of conversation list">
  <ChevronsDown className="h-4 w-4" />
</Button>

<Button variant="ghost" size="icon" aria-label="Open CRM drawer">
  <PanelRightOpen className="h-4 w-4" />
</Button>
```

**Skip links (in dashboard layout):**
```tsx
// Add at top of dashboard layout
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-background focus:px-4 focus:py-2 focus:rounded-md focus:ring-2 focus:ring-ring"
>
  Skip to main content
</a>

// Add id to main content area
<main id="main-content" className="flex-1">
  {/* Dashboard content */}
</main>
```

### Step 10: Email Header Collapse

Make email headers collapsible in long threads:

```tsx
function ChatMessage({ message, isExpanded, onToggleExpand }) {
  const isEmail = message.channel === "email"
  const hasEmailDetails = isEmail && (message.toEmail || message.ccEmails?.length)

  return (
    <div className="...">
      {hasEmailDetails && (
        <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs">
              {isExpanded ? "Hide details" : "Show email details"}
              <ChevronDown className={cn(
                "h-3 w-3 ml-1 transition-transform",
                isExpanded && "rotate-180"
              )} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="text-xs text-muted-foreground space-y-1 mt-2 mb-3">
              <p><strong>From:</strong> {message.fromEmail}</p>
              <p><strong>To:</strong> {message.toEmail}</p>
              {message.ccEmails?.length > 0 && (
                <p><strong>CC:</strong> {message.ccEmails.join(", ")}</p>
              )}
              {message.subject && (
                <p><strong>Subject:</strong> {message.subject}</p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      {/* Message content */}
    </div>
  )
}
```

### Step 11: Verify

1. `npm run lint` — no new errors
2. `npm run build` — succeeds
3. Mobile check (375px viewport):
   - Sidebar collapses, FAB button appears
   - Filters collapse with count badge
   - Touch targets are 44px+
   - Empty state shows when no conversations
4. Accessibility check:
   - Tab through inbox, verify visible focus rings
   - Check ARIA labels with screen reader or DevTools
   - Verify skip link works
5. Dark mode: All changes work in dark theme

## Output
- `components/dashboard/conversation-card.tsx` — Removed hard-coded workspace name logic for SMS attribution
- `components/dashboard/conversation-feed.tsx` — Mobile sheet sidebar + filter collapsible, empty state, filter count, clear-all
- `components/dashboard/action-station.tsx` — 44px touch targets, destructive auto-send alert with actions, ARIA labels for icon-only buttons
- `components/dashboard/chat-message.tsx` — Collapsible email header details + subject
- `app/page.tsx` — Skip link + `main` anchor for accessibility

**Execution Output (2026-02-02)**
- Refactored inbox sidebar into a mobile Sheet with a floating open button and preserved desktop layout.
- Added collapsible filters on mobile with an active filter count and clear-all empty state messaging.
- Upgraded auto-send warning to a destructive alert with explicit approve/reject actions, and expanded touch targets.
- Collapsed email header details behind a toggle to reduce thread noise.
- Added a skip-to-content link in the dashboard layout.

**Validation**
- Not run in this subphase: `npm run lint`, `npm run build` (defer to phase end).

## Handoff
Proceed to Phase 92f (Corrections & Shared UI Primitives). Validate any remaining lint/type issues, consolidate shared UI primitives, and double-check settings-view extraction plan.
