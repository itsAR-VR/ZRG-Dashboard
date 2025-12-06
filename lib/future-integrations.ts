/**
 * Future Integrations Reference
 *
 * This file documents planned integrations that are not yet implemented.
 * These integrations are scaffolded in the follow-up system but require
 * additional development to become fully functional.
 *
 * Reference this file when implementing these features in future phases.
 */

// =============================================================================
// Phase III: LinkedIn Integration
// =============================================================================

/**
 * LinkedIn Integration via Unipile API
 *
 * Status: Schema scaffolded (Lead.linkedinId, Lead.linkedinUrl, Message.channel='linkedin')
 * Provider: Unipile (https://unipile.com)
 *
 * Use Cases:
 * - Check if lead has connected on LinkedIn
 * - Send follow-up messages via LinkedIn if connected
 * - Connection request automation
 * - Message sync to unified inbox
 *
 * Follow-up Sequence Integration:
 * - Condition: "linkedin_connected" - Check if lead has accepted connection
 * - Channel: "linkedin" - Send message via LinkedIn DM/InMail
 *
 * API Documentation: https://docs.unipile.com
 *
 * Required Fields:
 * - UNIPILE_API_KEY: API key for Unipile
 * - Lead.linkedinId: LinkedIn member ID (populated when connection established)
 * - Lead.linkedinUrl: LinkedIn profile URL (for connection requests)
 *
 * Implementation Notes:
 * - Unipile handles OAuth with LinkedIn
 * - Rate limits apply: ~100 connection requests/day, ~150 messages/day
 * - InMail requires LinkedIn Sales Navigator or Premium
 */

export interface LinkedInIntegrationConfig {
  provider: "unipile";
  apiKey: string;
  // Webhook endpoint for incoming messages
  webhookUrl: string;
  // Rate limit settings
  maxConnectionRequestsPerDay: number;
  maxMessagesPerDay: number;
}

export interface LinkedInConnectionStatus {
  isConnected: boolean;
  connectionDate?: Date;
  canMessage: boolean;
  requiresInMail: boolean;
}

// Placeholder function - to be implemented in Phase III
export async function checkLinkedInConnectionStatus(
  leadLinkedInUrl: string
): Promise<LinkedInConnectionStatus> {
  console.warn("LinkedIn integration not yet implemented");
  return {
    isConnected: false,
    canMessage: false,
    requiresInMail: true,
  };
}

// =============================================================================
// Phase IV: Calendar Automation
// =============================================================================

/**
 * Calendar Booking Automation
 *
 * Status: Availability fetching implemented (lib/calendar-availability.ts)
 * Missing: Automated booking when lead selects a time
 *
 * Current Capabilities:
 * - Detect calendar type from URL (Calendly, HubSpot, GHL)
 * - Fetch available time slots
 * - Format slots for AI follow-up messages
 * - Multiple calendar links per workspace
 * - Per-lead calendar preferences
 *
 * Future Capabilities (Phase IV):
 * - Parse lead's time preference from message (AI extraction)
 * - Automatically book meeting on selected calendar
 * - Create calendar event with Zoom/Meet link
 * - Send confirmation email with meeting details
 * - Sync booked meetings to dashboard
 *
 * Supported Calendar Platforms:
 * - Calendly (public booking API)
 * - HubSpot Meetings (public availability API)
 * - GoHighLevel (widget booking API)
 *
 * Implementation Notes:
 * - Calendly: POST to booking endpoint with invitee details
 * - HubSpot: POST to meetings API with contact info
 * - GHL: POST to calendar booking endpoint
 * - All require email at minimum; phone preferred
 */

export interface CalendarBookingRequest {
  calendarLinkId: string;
  leadId: string;
  requestedTime: Date;
  leadEmail: string;
  leadName: string;
  leadPhone?: string;
  notes?: string;
}

export interface CalendarBookingResult {
  success: boolean;
  meetingId?: string;
  meetingUrl?: string;
  confirmationSent?: boolean;
  error?: string;
}

// Placeholder function - to be implemented in Phase IV
export async function bookCalendarMeeting(
  request: CalendarBookingRequest
): Promise<CalendarBookingResult> {
  console.warn("Automated calendar booking not yet implemented");
  return {
    success: false,
    error: "Calendar booking automation is planned for Phase IV",
  };
}

// =============================================================================
// Phase V: AI Voice Caller
// =============================================================================

/**
 * AI Voice Caller Integration via Retell AI
 *
 * Status: Channel scaffolded (FollowUpStep.channel='ai_voice', FollowUpTask.type='ai_voice')
 * Provider: Retell AI (https://retellai.com)
 * Connection Method: SIP Trunking
 *
 * Use Cases:
 * 1. Qualification Calls (Post-Booking):
 *    - After lead selects meeting time, AI calls to ask qualification questions
 *    - Captures responses and stores in lead record
 *    - Confirms meeting details
 *
 * 2. Double-Dial Touchpoints (No Response):
 *    - Day 2: If phone provided, immediate AI call for engagement
 *    - Fallback to SMS if call not answered
 *    - Warm transfer to human if lead requests
 *
 * 3. Follow-up Calls:
 *    - Re-engage cold leads with personalized AI call
 *    - Book meetings directly during call
 *
 * API Documentation: https://docs.retellai.com
 *
 * Required Configuration:
 * - RETELL_API_KEY: Retell AI API key
 * - SIP trunk credentials (provided by Retell)
 * - Agent ID (configured in Retell dashboard)
 * - Webhook URL for call events
 *
 * Call Flow:
 * 1. Trigger call via Retell API with lead phone number
 * 2. AI agent follows script with qualification questions
 * 3. Capture responses via webhook
 * 4. Update lead record with call outcome
 * 5. If meeting requested, hand off to calendar booking
 *
 * Qualification Questions Integration:
 * - Pull from WorkspaceSettings.qualificationQuestions
 * - AI asks each question and captures free-form response
 * - Responses stored in lead notes or custom fields
 */

export interface RetellAIConfig {
  provider: "retell";
  apiKey: string;
  agentId: string;
  // SIP trunk configuration
  sipTrunk: {
    username: string;
    password: string;
    server: string;
  };
  // Webhook for call events
  webhookUrl: string;
}

export interface AIVoiceCallRequest {
  leadId: string;
  phoneNumber: string;
  // Which script/agent to use
  callType: "qualification" | "followup" | "double_dial";
  // Qualification questions to ask (from workspace settings)
  qualificationQuestions?: Array<{ id: string; question: string }>;
  // Context for personalization
  leadFirstName?: string;
  companyName?: string;
  meetingContext?: string;
}

export interface AIVoiceCallResult {
  success: boolean;
  callId?: string;
  status?: "initiated" | "in_progress" | "completed" | "failed" | "no_answer";
  duration?: number;
  transcriptUrl?: string;
  qualificationResponses?: Record<string, string>;
  meetingRequested?: boolean;
  handoffRequested?: boolean;
  error?: string;
}

// Placeholder function - to be implemented in Phase V
export async function initiateAIVoiceCall(
  request: AIVoiceCallRequest
): Promise<AIVoiceCallResult> {
  console.warn("AI Voice Caller integration not yet implemented");
  return {
    success: false,
    error: "AI Voice Caller is planned for Phase V (Retell AI via SIP trunking)",
  };
}

/**
 * Webhook handler for Retell AI call events
 *
 * Expected webhook events:
 * - call.started: Call initiated
 * - call.answered: Lead picked up
 * - call.ended: Call completed (includes transcript)
 * - call.failed: Call failed (busy, no answer, etc.)
 *
 * Webhook URL: /api/webhooks/retell
 */
export interface RetellWebhookPayload {
  event: "call.started" | "call.answered" | "call.ended" | "call.failed";
  callId: string;
  timestamp: string;
  data: {
    duration?: number;
    transcript?: string;
    outcome?: string;
    qualificationResponses?: Record<string, string>;
    // Custom metadata we passed when initiating
    metadata?: {
      leadId: string;
      callType: string;
    };
  };
}

// =============================================================================
// Integration Priority & Dependencies
// =============================================================================

/**
 * Implementation Order:
 *
 * 1. Phase III - LinkedIn (Medium complexity)
 *    - Dependency: Unipile account
 *    - Effort: ~2 sprints
 *    - Value: Additional touchpoint for B2B leads
 *
 * 2. Phase IV - Calendar Automation (Medium complexity)
 *    - Dependency: Current availability fetching working
 *    - Effort: ~1-2 sprints
 *    - Value: Reduces manual booking friction
 *
 * 3. Phase V - AI Voice (High complexity)
 *    - Dependency: Retell AI account, SIP trunk setup
 *    - Effort: ~3-4 sprints
 *    - Value: Highest impact for qualification and engagement
 *
 * Each integration should be feature-flagged per workspace to allow
 * gradual rollout and testing.
 */

export const INTEGRATION_STATUS = {
  linkedin: {
    phase: "III",
    status: "schema_ready",
    provider: "Unipile",
    documentation: "https://docs.unipile.com",
  },
  calendar_automation: {
    phase: "IV",
    status: "availability_working",
    providers: ["Calendly", "HubSpot", "GoHighLevel"],
    missing: "booking_api",
  },
  ai_voice: {
    phase: "V",
    status: "channel_scaffolded",
    provider: "Retell AI",
    documentation: "https://docs.retellai.com",
    connectionMethod: "SIP Trunking",
  },
} as const;

