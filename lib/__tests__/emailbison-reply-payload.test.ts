import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEmailBisonReplyPayload } from "../emailbison-reply-payload";

describe("buildEmailBisonReplyPayload", () => {
  it("disables inject_previous_email_body to avoid copying lead signature/links", () => {
    const payload = buildEmailBisonReplyPayload({
      messageHtml: "<div>Hello</div>",
      senderEmailId: 123,
      toEmails: [{ name: null, email_address: "to@example.com" }],
      subject: "Subject",
      ccEmails: [],
      bccEmails: [],
    });

    assert.equal(payload.inject_previous_email_body, false);
    assert.equal(payload.content_type, "html");
  });
});

