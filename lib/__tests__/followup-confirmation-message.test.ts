import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAutoBookingConfirmationMessage } from "../followup-engine";

describe("buildAutoBookingConfirmationMessage", () => {
  it("uses the calendar-invite reschedule wording when booking link is present", () => {
    const message = buildAutoBookingConfirmationMessage({
      channel: "email",
      slotLabel: "10:30 AM EST on Tue, Feb 17",
      bookingLink: "https://calendly.com/example/test",
    });

    assert.match(
      message,
      /If the time doesn't work, let me know or feel free to reschedule using the calendar invite:/i
    );
    assert.match(message, /https:\/\/calendly\.com\/example\/test/);
  });

  it("falls back to correction-only wording when booking link is missing", () => {
    const message = buildAutoBookingConfirmationMessage({
      channel: "sms",
      slotLabel: "9:00 AM EST on Fri, Feb 20",
      bookingLink: null,
    });

    assert.equal(
      message,
      "You're booked for 9:00 AM EST on Fri, Feb 20. If the time doesn't work, let me know and we can find another time."
    );
  });
});
