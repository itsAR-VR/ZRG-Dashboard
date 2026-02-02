type AvailabilitySection = {
  headerLine: string;
  slotLines: string[];
  fullMatch: string;
  startIndex: number;
  endIndex: number;
};

const HEADER_REGEX = /^(?:AVAILABLE TIMES|Available times)[^\r\n]*\r?\n/gm;

function readLine(content: string, startIndex: number): { line: string; endIndex: number } {
  const newlineIndex = content.indexOf("\n", startIndex);
  if (newlineIndex === -1) {
    return { line: content.slice(startIndex), endIndex: content.length };
  }

  const lineWithBreak = content.slice(startIndex, newlineIndex + 1);
  const line = lineWithBreak.endsWith("\r\n") ? lineWithBreak.slice(0, -2) : lineWithBreak.slice(0, -1);
  return { line, endIndex: newlineIndex + 1 };
}

function findAvailabilitySections(content: string): AvailabilitySection[] {
  const sections: AvailabilitySection[] = [];
  let match: RegExpExecArray | null;

  while ((match = HEADER_REGEX.exec(content)) !== null) {
    const headerStart = match.index;
    const headerWithBreak = match[0];
    const headerLine = headerWithBreak.replace(/\r?\n$/, "");
    let cursor = headerStart + headerWithBreak.length;
    let endIndex = cursor;
    const slotLines: string[] = [];

    while (cursor < content.length) {
      const { line, endIndex: nextIndex } = readLine(content, cursor);
      const bulletMatch = line.match(/^\s*-\s+(.+)$/);
      if (!bulletMatch) break;
      slotLines.push(bulletMatch[1]?.trim() ?? "");
      cursor = nextIndex;
      endIndex = nextIndex;
    }

    if (slotLines.length === 0) {
      continue;
    }

    sections.push({
      headerLine,
      slotLines,
      fullMatch: content.slice(headerStart, endIndex),
      startIndex: headerStart,
      endIndex,
    });
  }

  return sections;
}

export function hasAvailabilitySection(content: string): boolean {
  return findAvailabilitySections(content).length > 0;
}

export function extractAvailabilitySection(
  content: string
): (AvailabilitySection & { sectionCount: number }) | null {
  const sections = findAvailabilitySections(content);
  if (sections.length === 0) return null;
  const [first] = sections;
  return {
    ...first,
    sectionCount: sections.length,
  };
}

export function replaceAvailabilitySlotsInContent(content: string, newSlotLabels: string[]): string {
  const section = extractAvailabilitySection(content);
  if (!section) {
    throw new Error("availability_section_not_found");
  }

  const newline = section.fullMatch.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = /\r?\n$/.test(section.fullMatch);
  const bulletLines = newSlotLabels.map((label) => `- ${label}`).join(newline);
  const replacement = endsWithNewline
    ? `${section.headerLine}${newline}${bulletLines}${newline}`
    : `${section.headerLine}${newline}${bulletLines}`;

  return `${content.slice(0, section.startIndex)}${replacement}${content.slice(section.endIndex)}`;
}
