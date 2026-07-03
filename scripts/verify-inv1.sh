#!/usr/bin/env bash
# INV-1 fairness gate: discriminating attributes must be ABSENT from the
# metrics pillar (Prometheus) but PRESENT in the real arm-C backends —
# Loki (logs) and Tempo (traces). Run after `make up`. Exits non-zero on
# any violation.
#
# Present-side proof is against Loki + Tempo (not ClickHouse otel_logs/
# otel_traces) because arm C actually queries Loki/Tempo at demo time;
# proving presence in ClickHouse alone would not prove INV-1 for the arm
# that matters.
#
# Scope note: host.region (host_region in Loki, host.region in Tempo) is a
# LEGITIMATE low-cardinality metric label — real RED metrics carry region —
# so it is intentionally EXCLUDED from the high-cardinality absence
# blocklist below. S6 (region-only scenario) is therefore an expected TIE:
# it has no high-cardinality discriminator, so it is metrics-solvable in
# both arms. The gate does not (and must not) assert region is absent, and
# does not assert any high-card presence for S6 — it only notes the tie.
set -euo pipefail

HIGH_CARD=(app_feature_flag app_tenant_id app_build_id k8s_pod_name app_platform user_id)
fail=0

echo "== metrics pillar must NOT carry high-cardinality discriminating labels =="
# Sweep EVERY label name that appears on the span-derived RED-metrics arm (the
# metrics pillar INV-1 governs), not a single metric — so a renamed metric in the
# arm can't make "absence" vacuous. Scoped to traces_span_metrics_* so the
# separate infra-saturation USE metrics (which legitimately carry k8s_pod_name to
# correlate saturation to a pod) don't get conflated with the RED-metrics arm.
alllabels=$(curl -sf --max-time 10 \
  'http://localhost:9090/api/v1/labels?match[]=%7B__name__=~%22traces_span_metrics_.*%22%7D' \
  | python3 -c "import sys,json;print(' '.join(json.load(sys.stdin)['data']))")
echo "  span-metrics arm label names: ${alllabels}"
for k in "${HIGH_CARD[@]}"; do
  if grep -qw "$k" <<<"$alllabels"; then echo "  VIOLATION: $k present in metrics"; fail=1; fi
done

# Prove the span-derived metrics actually EXIST, so "absent" isn't proven over
# nothing (empty result would otherwise silently pass the grep above).
series=$(curl -sf --max-time 10 "http://localhost:9090/api/v1/query?query=traces_span_metrics_calls_total" \
  | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data']['result']))")
echo "  traces_span_metrics_calls_total series: $series"
[ "$series" -gt 0 ] || { echo "  VIOLATION: metrics pillar has no span-derived series; cannot prove absence over nothing"; fail=1; }

# ---------------------------------------------------------------------------
# Per-scenario PRESENT-side sweep against the real arm-C backends.
#
# Loki attribute naming (OTLP ingest, Loki 3.3.2): dotted OTel attribute keys
# arrive as per-line STRUCTURED METADATA with dots replaced by underscores
# (app.feature_flag -> app_feature_flag). They are NOT stream/index labels
# (confirmed: /loki/api/v1/labels only lists service_name + __stream_shard__),
# so they must be matched with a LogQL pipe filter, not a `{}` stream
# selector: `{service_name="trace-generator"} | app_feature_flag=`value``.
#
# Tempo attribute naming (2.6.1): TraceQL search uses the `span.<key>` scope
# with the ORIGINAL dotted key, e.g. `{span.app.feature_flag="value"}`.
# ---------------------------------------------------------------------------

now=$(date +%s)
LOKI_START="$(( now - 7200 ))000000000"
LOKI_END="${now}000000000"

loki_count() {
  # loki_count <structured-metadata-key> <logql-value-expr-including-backticks>
  local key=$1 valexpr=$2
  curl -sf --max-time 10 -G http://localhost:3100/loki/api/v1/query_range \
    --data-urlencode "query={service_name=\"trace-generator\"} | ${key}=${valexpr}" \
    --data-urlencode 'limit=5' \
    --data-urlencode "start=${LOKI_START}" \
    --data-urlencode "end=${LOKI_END}" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(sum(len(r['values']) for r in d['data']['result']))"
}

tempo_count() {
  # tempo_count <traceql-query>
  local q=$1
  curl -sf --max-time 10 -G http://localhost:3200/api/search \
    --data-urlencode "q=${q}" \
    --data-urlencode 'limit=5' \
    --data-urlencode "start=$(( $(date +%s) - 7200 ))" \
    --data-urlencode "end=$(date +%s)" \
    | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('traces',[])))"
}

assert_loki() {
  local label=$1 key=$2 valexpr=$3 human=$4
  local n
  n=$(loki_count "$key" "$valexpr")
  echo "  [$label] Loki ${key}=${valexpr} ($human): $n entries"
  [ "$n" -gt 0 ] || { echo "  VIOLATION: [$label] $human missing from Loki"; fail=1; }
}

assert_tempo() {
  local label=$1 q=$2 human=$3
  local n
  n=$(tempo_count "$q")
  echo "  [$label] Tempo ${q} ($human): $n traces"
  [ "$n" -gt 0 ] || { echo "  VIOLATION: [$label] $human missing from Tempo"; fail=1; }
}

echo "== logs pillar (Loki) MUST carry each scenario's high-cardinality discriminating attribute(s) =="
assert_loki S1 app_feature_flag '`new-checkout-flow`' "feature_flag"
assert_loki S2 app_platform '`ios`' "platform"
assert_loki S2 app_build_id '`build-7a3`' "build_id"
assert_loki S4 app_tenant_id '`tenant-initech`' "tenant_id"
assert_loki S4 app_feature_flag '`dark-launch-search`' "feature_flag"
assert_loki S5 app_build_id '`build-7a3`' "build_id"
assert_loki S5 k8s_pod_name '~`pod-abc-7|pod-abc-8`' "pod name"
assert_loki S7 app_tenant_id '`tenant-umbrella`' "tenant_id"
assert_loki S8 app_tenant_id '`tenant-globex`' "tenant_id"

echo "== traces pillar (Tempo) MUST carry the discriminating attribute(s), incl. trace-only ones =="
assert_tempo S1 '{span.app.feature_flag="new-checkout-flow"}' "feature_flag"
assert_tempo S3 '{span.db.system="redis"}' "db.system (TRACE-ONLY: not on log records — traces carry what logs don't)"
assert_tempo S5 '{span.k8s.pod.name=~"pod-abc-7|pod-abc-8"}' "pod name"

echo "== S6 (region-only) is an expected TIE, not a gate assertion =="
echo "  S6's only discriminator is host.region, a legitimate low-cardinality metric label."
echo "  It is metrics-solvable in both arms, so no high-card present-side check applies to S6."

if [ "$fail" -ne 0 ]; then echo "INV-1 FAILED"; exit 1; fi
echo "INV-1 OK"
