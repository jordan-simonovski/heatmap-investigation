import { test } from "node:test";
import assert from "node:assert/strict";
import { clickhouseSql } from "../src/backends/clickhouse.ts";
import { promql } from "../src/backends/prometheus.ts";
import { logql } from "../src/backends/loki.ts";
import { traceql, getTrace, traceqlMetrics } from "../src/backends/tempo.ts";

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

test("tempo honors a raised search limit", { skip: !live }, async () => {
  const out = await traceql('{ span.app.feature_flag="new-checkout-flow" }', 3);
  const parsed = JSON.parse(out);
  assert.ok(parsed.traces.length <= 3);
});

test("loki honors a raised limit", { skip: !live }, async () => {
  const out = await logql('{service_name="trace-generator"}', 5);
  assert.match(out, /"status":"success"/);
});

test("get_trace returns spans with attributes (V2)", { skip: !live }, async () => {
  const search = await traceql('{ span.http.route="/api/auth" }', 1);
  const { traces } = JSON.parse(search);
  assert.ok(traces?.length > 0, "expected at least one /api/auth trace");
  const out = await getTrace(traces[0].traceID);
  const parsed = JSON.parse(out);
  assert.ok(parsed.batches?.length > 0, "trace has batches");
  const allAttrs = JSON.stringify(parsed);
  assert.match(allAttrs, /db\.system/, "spans carry db.system attribute");
});

test("tempo metrics aggregation groups by span.k8s.pod.name (D1)", { skip: !live }, async () => {
  const out = await traceqlMetrics(
    '{ span.http.route="/api/auth" } | count_over_time() by (span.k8s.pod.name)',
  );
  const parsed = JSON.parse(out);
  assert.ok(parsed.series.length > 1, "expected multiple per-pod series, not one collapsed series");
  for (const s of parsed.series) {
    assert.ok(!JSON.stringify(s.labels).includes('"nil"'), "no nil-labeled series");
  }
});
