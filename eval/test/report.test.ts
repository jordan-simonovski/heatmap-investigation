import { test } from "node:test";
import assert from "node:assert/strict";
import { median, aggregate } from "../src/report.ts";
import type { JudgedResult } from "../src/matrix.ts";

test("median handles odd and even lengths", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

function row(over: Partial<JudgedResult>): JudgedResult {
  return {
    scenario: "S1", arm: "wide-sql", trial: 1, verdict: null,
    usage: { inputTokens: 0, outputTokens: 100 }, wallClockMs: 1000,
    toolCalls: 3, turns: 4, pass: true, judgeReasoning: "", error: false, ...over,
  };
}

test("aggregate computes pass-rate over all, medians over passing only", () => {
  const rows: JudgedResult[] = [
    row({ trial: 1, pass: true, usage: { inputTokens: 0, outputTokens: 100 } }),
    row({ trial: 2, pass: true, usage: { inputTokens: 0, outputTokens: 300 } }),
    row({ trial: 3, pass: false, usage: { inputTokens: 0, outputTokens: 999 } }),
  ];
  const [cell] = aggregate(rows);
  assert.equal(cell.n, 3);
  assert.equal(cell.nPass, 2);
  assert.equal(cell.nError, 0);
  assert.equal(cell.passRate, 2 / 3);
  // median tokens over the two passing rows only: median(100,300)=200
  assert.equal(cell.medTokens, 200);
});

test("aggregate excludes infra-errored cells from n/pass-rate and counts them in nError", () => {
  const rows: JudgedResult[] = [
    row({ trial: 1, pass: true, usage: { inputTokens: 0, outputTokens: 100 } }),
    row({ trial: 2, pass: false, usage: { inputTokens: 0, outputTokens: 300 } }),
    row({
      trial: 3,
      pass: false,
      error: true,
      judgeReasoning: "cell error: transient API failure",
      usage: { inputTokens: 0, outputTokens: 0 },
      wallClockMs: 0,
      toolCalls: 0,
    }),
  ];
  const [cell] = aggregate(rows);
  // the errored row is excluded from the denominator entirely
  assert.equal(cell.n, 2);
  assert.equal(cell.nPass, 1);
  assert.equal(cell.nError, 1);
  assert.equal(cell.passRate, 1 / 2);
});
