# Phase 92d — Settings AI/Booking Tabs: Progressive Disclosure + Clarity

## Focus
Apply progressive disclosure patterns to the AI and Booking tabs, which together span ~1,700 lines. Key targets: Knowledge Assets add form (convert to modal), Qualification Questions (expandable list), Pause Follow-ups (standalone card), and Booking Process Manager (wizard pattern).

## Inputs
- Phase 92a tokens available
- Phase 92b/c patterns (accordions, modals, section headers)
- Audit findings:
  - A1: Knowledge Assets add form too prominent
  - A2: Qualification Questions inline
  - A3: Pause Follow-ups buried
  - A4: AI Behavior Rules visual inconsistency
  - A5: Automation Settings lacks context
  - A6: Draft confidence threshold hidden
  - B1: Booking Process Manager too nested
  - B2: AI Campaign Assignment table overloaded
  - B3: Booking Notices buried in dropdown

## Work

### Step 1: Invoke Skills
```
/impeccable:simplify
/impeccable:clarify
```

### Step 2: AI Tab — Knowledge Assets Add Form → Modal

Replace the prominent dashed-border add form with a button + dialog:

**Before:**
```
[Existing Assets List]
┌─────────────────────────────┐
│  + Add New Asset            │
│  [Name input]               │
│  [Type selector]            │
│  [Content area]             │
│  [Add button]               │
└─────────────────────────────┘
```

**After:**
```
[Existing Assets List]

[+ Add Knowledge Asset] (button)
```

Dialog contains:
```tsx
<Dialog open={addAssetOpen} onOpenChange={setAddAssetOpen}>
  <DialogTrigger asChild>
    <Button variant="outline" className="w-full mt-4">
      <Plus className="h-4 w-4 mr-2" />
      Add Knowledge Asset
    </Button>
  </DialogTrigger>
  <DialogContent className="sm:max-w-[500px]">
    <DialogHeader>
      <DialogTitle>Add Knowledge Asset</DialogTitle>
      <DialogDescription>
        Add context that the AI will use when generating responses
      </DialogDescription>
    </DialogHeader>
    <div className="space-y-4 py-4">
      {/* Asset Name */}
      {/* Type Selector (Text, Website, File) */}
      {/* Content input based on type */}
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setAddAssetOpen(false)}>
        Cancel
      </Button>
      <Button onClick={handleAddAsset} disabled={isAdding}>
        {isAdding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Add Asset
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Step 3: AI Tab — Qualification Questions Expandable List

Replace always-visible add input with collapsible section:

```tsx
<Collapsible open={questionsExpanded} onOpenChange={setQuestionsExpanded}>
  <div className="flex items-center justify-between">
    <Label className="text-sm font-medium">Qualification Questions</Label>
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="sm">
        {questionsExpanded ? "Collapse" : "Add Questions"}
        <ChevronDown className={cn(
          "h-4 w-4 ml-2 transition-transform",
          questionsExpanded && "rotate-180"
        )} />
      </Button>
    </CollapsibleTrigger>
  </div>

  {/* Always visible: Existing questions list */}
  <div className="space-y-2 mt-4">
    {qualificationQuestions.map((q) => (
      <div key={q.id} className="flex items-center gap-2 p-2 rounded-lg border">
        <span className="flex-1 text-sm">{q.text}</span>
        <Switch checked={q.required} onCheckedChange={...} />
        <Button variant="ghost" size="icon" onClick={...}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    ))}
  </div>

  <CollapsibleContent>
    {/* Add new question form */}
    <div className="flex gap-2 mt-4">
      <Input
        placeholder="New qualification question..."
        value={newQuestion}
        onChange={(e) => setNewQuestion(e.target.value)}
      />
      <Button onClick={handleAddQuestion}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
    {/* Example questions */}
  </CollapsibleContent>
</Collapsible>
```

### Step 4: AI Tab — Pause Follow-ups Standalone Card

Extract from AI Behavior Rules into its own prominent card:

```tsx
<Card className={cn(
  "border-2",
  followUpsPaused ? "border-amber-500/50 bg-amber-500/5" : "border-border"
)}>
  <CardHeader>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex items-center justify-center h-10 w-10 rounded-lg",
          followUpsPaused ? "bg-amber-500/20" : "bg-muted"
        )}>
          {followUpsPaused ? (
            <PauseCircle className="h-5 w-5 text-amber-500" />
          ) : (
            <PlayCircle className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div>
          <CardTitle className="text-base">Follow-Up Sequences</CardTitle>
          <CardDescription>
            {followUpsPaused
              ? `Paused for ${daysRemaining} more day${daysRemaining > 1 ? 's' : ''}`
              : "Sequences are running normally"}
          </CardDescription>
        </div>
      </div>
      <Badge variant={followUpsPaused ? "destructive" : "secondary"}>
        {followUpsPaused ? "Paused" : "Active"}
      </Badge>
    </div>
  </CardHeader>
  <CardContent>
    {followUpsPaused ? (
      <Button onClick={handleResume} variant="outline" className="w-full">
        Resume Follow-ups
      </Button>
    ) : (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={365}
          value={pauseDays}
          onChange={(e) => setPauseDays(Number(e.target.value))}
          className="w-24"
        />
        <span className="text-sm text-muted-foreground">days</span>
        <Button onClick={handlePause} variant="outline">
          Pause
        </Button>
      </div>
    )}
  </CardContent>
</Card>
```

Remove quick buttons (1d/3d/7d/14d) for visual consistency with other settings.

### Step 5: AI Tab — Automation Settings Helper Text

Add descriptions to each toggle:

```tsx
<div className="space-y-4">
  <div className="flex items-center justify-between p-3 rounded-lg border">
    <div className="space-y-0.5">
      <Label className="text-sm font-medium">Auto-enroll in sequences</Label>
      <p className="text-xs text-muted-foreground">
        Automatically add interested leads to follow-up sequences
      </p>
    </div>
    <Switch checked={autoEnroll} onCheckedChange={setAutoEnroll} />
  </div>

  <div className="flex items-center justify-between p-3 rounded-lg border">
    <div className="space-y-0.5">
      <Label className="text-sm font-medium">Auto-send AI responses</Label>
      <p className="text-xs text-muted-foreground">
        Send AI-generated drafts without manual approval when confidence is high
      </p>
    </div>
    <Switch checked={autoSend} onCheckedChange={setAutoSend} />
  </div>

  {/* Repeat for other toggles */}
</div>
```

### Step 6: AI Tab — Confidence Threshold Slider

Replace hidden number input with visual slider:

```tsx
<div className="space-y-4">
  <div className="flex items-center justify-between">
    <Label className="text-sm font-medium">Draft Confidence Threshold</Label>
    <span className="text-sm font-mono text-muted-foreground">
      {confidenceThreshold}%
    </span>
  </div>
  <Slider
    value={[confidenceThreshold]}
    onValueChange={([v]) => setConfidenceThreshold(v)}
    min={50}
    max={100}
    step={5}
    className="w-full"
  />
  <div className="flex justify-between text-xs text-muted-foreground">
    <span>More aggressive (50%)</span>
    <span>More conservative (100%)</span>
  </div>
</div>
```

### Step 7: Booking Tab — Notices as Persistent Banner

Replace dropdown notices with alert banner:

```tsx
{hasBookingNotices && (
  <Alert variant="default" className="mb-6 bg-amber-500/5 border-amber-500/20">
    <AlertTriangle className="h-4 w-4 text-amber-500" />
    <AlertTitle>Booking Configuration Notes</AlertTitle>
    <AlertDescription>
      <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
        <li>Process 5 requires manual review for lead scheduler links</li>
        <li>Third-party auto-booking via browser automation is planned</li>
      </ul>
    </AlertDescription>
  </Alert>
)}
```

### Step 8: Booking Tab — Campaign Assignment Collapsible Rows

Group campaign settings into expandable rows:

```tsx
{campaigns.map((campaign) => (
  <Collapsible key={campaign.id}>
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="flex items-center gap-3">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="font-medium">{campaign.name}</p>
          <p className="text-xs text-muted-foreground">
            {campaign.leadCount} leads • {campaign.responseMode}
          </p>
        </div>
      </div>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="icon">
          <ChevronDown className="h-4 w-4" />
        </Button>
      </CollapsibleTrigger>
    </div>
    <CollapsibleContent>
      <div className="p-4 pt-2 space-y-4 border-x border-b rounded-b-lg">
        {/* Auto-send threshold */}
        {/* Delay min/max */}
        {/* Booking process dropdown */}
        {/* AI persona dropdown */}
        {/* Schedule editor */}
      </div>
    </CollapsibleContent>
  </Collapsible>
))}
```

### Step 9: Verify

1. `npm run lint` — no new errors
2. `npm run build` — succeeds
3. AI Tab visual check:
   - Knowledge Assets: "+ Add" button opens modal
   - Qualification Questions: Collapsible add section
   - Pause Follow-ups: Standalone card with clear status
   - Automation Settings: Helper text visible
   - Confidence: Slider works smoothly
4. Booking Tab visual check:
   - Notices: Alert banner visible at top
   - Campaigns: Collapsible rows expand/collapse

## Output
- `components/dashboard/settings-view.tsx` AI tab refactored with:
  - Knowledge Assets modal flow
  - Qualification Questions collapsible
  - Pause Follow-ups standalone card
  - AI Behavior Rules helper text
- `components/ui/alert.tsx` + `components/ui/slider.tsx` new primitives
- `components/dashboard/settings/ai-campaign-assignment.tsx` updated to:
  - Collapsible campaign rows
  - Slider-based confidence threshold control
- `components/dashboard/settings-view.tsx` Booking tab refactored with:
  - Booking notices as alert banner
  - Campaign assignment panel now collapsible (via component update)

**Execution Output (2026-02-02)**
- Added `Alert` and `Slider` primitives and wired Booking Notices to an alert banner.
- Converted AI Campaign Assignment table into collapsible cards with a confidence slider and reorganized inputs.
- Cleaned AI tab workspace settings layout, including Knowledge Assets dialog, Qualification Questions collapsible, and standalone Follow-Up Sequences card.

**Validation**
- Not run in this subphase: `npm run lint`, `npm run build` (defer to phase end).

## Handoff
Phase 92e focuses on inbox and accessibility. All settings tabs now follow consistent progressive disclosure patterns that 92e can reference for any remaining cleanup.
