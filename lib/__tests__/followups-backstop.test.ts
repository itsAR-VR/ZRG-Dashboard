import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { completeFollowUpsForMeetingBookedLeads } from "../followup-engine";

describe("completeFollowUpsForMeetingBookedLeads", () => {
  it("queries for active/paused non-post-booking instances on meeting-booked leads", async () => {
    const calls: any[] = [];
    const prismaStub = {
      followUpInstance: {
        updateMany: async (args: any) => {
          calls.push(args);
          return { count: 0 };
        },
      },
    };

    await completeFollowUpsForMeetingBookedLeads(prismaStub as any);

    assert.equal(calls.length, 1);
    const where = calls[0].where;
    assert.deepEqual(where.status, { in: ["active", "paused"] });
    assert.deepEqual(where.sequence, { triggerOn: { not: "meeting_selected" } });
    assert.deepEqual(where.lead, { status: "meeting-booked" });
  });

  it("sets status to completed with completedAt and null nextStepDue", async () => {
    const calls: any[] = [];
    const prismaStub = {
      followUpInstance: {
        updateMany: async (args: any) => {
          calls.push(args);
          return { count: 0 };
        },
      },
    };

    await completeFollowUpsForMeetingBookedLeads(prismaStub as any);

    const data = calls[0].data;
    assert.equal(data.status, "completed");
    assert.ok(data.completedAt instanceof Date);
    assert.equal(data.nextStepDue, null);
  });

  it("returns completedCount from updateMany result", async () => {
    const prismaStub = {
      followUpInstance: {
        updateMany: async () => ({ count: 5 }),
      },
    };

    const result = await completeFollowUpsForMeetingBookedLeads(prismaStub as any);
    assert.equal(result.completedCount, 5);
  });

  it("returns 0 on error", async () => {
    const prismaStub = {
      followUpInstance: {
        updateMany: async () => {
          throw new Error("DB error");
        },
      },
    };

    const result = await completeFollowUpsForMeetingBookedLeads(prismaStub as any);
    assert.equal(result.completedCount, 0);
  });
});
