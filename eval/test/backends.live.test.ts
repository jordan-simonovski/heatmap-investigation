import { test } from "node:test";
import assert from "node:assert/strict";
import { clickhouseSql } from "../src/backends/clickhouse.ts";
import { promql } from "../src/backends/prometheus.ts";
import { logql } from "../src/backends/loki.ts";
import { traceql } from "../src/backends/tempo.ts";

const live = process.env.EVAL_LIVE === "1";

test("clickhouse returns span rows", { skip: !live }, async () => {
  const out = await clickhouseSql("SELECT count() FROM otel_traces");
  assert.match(out, /\d/);
});

test("prometheus returns RED metric series", { skip: !live }, async () => {
  const out = await promql("traces_span_metrics_calls_total");
  assert.match(out, /"status":"success"/);
});

test("loki returns generator logs", { skip: !live }, async () => {
  const out = await logql('{service_name="trace-generator"}');
  assert.match(out, /"status":"success"/);
});

test("tempo returns traces", { skip: !live }, async () => {
  const out = await traceql('{ span.app.feature_flag="new-checkout-flow" }');
  assert.match(out, /traces|"traces"/);
});
