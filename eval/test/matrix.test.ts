import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCells, chunk } from "../src/matrix.ts";

test("chunk splits into bounded groups", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("buildCells produces scenario x arm x trial", () => {
  const cells = buildCells({ scenarioIds: ["S1"], armNames: ["wide-sql", "pillars"], trials: 3 });
  assert.equal(cells.length, 6); // 1 scenario x 2 arms x 3 trials
  assert.equal(cells.filter((c) => c.arm.name === "pillars").length, 3);
});

test("buildCells defaults to full matrix", () => {
  const cells = buildCells({});
  assert.equal(cells.length, 8 * 3 * 5); // 120
});
