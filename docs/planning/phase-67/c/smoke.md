# Phase 67c — Smoke Test Checklist

## Prerequisites

- [ ] Deploy Phase 67 changes to staging/preview
- [ ] Verify no build errors in Vercel dashboard
- [ ] Confirm `AUTO_SEND_DISABLED` is NOT set (or is `0`)

---

## 1. AI Auto-Send Tests

### 1.1 Kill-Switch Verification
- [ ] **Test global disable**: Set `AUTO_SEND_DISABLED=1` in Vercel env vars
- [ ] Trigger an inbound email that would normally auto-send
- [ ] Verify log shows: `[AutoSend] Complete ... reason: globally_disabled_via_env`
- [ ] Remove/unset `AUTO_SEND_DISABLED` and redeploy

### 1.2 AI Campaign Auto-Send (Safe Path)
- [ ] Lead in AI campaign (`responseMode: AI_AUTO_SEND`)
- [ ] Inbound reply with "Interested" or "Meeting Requested" sentiment
- [ ] Verify:
  - [ ] Draft generated (`AIDraft` record created)
  - [ ] AI evaluator runs (`AIInteraction` with `auto_send_evaluator`)
  - [ ] If confidence ≥ threshold: auto-sent immediately or delayed based on config
  - [ ] Log shows: `[Post-Process] Auto-send approved for draft ...`

### 1.3 AI Campaign Auto-Send (Needs Review Path)
- [ ] Lead in AI campaign with ambiguous inbound (low confidence expected)
- [ ] Verify:
  - [ ] Draft generated
  - [ ] Confidence below threshold triggers `needs_review`
  - [ ] Slack DM sent to reviewer (`jon@zeroriskgrowth.com`)
  - [ ] Log shows: `[Post-Process] Auto-send blocked: ...`

### 1.4 Legacy Auto-Reply Path
- [ ] Lead NOT in AI campaign but has `autoReplyEnabled: true`
- [ ] Inbound reply
- [ ] Verify legacy gate evaluates and either sends or skips with appropriate reason

---

## 2. Auto-Booking Tests

### 2.1 Offered Slot Acceptance (With Questions)
- [ ] Lead has all required qualification answers
- [ ] AI draft offers specific slot(s) from availability cache
- [ ] Lead replies accepting an offered slot
- [ ] Verify:
  - [ ] `availabilitySource` matches what was offered
  - [ ] Booking uses `with_questions` target (questions-enabled calendar)
  - [ ] Appointment created with correct event type

### 2.2 Offered Slot Acceptance (No Questions)
- [ ] Lead is missing required qualification answers
- [ ] AI draft offers slot(s)
- [ ] Lead replies accepting an offered slot
- [ ] Verify:
  - [ ] Booking uses `no_questions` target (direct-book calendar)
  - [ ] Log shows: `determineDeterministicBookingTarget` returned `no_questions`

### 2.3 Proposed Time (Not Offered)
- [ ] Lead proposes a time that wasn't in the offered slots
- [ ] Verify:
  - [ ] System checks if proposed time matches exact availability
  - [ ] If match with confidence ≥ 0.9 → books
  - [ ] If no match or low confidence → creates "Schedule Call" task instead

### 2.4 Booking Target Selector Fallback
- [ ] Workspace with OPENAI_API_KEY not configured (or set timeout very low)
- [ ] Trigger booking target selection
- [ ] Verify deterministic fallback is used (`source: deterministic_fallback`)

---

## 3. Error Log Verification

After running smoke tests, check Vercel logs for 24 hours:

- [ ] Zero hits for: `Post-process error: hit max_output_tokens` at error level
- [ ] Zero hits for: `Missing phone number` at error level
- [ ] Zero hits for: `Invalid country calling code` at error level
- [ ] Zero hits for: `DND is active for SMS` at error level
- [ ] Zero hits for: `Maximum call stack size exceeded` at error level

Note: `refresh_token_not_found` may still appear (logged by Supabase library, not our code).

---

## Sign-Off

| Test Category | Passed | Notes |
|---------------|--------|-------|
| Kill-Switch | ☐ | |
| AI Auto-Send (Safe) | ☐ | |
| AI Auto-Send (Review) | ☐ | |
| Legacy Auto-Reply | ☐ | |
| Booking With Questions | ☐ | |
| Booking No Questions | ☐ | |
| Proposed Time | ☐ | |
| Deterministic Fallback | ☐ | |
| Error Log Clean | ☐ | |

**Reviewer:** _________________
**Date:** _________________
