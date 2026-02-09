function scrubEmails(value: string): string {
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]");
}

function scrubPhones(value: string): string {
  // Keep this intentionally broad. We're scrubbing durable memory proposals, not validating.
  return value.replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]");
}

export function scrubMemoryProposalContent(raw: string): { content: string; changed: boolean } {
  const input = String(raw || "");
  const scrubbed = scrubPhones(scrubEmails(input));
  return { content: scrubbed, changed: scrubbed !== input };
}

