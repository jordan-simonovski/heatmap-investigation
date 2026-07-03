import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJudgePrompt, majorityVote, normalizeAttrKey, type JudgeVote } from "../src/judge.ts";
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

test("judge prompt lists required discriminating attributes with normalized keys (V12/V13)", () => {
  const s = scenarios.find((x) => x.id === "S1")!;
  const p = buildJudgePrompt(s, { rca: "x", culprit_service: "y", discriminating_attributes: [] });
  assert.ok(p.includes("REQUIRED DISCRIMINATING ATTRIBUTES"));
  assert.ok(p.includes("normalized key: app_feature_flag"));
  assert.ok(p.includes("normalized key: host_region"));
  assert.ok(p.toLowerCase().includes("dots or underscores"));
});

test("judge prompt softens 'apply strictly' wording (V14)", () => {
  const s = scenarios.find((x) => x.id === "S1")!;
  const p = buildJudgePrompt(s, { rca: "x", culprit_service: "y", discriminating_attributes: [] });
  assert.ok(!/apply the rubric strictly/i.test(p), "should no longer bias toward false negatives");
  assert.ok(/grade generously on phrasing/i.test(p));
});

test("normalizeAttrKey equates dotted and underscored attribute keys (V13)", () => {
  assert.equal(normalizeAttrKey("host.region"), normalizeAttrKey("host_region"));
  assert.equal(normalizeAttrKey("app.feature_flag"), normalizeAttrKey("app_feature_flag"));
  assert.equal(normalizeAttrKey("Host.Region"), "host_region");
});

function vote(over: Partial<JudgeVote>): JudgeVote {
  return { pass: true, reasoning: "vote", identifiedAttributes: [], ...over };
}

test("majorityVote: 2-of-3 pass wins", () => {
  const j = majorityVote([
    vote({ pass: true }),
    vote({ pass: true }),
    vote({ pass: false }),
  ]);
  assert.equal(j.pass, true);
  assert.equal(j.votes.length, 3);
});

test("majorityVote: 2-of-3 fail wins", () => {
  const j = majorityVote([
    vote({ pass: false }),
    vote({ pass: false }),
    vote({ pass: true }),
  ]);
  assert.equal(j.pass, false);
});

test("majorityVote: unanimous agreement", () => {
  assert.equal(majorityVote([vote({ pass: true }), vote({ pass: true })]).pass, true);
  assert.equal(majorityVote([vote({ pass: false }), vote({ pass: false })]).pass, false);
});

test("majorityVote: tie (e.g. k=2 split) does not pass — requires a strict majority", () => {
  const j = majorityVote([vote({ pass: true }), vote({ pass: false })]);
  assert.equal(j.pass, false);
});

test("majorityVote: no votes defaults to fail, not a throw", () => {
  const j = majorityVote([]);
  assert.equal(j.pass, false);
  assert.deepEqual(j.identifiedAttributes, []);
});

test("majorityVote: identifiedAttributes requires a majority of votes to agree per-attribute", () => {
  const j = majorityVote([
    vote({ pass: true, identifiedAttributes: ["host_region", "app_feature_flag"] }),
    vote({ pass: true, identifiedAttributes: ["host_region"] }),
    vote({ pass: false, identifiedAttributes: [] }),
  ]);
  // host_region: 2/3 votes -> majority -> included
  assert.ok(j.identifiedAttributes.includes("host_region"));
  // app_feature_flag: 1/3 votes -> not a majority -> excluded
  assert.ok(!j.identifiedAttributes.includes("app_feature_flag"));
});

test("majorityVote: reasoning concatenates all votes for audit", () => {
  const j = majorityVote([vote({ pass: true, reasoning: "looks right" }), vote({ pass: false, reasoning: "missing region" })]);
  assert.ok(j.reasoning.includes("looks right"));
  assert.ok(j.reasoning.includes("missing region"));
});
