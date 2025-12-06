#!/usr/bin/env npx ts-node
/**
 * Test script for EmailBison webhook ingestion
 * 
 * Usage:
 *   npx ts-node scripts/test-email-webhook.ts
 * 
 * This script simulates an EmailBison LEAD_REPLIED webhook to verify the
 * webhook handler is working correctly.
 */

const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://localhost:3000/api/webhooks/email";

// Sample payload matching the user's test email
const samplePayload = {
  event: {
    type: "LEAD_REPLIED",
    name: "Lead Replied",
    instance_url: "https://send.meetinboxxia.com",
    workspace_id: 12345, // This should match the emailBisonWorkspaceId in your Client record
    workspace_name: "Test Workspace",
  },
  data: {
    campaign: {
      id: 1,
      name: "Test Campaign",
    },
    lead: {
      id: 100,
      email: "ar@soramedia.co",
      first_name: "Abdur",
      last_name: "Sajid",
      status: "active",
    },
    reply: {
      id: 999,
      uuid: "test-uuid-123",
      email_subject: "testing dashboard",
      from_email_address: "ar@soramedia.co",
      from_name: "Abdur Sajid",
      to: [{ address: "aaron.ennis@meetcompletefinanciallabs.cfd", name: null }],
      cc: [],
      bcc: [],
      html_body: "<p>hey</p>",
      text_body: "hey",
      date_received: "2025-12-06T16:13:10.000Z",
      created_at: "2025-12-06T16:13:10.000Z",
      automated_reply: false,
      interested: false,
      type: "reply",
      folder: "inbox",
    },
    sender_email: {
      id: 50,
      email: "aaron.ennis@meetcompletefinanciallabs.cfd",
      name: "Aaron Ennis",
    },
  },
};

async function testWebhook() {
  console.log("🧪 Testing EmailBison Webhook");
  console.log(`📡 URL: ${WEBHOOK_URL}`);
  console.log(`📦 Event Type: ${samplePayload.event.type}`);
  console.log(`🏢 Workspace ID: ${samplePayload.event.workspace_id}`);
  console.log(`📧 From: ${samplePayload.data.reply?.from_email_address}`);
  console.log("");

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(samplePayload),
    });

    const status = response.status;
    const body = await response.json();

    console.log(`📊 Response Status: ${status}`);
    console.log(`📋 Response Body:`, JSON.stringify(body, null, 2));

    if (status === 200 && body.success) {
      console.log("\n✅ Webhook test PASSED!");
      if (body.leadId) {
        console.log(`   Lead ID: ${body.leadId}`);
      }
      if (body.sentimentTag) {
        console.log(`   Sentiment: ${body.sentimentTag}`);
      }
      if (body.draftId) {
        console.log(`   AI Draft ID: ${body.draftId}`);
      }
    } else if (status === 404) {
      console.log("\n❌ Webhook test FAILED: Client not found");
      console.log("   → Make sure emailBisonWorkspaceId is set in your Client record");
      console.log(`   → Expected workspace_id: ${samplePayload.event.workspace_id}`);
    } else {
      console.log(`\n⚠️  Webhook returned status ${status}`);
      console.log(`   Error: ${body.error || "Unknown"}`);
    }
  } catch (error) {
    console.error("\n❌ Request failed:", error);
    console.log("   → Is the server running at " + WEBHOOK_URL + "?");
  }
}

testWebhook();

