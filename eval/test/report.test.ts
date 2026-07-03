import { test } from "node:test";
import assert from "node:assert/strict";
import { median, mean, aggregate, renderTable } from "../src/report.ts";
import type { JudgedResult } from "../src/matrix.ts";

test("median handles odd and even lengths", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});

test("mean handles empty and non-empty", () => {
  assert.equal(mean([]), 0);
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([0.5, 1]), 0.75);
});

function row(over: Partial<JudgedResult>): JudgedResult {
  return {
    scenario: "S1", arm: "wide-sql", trial: 1, verdict: null,
    usage: { inputTokens: 0, outputTokens: 100 }, wallClockMs: 1000,
    toolCalls: 3, turns: 4, pass: true, judgeReasoning: "", error: false,
    resolvedModel: "claude-sonnet-5-20260101", retries: 0,
    attributeRecall: 1, identifiedAttributes: ["host_region"],
    ...over,
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

// V5: a zero-pass cell used to render a literal "0" for every passing-only median column
// (median([]) === 0), which reads as "free" rather than "nothing to measure."
test("renderTable renders — (not 0) for zero-pass cells' passing-only medians", () => {
  const rows: JudgedResult[] = [
    row({ trial: 1, pass: false, usage: { inputTokens: 100, outputTokens: 900 } }),
    row({ trial: 2, pass: false, usage: { inputTokens: 100, outputTokens: 900 } }),
  ];
  const cells = aggregate(rows);
  const [cell] = cells;
  assert.equal(cell.nPass, 0);
  // passing-only aggregates really are 0 under median([])
  assert.equal(cell.medTokens, 0);
  assert.equal(cell.medOutputTokens, 0);
  assert.equal(cell.medTurns, 0);

  const table = renderTable(cells);
  const dataRow = table.split("\n")[2];
  const cols = dataRow.split("|").map((s) => s.trim());
  // [empty, arm, scenario, pass-rate, attr-recall, tokens(pass), tokens(all), output tokens,
  //  turns, tool-calls, wall, resolved model, retries, errors, empty]
  const [, , , , , tokensPass, , outputTokens, turns, toolCalls, wall] = cols;
  assert.ok(dataRow.includes("—"), `expected a — placeholder in: ${dataRow}`);
  // the passing-only columns (real V5 bug: these used to render a literal "0")
  for (const [name, val] of [
    ["tokens(pass)", tokensPass],
    ["outputTokens", outputTokens],
    ["turns", turns],
    ["toolCalls", toolCalls],
    ["wall", wall],
  ] as const) {
    assert.equal(val, "—", `${name} should be — for a zero-pass cell, got "${val}" in: ${dataRow}`);
  }
  // the all-trials column is NOT passing-only, so it should still show a real number
  assert.equal(cell.medTokensAllTrials, 1000);
});

test("renderTable renders — for a cell with no scored trials at all (all errored)", () => {
  const rows: JudgedResult[] = [
    row({ trial: 1, error: true, pass: false, resolvedModel: "" }),
    row({ trial: 2, error: true, pass: false, resolvedModel: "" }),
  ];
  const cells = aggregate(rows);
  const [cell] = cells;
  assert.equal(cell.n, 0);
  assert.equal(cell.resolvedModel, "—");
  const table = renderTable(cells);
  const dataRow = table.split("\n")[2];
  assert.ok(dataRow.includes("—"));
});

// V15/V3: all-trials cost should reflect failed-run cost, not just the (possibly single)
// passing trial's cost.
test("medTokensAllTrials includes failing trials; medTokens (headline) does not", () => {
  const rows: JudgedResult[] = [
    row({ trial: 1, pass: true, usage: { inputTokens: 0, outputTokens: 100 } }),
    row({ trial: 2, pass: false, usage: { inputTokens: 0, outputTokens: 5000 } }),
    row({ trial: 3, pass: false, usage: { inputTokens: 0, outputTokens: 6000 } }),
  ];
  const [cell] = aggregate(rows);
  assert.equal(cell.medTokens, 100); // only the passing trial
  assert.equal(cell.medTokensAllTrials, 5000); // median(100, 5000, 6000)
});

test("medOutputTokens is output-only, distinct from medTokens (input+output)", () => {
  const rows: JudgedResult[] = [
    row({ trial: 1, pass: true, usage: { inputTokens: 4000, outputTokens: 100 } }),
    row({ trial: 2, pass: true, usage: { inputTokens: 6000, outputTokens: 300 } }),
  ];
  const [cell] = aggregate(rows);
  assert.equal(cell.medOutputTokens, 200); // median(100, 300)
  assert.equal(cell.medTokens, 5200); // median(4100, 6300)
});

// V12: attribute-recall aggregation must include failing trials (mean over ALL scored,
// non-error trials) so a "found half of it" pattern is visible instead of collapsing to 0
// under the binary pass/fail.
test("meanAttributeRecall averages over scored trials including failures", () => {
  const rows: JudgedResult[] = [
    row({ trial: 1, pass: true, attributeRecall: 1 }),
    row({ trial: 2, pass: false, attributeRecall: 0.5 }),
    row({ trial: 3, pass: false, attributeRecall: 0 }),
  ];
  const [cell] = aggregate(rows);
  assert.equal(cell.meanAttributeRecall, 0.5); // mean(1, 0.5, 0)
  const table = renderTable([cell]);
  assert.ok(table.includes("50%"));
});

// V6: resolved model id(s) actually served should surface in the aggregate, and flag
// (rather than silently pick one) if a run mixed resolved ids — e.g. an alias repointed.
test("resolvedModel reports the single served model, or flags a mix", () => {
  const uniform = aggregate([
    row({ trial: 1, resolvedModel: "claude-sonnet-5-20260101" }),
    row({ trial: 2, resolvedModel: "claude-sonnet-5-20260101" }),
  ])[0];
  assert.equal(uniform.resolvedModel, "claude-sonnet-5-20260101");

  const mixed = aggregate([
    row({ trial: 1, resolvedModel: "claude-sonnet-5-20260101" }),
    row({ trial: 2, resolvedModel: "claude-sonnet-5-20260215" }),
  ])[0];
  assert.equal(mixed.resolvedModel, "claude-sonnet-5-20260101+claude-sonnet-5-20260215");
});
