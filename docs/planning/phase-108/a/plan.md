# Phase 108a — Outcome Labeling + Attribution Spec

## Focus
Define a rigorous, auditable way to label:
1) whether a lead “booked a meeting”, and
2) which outbound message (setter vs AI) we attribute as the most likely driver of that booking.

This subphase is the foundation for extracting a reliable dataset and avoiding misleading conclusions.

## Inputs
- Prisma schema:
  - `Lead` booking fields (`appointmentBookedAt`, `appointmentProvider`, status)
  - `Appointment` history (if needed)
  - `Message` (`direction`, `channel`, `sentAt`, `sentBy`, `sentByUserId`, `aiDraftId`)
  - `AIDraft` outcome metadata (Phase 101: disposition if available)
- Existing booking/stop-followups conventions (Phase 98) and meeting overseer gating (Phase 106 work in progress).

## Work
1. **Define “Booked Meeting” label (primary + fallback):**
   - Primary: `Lead.appointmentBookedAt != null` (or equivalent canonical field).
   - Fallbacks (explicitly ordered): confirmed appointment row, provider-specific booking identifiers, or `Lead.status == "meeting-booked"` (only if consistent).
   - Document exact precedence + edge cases (reschedules/cancellations).
2. **Define attribution strategy (start conservative):**
   - Default: attribute the **last outbound message** before `appointmentBookedAt` within a window (e.g., 14 days).
   - Exclusions: internal/system messages, messages sent after booking, and channels not relevant to the thread.
   - If multiple channels: decide whether to attribute cross-channel or only within the booking provider’s channel.
3. **Define negative cohort (“Not booked”):**
   - Leads with no booking signal AND at least one outbound message in the analysis window.
   - Add a “maturity” buffer (e.g., only count as “not booked” if last outbound was ≥ X days ago) to reduce false negatives.
4. **Define segmentation dimensions:**
   - Sender type: setter vs AI (`Message.sentBy`, `sentByUserId`, and/or `AIDraft.responseDisposition` when present).
   - Channel: email/SMS/LinkedIn.
   - Campaign mode: for email, optionally segment by `EmailCampaign.responseMode` (AI auto-send vs not).
5. **Write a single “spec checklist” for downstream phases:**
   - A one-page “Definition of Done for Dataset Rows” that lists required fields and validations.

## Output
- A written, deterministic labeling + attribution spec embedded in this plan (or linked doc):
  - “Booked” definition + precedence
  - “Attributed message” selection algorithm
  - Negative cohort rules and buffers
  - Required fields for each dataset row

## Spec (Locked)
- **Booked label (boolean):**
  - Use `isMeetingBooked(lead, workspaceSettings)` as the canonical booked boolean.
  - If `appointmentStatus === canceled`, treat as **not booked** (even if provider evidence exists).
- **Booked timestamp:**
  - Prefer `Lead.appointmentBookedAt`.
  - If booked but timestamp missing → classify as `BOOKED_NO_TIMESTAMP` and **exclude from attribution** counts.
- **Attribution window:** 14 days.
- **Attribution (cross-channel):**
  - Choose **last outbound** message (`direction="outbound"`) with `sentAt <= bookedAt` and `sentAt >= bookedAt - 14d`.
  - Workspace scoping: messages are selected only for leads in the workspace (`Lead.clientId`), regardless of `Message.source`.
- **Attribution (within-channel):**
  - For each channel (email/sms/linkedin), choose last outbound in that channel within window.
  - Report both cross-channel and within-channel metrics.
- **Negative cohort:**
  - Leads with **no booked signal** AND **at least one outbound** in the analysis window.
  - If last outbound is within the 7‑day maturity buffer (relative to `windowTo`) → `PENDING`.
  - Else → `NOT_BOOKED`.
- **Segmentation:**
  - Sender type: prefer `Message.sentBy` (`ai` | `setter`).
  - Fallback: if `sentBy` missing, infer `ai` when `aiDraftId` is present; otherwise `setter`.
  - Include `AIDraft.responseDisposition` when available to distinguish `AUTO_SENT` vs `APPROVED` vs `EDITED`.
- **Required dataset fields:**
  - `clientId`, `leadId`, `messageId`, `sentAt`, `channel`, `sentBy`, `aiDraftId`, `responseDisposition`, `outcome`, `attributionType`, `bookedAt?`.

## Handoff
Phase 108b uses this spec to implement the extractor and ensure every dataset row is reproducible and defensible.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Locked outcome labeling + attribution spec (booked boolean, windows, pending bucket, sender inference).
- Commands run:
  - `rg -n "model Message" prisma/schema.prisma` — verified message fields for attribution
- Blockers:
  - None.
- Next concrete steps:
  - Implement dataset extractor + metrics snapshot in Phase 108b.
