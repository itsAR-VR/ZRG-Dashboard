import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function listDirFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listDirFiles(fullPath);
      return [fullPath];
    });
}

describe('"use server" exports hygiene', () => {
  it("does not export non-functions from actions modules", () => {
    const actionsDir = path.join(process.cwd(), "actions");
    const actionFiles = listDirFiles(actionsDir).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));

    const offenders: string[] = [];
    for (const filePath of actionFiles) {
      const rel = path.relative(process.cwd(), filePath);
      const source = fs.readFileSync(filePath, "utf8");
      if (!source.includes('"use server"') && !source.includes("'use server'")) continue;

      const lines = source.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (/^\s*export\s+(const|let|var|class|default)\b/.test(line)) {
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    assert.equal(
      offenders.length,
      0,
      [
        '"use server" modules must not export non-function runtime values.',
        "Next.js will throw E352 and Server Actions will fail with digest-only 500s.",
        "",
        ...offenders,
      ].join("\n")
    );
  });
});

