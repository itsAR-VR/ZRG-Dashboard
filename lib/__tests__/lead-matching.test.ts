import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { findOrCreateLead } from "@/lib/lead-matching";
import { prisma } from "@/lib/prisma";

const TEST_CLIENT_ID = "00000000-1111-2222-3333-444444444444";

async function ensureClient() {
  return prisma.client.upsert({
    where: { id: TEST_CLIENT_ID },
    update: {
      name: "Lead Matching Test",
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

  it("does not match an existing lead by incoming company URL", async () => {
    const client = await ensureClient();

    await prisma.lead.create({
      data: {
        clientId: client.id,
        firstName: "Jane",
        lastName: "Doe",
        linkedinUrl: "https://linkedin.com/in/jane-doe",
        status: "new",
        autoReplyEnabled: false,
        autoFollowUpEnabled: false,
      },
    });

    const result = await findOrCreateLead(
      client.id,
      {
        firstName: "Another",
        lastName: "Person",
      },
      {
        linkedinUrl: "https://linkedin.com/company/acme",
      }
    );

    const totalLeads = await prisma.lead.count({ where: { clientId: client.id } });

    assert.equal(result.matchedBy, "new");
    assert.equal(totalLeads, 2);
    assert.equal(result.lead.linkedinUrl, null);
    assert.equal(result.lead.linkedinCompanyUrl, "https://linkedin.com/company/acme");
  });

  it("stores company URL separately when matching an existing lead by email", async () => {
    const client = await ensureClient();

    const existing = await prisma.lead.create({
      data: {
        clientId: client.id,
        email: "alex@example.com",
        firstName: "Alex",
        lastName: "Taylor",
        linkedinUrl: "https://linkedin.com/in/alex-taylor",
        status: "new",
        autoReplyEnabled: false,
        autoFollowUpEnabled: false,
      },
    });

    const result = await findOrCreateLead(
      client.id,
      { email: "alex@example.com", firstName: "Alex", lastName: "Taylor" },
      { linkedinUrl: "https://linkedin.com/company/acme" }
    );

    assert.equal(result.lead.id, existing.id);
    assert.equal(result.matchedBy, "email");
    assert.equal(result.lead.linkedinUrl, "https://linkedin.com/in/alex-taylor");
    assert.equal(result.lead.linkedinCompanyUrl, "https://linkedin.com/company/acme");
  });

  it("persists explicit linkedinCompanyUrl while keeping profile-only linkedinUrl", async () => {
    const client = await ensureClient();

    const result = await findOrCreateLead(
      client.id,
      { email: "morgan@example.com", firstName: "Morgan", lastName: "Lee" },
      {
        linkedinUrl: "https://www.linkedin.com/in/morgan-lee/",
        linkedinCompanyUrl: "https://www.linkedin.com/company/example-corp/about/",
      }
    );

    assert.equal(result.isNew, true);
    assert.equal(result.matchedBy, "new");
    assert.equal(result.lead.linkedinUrl, "https://linkedin.com/in/morgan-lee");
    assert.equal(result.lead.linkedinCompanyUrl, "https://linkedin.com/company/example-corp");
  });
});
