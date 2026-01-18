# Phase 36c — Booking Process Builder UI

## Focus

Build the CRUD interface for creating, viewing, editing, and deleting booking processes with their stage configurations.

## Inputs

- `BookingProcess` and `BookingProcessStage` models from phase 36a
- Existing UI patterns in `components/dashboard/settings-view.tsx`
- Existing `WorkspaceSettings.qualifyingQuestions` for question selection
- Shadcn UI components in `components/ui/`

## Work

### 1. Create Booking Process Server Actions

Create `actions/booking-process-actions.ts`:

```typescript
export async function listBookingProcesses(clientId: string): Promise<BookingProcessWithStages[]>

export async function getBookingProcess(id: string): Promise<BookingProcessWithStages | null>

export async function createBookingProcess(data: {
  clientId: string;
  name: string;
  description?: string;
  maxRepliesBeforeEscalation?: number;
  stages: BookingProcessStageInput[];
}): Promise<{ success: boolean; data?: BookingProcess; error?: string }>

export async function updateBookingProcess(
  id: string,
  data: Partial<BookingProcessInput>
): Promise<{ success: boolean; data?: BookingProcess; error?: string }>

export async function deleteBookingProcess(id: string): Promise<{ success: boolean; error?: string }>
// Check for active campaign assignments before allowing delete
```

### 2. Create Booking Process List Component

Create `components/dashboard/booking-process-list.tsx`:

- Display all saved booking processes for the workspace
- Show name, description, number of stages, assigned campaign count
- Actions: Edit, Duplicate, Delete
- "Create New" button

### 3. Create Booking Process Builder Component

Create `components/dashboard/booking-process-builder.tsx`:

**Header Section:**
- Process name input (required)
- Description textarea (optional)
- Max replies before escalation (number input, default 5)

**Stages Section:**
Visual/tabular interface for configuring each stage:

```
┌──────────────────────────────────────────────────────────────────┐
│ Stage 1                                              [Delete] [↕]│
├──────────────────────────────────────────────────────────────────┤
│ Channels:  ☑ Email  ☑ SMS  ☑ LinkedIn                           │
│                                                                  │
│ ☐ Include booking link                                           │
│   └─ Link type: ○ Plain URL  ○ Hyperlinked text                 │
│                                                                  │
│ ☐ Include suggested times                                        │
│   └─ Number of times: [3] ▼                                     │
│                                                                  │
│ ☐ Include qualifying question(s)                                 │
│   └─ Select questions: [Dropdown multi-select from settings]    │
│                                                                  │
│ ☐ Include timezone ask                                           │
└──────────────────────────────────────────────────────────────────┘

[+ Add Stage]
```

**Features:**
- Drag-to-reorder stages (or up/down arrows)
- Delete stage (with confirmation if stages exist after)
- Add stage button
- Conditional visibility (show link type only if "Include booking link" checked)
- Multi-select for qualifying questions from workspace settings

### 4. Create Stage Preview Component

Create `components/dashboard/booking-process-stage-preview.tsx`:

Show example AI response text for each stage based on configuration:

```
Stage 1 Preview:
"Thanks for your interest! I'd love to learn more about your needs.

[Qualifying question here]

In the meantime, here are a few times that work for a quick call:
- Tuesday, Jan 21 at 2:00 PM EST
- Wednesday, Jan 22 at 10:00 AM EST
- Thursday, Jan 23 at 3:00 PM EST

What works best for you?"
```

### 5. Integrate into Settings View

Add a new tab or section in `components/dashboard/settings-view.tsx`:

**Option A:** New "Booking Processes" tab alongside existing tabs
**Option B:** Section within existing settings, collapsible

Recommended: **Option A** — separate tab for clarity, as this is a substantial feature.

### 6. Template Booking Processes

Pre-populate workspace with example templates (can be created on first access or via seed):

1. **Direct Link First**
   - Stage 1: Booking link (plain URL)

2. **Times + Question First**
   - Stage 1: Suggested times (3) + Qualifying question
   - Stage 2: Booking link if confirmed

3. **Relationship Builder**
   - Stage 1: Acknowledge, no booking content
   - Stage 2: Suggested times + Qualifying question
   - Stage 3: Booking link

4. **Times Only**
   - Stage 1: Suggested times (3)
   - Stage 2: Suggested times (follow-up)

5. **Times Then Link**
   - Stage 1: Suggested times
   - Stage 2: Suggested times (follow-up)
   - Stage 3: Booking link

### 7. Validation Rules

- Name is required and must be unique within workspace
- At least one stage required
- Stage numbers must be sequential (1, 2, 3...)
- At least one channel must be selected per stage
- Warn user about deliverability when Stage 1 includes booking link

### 8. Deliverability Warnings

Display contextual warnings in the builder:

- **Stage 1 with link:** "Including a booking link in the first reply may impact email deliverability. Consider suggesting times first."
- **Hyperlinked text:** "Hyperlinked text may increase spam risk. Plain URLs are generally safer."
- **Booking language:** Reference that words like "book", "schedule", "calendar" can trigger filters.

## Output

- `actions/booking-process-actions.ts` with CRUD operations
- `components/dashboard/booking-process-list.tsx`
- `components/dashboard/booking-process-builder.tsx`
- `components/dashboard/booking-process-stage-preview.tsx`
- Updated `settings-view.tsx` with new tab
- Template booking processes seeded or available

## Handoff

Booking process builder is complete. Users can create and manage booking processes. Subphase d will add the campaign assignment UI to connect processes to campaigns.
