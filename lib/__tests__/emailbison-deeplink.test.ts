import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pickEmailBisonReplyUuidForDeepLink } from "../emailbison-deeplink";

describe("pickEmailBisonReplyUuidForDeepLink", () => {
  it("prefers an exact id match when that reply includes a uuid", () => {
    const uuid = pickEmailBisonReplyUuidForDeepLink({
      preferredReplyId: "222",
      replies: [
        { id: 222, uuid: "uuid-222", date_received: "2024-01-01T00:00:00Z" },
        { id: 111, uuid: "uuid-111", date_received: "2025-01-01T00:00:00Z" },
      ],
    });

    assert.equal(uuid, "uuid-222");
  });

  it("falls back to the newest reply with a uuid when preferred id is missing", () => {
    const uuid = pickEmailBisonReplyUuidForDeepLink({
      preferredReplyId: "999",
      replies: [
        { id: 111, uuid: "uuid-111", date_received: "2024-01-01T00:00:00Z" },
        { id: 222, uuid: "uuid-222", date_received: "2024-02-01T00:00:00Z" },
      ],
    });

    assert.equal(uuid, "uuid-222");
  });

  it("returns null when no replies include a uuid", () => {
    const uuid = pickEmailBisonReplyUuidForDeepLink({
      preferredReplyId: "111",
      replies: [{ id: 111, uuid: null, date_received: "2024-01-01T00:00:00Z" }],
    });

    assert.equal(uuid, null);
  });
});

