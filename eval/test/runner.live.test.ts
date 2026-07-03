import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { runCell } from "../src/runner.ts";
import { scenarios } from "../src/scenarios.ts";
import { wideSqlArm } from "../src/tools/wideSqlTools.ts";

const live = process.env.EVAL_LIVE === "1";

test("runs one S1 x wide-sql cell end to end", { skip: !live }, async () => {
  const client = new Anthropic();
  const s1 = scenarios.find((s) => s.id === "S1")!;
  const r = await runCell(s1, wideSqlArm, 1, client, () => Date.now());
  assert.ok(r.verdict, "produced a verdict");
  assert.ok(r.usage.outputTokens > 0, "captured usage");
  assert.ok(r.toolCalls > 0, "made tool calls");
  console.log(JSON.stringify(r, null, 2));
});
