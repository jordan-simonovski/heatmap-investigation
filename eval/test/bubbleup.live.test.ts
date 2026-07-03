import { test } from "node:test";
import assert from "node:assert/strict";
import { bubbleUpArm } from "../src/tools/bubbleUpTools.ts";

const live = process.env.EVAL_LIVE === "1";

// Gated live check: proves rank_attributes emits valid ClickHouse AND ranks by
// selection-vs-baseline over-representation (sel_pct - base_pct), surfacing the
// S1 ground-truth discriminators.
//
// NOTE on the selection predicate: S1 is a LATENCY scenario (checkout p99
// ~1500ms), not an error-rate scenario, so the failing region is the SLOW
// checkout spans (Duration in NANOSECONDS — >1e9 = >1s), not StatusCode errors.
// Also, ClickHouse otel_traces.StatusCode stores the short enum ('Error'), not
// the TraceQL-style 'STATUS_CODE_ERROR'. Selecting slow checkout spans is what
// makes the new-checkout-flow feature flag over-represented.
test("rank_attributes runs and surfaces the S1 discriminator", { skip: !live }, async () => {
  const out = await bubbleUpArm.handlers.rank_attributes({
    selection_predicate: "SpanAttributes['http.route']='/cart/checkout' AND Duration > 1000000000",
    attribute_keys: ["app.feature_flag", "host.region"],
  });
  console.log(out);

  assert.ok(!/error/i.test(out), `unexpected error: ${out}`);
  assert.match(out, /diff/); // comparison columns present (attr value sel base sel_pct base_pct diff)

  // The S1 discriminators must appear...
  assert.match(out, /new-checkout-flow/);
  assert.match(out, /eu-west-1/);

  // ...and rank_attributes must rank by OVER-REPRESENTATION: the
  // new-checkout-flow row's diff (last column) must be a large positive number,
  // proving it ranks by sel_pct - base_pct rather than raw selection frequency.
  const row = out.split("\n").find((l) => l.startsWith("app.feature_flag\tnew-checkout-flow\t"));
  assert.ok(row, `no new-checkout-flow row in output:\n${out}`);
  const diff = Number(row!.split("\t").at(-1));
  assert.ok(diff > 10, `new-checkout-flow diff should be strongly positive, got ${diff}`);
});
