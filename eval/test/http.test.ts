import { test } from "node:test";
import assert from "node:assert/strict";
import { safeFetchText } from "../src/backends/http.ts";

test("safeFetchText returns error text on transport failure, does not throw", async () => {
  const out = await safeFetchText("Test", "http://localhost:1/", {}, 2000);
  assert.match(out, /Test error/);
});
