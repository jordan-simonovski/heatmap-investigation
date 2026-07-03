// Jest globals imported explicitly: @types/jest is hoisted to repo-root node_modules,
// outside the scaffold's typeRoots, so tsc can't see ambient describe/it/expect.
import { describe, expect, it } from '@jest/globals';
// SaturationPanel.tsx imports @grafana/scenes, whose LazyLoader touches
// IntersectionObserver at import time — polyfill it before requiring the module.
// require (not import) keeps this ordering: ES imports are hoisted, require is not
// (house pattern, see filterSemantics.test.js / errorInsightsDrawer.test.js).
global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

// Import via the package alias (external to tsc's rootDir), NOT a relative source
// path: a relative require of SaturationPanel.tsx would pull its ./types import
// into heatmap-app's program as source outside rootDir (TS6059). Matches the
// house pattern (filterSemantics.test.js requires '@heatmap/shared-comparison').
const { parseComparisonFrames } = require('@heatmap/shared-comparison') as typeof import('@heatmap/shared-comparison');

describe('parseComparisonFrames', () => {
  // Positional contract from buildSaturationComparisonSql:
  // service, pod, metric, p95_selection, p95_baseline, selection_samples, max_selection
  it('maps positional columns into rows', () => {
    const rows = parseComparisonFrames([
      ['user-service'],
      ['pod-abc-7'],
      ['memory.utilization'],
      [0.92],
      [0.4],
      [18],
      [0.95],
    ]);
    expect(rows).toEqual([
      {
        service: 'user-service',
        pod: 'pod-abc-7',
        metricName: 'memory.utilization',
        p95Selection: 0.92,
        p95Baseline: 0.4,
        selectionSamples: 18,
        maxSelection: 0.95,
      },
    ]);
  });

  it('converts null/NaN quantiles (empty windows) to null', () => {
    const rows = parseComparisonFrames([['s'], ['p'], ['cpu.utilization'], [null], [NaN], [0], [null]]);
    expect(rows[0].p95Selection).toBeNull();
    expect(rows[0].p95Baseline).toBeNull();
    expect(rows[0].maxSelection).toBeNull();
    expect(rows[0].selectionSamples).toBe(0);
  });

  it('returns empty for missing or short frames', () => {
    expect(parseComparisonFrames(undefined)).toEqual([]);
    expect(parseComparisonFrames([['a'], ['b']])).toEqual([]);
  });
});
