import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.ts";

test("config exposes both models and they differ", () => {
  assert.equal(config.agentModel, "claude-sonnet-5");
  assert.equal(config.judgeModel, "claude-opus-4-8");
  assert.notEqual(config.agentModel, config.judgeModel);
});

test("config defaults", () => {
  // trials default is 10 (the published headline-run config; see d0f65ca) — was 5
  // before that change, this assertion had drifted and was failing pre-existing.
  assert.equal(config.trials, 10);
  assert.equal(config.truncateCap, 8000);
  assert.equal(config.urls.clickhouse, "http://localhost:8123");
});

test("config exposes judgeSamples for majority-vote judging (D3)", () => {
  assert.equal(config.judgeSamples, 3);
});
