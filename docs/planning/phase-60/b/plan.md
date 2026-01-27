# Phase 60b — Create BookingProcessReference Component

## Focus
Implement the `BookingProcessReference` React component that displays the 5 booking processes with their descriptions, types, triggers, and behaviors in an accordion-style collapsible panel.

## Inputs
- Content specification from Phase 60a
- Existing UI patterns from `components/dashboard/settings/`
- Shadcn UI components (Card, Accordion, Badge, etc.)

## Work

### 1. Create Component File

Create `components/dashboard/settings/booking-process-reference.tsx`:

```typescript
"use client";

/**
 * Booking Process Reference Panel (Phase 60)
 *
 * Displays documentation for the 5 booking processes from Phase 52,
 * explaining their triggers, behaviors, and usage scenarios.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  Link2,
  Clock,
  Calendar,
  Phone,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  ArrowRight
} from "lucide-react";

// Process definitions
const BOOKING_PROCESSES = [
  {
    id: "1",
    name: "Link + Qualification",
    type: "outbound",
    templateName: "Link + Qualification (No Times)",
    icon: Link2,
    description: "Send booking link with qualifying questions when a lead shows interest.",
    trigger: "Lead expresses interest in your product/service",
    behavior: "AI draft includes your booking link and asks qualifying question(s). No suggested times are included.",
    example: '"I\'d love to chat! What\'s your timeline for implementing this? Here\'s my calendar: calendly.com/..."',
    automation: "full",
  },
  {
    id: "2",
    name: "Initial Email Times",
    type: "inbound",
    templateName: "Initial Email Times (EmailBison availability_slot)",
    icon: Clock,
    description: "Auto-book when the lead picks a time from your initial outreach.",
    trigger: "First outbound email included specific times (via EmailBison availability_slot)",
    behavior: "When the lead replies selecting one of the offered times, the system automatically books that slot.",
    example: 'You sent: "Are you free Tuesday 2pm or Wednesday 10am?" Lead replies: "Tuesday 2pm works" → Auto-booked',
    automation: "full",
  },
  {
    id: "3",
    name: "Lead Proposes Times",
    type: "inbound",
    templateName: "Lead Proposes Times (Auto-Book When Clear)",
    icon: Calendar,
    description: "Auto-book when the lead suggests times that match your availability.",
    trigger: "Lead proposes specific times in their message",
    behavior: "System checks if proposed times overlap with your availability. High-confidence matches are auto-booked; unclear cases are escalated for human review.",
    example: 'Lead: "I\'m free Thursday 3-5pm" → System finds Thursday 3pm available → Auto-booked',
    automation: "mostly",
  },
  {
    id: "4",
    name: "Call Requested",
    type: "inbound",
    templateName: "Call Requested (Create Call Task)",
    icon: Phone,
    description: "Create a task and notify you when a lead requests a phone call.",
    trigger: "Lead asks for a call and provides their phone number",
    behavior: "System creates a 'call' follow-up task and sends you a notification via Slack/email (requires Notification Center configured).",
    example: 'Lead: "Just call me at 555-1234" → Call task created + Slack notification sent',
    automation: "full",
    note: "Requires Notification Center to be configured for call alerts",
  },
  {
    id: "5",
    name: "Lead Calendar Link",
    type: "inbound",
    templateName: "Lead Provided Calendar Link (Escalate or Schedule)",
    icon: ExternalLink,
    description: "Capture and flag when a lead shares their own scheduling link.",
    trigger: "Lead sends their own calendar/scheduler link",
    behavior: "System captures the link, checks for availability overlap with yours, and creates a manual review task. You complete the booking on their scheduler.",
    example: 'Lead: "Book time on my calendar: calendly.com/lead/30min" → Link captured, flagged for your action',
    automation: "manual",
    note: "Full automation (booking on third-party schedulers) is planned for a future release",
  },
];

export function BookingProcessReference() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          <CardTitle>Booking Processes Reference</CardTitle>
        </div>
        <CardDescription>
          Understand how the AI handles different booking scenarios. <strong>Outbound</strong> processes control what goes into AI drafts. <strong>Inbound</strong> processes react to lead messages automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {BOOKING_PROCESSES.map((process) => (
            <AccordionItem key={process.id} value={process.id}>
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3 text-left">
                  <process.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">
                    {process.id}. {process.name}
                  </span>
                  <Badge variant={process.type === "outbound" ? "default" : "secondary"}>
                    {process.type === "outbound" ? "Outbound" : "Inbound"}
                  </Badge>
                  {process.automation === "manual" && (
                    <Badge variant="outline" className="text-amber-600 border-amber-600">
                      Manual Review
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-2 pl-7">
                  <p className="text-muted-foreground">{process.description}</p>

                  <div className="grid gap-3">
                    <div className="flex items-start gap-2">
                      <ArrowRight className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div>
                        <span className="font-medium text-sm">When it triggers:</span>
                        <p className="text-sm text-muted-foreground">{process.trigger}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div>
                        <span className="font-medium text-sm">What happens:</span>
                        <p className="text-sm text-muted-foreground">{process.behavior}</p>
                      </div>
                    </div>

                    <div className="bg-muted/50 rounded-md p-3">
                      <span className="font-medium text-sm">Example:</span>
                      <p className="text-sm text-muted-foreground italic mt-1">{process.example}</p>
                    </div>

                    {process.note && (
                      <div className="flex items-start gap-2 text-amber-600">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <p className="text-sm">{process.note}</p>
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground">
                      Template: <code className="bg-muted px-1 py-0.5 rounded">{process.templateName}</code>
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
```

### 2. Verify Accordion Component Exists

Check if `components/ui/accordion.tsx` exists. If not, add it via shadcn:
```bash
npx shadcn@latest add accordion
```

### 3. Export from Settings Index (if applicable)

If `components/dashboard/settings/index.ts` exists, add export.

## Output
- `components/dashboard/settings/booking-process-reference.tsx` — Complete component implementation

## Handoff
Pass the component to Phase 60c for integration into the Settings UI.
