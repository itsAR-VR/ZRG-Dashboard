# Founders Club — Persona-Routed Follow-Up Workflows (Chris + Aaron)

## Goal
Ensure follow-up workflows auto-start on the **first manual email reply** and route to the correct persona-specific sequence:
- Chris campaigns → Chris workflow
- Aaron campaigns → Aaron workflow

## Configuration Steps (UI)
1. **AI Personas**
   - Go to **Settings → AI Personality**.
   - Ensure personas exist for **Chris** and **Aaron**.
   - Each persona must have:
     - **Persona display name** (for `{senderName}`)
     - **Email signature** (for `{signature}`)

2. **Campaign Assignment**
   - Go to **Settings → Booking → Campaign Assignment**.
   - Assign the correct persona to each EmailBison campaign:
     - Example: “General Founders Club - Aaron” → Aaron persona

3. **Follow-Up Sequences**
   - Go to **Settings → Follow-Ups**.
   - Create two sequences:
     - **FC Workflow — Chris**
       - Trigger: **On first manual email reply**
       - AI Persona: **Chris**
     - **FC Workflow — Aaron**
       - Trigger: **On first manual email reply**
       - AI Persona: **Aaron**
   - Include `{senderName}` and `{signature}` in templates where appropriate.
   - Activate both sequences.

## Verification Checklist
1. Pick a lead in a **Chris**-assigned campaign.
2. Send a **manual email reply** from the dashboard.
3. Confirm a **FollowUpInstance** starts for **FC Workflow — Chris**.
4. Repeat with an **Aaron**-assigned campaign and confirm the Aaron workflow starts.

## Troubleshooting
- **No workflow starts**
  - Confirm the sequence is **active** and trigger is **On first manual email reply**.
  - Confirm the lead is in an EmailBison campaign with a persona assigned.
  - Check logs for `[FollowUp] Auto-start routing` entries.

- **Workflow started but follow-ups are blocked**
  - If templates reference `{signature}`, ensure the selected persona has a signature.
  - If templates reference `{senderName}`, ensure persona display name is set.

- **Legacy fallback**
  - If **no** `setter_reply` sequences are active, the system falls back to legacy Meeting Requested / ZRG Workflow V1 sequences (by name).

