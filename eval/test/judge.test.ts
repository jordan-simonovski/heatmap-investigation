import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJudgePrompt } from "../src/judge.ts";
import { scenarios } from "../src/scenarios.ts";

test("judge prompt includes ground truth + rubric + agent answer", () => {
  const s = scenarios.find((x) => x.id === "S1")!;
  const p = buildJudgePrompt(s, {
    rca: "the new-checkout-flow flag caused it",
    culprit_service: "order-service",
    discriminating_attributes: [{ key: "app.feature_flag", value: "new-checkout-flow" }],
  });
  assert.ok(p.includes(s.groundTruthRca));
  assert.ok(p.includes(s.rubric));
  assert.ok(p.includes("new-checkout-flow"));
});

test("judge prompt is blind to arm and efficiency", () => {
  const s = scenarios.find((x) => x.id === "S1")!;
  const p = buildJudgePrompt(s, { rca: "x", culprit_service: "y", discriminating_attributes: [] }).toLowerCase();
  // NOTE: "latency" deliberately omitted from this list — it is a legitimate domain word
  // that appears verbatim in S1's own symptomPrompt/groundTruthRca/rubric (this is a
  // checkout-latency incident), so banning it would make this test unsatisfiable together
  // with the "includes ground truth" test above. The actual blindness guarantee we care
  // about — no arm/tool identity, no token/wall-clock/trial efficiency figures — is still
  // fully exercised by the remaining forbidden terms. See task-6-report.md for detail.
  for (const forbidden of ["wide-sql", "bubble-up", "pillars", "token", "wall", "trial", "arm "]) {
    assert.ok(!p.includes(forbidden), `prompt leaks "${forbidden}"`);
  }
});
