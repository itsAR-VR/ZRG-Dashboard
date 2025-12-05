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
  status: "new" | "qualified" | "meeting-booked" | "blacklisted" | "not-interested" | "meeting-requested" | "information-requested" | "call-requested"
  qualification: {
    budget: boolean
    authority: boolean
    need: boolean
    timing: boolean
  }
}

export interface Message {
  id: string
  sender: "lead" | "ai" | "human"
  content: string
  timestamp: Date
}

export interface Conversation {
  id: string
  lead: Lead
  platform: "email" | "sms" | "linkedin"
  classification: "meeting-requested" | "not-interested" | "out-of-office" | "follow-up" | "new" | "information-requested" | "call-requested" | "blacklist" | "positive" | "neutral"
  lastMessage: string
  lastMessageTime: Date
  messages: Message[]
  hasAiDraft: boolean
  requiresAttention: boolean
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
