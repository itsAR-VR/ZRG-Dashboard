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
  status: "new" | "qualified" | "meeting-booked" | "blacklisted"
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
  classification: "meeting-requested" | "not-interested" | "out-of-office" | "follow-up" | "new"
  lastMessage: string
  lastMessageTime: Date
  messages: Message[]
  hasAiDraft: boolean
  requiresAttention: boolean
}

export const mockLeads: Lead[] = [
  {
    id: "1",
    name: "Sarah Chen",
    email: "sarah.chen@techcorp.com",
    phone: "+1 (555) 123-4567",
    company: "TechCorp Industries",
    title: "VP of Marketing",
    website: "https://techcorp.com",
    timezone: "PST (UTC-8)",
    leadScore: 87,
    status: "qualified",
    qualification: { budget: true, authority: true, need: true, timing: false },
  },
  {
    id: "2",
    name: "Marcus Johnson",
    email: "m.johnson@growthly.io",
    phone: "+1 (555) 234-5678",
    company: "Growthly",
    title: "Head of Sales",
    website: "https://growthly.io",
    timezone: "EST (UTC-5)",
    leadScore: 92,
    status: "meeting-booked",
    qualification: { budget: true, authority: true, need: true, timing: true },
  },
  {
    id: "3",
    name: "Emily Rodriguez",
    email: "emily@startupxyz.com",
    phone: "+1 (555) 345-6789",
    company: "StartupXYZ",
    title: "CEO",
    website: "https://startupxyz.com",
    timezone: "CST (UTC-6)",
    leadScore: 45,
    status: "new",
    qualification: { budget: false, authority: true, need: true, timing: false },
  },
  {
    id: "4",
    name: "James Park",
    email: "jpark@enterprise.co",
    phone: "+1 (555) 456-7890",
    company: "Enterprise Co",
    title: "Director of Operations",
    website: "https://enterprise.co",
    timezone: "MST (UTC-7)",
    leadScore: 68,
    status: "qualified",
    qualification: { budget: true, authority: false, need: true, timing: true },
  },
  {
    id: "5",
    name: "Lisa Wang",
    email: "lwang@innovate.tech",
    phone: "+1 (555) 567-8901",
    company: "Innovate Tech",
    title: "CMO",
    website: "https://innovate.tech",
    timezone: "PST (UTC-8)",
    leadScore: 31,
    status: "blacklisted",
    qualification: { budget: false, authority: true, need: false, timing: false },
  },
]

export const mockConversations: Conversation[] = [
  {
    id: "1",
    lead: mockLeads[0],
    platform: "email",
    classification: "meeting-requested",
    lastMessage: "Yes, I'd love to schedule a call. Does Thursday at 2pm work for you?",
    lastMessageTime: new Date(Date.now() - 1000 * 60 * 15),
    hasAiDraft: true,
    requiresAttention: true,
    messages: [
      {
        id: "m1",
        sender: "ai",
        content:
          "Hi Sarah, I noticed TechCorp has been scaling their marketing efforts. We've helped similar companies achieve 3x ROI on their outreach campaigns. Would you be open to a quick 15-minute call?",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
      },
      {
        id: "m2",
        sender: "lead",
        content:
          "Hi! Thanks for reaching out. We are indeed looking to improve our outreach strategy. Can you share more details?",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4),
      },
      {
        id: "m3",
        sender: "ai",
        content:
          "Our platform automates personalized outreach across email, LinkedIn, and SMS while maintaining a human touch. Companies like yours typically see response rates increase by 40%. I'd love to show you a quick demo.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
      },
      {
        id: "m4",
        sender: "lead",
        content: "Yes, I'd love to schedule a call. Does Thursday at 2pm work for you?",
        timestamp: new Date(Date.now() - 1000 * 60 * 15),
      },
    ],
  },
  {
    id: "2",
    lead: mockLeads[1],
    platform: "linkedin",
    classification: "meeting-requested",
    lastMessage: "Perfect, I just accepted the calendar invite. Looking forward to it!",
    lastMessageTime: new Date(Date.now() - 1000 * 60 * 45),
    hasAiDraft: false,
    requiresAttention: false,
    messages: [
      {
        id: "m1",
        sender: "ai",
        content:
          "Hey Marcus, saw your post about scaling sales teams. We've helped similar companies automate their outreach without losing the personal touch. Interested in learning more?",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48),
      },
      {
        id: "m2",
        sender: "lead",
        content: "Actually yes, we've been struggling with this exact problem. What does your solution look like?",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
      },
      {
        id: "m3",
        sender: "human",
        content:
          "Great to hear, Marcus! I'd love to show you how we can help. I'm sending over a calendar link for a quick 20-minute demo.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
      },
      {
        id: "m4",
        sender: "lead",
        content: "Perfect, I just accepted the calendar invite. Looking forward to it!",
        timestamp: new Date(Date.now() - 1000 * 60 * 45),
      },
    ],
  },
  {
    id: "3",
    lead: mockLeads[2],
    platform: "email",
    classification: "out-of-office",
    lastMessage: "I'm currently out of the office until January 15th with limited access to email.",
    lastMessageTime: new Date(Date.now() - 1000 * 60 * 60 * 3),
    hasAiDraft: true,
    requiresAttention: false,
    messages: [
      {
        id: "m1",
        sender: "ai",
        content:
          "Hi Emily, congrats on the recent funding round! Would love to chat about how we can help StartupXYZ scale your outreach efforts.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5),
      },
      {
        id: "m2",
        sender: "lead",
        content: "I'm currently out of the office until January 15th with limited access to email.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3),
      },
    ],
  },
  {
    id: "4",
    lead: mockLeads[3],
    platform: "sms",
    classification: "follow-up",
    lastMessage: "Let me check with my team and get back to you next week.",
    lastMessageTime: new Date(Date.now() - 1000 * 60 * 60 * 72),
    hasAiDraft: true,
    requiresAttention: true,
    messages: [
      {
        id: "m1",
        sender: "ai",
        content:
          "Hi James, following up on our conversation about streamlining Enterprise Co's sales operations. Any thoughts?",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 96),
      },
      {
        id: "m2",
        sender: "lead",
        content: "Let me check with my team and get back to you next week.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 72),
      },
    ],
  },
  {
    id: "5",
    lead: mockLeads[4],
    platform: "email",
    classification: "not-interested",
    lastMessage: "Thanks, but we're not looking for any new solutions at this time.",
    lastMessageTime: new Date(Date.now() - 1000 * 60 * 60 * 24),
    hasAiDraft: false,
    requiresAttention: false,
    messages: [
      {
        id: "m1",
        sender: "ai",
        content:
          "Hi Lisa, I noticed Innovate Tech has been growing rapidly. We help marketing teams like yours automate personalized outreach at scale.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48),
      },
      {
        id: "m2",
        sender: "lead",
        content: "Thanks, but we're not looking for any new solutions at this time.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
      },
    ],
  },
]

export const aiDrafts: Record<string, string> = {
  "1": "Hi Sarah,\n\nThursday at 2pm works perfectly for me! I'll send over a calendar invite shortly.\n\nLooking forward to showing you how we can help TechCorp supercharge your marketing outreach.\n\nBest,\nAlex",
  "3": "Hi Emily,\n\nThanks for letting me know! I hope you're enjoying your time off.\n\nI'll follow up after January 15th to continue our conversation about scaling StartupXYZ's outreach efforts.\n\nBest,\nAlex",
  "4": "Hi James,\n\nJust wanted to follow up on our conversation from last week. Have you had a chance to discuss with your team?\n\nI'd be happy to hop on a quick call to answer any questions they might have.\n\nBest,\nAlex",
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

export const mockFollowUpTasks: FollowUpTask[] = [
  {
    id: "ft1",
    lead: mockLeads[3],
    type: "email",
    sequenceStep: 3,
    totalSteps: 5,
    dueDate: new Date(Date.now() - 1000 * 60 * 60 * 24), // Yesterday - overdue
    suggestedMessage:
      "Hi James, just checking in on our previous conversation. Have you had a chance to discuss with your team?",
    campaignName: "Enterprise Outreach Q1",
  },
  {
    id: "ft2",
    lead: mockLeads[0],
    type: "call",
    sequenceStep: 2,
    totalSteps: 4,
    dueDate: new Date(), // Today
    suggestedMessage: "Follow-up call to confirm Thursday meeting details",
    campaignName: "Tech Leaders Campaign",
  },
  {
    id: "ft3",
    lead: mockLeads[2],
    type: "email",
    sequenceStep: 1,
    totalSteps: 5,
    dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // Next week - after OOO
    suggestedMessage: "Hi Emily, hope you had a great break! I'd love to continue our conversation about StartupXYZ.",
    campaignName: "Startup Founders Sequence",
  },
  {
    id: "ft4",
    lead: mockLeads[1],
    type: "linkedin",
    sequenceStep: 4,
    totalSteps: 4,
    dueDate: new Date(), // Today
    suggestedMessage: "Great meeting yesterday, Marcus! As discussed, here's the case study I mentioned.",
    campaignName: "Sales Leaders Nurture",
  },
  {
    id: "ft5",
    lead: {
      ...mockLeads[0],
      id: "6",
      name: "David Kim",
      email: "dkim@acme.com",
      company: "Acme Corp",
      title: "CTO",
      leadScore: 76,
    },
    type: "sms",
    sequenceStep: 2,
    totalSteps: 3,
    dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2), // 2 days from now
    suggestedMessage: "Hi David, quick follow-up on our chat. Would love to schedule a demo this week.",
    campaignName: "Tech Executives SMS",
  },
  {
    id: "ft6",
    lead: {
      ...mockLeads[0],
      id: "7",
      name: "Rachel Green",
      email: "rgreen@media.co",
      company: "Media Co",
      title: "Marketing Director",
      leadScore: 54,
    },
    type: "email",
    sequenceStep: 1,
    totalSteps: 5,
    dueDate: new Date(Date.now() - 1000 * 60 * 60 * 48), // 2 days ago - overdue
    suggestedMessage: "Hi Rachel, I came across Media Co's recent campaign and was impressed. Would love to connect.",
    campaignName: "Media & Entertainment Outreach",
  },
]

export interface AnalyticsData {
  kpis: {
    totalLeads: number
    responseRate: number
    meetingsBooked: number
    conversionRate: number
    avgResponseTime: string
    aiAccuracy: number
  }
  sentimentBreakdown: { name: string; value: number; color: string }[]
  channelPerformance: { channel: string; sent: number; responses: number; meetings: number }[]
  campaignLeaderboard: { name: string; sent: number; responses: number; meetings: number; conversionRate: number }[]
  weeklyActivity: { day: string; emails: number; calls: number; linkedin: number }[]
}

export const mockAnalytics: AnalyticsData = {
  kpis: {
    totalLeads: 1247,
    responseRate: 34.2,
    meetingsBooked: 89,
    conversionRate: 7.1,
    avgResponseTime: "2.4 hrs",
    aiAccuracy: 94.7,
  },
  sentimentBreakdown: [
    { name: "Interested", value: 42, color: "#10B981" },
    { name: "Neutral", value: 31, color: "#6B7280" },
    { name: "Not Interested", value: 18, color: "#EF4444" },
    { name: "Out of Office", value: 9, color: "#F59E0B" },
  ],
  channelPerformance: [
    { channel: "Email", sent: 2450, responses: 834, meetings: 52 },
    { channel: "LinkedIn", sent: 1120, responses: 456, meetings: 28 },
    { channel: "SMS", sent: 680, responses: 312, meetings: 9 },
  ],
  campaignLeaderboard: [
    { name: "Tech Leaders Campaign", sent: 450, responses: 178, meetings: 23, conversionRate: 5.1 },
    { name: "Enterprise Outreach Q1", sent: 380, responses: 142, meetings: 18, conversionRate: 4.7 },
    { name: "Startup Founders Sequence", sent: 520, responses: 198, meetings: 21, conversionRate: 4.0 },
    { name: "Sales Leaders Nurture", sent: 290, responses: 134, meetings: 15, conversionRate: 5.2 },
    { name: "Media & Entertainment", sent: 340, responses: 98, meetings: 8, conversionRate: 2.4 },
  ],
  weeklyActivity: [
    { day: "Mon", emails: 145, calls: 23, linkedin: 67 },
    { day: "Tue", emails: 178, calls: 31, linkedin: 82 },
    { day: "Wed", emails: 156, calls: 28, linkedin: 71 },
    { day: "Thu", emails: 189, calls: 35, linkedin: 94 },
    { day: "Fri", emails: 134, calls: 19, linkedin: 58 },
    { day: "Sat", emails: 45, calls: 0, linkedin: 23 },
    { day: "Sun", emails: 28, calls: 0, linkedin: 15 },
  ],
}
