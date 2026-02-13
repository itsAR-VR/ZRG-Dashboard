import { PrismaClient } from "@prisma/client";

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { findOrCreateLead } from "@/lib/lead-matching";
import { prisma } from "@/lib/prisma";

const TEST_CLIENT_ID = "00000000-1111-2222-3333-444444444444";

async function ensureClient() {
  return prisma.client.upsert({
    where: { id: TEST_CLIENT_ID },
    update: {
      name: "Lead Matching Test".concat(""),
    },
    create: {
      id: TEST_CLIENT_ID,
      name: "Lead Matching Test",
      userId: "test-user-id",
      ghlPrivateKey: null,
      ghlLocationId: null,
      emailBisonApiKey: null,
      smartLeadApiKey: null,
      smartLeadWebhookSecret: null,
      instantlyApiKey: null,
      instantlyWebhookSecret: null,
    },
  });
}

describe("findOrCreateLead", () => {
  afterEach(async () => {
    await prisma.lead.deleteMany({ where: { clientId: TEST_CLIENT_ID } });
  });

  it("matches by incoming company URL when existing lead has profile URL", async () => {
    const client = await ensureClient();

    await prisma.lead.create({
      data: {
        clientId: client.id,
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
        linkedinUrl: "https://linkedin.com/company/acme",
        status: "new",
        autoReplyEnabled: false,
        autoFollowUpEnabled: false,
      },
    });

    const result = await findOrCreateLead(
      client.id,
      {
        firstName: "Jane",
        lastName: "Doe",
      },
      {
        linkedinUrl: "https://www.linkedin.com/in/jane-doe",
      }
    );

    assert.equal(result.matchedBy, "linkedinUrl");
    assert.equal(result.lead.linkedinUrl, "https://linkedin.com/in/jane-doe");
  });

  it("does not create a duplicate lead when URL variants are mixed", async () => {
    const client = await ensureClient();

    const first = await prisma.lead.create({
      data: {
        clientId: client.id,
        firstName: "Alex",
        lastName: "Taylor",
        email: "alex@example.com",
        linkedinUrl: "https://linkedin.com/company/acme",
        status: "new",
        autoReplyEnabled: false,
        autoFollowUpEnabled: false,
      },
    });

    const firstResult = await findOrCreateLead(
      client.id,
      { email: "alex@example.com", firstName: "Alex", lastName: "Taylor" },
      { linkedinUrl: "https://linkedin.com/in/alex-taylor" }
    );

    const totalLeads = await prisma.lead.count({ where: { clientId: client.id } });

    assert.equal(first.id, firstResult.lead.id);
    assert.equal(totalLeads, 1);
  });
});

describe("lead-matching test utils", () => {
  it("has no-op", () => {
    assert.equal(true, true);
  });
});
