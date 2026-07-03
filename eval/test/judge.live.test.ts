import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { judge } from "../src/judge.ts";
import { scenarios } from "../src/scenarios.ts";

const live = process.env.EVAL_LIVE === "1";

test("judge passes a correct S1 answer and fails a wrong one", { skip: !live }, async () => {
  const client = new Anthropic();
  const s1 = scenarios.find((s) => s.id === "S1")!;
  const good = await judge(s1, {
    rca: "The new-checkout-flow feature flag in eu-west-1 caused N+1 queries and p99 latency.",
    culprit_service: "order-service",
    discriminating_attributes: [
      { key: "app.feature_flag", value: "new-checkout-flow" },
      { key: "host.region", value: "eu-west-1" },
    ],
  }, client);
  assert.equal(good.pass, true, good.reasoning);

  const bad = await judge(s1, {
    rca: "The database server ran out of disk space.",
    culprit_service: "postgres",
    discriminating_attributes: [],
  }, client);
  assert.equal(bad.pass, false, bad.reasoning);
});
