/**
 * Slack Interactions Webhook Handler
 *
 * This endpoint handles interactive component actions from Slack (button clicks, etc.).
 * It verifies the request signature using SLACK_SIGNING_SECRET and processes actions.
 *
 * Phase 70: Add "Approve & Send" button for AI auto-send review notifications.
 *
 * Required env vars:
 *   SLACK_SIGNING_SECRET - From Slack App > Basic Information > Signing Secret
 *
 * Slack App Configuration:
 *   1. Enable Interactivity & Shortcuts
 *   2. Set Request URL: https://your-domain.vercel.app/api/webhooks/slack/interactions
 */

import { type NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { updateSlackMessageWithToken, type SlackBlock } from "@/lib/slack-dm";
import { sendEmailReplyForDraftSystem } from "@/lib/email-send";

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "";

/**
 * Verify the request signature from Slack.
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
function verifySlackSignature(opts: {
  signature: string;
  timestamp: string;
  body: string;
}): boolean {
  if (!SLACK_SIGNING_SECRET) {
    console.warn("[SlackInteractions] SLACK_SIGNING_SECRET not configured");
    return false;
  }

  const { signature, timestamp, body } = opts;

  // Check timestamp is recent (within 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (Math.abs(currentTime - requestTime) > 300) {
    console.warn("[SlackInteractions] Request timestamp too old", { currentTime, requestTime });
    return false;
  }

  // Compute expected signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const expectedSignature =
    "v0=" +
    crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(sigBasestring, "utf8").digest("hex");

  // Constant-time comparison
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (signatureBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(signatureBuf, expectedBuf);
}

type SlackInteractionPayload = {
  type: string;
  user?: { id?: string; username?: string; name?: string };
  actions?: Array<{
    action_id: string;
    block_id: string;
    value?: string;
    type: string;
  }>;
  response_url?: string;
  channel?: { id: string };
  message?: { ts: string };
};

type ApproveButtonValue = {
  draftId: string;
  leadId: string;
  clientId: string;
};

/**
 * Handle the "Approve & Send" button action.
 */
async function handleApproveSend(params: {
  value: ApproveButtonValue;
  channelId: string;
  messageTs: string;
  userName: string;
}): Promise<{ success: boolean; error?: string }> {
  const { value, channelId, messageTs, userName } = params;

  // 1. Validate draft exists and is pending
  const draft = await prisma.aIDraft.findUnique({
    where: { id: value.draftId },
    select: {
      id: true,
      status: true,
      content: true,
      channel: true,
      lead: {
        select: {
          id: true,
          status: true,
          sentimentTag: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  if (!draft) {
    return { success: false, error: "Draft not found" };
  }

  const slackToken = await prisma.client.findUnique({
    where: { id: value.clientId },
    select: { slackBotToken: true },
  });
  const slackTokenValue = (slackToken?.slackBotToken || "").trim();
  const updateSlackMessageSafe = async (opts: {
    channelId: string;
    messageTs: string;
    text: string;
    blocks?: SlackBlock[];
  }) => {
    if (!slackTokenValue) {
      console.warn("[SlackInteractions] Slack bot token not configured for client", value.clientId);
      return;
    }
    const result = await updateSlackMessageWithToken({
      token: slackTokenValue,
      channelId: opts.channelId,
      messageTs: opts.messageTs,
      text: opts.text,
      blocks: opts.blocks,
    });
    if (!result.success) {
      console.warn("[SlackInteractions] Failed to update Slack message", result.error);
    }
  };

  if (draft.status !== "pending") {
    // Update Slack message to show already processed
    await updateSlackMessageSafe({
      channelId,
      messageTs,
      text: `This draft has already been ${draft.status}.`,
      blocks: buildCompletedBlocks({
        status: draft.status === "approved" ? "already_sent" : "already_processed",
        draftStatus: draft.status,
        userName,
      }),
    });
    return { success: false, error: `Draft is already ${draft.status}` };
  }

  if (draft.channel !== "email") {
    return { success: false, error: "Only email drafts can be approved via Slack" };
  }

  // 2. Check lead not blacklisted
  const lead = draft.lead;
  if (lead.status === "blacklisted" || lead.sentimentTag === "Blacklist") {
    await updateSlackMessageSafe({
      channelId,
      messageTs,
      text: "Cannot send - lead is blacklisted (opted out).",
      blocks: buildCompletedBlocks({
        status: "blocked",
        reason: "Lead is blacklisted (opted out)",
        userName,
      }),
    });
    return { success: false, error: "Lead is blacklisted" };
  }

  // 3. Send the email
  // Slack approval is human-in-the-loop, so attribute this send as a human ("setter") send.
  const sendResult = await sendEmailReplyForDraftSystem(value.draftId, undefined, { sentBy: "setter" });

  if (!sendResult.success) {
    await updateSlackMessageSafe({
      channelId,
      messageTs,
      text: `Failed to send: ${sendResult.error}`,
      blocks: buildCompletedBlocks({
        status: "error",
        reason: sendResult.error || "Unknown error",
        userName,
      }),
    });
    return { success: false, error: sendResult.error };
  }

  // 4. Update Slack message to show success
  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
  await updateSlackMessageSafe({
    channelId,
    messageTs,
    text: `Email sent to ${leadName} (${lead.email}) by ${userName}`,
    blocks: buildCompletedBlocks({
      status: "sent",
      leadName,
      leadEmail: lead.email || undefined,
      userName,
    }),
  });

  console.log("[SlackInteractions] Email approved and sent", {
    draftId: value.draftId,
    leadId: value.leadId,
    messageId: sendResult.messageId,
    approvedBy: userName,
  });

  return { success: true };
}

/**
 * Build the updated message blocks after an action is completed.
 */
function buildCompletedBlocks(opts: {
  status: "sent" | "already_sent" | "already_processed" | "blocked" | "error";
  leadName?: string;
  leadEmail?: string;
  draftStatus?: string;
  reason?: string;
  userName: string;
}): SlackBlock[] {
  const timestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  switch (opts.status) {
    case "sent":
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Email Sent*\n${opts.leadName} (${opts.leadEmail})\n\n_Approved by ${opts.userName} at ${timestamp}_`,
          },
        },
      ];
    case "already_sent":
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Already Sent*\nThis email was already sent.\n\n_Checked by ${opts.userName} at ${timestamp}_`,
          },
        },
      ];
    case "already_processed":
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Already Processed*\nThis draft has been ${opts.draftStatus}.\n\n_Checked by ${opts.userName} at ${timestamp}_`,
          },
        },
      ];
    case "blocked":
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Blocked*\n${opts.reason}\n\n_Action attempted by ${opts.userName} at ${timestamp}_`,
          },
        },
      ];
    case "error":
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Error*\n${opts.reason}\n\n_Action attempted by ${opts.userName} at ${timestamp}_`,
          },
        },
      ];
  }
}

export async function POST(request: NextRequest) {
  try {
    // Read the raw body for signature verification
    const rawBody = await request.text();

    // Get headers for signature verification
    const signature = request.headers.get("x-slack-signature") || "";
    const timestamp = request.headers.get("x-slack-request-timestamp") || "";

    // Verify signature
    if (!verifySlackSignature({ signature, timestamp, body: rawBody })) {
      console.warn("[SlackInteractions] Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse the URL-encoded payload
    const params = new URLSearchParams(rawBody);
    const payloadStr = params.get("payload");
    if (!payloadStr) {
      console.warn("[SlackInteractions] Missing payload");
      return NextResponse.json({ error: "Missing payload" }, { status: 400 });
    }

    const payload = JSON.parse(payloadStr) as SlackInteractionPayload;

    // Handle URL verification (Slack sends this during setup)
    if (payload.type === "url_verification") {
      return NextResponse.json({ challenge: (payload as any).challenge });
    }

    // Handle interactive message actions
    if (payload.type === "block_actions") {
      const actions = payload.actions || [];
      const channelId = payload.channel?.id || "";
      const messageTs = payload.message?.ts || "";
      const userName = payload.user?.name || payload.user?.username || "Unknown";

      for (const action of actions) {
        // Handle "Approve & Send" button
        if (action.action_id === "approve_send" && action.value) {
          try {
            const value = JSON.parse(action.value) as ApproveButtonValue;
            const result = await handleApproveSend({
              value,
              channelId,
              messageTs,
              userName,
            });

            if (!result.success) {
              console.warn("[SlackInteractions] Approve action failed", {
                error: result.error,
                draftId: value.draftId,
              });
            }
          } catch (parseError) {
            console.error("[SlackInteractions] Failed to parse action value", parseError);
          }
        }

        // "View in Dashboard" is a URL button, no server action needed
      }
    }

    // Acknowledge the request
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[SlackInteractions] Webhook error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
