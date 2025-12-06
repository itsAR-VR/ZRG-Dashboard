/**
 * Slack Notification Utilities
 * 
 * Sends notifications to Slack via webhook
 */

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
}

interface SlackNotificationParams {
  text: string;
  blocks?: SlackBlock[];
}

/**
 * Send a notification to Slack via webhook
 */
export async function sendSlackNotification(params: SlackNotificationParams): Promise<boolean> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.log("Slack webhook URL not configured, skipping notification");
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      console.error("Slack notification failed:", await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to send Slack notification:", error);
    return false;
  }
}

/**
 * Send a meeting booked notification to Slack
 */
export async function sendMeetingBookedNotification(
  leadName: string,
  workspaceName: string,
  meetingTime: string,
  isAutoBooked: boolean = false
): Promise<boolean> {
  return sendSlackNotification({
    text: `${isAutoBooked ? "🤖 Auto-Booked" : "🗓️"} Meeting: ${leadName}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: isAutoBooked ? "🤖 Meeting Auto-Booked" : "🗓️ Meeting Booked",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Lead:*\n${leadName}`,
          },
          {
            type: "mrkdwn",
            text: `*Workspace:*\n${workspaceName}`,
          },
          {
            type: "mrkdwn",
            text: `*Time:*\n${meetingTime}`,
          },
          {
            type: "mrkdwn",
            text: `*Method:*\n${isAutoBooked ? "Automatic" : "Manual"}`,
          },
        ],
      },
    ],
  });
}

