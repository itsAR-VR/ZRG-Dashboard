import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeGhlAppointmentResponse } from "../ghl-api";

describe("normalizeGhlAppointmentResponse", () => {
  it("unwraps the appointment wrapper (production shape)", () => {
    const input = {
      appointment: {
        id: "appt-1",
        calendarId: "cal-1",
        contactId: "contact-1",
        locationId: "loc-1",
        title: "Intro Call",
        startTime: "2026-01-06T09:00:00-07:00",
        endTime: "2026-01-06T09:30:00-07:00",
        appointmentStatus: "invalid",
        assignedUserId: "user-1",
        notes: "",
        address: "https://example.com/meeting",
        dateAdded: "2026-01-06T03:59:13.034Z",
        dateUpdated: "2026-01-06T15:21:56.018Z",
      },
      traceId: "trace-1",
    };

    const result = normalizeGhlAppointmentResponse(input);
    assert.ok(result);
    assert.equal(result.id, "appt-1");
    assert.equal(result.calendarId, "cal-1");
    assert.equal(result.contactId, "contact-1");
    assert.equal(result.locationId, "loc-1");
    assert.equal(result.appointmentStatus, "invalid");
    assert.equal(result.startTime, "2026-01-06T09:00:00-07:00");
    assert.equal(result.endTime, "2026-01-06T09:30:00-07:00");
  });

  it("handles direct response shape with id", () => {
    const input = {
      id: "appt-123",
      calendarId: "cal-1",
      contactId: "contact-1",
      locationId: "loc-1",
      title: "Test Appointment",
      startTime: "2026-01-25T10:00:00Z",
      endTime: "2026-01-25T10:30:00Z",
      appointmentStatus: "confirmed",
    };

    const result = normalizeGhlAppointmentResponse(input);
    assert.ok(result);
    assert.equal(result.id, "appt-123");
    assert.equal(result.calendarId, "cal-1");
  });

  it("unwraps event wrapper shape", () => {
    const input = {
      event: {
        id: "evt-789",
        calendarId: "cal-1",
        contactId: "contact-1",
        locationId: "loc-1",
        title: "Event",
        startTime: "2026-01-25T10:00:00Z",
        endTime: "2026-01-25T10:30:00Z",
        appointmentStatus: "confirmed",
      },
    };

    const result = normalizeGhlAppointmentResponse(input);
    assert.ok(result);
    assert.equal(result.id, "evt-789");
  });

  it("returns null for missing ID in appointment wrapper", () => {
    const input = {
      appointment: {
        calendarId: "cal-1",
        startTime: "2026-01-25T10:00:00Z",
      },
    };

    const result = normalizeGhlAppointmentResponse(input);
    assert.equal(result, null);
  });

  it("returns null for null/undefined input", () => {
    assert.equal(normalizeGhlAppointmentResponse(null), null);
    assert.equal(normalizeGhlAppointmentResponse(undefined), null);
  });

  it("returns null for empty object", () => {
    assert.equal(normalizeGhlAppointmentResponse({}), null);
  });

  it("returns null for non-object input", () => {
    assert.equal(normalizeGhlAppointmentResponse("string"), null);
    assert.equal(normalizeGhlAppointmentResponse(123), null);
    assert.equal(normalizeGhlAppointmentResponse(true), null);
  });

  it("handles missing optional fields gracefully", () => {
    const input = {
      appointment: {
        id: "appt-minimal",
        calendarId: "cal-1",
        contactId: "contact-1",
        locationId: "loc-1",
        title: "Minimal",
        startTime: "2026-01-25T10:00:00Z",
        endTime: "2026-01-25T10:30:00Z",
        appointmentStatus: "confirmed",
      },
    };

    const result = normalizeGhlAppointmentResponse(input);
    assert.ok(result);
    assert.equal(result.id, "appt-minimal");
    assert.equal(result.assignedUserId, undefined);
    assert.equal(result.notes, undefined);
    assert.equal(result.address, undefined);
  });

  it("preserves empty string values for optional fields", () => {
    const input = {
      appointment: {
        id: "appt-empty-strings",
        calendarId: "cal-1",
        contactId: "contact-1",
        locationId: "loc-1",
        title: "Empty strings test",
        startTime: "2026-01-25T10:00:00Z",
        endTime: "2026-01-25T10:30:00Z",
        appointmentStatus: "confirmed",
        notes: "",
        address: "",
      },
    };

    const result = normalizeGhlAppointmentResponse(input);
    assert.ok(result);
    assert.equal(result.notes, "");
    assert.equal(result.address, "");
  });
});
