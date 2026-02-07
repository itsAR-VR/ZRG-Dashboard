import assert from "node:assert/strict";
import test from "node:test";

import { rankChunksForSelection, type AutoSendOptimizationChunk } from "@/lib/auto-send/optimization-context";

test("rankChunksForSelection: prefers chunks with token overlap", () => {
  const chunks: AutoSendOptimizationChunk[] = [
    { id: "mp:summary", source: "message_performance", text: "Message performance summary: keep it concise." },
    { id: "mp:pattern:1", source: "message_performance", text: "What worked: ask a direct question to move to next step." },
    { id: "ins:takeaway:1", source: "insights_pack", text: "Insight: lead with a clear CTA and a single question." },
  ];

  const ranked = rankChunksForSelection({
    chunks,
    queryText: "Their reply asked about pricing. Our draft needs a clearer CTA and one question.",
    maxCandidates: 24,
  });

  assert.equal(ranked.length, 3);
  assert.equal(ranked[0]?.id, "ins:takeaway:1");
});

test("rankChunksForSelection: keeps mp:summary if message performance chunks exist", () => {
  const chunks: AutoSendOptimizationChunk[] = [
    { id: "mp:summary", source: "message_performance", text: "Message performance summary: baseline guidance." },
    { id: "mp:pattern:1", source: "message_performance", text: "What worked: mention pricing quickly." },
    { id: "ins:takeaway:1", source: "insights_pack", text: "Insight: keep it short." },
  ];

  const ranked = rankChunksForSelection({
    chunks,
    queryText: "short",
    maxCandidates: 24,
  });

  assert.equal(ranked.length, 3);
  assert.equal(ranked.some((c) => c.id === "mp:summary"), true);
});
