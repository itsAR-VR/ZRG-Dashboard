# Phase 92b — Settings General Tab: Section Headers + Accordion Patterns

## Focus
Reorganize the Settings → General tab using section headers and accordion patterns to reduce cognitive load. The Auto-Send Schedule card (currently 300+ lines with 3 modes + holiday management) is the primary target for progressive disclosure.

## Inputs
- Phase 92a completed (semantic tokens available)
- Audit findings:
  - G1: Auto-Send Schedule too dense (3 modes + holidays in one card)
  - G3: Timezone dropdown has 22 flat options
  - G4: No visual grouping (all cards same weight)
- Current structure: `settings-view.tsx:2067-3174` (~1,100 lines)

## Work

### Step 1: Invoke Skills
```
/impeccable:simplify
/impeccable:clarify
```
Follow skill guidance for progressive disclosure patterns.

### Step 2: Add Section Headers

Insert visual section dividers to group related settings:

**Section 1: "Scheduling" (lines ~2067-2530)**
- Availability card (timezone, hours)
- Auto-Send Schedule card (refactored with accordion)

**Section 2: "Company Profile" (lines ~2550-2617)**
- Company Name, Target Result, ICP

**Section 3: "Calendar Links" (lines ~2619-2854)**
- Calendar links management

Create a reusable section header component or use existing pattern:

```tsx
<div className="flex items-center gap-2 mt-8 mb-4">
  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
    Scheduling
  </h3>
  <Separator className="flex-1" />
</div>
```

### Step 3: Refactor Auto-Send Schedule Card

Convert the 3-mode schedule + holiday management into an accordion:

```tsx
<Accordion type="single" collapsible className="w-full">
  <AccordionItem value="schedule-mode">
    <AccordionTrigger>
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4" />
        <span>Schedule Mode</span>
        <Badge variant="secondary" className="ml-2">
          {scheduleMode === "ALWAYS" ? "Always On" :
           scheduleMode === "BUSINESS_HOURS" ? "Business Hours" : "Custom"}
        </Badge>
      </div>
    </AccordionTrigger>
    <AccordionContent>
      {/* Mode selector + time inputs */}
    </AccordionContent>
  </AccordionItem>

  <AccordionItem value="holidays">
    <AccordionTrigger>
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4" />
        <span>Holiday Settings</span>
        <Badge variant="outline" className="ml-2">
          {excludedDates.length + blackoutDateRanges.length} exclusions
        </Badge>
      </div>
    </AccordionTrigger>
    <AccordionContent>
      {/* Preset holidays + custom exclusions + date ranges */}
    </AccordionContent>
  </AccordionItem>
</Accordion>
```

### Step 4: Group Timezone Dropdown by Region

Replace flat timezone list with grouped structure:

```tsx
<Select value={timezone} onValueChange={setTimezone}>
  <SelectTrigger>
    <SelectValue placeholder="Select timezone" />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Americas</SelectLabel>
      <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
      <SelectItem value="America/Chicago">Central (CT)</SelectItem>
      <SelectItem value="America/Denver">Mountain (MT)</SelectItem>
      <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
      <SelectItem value="America/Anchorage">Alaska (AKT)</SelectItem>
      <SelectItem value="Pacific/Honolulu">Hawaii (HT)</SelectItem>
    </SelectGroup>
    <SelectSeparator />
    <SelectGroup>
      <SelectLabel>Europe</SelectLabel>
      <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
      <SelectItem value="Europe/Paris">Paris (CET)</SelectItem>
      <SelectItem value="Europe/Berlin">Berlin (CET)</SelectItem>
      {/* ... */}
    </SelectGroup>
    <SelectSeparator />
    <SelectGroup>
      <SelectLabel>Asia Pacific</SelectLabel>
      <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
      <SelectItem value="Asia/Singapore">Singapore (SGT)</SelectItem>
      <SelectItem value="Australia/Sydney">Sydney (AEST)</SelectItem>
      {/* ... */}
    </SelectGroup>
  </SelectContent>
</Select>
```

### Step 5: Verify

1. `npm run lint` — no new errors
2. `npm run build` — succeeds
3. Visual check: General tab has clear sections
4. Accordion behavior: Schedule mode and holidays collapse/expand correctly
5. Timezone dropdown: Groups are visible and scannable

## Output
- `settings-view.tsx` General tab (~lines 2067-3174) refactored with:
  - 3 section headers: Scheduling, Company Profile, Calendar Links
  - Auto-Send Schedule using Accordion component
  - Timezone dropdown grouped by region

**Execution Output (2026-02-02)**
- Added section headers in General tab for Account, Scheduling, Company Profile, Calendar Links, and Notifications.
- Reworked AI Auto-Send Schedule into an accordion with Schedule Mode + Holiday Settings sections.
- Grouped timezone dropdown by region using `SelectGroup`/`SelectLabel`.
- Note: Settings tab extraction into subcomponents is deferred to Phase 92f (per plan decision).

**Validation**
- Not run in this subphase: `npm run lint`, `npm run build` (defer to phase end).

## Handoff
Phase 92c can now apply similar patterns (section headers, accordions) to the Integrations tab. The General tab serves as the reference implementation for progressive disclosure patterns.

Proceed to Phase 92c (Integrations tab) for logos + Slack cleanup. Keep Settings refactor extraction work queued for Phase 92f.
