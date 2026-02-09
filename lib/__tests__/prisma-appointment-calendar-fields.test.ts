import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Prisma } from "@prisma/client";

// Compilation will fail if the fields do not exist.
type _AssertGhlCalendarId = Prisma.AppointmentCreateInput["ghlCalendarId"];
type _AssertCalendlyEventTypeUri = Prisma.AppointmentCreateInput["calendlyEventTypeUri"];

describe("prisma Appointment calendar attribution fields", () => {
  it("exposes ghlCalendarId and calendlyEventTypeUri on AppointmentCreateInput", () => {
    const input: Partial<Prisma.AppointmentCreateInput> = {
      ghlCalendarId: "test-ghl-calendar-id",
      calendlyEventTypeUri: "https://api.calendly.com/event_types/test",
    };

    assert.ok(input.ghlCalendarId);
    assert.ok(input.calendlyEventTypeUri);
  });
});

