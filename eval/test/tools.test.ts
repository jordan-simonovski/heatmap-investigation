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
  assert.deepEqual(
    pillarNames.sort(),
    ["get_trace", "loki_logql", "promql", "traceql", "traceql_metrics"],
  );
  assert.ok(!pillarNames.includes("clickhouse_sql"));
});

test("pillars traceql/loki tools expose an agent-adjustable limit (V5)", () => {
  const traceqlDef = pillarsArm.definitions.find((d) => d.name === "traceql")!;
  const lokiDef = pillarsArm.definitions.find((d) => d.name === "loki_logql")!;
  assert.ok("limit" in (traceqlDef.input_schema.properties as object), "traceql exposes limit");
  assert.ok("limit" in (lokiDef.input_schema.properties as object), "loki_logql exposes limit");
});

test("get_trace requires a trace_id", () => {
  const def = pillarsArm.definitions.find((d) => d.name === "get_trace")!;
  assert.deepEqual(def.input_schema.required, ["trace_id"]);
});

test("traceql_metrics description steers the agent to span. scope, not resource.", () => {
  const def = pillarsArm.definitions.find((d) => d.name === "traceql_metrics")!;
  assert.match(def.description!, /span\./);
  assert.match(def.description!, /resource\./);
});

test("submit_verdict requires the three verdict fields", () => {
  assert.deepEqual(
    (SUBMIT_VERDICT.input_schema.required as string[]).sort(),
    ["culprit_service", "discriminating_attributes", "rca"],
  );
});
