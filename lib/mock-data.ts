/**
 * Type definitions for dashboard components
 * These types are used throughout the UI components for type safety
 * 
 * Note: This file previously contained mock data but has been cleaned up.
 * All data now comes from the database via server actions.
 */

export interface Lead {
  id: string
  name: string
  email: string
  phone: string
  company: string
  title: string
  website: string
  timezone: string
  leadScore: number
  autoReplyEnabled: boolean
  autoFollowUpEnabled: boolean
  clientId: string  // Workspace/client ID for follow-up sequence management
  smsCampaignId?: string | null
  smsCampaignName?: string | null
  status: "new" | "qualified" | "meeting-booked" | "blacklisted" | "not-interested" | "meeting-requested" | "information-requested" | "call-requested"
  qualification: {
    budget: boolean
    authority: boolean
    need: boolean
    timing: boolean
  }
  // Enrichment data (from EmailBison/Clay)
  linkedinUrl?: string | null
  companyName?: string | null
  companyWebsite?: string | null
  companyState?: string | null
  emailBisonLeadId?: string | null
  enrichmentStatus?: string | null  // 'pending' | 'enriched' | 'not_found' | 'not_needed'
  autoBookMeetingsEnabled?: boolean
  // GHL integration data
  ghlContactId?: string | null
  ghlLocationId?: string | null
  // Sentiment/classification
  sentimentTag?: string | null
}

export type Channel = "sms" | "email" | "linkedin";

export interface Message {
  id: string
  sender: "lead" | "ai" | "human"
  content: string
  timestamp: Date
  subject?: string
  rawHtml?: string
  rawText?: string
  cc?: string[]
  bcc?: string[]
  channel: Channel
  direction?: "inbound" | "outbound"
  isRead?: boolean
}

export interface Conversation {
  id: string
  lead: Lead
  channels: Channel[]           // All channels this lead has messages on
  availableChannels: Channel[]  // Channels available based on contact info
  primaryChannel: Channel       // Most recent/active channel
  platform?: Channel            // @deprecated - use primaryChannel instead
  classification: "meeting-requested" | "not-interested" | "out-of-office" | "follow-up" | "new" | "information-requested" | "call-requested" | "blacklist" | "positive" | "neutral" | "interested"
  lastMessage: string
  lastSubject?: string | null
  lastMessageTime: Date
  messages: Message[]
  hasAiDraft: boolean
  requiresAttention: boolean
  emailCampaignId?: string | null
}

export interface FollowUpTask {
  id: string
  lead: Lead
  type: "email" | "call" | "linkedin" | "sms"
  sequenceStep: number
  totalSteps: number
  dueDate: Date
  suggestedMessage: string
  campaignName: string
}
