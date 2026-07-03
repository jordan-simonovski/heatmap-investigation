import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.ts";

test("config exposes both models and they differ", () => {
  assert.equal(config.agentModel, "claude-sonnet-5");
  assert.equal(config.judgeModel, "claude-opus-4-8");
  assert.notEqual(config.agentModel, config.judgeModel);
});

test("config defaults", () => {
  assert.equal(config.trials, 5);
  assert.equal(config.truncateCap, 8000);
  assert.equal(config.urls.clickhouse, "http://localhost:8123");
});
