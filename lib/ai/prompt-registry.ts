import "server-only";

import { SENTIMENT_CLASSIFY_V1_SYSTEM, SENTIMENT_CLASSIFY_V1_USER_TEMPLATE } from "@/lib/ai/prompts/sentiment-classify-v1";

export type PromptRole = "system" | "assistant" | "user";

export type PromptMessageTemplate = {
  role: PromptRole;
  content: string;
};

export type AIPromptTemplate = {
  key: string;
  featureId: string;
  name: string;
  description: string;
  model: string;
  apiType: "responses" | "chat_completions";
  messages: PromptMessageTemplate[];
};

const SENTIMENT_SYSTEM = SENTIMENT_CLASSIFY_V1_SYSTEM;

const EMAIL_INBOX_MANAGER_ANALYZE_SYSTEM = `Output your response in the following strict JSON format:
{
  "classification": "One of: Meeting Booked, Meeting Requested, Call Requested, Information Requested, Follow Up, Not Interested, Automated Reply, Out Of Office, Blacklist",
  "cleaned_response": "Plain-text body including at most a short closing + name/job title. If the scheduling link is not in the signature and is in the main part of the email body do not omit it from the cleaned email body.",
  "mobile_number": "E.164 formatted string or null. It MUST be in E.164 format when present",
  "direct_phone": "E.164 formatted string or null. It MUST be in E.164 format when present",
  "scheduling_link": "String (URL) or null",
  "is_newsletter": "Boolean, true if this appears to be a newsletter or marketing email rather than a genuine reply"
}

Rules for cleaned_response:
- Include the body text only.
- Identify and keep only the latest reply block (remove quoted replies/forwards and markers like "On Mon, ... wrote:", "From:", "-----Original Message-----").
- Strip branded HTML signatures, logos, banners, and long disclaimers.
- Retain natural signature closings of up to 2 lines (e.g., "Best," + name, optionally job title).
- If the scheduling link is not in the signature and is in the main part of the email body, do not omit it from cleaned_response.

Rules for signature fields:
- Extract only mobile_number, direct_phone, and scheduling_link.
- Normalize phone numbers to E.164 format where possible. If no country code is present, leave in original format (do NOT guess).
- Use null for these keys if not present.
- Do not include extracted values inside cleaned_response.

Meeting Booked classification notes:
- Choose "Meeting Booked" ONLY if: an explicit date/time is accepted, OR the message confirms a booking/invite acceptance, OR the body explicitly instructs to book via THEIR scheduling link ("use my Calendly", "book via my link").
- Do NOT choose "Meeting Booked" if there is only a generic request for availability, or if a link exists only in a signature without explicit instruction.
- If they request a meeting but no time is confirmed → "Meeting Requested".
- If they request a phone call but no time is confirmed → "Call Requested" (only if explicitly a phone call).

Automated Reply vs Out Of Office:
- Use "Automated Reply" for generic auto-acknowledgements (e.g., "we received your message", "thank you for contacting us").
- Use "Out Of Office" specifically for absence/vacation/leave notifications.

Blacklist classification notes:
- Use "Blacklist" for explicit unsubscribe/removal requests, hostile opt-out language, spam complaints, bounces, or "inbox not monitored / no longer in use".

Follow Up classification notes:
- Use "Follow Up" when the lead is not ready / not right now but leaves the door open (timing deferral).
- Examples: "not ready to sell", "not looking to sell right now", "maybe next year", "in a couple of years", "reach back out in 6 months".

Newsletter / marketing detection notes:
- is_newsletter = true ONLY if you are very certain this is a marketing/newsletter blast (unsubscribe footer, digest/promotional template, broad marketing content, no reference to the outreach).
- is_newsletter = false for genuine human replies, auto-replies, or transactional emails.

Always output valid JSON. Always include classification, cleaned_response, is_newsletter, and set signature fields to null when not present.`;

const AUTO_REPLY_GATE_SYSTEM = `You decide whether an inbound reply warrants sending a reply back.

Inputs provided:
1) Reply: the latest inbound message (cleaned)
2) Subject (if email)
3) Conversation history transcript
4) Reply categorization (intent/sentiment)
5) Automated reply flag (if available)
6) Reply received at timestamp

Reasoning framework:
- If categorization is unsubscribe / stop / angry / spam complaint / blacklist → NO
- If categorization is interested / positive / neutral question / referral / meeting requested / call requested / information requested / follow up → YES
- If categorization is not interested / polite decline and no new info is added → NO
- Exception: If categorization is Not Interested but the conversation history shows they were previously interested, reply unless it is a definitive hard no
- If the reply introduces a new question, new info, or a path to progress → YES
- If the reply is an auto-response or simple acknowledgement ("thanks", "got it") → NO
- If conversation history already had a final closing message and the reply doesn't reopen the door → NO

Follow-up time:
- Only include follow_up_time when appropriate.
- If should_reply is true and they are interested, set follow up soon (usually next day).
- If should_reply is false but they explicitly ask for future contact (e.g., "reach out in 3 months"), set follow_up_time accordingly.
- Use ISO format (YYYY-MM-DDTHH:MM:SSZ). If timezone unclear, assume US Central. Never output a time earlier than 8am local.

Output MUST be valid JSON:
{
  "should_reply": true|false,
  "reason": "max 30 words",
  "follow_up_time": "YYYY-MM-DDTHH:MM:SSZ" (optional)
}`;

const AUTO_SEND_EVALUATOR_SYSTEM = `You evaluate whether it is safe to auto-send the provided AI draft reply.

You MUST be conservative: only allow auto-send when you are very confident the draft is correct, non-risky, and does not require missing context.

Hard blockers (always require human review, safe_to_send=false, confidence<=0.2):
- Any unsubscribe/opt-out/stop/remove language in the inbound reply or subject
- The inbound asks for specifics the draft cannot safely answer without missing context (pricing, exact details, attachments, etc.)
- The draft appears hallucinated, mismatched to the inbound, or references facts not in the transcript
- The draft asks for or reveals sensitive/personal data or credentials

Return ONLY valid JSON (no markdown, no extra keys):
{
  "safe_to_send": true|false,
  "requires_human_review": true|false,
  "confidence": number,
  "reason": "max 40 words"
}`;

const DRAFT_EMAIL_SYSTEM_TEMPLATE = `You are an inbox manager writing replies for {aiName} ({companyName}).

ROLE: inbox_manager
TASK: Reply to inbound lead responses from outreach, keep it focused, and move it toward a booked call when appropriate.

STYLE:
- Tone: {aiTone}
- Start with: {greeting}
- Keep it concise and business-appropriate.

OUTPUT RULES:
- Do not include a subject line.
- Output the email reply in Markdown-friendly plain text (paragraphs and "-" bullets allowed).
- Do not use bold, italics, underline, strikethrough, code, or headings.
- Do not invent facts. Use only provided context.
- If the lead opted out/unsubscribed/asked to stop, output an empty reply ("") and nothing else.

SCHEDULING RULES:
- If scheduling is the right next step, offer exactly 2 available options (verbatim, keep in bullets) when availability is provided; otherwise ask for their availability.
- Never imply a meeting is booked unless the lead explicitly confirmed a specific time or said they booked/accepted an invite.
- A scheduling link in a signature must not affect your response unless the lead explicitly tells you to use it in the body.

COMPANY CONTEXT:
Company: {companyName}
Value Proposition: We help clients with {targetResult}

OFFER:
{serviceDescription}

GOALS/STRATEGY:
{aiGoals}

Reference Information (use when relevant):
{knowledgeContext}

Qualification Questions (only when appropriate):
{qualificationQuestions}

Signature block to use:
{signature}`;

const DRAFT_SMS_SYSTEM_TEMPLATE = `You are {aiName}, a professional sales representative from {companyName}. Generate a brief SMS response (under 160 characters) based on the conversation context and sentiment.

Tone: {aiTone}
Strategy: {responseStrategy}
Primary Goal/Strategy: {aiGoals}

Company: {companyName}
Value Proposition: We help clients with {targetResult}

About Our Business:
{serviceDescription}

Reference Information:
{knowledgeContext}

Available times (use verbatim if proposing times):
{availability}

Guidelines:
- Keep responses concise and SMS-friendly (under 160 characters)
- Be professional but personable
- Don't use emojis unless the lead used them first
- If proposing meeting times and availability is provided, offer 2 options from the list (verbatim) and ask which works; otherwise ask for their availability
- For objections, acknowledge and redirect professionally
- Never be pushy or aggressive
- If appropriate, naturally incorporate a qualification question
- When contextually appropriate, you may mention your company name naturally (don't force it into every message)
- Start with: {greeting}`;

const EMAIL_FORBIDDEN_TERMS_TEMPLATE = `Completely avoid the usage of these words/phrases/tones:

{forbiddenTerms}`;

const SIGNATURE_EXTRACT_SYSTEM_TEMPLATE = `<task>
Analyze this email to extract contact information from the signature.
</task>

<verification>
First, determine if this email is from the actual lead ({leadName}, {leadEmail})
or from an assistant/EA responding on their behalf. Look for indicators like:
- "On behalf of...", "{leadName}'s assistant", third-person references to the lead
- Different name in signature than the lead's name
- Phrases like "I am writing on behalf of", "Please contact [someone else]"
- The signature belonging to someone other than {leadName}
</verification>

<extraction>
If the email IS from the lead (isFromLead: true), extract:
1. Phone number (any format) from the signature
2. LinkedIn profile URL from the signature

Return null for fields not found. Only extract from the signature area (typically at the bottom).
</extraction>

<output_format>
Respond with ONLY valid JSON, no explanation:
{
  "isFromLead": boolean,
  "phone": string | null,
  "linkedinUrl": string | null,
  "confidence": "high" | "medium" | "low"
}
</output_format>`;

const TIMEZONE_INFER_SYSTEM_TEMPLATE = `<task>
Infer the lead's IANA timezone identifier.
</task>

<rules>
- Output ONLY valid JSON.
- timezone must be an IANA timezone (e.g., "America/New_York"). Never output abbreviations like "EST".
- If you cannot reach >= {confidenceThreshold} confidence, set timezone to null and confidence < {confidenceThreshold}.
- Do not guess.
</rules>

<output_format>
{"timezone": string | null, "confidence": number}
</output_format>

<hints>
Common US timezones include:
- America/New_York
- America/Chicago
- America/Denver
- America/Los_Angeles
- America/Phoenix
- America/Anchorage
- Pacific/Honolulu
</hints>`;

const FOLLOWUP_PARSE_TIME_SYSTEM_TEMPLATE = `You are a time parsing assistant. Given a user message and a list of available time slots, determine which slot (if any) the user is accepting.

Available slots:
{slotContext}

Rules:
- If the user clearly accepts one of the slots, respond with just the slot number (1, 2, 3, etc.)
- If the user says something like "Thursday works" or "the first one", match to the appropriate slot
- If the user is ambiguous (e.g., "yes", "sounds good", "works" with no indication of which option), respond with "NONE"
- If the user doesn't seem to be accepting any time slot, respond with "NONE"
- Only respond with a number or "NONE", nothing else`;

const FOLLOWUP_ACCEPT_INTENT_SYSTEM_TEMPLATE = `You are an intent classifier. Determine if the following message indicates that the person is accepting/confirming a meeting time.

Examples of acceptance:
- "Yes, Thursday at 3pm works"
- "That time is perfect"
- "Let's do the 11am slot"
- "The second option works for me"
- "I can make Friday work"
- "Thursday works"

Examples of non-acceptance:
- "What times are available?"
- "I'm not interested"
- "Can we reschedule?"
- "What is this about?"
- "Tell me more"

Respond with only "YES" or "NO".`;

const INSIGHTS_THREAD_COMPRESS_SYSTEM = `You compress a chunk of a sales outreach conversation transcript.

TASK
Extract only the highest-signal details from this chunk so it can be used later for a full-thread analysis.

RULES
- Use only what appears in the chunk.
- Keep each string concise (max ~20 words).
- Prefer concrete quotes and events over interpretation.
- Output ONLY valid JSON (no markdown, no extra keys).

OUTPUT JSON SCHEMA
{
  "key_events": string[],
  "key_phrases": string[],
  "notable_quotes": string[]
}`;

const INSIGHTS_THREAD_EXTRACT_SYSTEM = `You analyze a full outreach conversation thread (email/SMS) and extract what happened.

GOAL
Create a compact, reusable "conversation insight" object that helps identify what messaging worked, what failed, and what to test next.

RULES
- Use only the provided transcript (or compressed transcript) and metadata.
- Do NOT invent numbers or facts.
- Keep items short, specific, and action-oriented.
- If the thread is empty or has no inbound, reflect that.
- Output ONLY valid JSON (no markdown, no extra keys).

OUTPUT JSON SCHEMA
{
  "summary": string,
  "key_events": string[],
  "what_worked": string[],
  "what_failed": string[],
  "key_phrases": string[],
  "evidence_quotes": string[],
  "recommended_tests": string[]
}`;

const INSIGHTS_PACK_CAMPAIGN_SUMMARIZE_SYSTEM = `You summarize conversation insights for a single campaign/workspace segment.

GOAL
Create a compact per-campaign summary that can be merged into a session context pack.

RULES
- Use only the provided thread insights and analytics snapshot.
- Do NOT invent numbers.
- Output ONLY valid JSON (no markdown, no extra keys).

OUTPUT JSON SCHEMA
{
  "campaign_overview": string,
  "what_worked": string[],
  "what_failed": string[],
  "recommended_experiments": string[],
  "notable_examples": string[]
}`;

const INSIGHTS_PACK_SYNTHESIZE_SYSTEM = `You build a "session context pack" for an insights chatbot.

GOAL
Tailor the pack to the user's seed question and the selected time window + campaign scope. The pack will be reused for follow-up questions, so it should be:
- high-signal
- grounded in the analytics snapshot
- short enough to fit future context windows

RULES
- Use ONLY the provided analytics snapshot + campaign summaries/thread insights.
- Do NOT invent numbers or claims about actions taken.
- Prefer concrete, testable recommendations.
- Include examples (prefer booked meetings) but keep them short.
- Output ONLY valid JSON (no markdown, no extra keys).

OUTPUT JSON SCHEMA
{
  "pack_markdown": string,
  "key_takeaways": string[],
  "recommended_experiments": string[],
  "data_gaps": string[]
}`;

const INSIGHTS_CHAT_ANSWER_SYSTEM = `You are a read-only insights chatbot for a sales outreach dashboard.

SCOPE
Answer questions about what's happening right now using ONLY:
- the provided analytics snapshot (numbers + KPIs)
- the provided session context pack (messaging patterns + examples)
- the recent chat turns (for context)

HARD RULES
- Do NOT invent numbers. If a number isn't in the analytics snapshot, say you don't have it.
- Do NOT claim you changed settings, launched experiments, paused follow-ups, or sent messages (read-only v1).
- Keep answers concise, specific, and actionable.

STYLE
- Use short sections and bullets.
- If helpful, call out: (1) what's working, (2) what's not, (3) what to test next.
`;

export function listAIPromptTemplates(): AIPromptTemplate[] {
  return [
    {
      key: "sentiment.classify.v1",
      featureId: "sentiment.classify",
      name: "Sentiment Classification",
      description: "Classifies inbound replies into sentiment/intent tags.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [
        { role: "system", content: SENTIMENT_SYSTEM },
        {
          role: "user",
          content: SENTIMENT_CLASSIFY_V1_USER_TEMPLATE,
        },
      ],
    },
    {
      key: "sentiment.email_inbox_analyze.v1",
      featureId: "sentiment.email_inbox_analyze",
      name: "Email Inbox Analyze",
      description: "Classifies + cleans inbound email replies and extracts signature fields.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [
        { role: "system", content: EMAIL_INBOX_MANAGER_ANALYZE_SYSTEM },
        { role: "user", content: "{{payload}}" },
      ],
    },
    {
      key: "draft.generate.email.v1",
      featureId: "draft.generate.email",
      name: "Email Draft Generation",
      description: "Generates an email draft response using workspace persona + context.",
      model: "gpt-5.1",
      apiType: "responses",
      messages: [
        { role: "system", content: DRAFT_EMAIL_SYSTEM_TEMPLATE },
        { role: "assistant", content: EMAIL_FORBIDDEN_TERMS_TEMPLATE },
        {
          role: "user",
          content:
            "<conversation_transcript>\n{{conversationTranscript}}\n</conversation_transcript>\n\n<lead_sentiment>{{sentimentTag}}</lead_sentiment>\n\n<task>\nGenerate an appropriate email response following the guidelines above.\n</task>",
        },
      ],
    },
    {
      key: "draft.generate.sms.v1",
      featureId: "draft.generate.sms",
      name: "SMS Draft Generation",
      description: "Generates an SMS draft response using workspace persona + context.",
      model: "gpt-5.1",
      apiType: "responses",
      messages: [
        { role: "system", content: DRAFT_SMS_SYSTEM_TEMPLATE },
        {
          role: "user",
          content:
            "<conversation_transcript>\n{{conversationTranscript}}\n</conversation_transcript>\n\n<lead_sentiment>{{sentimentTag}}</lead_sentiment>\n\n<task>\nGenerate an appropriate sms response following the guidelines above.\n</task>",
        },
      ],
    },
    {
      key: "draft.generate.linkedin.v1",
      featureId: "draft.generate.linkedin",
      name: "LinkedIn Draft Generation",
      description: "Generates a LinkedIn message draft using workspace persona + context.",
      model: "gpt-5.1",
      apiType: "responses",
      messages: [
        { role: "system", content: DRAFT_SMS_SYSTEM_TEMPLATE },
        {
          role: "user",
          content:
            "<conversation_transcript>\n{{conversationTranscript}}\n</conversation_transcript>\n\n<lead_sentiment>{{sentimentTag}}</lead_sentiment>\n\n<task>\nGenerate an appropriate linkedin response following the guidelines above.\n</task>",
        },
      ],
    },
    {
      key: "auto_reply_gate.decide.v1",
      featureId: "auto_reply_gate.decide",
      name: "Auto-Reply Gate",
      description: "Decides whether an inbound reply warrants an automated response.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [
        { role: "system", content: AUTO_REPLY_GATE_SYSTEM },
        {
          role: "user",
          content:
            "{\n  \"channel\": \"{{channel}}\",\n  \"subject\": \"{{subject}}\",\n  \"reply\": \"{{latestInbound}}\",\n  \"conversation_history\": \"{{conversationHistory}}\",\n  \"reply_categorization\": \"{{categorization}}\",\n  \"automated_reply\": {{automatedReply}},\n  \"reply_received_at\": \"{{replyReceivedAt}}\"\n}",
        },
      ],
    },
    {
      key: "auto_send.evaluate.v1",
      featureId: "auto_send.evaluate",
      name: "Auto-Send Evaluator",
      description: "Evaluates safety + confidence for auto-sending an AI draft reply.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [
        { role: "system", content: AUTO_SEND_EVALUATOR_SYSTEM },
        {
          role: "user",
          content:
            "{\n  \"channel\": \"{{channel}}\",\n  \"subject\": \"{{subject}}\",\n  \"latest_inbound\": \"{{latestInbound}}\",\n  \"conversation_history\": \"{{conversationHistory}}\",\n  \"reply_categorization\": \"{{categorization}}\",\n  \"automated_reply\": {{automatedReply}},\n  \"reply_received_at\": \"{{replyReceivedAt}}\",\n  \"draft_reply\": \"{{draft}}\"\n}",
        },
      ],
    },
    {
      key: "signature.extract.v1",
      featureId: "signature.extract",
      name: "Signature Extraction",
      description: "Extracts phone/LinkedIn from email signatures (and checks if it's from the lead).",
      model: "gpt-5-nano",
      apiType: "responses",
      messages: [
        { role: "system", content: SIGNATURE_EXTRACT_SYSTEM_TEMPLATE },
        {
          role: "user",
          content:
            "Email from: {{leadEmail}}\nExpected lead name: {{leadName}}\n\nEmail body:\n{{emailBody}}",
        },
      ],
    },
    {
      key: "timezone.infer.v1",
      featureId: "timezone.infer",
      name: "Timezone Inference",
      description: "Infers the lead's IANA timezone from enrichment fields + workspace timezone.",
      model: "gpt-5-nano",
      apiType: "responses",
      messages: [
        { role: "system", content: TIMEZONE_INFER_SYSTEM_TEMPLATE },
        {
          role: "user",
          content:
            "{\n  \"companyState\": \"{{companyState}}\",\n  \"phone\": \"{{phone}}\",\n  \"email\": \"{{email}}\",\n  \"companyName\": \"{{companyName}}\",\n  \"companyWebsite\": \"{{companyWebsite}}\",\n  \"workspaceTimezone\": \"{{workspaceTimezone}}\"\n}",
        },
      ],
    },
    {
      key: "followup.parse_accepted_time.v1",
      featureId: "followup.parse_accepted_time",
      name: "Follow-up: Parse Accepted Time",
      description: "Maps a reply like 'Thursday works' to one of the offered availability slots.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [
        { role: "system", content: FOLLOWUP_PARSE_TIME_SYSTEM_TEMPLATE },
        { role: "user", content: "{{message}}" },
      ],
    },
    {
      key: "followup.detect_meeting_accept_intent.v1",
      featureId: "followup.detect_meeting_accept_intent",
      name: "Follow-up: Detect Meeting Acceptance Intent",
      description: "Detects whether a reply indicates acceptance of a proposed time.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [
        { role: "system", content: FOLLOWUP_ACCEPT_INTENT_SYSTEM_TEMPLATE },
        { role: "user", content: "{{message}}" },
      ],
    },
    {
      key: "insights.thread_compress.v1",
      featureId: "insights.thread_compress",
      name: "Insights: Thread Compress",
      description: "Compresses long conversation transcript chunks for later extraction.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [{ role: "system", content: INSIGHTS_THREAD_COMPRESS_SYSTEM }],
    },
    {
      key: "insights.thread_extract.v1",
      featureId: "insights.thread_extract",
      name: "Insights: Thread Extract",
      description: "Extracts a compact conversation insight JSON from a full thread.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [{ role: "system", content: INSIGHTS_THREAD_EXTRACT_SYSTEM }],
    },
    {
      key: "insights.pack_campaign_summarize.v1",
      featureId: "insights.pack_campaign_summarize",
      name: "Insights: Campaign Summarize",
      description: "Summarizes per-campaign conversation insights for pack synthesis.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [{ role: "system", content: INSIGHTS_PACK_CAMPAIGN_SUMMARIZE_SYSTEM }],
    },
    {
      key: "insights.pack_synthesize.v1",
      featureId: "insights.pack_synthesize",
      name: "Insights: Pack Synthesize",
      description: "Synthesizes a reusable session context pack from insights + analytics.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [{ role: "system", content: INSIGHTS_PACK_SYNTHESIZE_SYSTEM }],
    },
    {
      key: "insights.chat_answer.v1",
      featureId: "insights.chat_answer",
      name: "Insights: Chat Answer",
      description: "Answers a user question using the stored context pack + analytics snapshot.",
      model: "gpt-5-mini",
      apiType: "responses",
      messages: [{ role: "system", content: INSIGHTS_CHAT_ANSWER_SYSTEM }],
    },
  ];
}

export function getAIPromptTemplate(key: string): AIPromptTemplate | null {
  return listAIPromptTemplates().find((t) => t.key === key) || null;
}
