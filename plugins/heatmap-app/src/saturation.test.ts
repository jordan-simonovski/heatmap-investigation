// Import via the package alias (external to tsc's rootDir), NOT a relative source
// path: a relative import pulls shared-comparison src into heatmap-app's program
// (TS6059). require after the IntersectionObserver polyfill because the alias's
// index re-exports a scene object whose LazyLoader touches IntersectionObserver at
// import time (house pattern, see saturationParse.test.ts / filterSemantics.test.js).
// Jest globals imported explicitly: @types/jest is hoisted to the repo-root
// node_modules, which the scaffold's typeRoots (../node_modules/@types) doesn't
// cover, so tsc can't see ambient describe/it/expect in a .test.ts.
import { describe, expect, it } from '@jest/globals';
import type { ResourceComparisonRow } from '@heatmap/shared-comparison';

global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

const { scoreSaturation, SATURATION_SIGNALS } =
  require('@heatmap/shared-comparison') as typeof import('@heatmap/shared-comparison');

const row = (over: Partial<ResourceComparisonRow>): ResourceComparisonRow => ({
  service: 'user-service',
  pod: 'pod-abc-7',
  metricName: 'memory.utilization',
  p95Selection: 0.92,
  p95Baseline: 0.4,
  selectionSamples: 20,
  maxSelection: 0.95,
  ...over,
});

describe('SATURATION_SIGNALS registry', () => {
  it('contains the four v1 signals with correct kinds', () => {
    const byName = Object.fromEntries(SATURATION_SIGNALS.map((s) => [s.metricName, s.kind]));
    expect(byName).toEqual({
      'cpu.utilization': 'utilization',
      'memory.utilization': 'utilization',
      'db.pool.utilization': 'utilization',
      'queue.depth': 'counter',
    });
  });
});

describe('scoreSaturation', () => {
  it('scores utilization as p95 delta and ranks descending', () => {
    const scores = scoreSaturation([
      row({ p95Selection: 0.92, p95Baseline: 0.4 }), // +0.52
      row({ service: 'api-gateway', metricName: 'cpu.utilization', p95Selection: 0.5, p95Baseline: 0.4 }), // +0.10
    ]);
    expect(scores).toHaveLength(2);
    expect(scores[0].service).toBe('user-service');
    expect(scores[0].score).toBeCloseTo(0.52);
    expect(scores[1].score).toBeCloseTo(0.1);
  });

  it('drops zero and negative deltas (directional, selection-first)', () => {
    const scores = scoreSaturation([
      row({ p95Selection: 0.4, p95Baseline: 0.4 }),
      row({ p95Selection: 0.3, p95Baseline: 0.6 }),
    ]);
    expect(scores).toHaveLength(0);
  });

  it('scores counters as relative delta against their own baseline', () => {
    const scores = scoreSaturation([
      row({ metricName: 'queue.depth', p95Selection: 45, p95Baseline: 3 }),
    ]);
    expect(scores).toHaveLength(1);
    expect(scores[0].score).toBeCloseTo((45 - 3) / 3);
  });

  it('treats a missing baseline like zero (new-signal case)', () => {
    const scores = scoreSaturation([row({ p95Baseline: null, p95Selection: 0.9 })]);
    expect(scores).toHaveLength(1);
    expect(scores[0].score).toBeCloseTo(0.9);
  });

  it('skips rows with no selection value and unknown metrics', () => {
    const scores = scoreSaturation([
      row({ p95Selection: null, maxSelection: null }),
      row({ metricName: 'not.a.signal' }),
    ]);
    expect(scores).toHaveLength(0);
  });

  it('falls back to maxSelection and flags lowConfidence for small selections', () => {
    const scores = scoreSaturation([
      row({ selectionSamples: 1, p95Selection: null, maxSelection: 0.9, p95Baseline: 0.4 }),
    ]);
    expect(scores).toHaveLength(1);
    expect(scores[0].lowConfidence).toBe(true);
    expect(scores[0].selectionValue).toBeCloseTo(0.9);
    expect(scores[0].score).toBeCloseTo(0.5);
  });

  it('breaks ties deterministically by service, then pod', () => {
    const scores = scoreSaturation([
      row({ service: 'zeta-svc', p95Selection: 0.9, p95Baseline: 0.4 }),
      row({ service: 'alpha-svc', p95Selection: 0.9, p95Baseline: 0.4 }),
    ]);
    expect(scores.map((s) => s.service)).toEqual(['alpha-svc', 'zeta-svc']);
  });

  it('returns empty for empty input', () => {
    expect(scoreSaturation([])).toEqual([]);
  });
});
