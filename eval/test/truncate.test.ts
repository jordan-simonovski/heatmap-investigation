import { test } from "node:test";
import assert from "node:assert/strict";
import { truncate } from "../src/backends/truncate.ts";

test("passes short strings through", () => {
  assert.equal(truncate("hello", 100), "hello");
});

test("truncates and annotates long strings", () => {
  const s = "x".repeat(50);
  const out = truncate(s, 10);
  assert.ok(out.startsWith("xxxxxxxxxx"));
  assert.ok(out.includes("[truncated 40 chars]"));
  assert.ok(out.length < s.length);
});
