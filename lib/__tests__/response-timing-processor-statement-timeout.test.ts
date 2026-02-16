import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Response timing processor statement_timeout", () => {
  it("does not parameterize SET LOCAL statement_timeout", () => {
    const source = read("lib/response-timing/processor.ts");

    assert.ok(
      !source.includes("$executeRaw`SET LOCAL statement_timeout = ${"),
      "expected SET LOCAL statement_timeout to avoid parameter placeholders (Postgres rejects $1 here)"
    );
    assert.ok(source.includes("$executeRawUnsafe(`SET LOCAL statement_timeout = ${"), "expected statement_timeout to be set via raw SQL string");
  });

  it("explicitly sets ResponseTimingEvent.id in raw insert to avoid DB-default drift", () => {
    const source = read("lib/response-timing/processor.ts");

    assert.ok(
      source.includes('insert into "ResponseTimingEvent" (\n              "id",'),
      "expected raw insert columns to include id"
    );
    assert.ok(source.includes('m.id as "id"'), 'expected insert select to set "id" from inbound message id');
    assert.ok(source.includes('"createdAt"'), "expected raw insert columns to include createdAt");
    assert.ok(source.includes('"updatedAt"'), "expected raw insert columns to include updatedAt");
    assert.ok(source.includes('now() as "createdAt"'), 'expected insert select to set "createdAt" explicitly');
    assert.ok(source.includes('now() as "updatedAt"'), 'expected insert select to set "updatedAt" explicitly');
  });
});
