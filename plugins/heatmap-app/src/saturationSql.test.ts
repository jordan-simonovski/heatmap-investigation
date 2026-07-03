// Jest globals imported explicitly: @types/jest is hoisted to repo-root node_modules,
// outside the scaffold's typeRoots, so tsc can't see ambient describe/it/expect.
import { describe, expect, it } from '@jest/globals';
// Import via the package alias (external to tsc's rootDir), NOT a relative source
// path, to avoid pulling shared-comparison src into heatmap-app's program (TS6059).
// require after the IntersectionObserver polyfill: the alias's index re-exports a
// scene object whose LazyLoader touches IntersectionObserver at import time.
global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

const {
  buildResourceSeriesSql,
  buildSaturationComparisonSql,
  buildResourceDetailSql,
  DEFAULT_METRICS_TABLE,
} = require('@heatmap/shared-comparison') as typeof import('@heatmap/shared-comparison');

describe('buildResourceSeriesSql', () => {
  it('aggregates max utilization per (bucket, service) — long format for partitionByValues', () => {
    const sql = buildResourceSeriesSql([]);
    expect(sql).toContain('$__timeFilter(TimeUnix)');
    expect(sql).toContain(`FROM ${DEFAULT_METRICS_TABLE}`);
    expect(sql).toContain("'cpu.utilization', 'memory.utilization', 'db.pool.utilization'");
    expect(sql).not.toContain('queue.depth'); // counters are not 0-1 comparable; strip is utilization-only
    // one row per (time, service) so a Grafana partitionByValues transform can split
    // it into one line per service (no hardcoded service list in TS).
    expect(sql).toContain("ResourceAttributes['service.name'] AS service");
    expect(sql).toContain('max(Value) AS saturation');
    expect(sql).toContain('GROUP BY time, service');
    expect(sql).not.toContain("ResourceAttributes['service.name'] IN"); // no filter when services empty
  });

  it('filters and escapes service names', () => {
    const sql = buildResourceSeriesSql(["user-service", "bad'svc"]);
    expect(sql).toContain("ResourceAttributes['service.name'] IN ('user-service', 'bad\\'svc')");
  });
});

describe('buildSaturationComparisonSql', () => {
  const selection = { fromMs: 1000, toMs: 2000 };
  const panel = { fromMs: 0, toMs: 10000 };

  it('computes selection and baseline p95 in one pass with the documented column order', () => {
    const sql = buildSaturationComparisonSql(selection, panel, []);
    expect(sql).toContain(
      'quantileIf(0.95)(Value, TimeUnix >= fromUnixTimestamp64Milli(1000) AND TimeUnix <= fromUnixTimestamp64Milli(2000)) AS p95_selection'
    );
    expect(sql).toContain(
      'quantileIf(0.95)(Value, NOT (TimeUnix >= fromUnixTimestamp64Milli(1000) AND TimeUnix <= fromUnixTimestamp64Milli(2000))) AS p95_baseline'
    );
    // baseline is bounded by the panel window in the outer WHERE
    expect(sql).toContain('WHERE TimeUnix >= fromUnixTimestamp64Milli(0) AND TimeUnix <= fromUnixTimestamp64Milli(10000)');
    // positional parse contract
    const selectIdx = ['AS service', 'AS pod', 'AS metric', 'AS p95_selection', 'AS p95_baseline', 'AS selection_samples', 'AS max_selection'].map((c) => sql.indexOf(c));
    expect([...selectIdx].sort((a, b) => a - b)).toEqual(selectIdx);
    expect(sql).toContain('GROUP BY service, pod, metric');
    // all four signals included
    expect(sql).toContain("'queue.depth'");
  });

  it('floors fractional milliseconds', () => {
    const sql = buildSaturationComparisonSql({ fromMs: 1000.9, toMs: 2000.9 }, panel, []);
    expect(sql).toContain('fromUnixTimestamp64Milli(1000)');
    expect(sql).toContain('fromUnixTimestamp64Milli(2000)');
  });

  it('applies the escaped service filter', () => {
    const sql = buildSaturationComparisonSql(selection, panel, ["a'b"]);
    expect(sql).toContain("AND ResourceAttributes['service.name'] IN ('a\\'b')");
  });
});

describe('buildResourceDetailSql', () => {
  it('pivots one column per signal for a single resource, escaped', () => {
    const sql = buildResourceDetailSql("user-service", "pod'7");
    expect(sql).toContain('$__timeFilter(TimeUnix)');
    expect(sql).toContain("ResourceAttributes['service.name'] = 'user-service'");
    expect(sql).toContain("ResourceAttributes['k8s.pod.name'] = 'pod\\'7'");
    expect(sql).toContain("maxIf(Value, MetricName = 'cpu.utilization') AS \"CPU\"");
    expect(sql).toContain("maxIf(Value, MetricName = 'queue.depth') AS \"Queue depth\"");
    expect(sql).toContain('GROUP BY time');
  });
});
