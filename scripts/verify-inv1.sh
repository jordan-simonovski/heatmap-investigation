#!/usr/bin/env bash
# INV-1 fairness gate: discriminating attributes must be ABSENT from the
# metrics pillar (Prometheus) but PRESENT in logs (Loki) and traces (ClickHouse
# otel_traces / Tempo). Run after `make up`. Exits non-zero on any violation.
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

echo "== logs pillar MUST carry discriminating attributes (S1 feature_flag) =="
n=$(docker exec clickhouse-server clickhouse-client --query \
  "SELECT count() FROM otel_logs WHERE LogAttributes['app.feature_flag']='new-checkout-flow'")
echo "  otel_logs rows with S1 feature_flag: $n"
[ "$n" -gt 0 ] || { echo "  VIOLATION: S1 discriminating attr missing from logs"; fail=1; }

echo "== traces pillar MUST carry discriminating attributes (S1 feature_flag) =="
t=$(docker exec clickhouse-server clickhouse-client --query \
  "SELECT count() FROM otel_traces WHERE SpanAttributes['app.feature_flag']='new-checkout-flow'")
echo "  otel_traces spans with S1 feature_flag: $t"
[ "$t" -gt 0 ] || { echo "  VIOLATION: S1 discriminating attr missing from traces"; fail=1; }

if [ "$fail" -ne 0 ]; then echo "INV-1 FAILED"; exit 1; fi
echo "INV-1 OK"
