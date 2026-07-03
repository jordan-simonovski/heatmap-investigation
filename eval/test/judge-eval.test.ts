import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadGoldSet, scoreGoldSet } from "../src/judge-eval.ts";
import { scenarios } from "../src/scenarios.ts";

const goldPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "gold", "verdicts.json");

test("gold set loads, is well-formed, and is within the ~20-40 case range", () => {
  const goldSet = loadGoldSet(goldPath);
  assert.ok(goldSet.length >= 20 && goldSet.length <= 40, `expected 20-40 cases, got ${goldSet.length}`);
  for (const c of goldSet) {
    assert.ok(scenarios.some((s) => s.id === c.scenario_id), `unknown scenario_id ${c.scenario_id}`);
    assert.equal(typeof c.expected_pass, "boolean");
    assert.ok(c.verdict.culprit_service.length > 0);
    assert.ok(Array.isArray(c.verdict.discriminating_attributes));
  }
});

test("gold set pins the two real S5 boundary cases from the audit", () => {
  const goldSet = loadGoldSet(goldPath);
  const s5 = goldSet.filter((c) => c.scenario_id === "S5");
  const foundPodsRuledOutBuild = s5.find((c) => /ruled.*out|rejected build/i.test(c.note ?? ""));
  const redisRedHerring = s5.find((c) => /redis/i.test(JSON.stringify(c.verdict)) && /red.?herring|D2/i.test(c.note ?? ""));
  assert.ok(foundPodsRuledOutBuild, "expected a pinned case where the agent found pods but ruled out build_id");
  assert.ok(redisRedHerring, "expected a pinned case where the agent said Redis on user-service");
  assert.equal(foundPodsRuledOutBuild!.expected_pass, false);
  assert.equal(redisRedHerring!.expected_pass, false);
});

test("every gold case includes a note (first-pass labels must be explainable/reviewable)", () => {
  const goldSet = loadGoldSet(goldPath);
  for (const c of goldSet) {
    assert.ok(c.note && c.note.length > 0, `gold case ${c.id} is missing a review note`);
  }
});

test("loadGoldSet rejects an unknown scenario_id", () => {
  const tmpPath = path.join(tmpdir(), `judge-eval-bad-gold-${process.pid}-${Date.now()}.json`);
  writeFileSync(
    tmpPath,
    JSON.stringify([
      {
        id: "bad-1",
        scenario_id: "S999",
        verdict: { rca: "x", culprit_service: "y", discriminating_attributes: [] },
        expected_pass: true,
      },
    ]),
  );
  try {
    assert.throws(() => loadGoldSet(tmpPath), /unknown scenario_id/);
  } finally {
    unlinkSync(tmpPath);
  }
});

test("loadGoldSet rejects a case missing required fields", () => {
  const tmpPath = path.join(tmpdir(), `judge-eval-malformed-gold-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmpPath, JSON.stringify([{ id: "bad-2", scenario_id: "S1" }]));
  try {
    assert.throws(() => loadGoldSet(tmpPath), /malformed gold case/);
  } finally {
    unlinkSync(tmpPath);
  }
});

test("scoreGoldSet computes precision/recall/agreement from a confusion matrix", () => {
  const stats = scoreGoldSet([
    { expected_pass: true, actualPass: true }, // TP
    { expected_pass: true, actualPass: true }, // TP
    { expected_pass: true, actualPass: false }, // FN
    { expected_pass: false, actualPass: false }, // TN
    { expected_pass: false, actualPass: true }, // FP
  ]);
  assert.equal(stats.n, 5);
  assert.equal(stats.tp, 2);
  assert.equal(stats.fn, 1);
  assert.equal(stats.tn, 1);
  assert.equal(stats.fp, 1);
  assert.equal(stats.precision, 2 / 3); // tp / (tp+fp)
  assert.equal(stats.recall, 2 / 3); // tp / (tp+fn)
  assert.equal(stats.agreement, 3 / 5); // (tp+tn) / n
});

test("scoreGoldSet handles the empty/degenerate case without throwing", () => {
  const stats = scoreGoldSet([]);
  assert.equal(stats.n, 0);
  assert.ok(Number.isNaN(stats.precision));
  assert.ok(Number.isNaN(stats.recall));
  assert.ok(Number.isNaN(stats.agreement));
});

test("scoreGoldSet: all-pass-correct gives precision=recall=agreement=1", () => {
  const stats = scoreGoldSet([
    { expected_pass: true, actualPass: true },
    { expected_pass: false, actualPass: false },
  ]);
  assert.equal(stats.precision, 1);
  assert.equal(stats.recall, 1);
  assert.equal(stats.agreement, 1);
});
