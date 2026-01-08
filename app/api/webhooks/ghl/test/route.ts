import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Test endpoint to simulate a GHL inbound SMS webhook
 * POST /api/webhooks/ghl/test
 * 
 * This endpoint allows you to test the webhook flow without needing
 * an actual GHL workflow to fire.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Get the locationId - either from body or fetch first client
    let locationId = body.locationId;
    
    if (!locationId) {
      // Try to get the first registered client
      const firstClient = await prisma.client.findFirst({
        orderBy: { createdAt: "desc" },
      });
      
      if (!firstClient) {
        return NextResponse.json({
          error: "No clients registered. Please add a GHL workspace in Settings first.",
        }, { status: 400 });
      }
      
      locationId = firstClient.ghlLocationId;
    }
    
    const incomingCustomData =
      body.customData && typeof body.customData === "object" ? (body.customData as Record<string, unknown>) : null;

    // Build a test payload matching GHL webhook structure
    const testPayload = {
      contact_id: body.contactId || `test_contact_${Date.now()}`,
      first_name: body.firstName || "Test",
      last_name: body.lastName || "User",
      full_name: body.fullName || `${body.firstName || "Test"} ${body.lastName || "User"}`,
      email: body.email || "test@example.com",
      phone: body.phone || "+15551234567",
      tags: "",
      country: "US",
      date_created: new Date().toISOString(),
      full_address: "",
      contact_type: "lead",
      location: {
        name: "Test Location",
        id: locationId,
      },
      message: {
        type: 2,
        body: body.message || "This is a test message",
      },
      workflow: {
        id: "test-workflow",
        name: "Test Workflow",
      },
      customData: {
        ID: body.contactId || `test_contact_${Date.now()}`,
        "Phone Number": body.phone || "+15551234567",
        "First Name": body.firstName || "Test",
        "Last Name": body.lastName || "User",
        Email: body.email || "test@example.com",
        Message: body.message || "This is a test message",
        ...(incomingCustomData || {}),
        Client: body.client || body.Client || "demo-subclient",
        Date: new Date().toLocaleDateString(),
        Time: new Date().toLocaleTimeString(),
      },
    };

    // Get the base URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
      `${request.headers.get("x-forwarded-proto") || "https"}://${request.headers.get("host")}`;
    
    // Forward to the actual webhook endpoint
    const webhookUrl = `${baseUrl}/api/webhooks/ghl/sms`;
    
    console.log(`Testing webhook at: ${webhookUrl}`);
    console.log(`Test payload:`, JSON.stringify(testPayload, null, 2));
    
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testPayload),
    });

    const result = await response.json();

    return NextResponse.json({
      success: response.ok,
      testPayload,
      webhookResponse: result,
      webhookStatus: response.status,
    });
  } catch (error) {
    console.error("Test webhook error:", error);
    return NextResponse.json(
      {
        error: "Test failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET handler - show test instructions
 */
export async function GET() {
  // Get registered clients for reference
  const clients = await prisma.client.findMany({
    select: {
      id: true,
      name: true,
      ghlLocationId: true,
    },
  });

  return NextResponse.json({
    message: "GHL Webhook Test Endpoint",
    instructions: "Send a POST request with optional fields to simulate a GHL webhook",
    registeredClients: clients,
    examplePayload: {
      locationId: clients[0]?.ghlLocationId || "your-ghl-location-id",
      contactId: "test_contact_123",
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: "+15551234567",
      client: "demo-subclient",
      message: "Hello, I am interested in your services!",
    },
    curlExample: `curl -X POST ${process.env.NEXT_PUBLIC_APP_URL || "https://your-domain.com"}/api/webhooks/ghl/test \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Test message from curl"}'`,
  });
}
