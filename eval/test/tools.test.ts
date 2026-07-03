import { test } from "node:test";
import assert from "node:assert/strict";
import { wideSqlArm } from "../src/tools/wideSqlTools.ts";
import { pillarsArm } from "../src/tools/pillarsTools.ts";
import { bubbleUpArm } from "../src/tools/bubbleUpTools.ts";
import { SUBMIT_VERDICT } from "../src/tools/submitVerdict.ts";

test("each arm exposes definitions with matching handlers", () => {
  for (const arm of [wideSqlArm, pillarsArm, bubbleUpArm]) {
    assert.ok(arm.definitions.length > 0, `${arm.name} has tools`);
    for (const def of arm.definitions) {
      assert.equal(typeof arm.handlers[def.name], "function", `${arm.name}:${def.name} handler`);
    }
  }
});

test("arms differ only in tools, pillars has no SQL", () => {
  const pillarNames = pillarsArm.definitions.map((d) => d.name);
  assert.deepEqual(pillarNames.sort(), ["loki_logql", "promql", "traceql"]);
  assert.ok(!pillarNames.includes("clickhouse_sql"));
});

test("submit_verdict requires the three verdict fields", () => {
  assert.deepEqual(
    (SUBMIT_VERDICT.input_schema.required as string[]).sort(),
    ["culprit_service", "discriminating_attributes", "rca"],
  );
});
