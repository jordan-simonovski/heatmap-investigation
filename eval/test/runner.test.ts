import { test } from "node:test";
import assert from "node:assert/strict";
import { accumulateUsage } from "../src/runner.ts";

test("accumulates token usage across turns", () => {
  let u = { inputTokens: 0, outputTokens: 0 };
  u = accumulateUsage(u, { input_tokens: 100, output_tokens: 20 });
  u = accumulateUsage(u, { input_tokens: 150, output_tokens: 30 });
  assert.deepEqual(u, { inputTokens: 250, outputTokens: 50 });
});
