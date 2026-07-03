import { escapeSql } from './sqlFilters';
import { SATURATION_SIGNALS } from './saturation';

/**
 * Metrics land in the table created by the collector's ClickHouse exporter
 * (docker/otel-collector-config.yml, create_schema: true). Verified against
 * otel_metrics_gauge: ResourceAttributes Map, MetricName, Value Float64,
 * TimeUnix DateTime64(9). (Contrib 0.155.0 also happens to expose a ServiceName
 * column, but exporter versions differ — always read the portable
 * ResourceAttributes['service.name'] Map key, never a top-level column.)
 */
export const DEFAULT_METRICS_TABLE = 'otel_metrics_gauge';

export interface MsWindow {
  fromMs: number;
  toMs: number;
}

const quoted = (v: string) => `'${escapeSql(v)}'`;

function serviceFilter(services: string[]): string {
  if (services.length === 0) {
    return '';
  }
  return `\n  AND ResourceAttributes['service.name'] IN (${services.map(quoted).join(', ')})`;
}

function timePredicate(w: MsWindow): string {
  return `TimeUnix >= fromUnixTimestamp64Milli(${Math.floor(w.fromMs)}) AND TimeUnix <= fromUnixTimestamp64Milli(${Math.floor(w.toMs)})`;
}

/** Ambient strip: max utilization per 15s bucket across the in-view services. Utilization-only — counters are not 0-1 comparable. */
export function buildResourceSeriesSql(services: string[], table = DEFAULT_METRICS_TABLE): string {
  const utilization = SATURATION_SIGNALS.filter((s) => s.kind === 'utilization')
    .map((s) => quoted(s.metricName))
    .join(', ');
  return `SELECT
  toStartOfInterval(TimeUnix, INTERVAL 15 SECOND) AS time,
  max(Value) AS saturation
FROM ${table}
WHERE $__timeFilter(TimeUnix)
  AND MetricName IN (${utilization})${serviceFilter(services)}
GROUP BY time
ORDER BY time`;
}

/**
 * One pass over the gauge table: p95 inside the selection window vs p95 in the
 * rest of the panel window, per (service, pod, metric). Baseline = panel
 * window AND NOT selection — mirrors the span-side pattern in
 * AttributeComparisonPanel.runComparison. Column order is the positional
 * parse contract for parseComparisonFrames — keep in sync.
 * NOTE: selection traceIds do NOT apply here (metrics cannot join on traces);
 * correlation is time + service only, by design.
 */
export function buildSaturationComparisonSql(
  selection: MsWindow,
  panel: MsWindow,
  services: string[],
  table = DEFAULT_METRICS_TABLE
): string {
  const selPred = timePredicate(selection);
  const allSignals = SATURATION_SIGNALS.map((s) => quoted(s.metricName)).join(', ');
  return `SELECT
  ResourceAttributes['service.name'] AS service,
  ResourceAttributes['k8s.pod.name'] AS pod,
  MetricName AS metric,
  quantileIf(0.95)(Value, ${selPred}) AS p95_selection,
  quantileIf(0.95)(Value, NOT (${selPred})) AS p95_baseline,
  countIf(${selPred}) AS selection_samples,
  maxIf(Value, ${selPred}) AS max_selection
FROM ${table}
WHERE ${timePredicate(panel)}
  AND MetricName IN (${allSignals})${serviceFilter(services)}
GROUP BY service, pod, metric`;
}

/** Resource detail panel: one series per signal for a single (service, pod). */
export function buildResourceDetailSql(service: string, pod: string, table = DEFAULT_METRICS_TABLE): string {
  const pivots = SATURATION_SIGNALS.map(
    (s) => `maxIf(Value, MetricName = ${quoted(s.metricName)}) AS "${s.label}"`
  ).join(',\n  ');
  return `SELECT
  toStartOfInterval(TimeUnix, INTERVAL 15 SECOND) AS time,
  ${pivots}
FROM ${table}
WHERE $__timeFilter(TimeUnix)
  AND ResourceAttributes['service.name'] = ${quoted(service)}
  AND ResourceAttributes['k8s.pod.name'] = ${quoted(pod)}
GROUP BY time
ORDER BY time`;
}
