export type SignalKind = 'utilization' | 'counter';

export interface SaturationSignal {
  metricName: string;
  kind: SignalKind;
  label: string;
}

/** v1 signal registry — hardcoded, mirrors trace-generator/metrics.go. */
export const SATURATION_SIGNALS: SaturationSignal[] = [
  { metricName: 'cpu.utilization', kind: 'utilization', label: 'CPU' },
  { metricName: 'memory.utilization', kind: 'utilization', label: 'Memory' },
  { metricName: 'db.pool.utilization', kind: 'utilization', label: 'DB pool' },
  { metricName: 'queue.depth', kind: 'counter', label: 'Queue depth' },
];

/** Below this many datapoints in the selection window, p95 is unstable — fall back to max and flag. */
export const MIN_SELECTION_SAMPLES = 3;

export interface ResourceComparisonRow {
  service: string;
  pod: string;
  metricName: string;
  p95Selection: number | null;
  p95Baseline: number | null;
  selectionSamples: number;
  maxSelection: number | null;
}

export interface SaturationScore {
  service: string;
  pod: string;
  signal: SaturationSignal;
  score: number;
  selectionValue: number;
  baselineValue: number;
  lowConfidence: boolean;
}

const COUNTER_EPSILON = 1e-6;

/**
 * Directional, selection-first scoring — same semantics as computeComparison:
 * only over-representation in the selection is signal; score <= 0 is dropped.
 * utilization: score = p95_selection - p95_baseline (percentage points).
 * counter:     score = (p95_selection - p95_baseline) / max(p95_baseline, eps).
 * ponytail: p95-delta scoring; upgrade is effect-size normalization (z-score)
 * if noisy signals demonstrably mis-rank — frontier work, do not gold-plate.
 */
export function scoreSaturation(rows: ResourceComparisonRow[]): SaturationScore[] {
  const signalByName = new Map(SATURATION_SIGNALS.map((s) => [s.metricName, s]));
  const scores: SaturationScore[] = [];

  for (const r of rows) {
    const signal = signalByName.get(r.metricName);
    if (!signal) {
      continue;
    }

    const lowConfidence = r.selectionSamples < MIN_SELECTION_SAMPLES;
    const selectionValue = lowConfidence ? r.maxSelection : r.p95Selection;
    if (selectionValue == null || !isFinite(selectionValue)) {
      continue;
    }
    const baselineValue = r.p95Baseline != null && isFinite(r.p95Baseline) ? r.p95Baseline : 0;

    const score =
      signal.kind === 'utilization'
        ? selectionValue - baselineValue
        : (selectionValue - baselineValue) / Math.max(baselineValue, COUNTER_EPSILON);

    if (score <= 0) {
      continue;
    }
    scores.push({ service: r.service, pod: r.pod, signal, score, selectionValue, baselineValue, lowConfidence });
  }

  scores.sort(
    (a, b) =>
      b.score - a.score ||
      a.service.localeCompare(b.service) ||
      a.pod.localeCompare(b.pod)
  );
  return scores;
}
