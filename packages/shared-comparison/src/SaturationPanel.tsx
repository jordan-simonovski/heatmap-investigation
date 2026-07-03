import React from 'react';
import {
  AdHocFiltersVariable,
  QueryVariable,
  SceneComponentProps,
  SceneObjectBase,
  SceneObjectState,
  sceneGraph,
} from '@grafana/scenes';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { HeatmapSelection } from './types';
import { ResourceComparisonRow, SaturationScore, scoreSaturation } from './saturation';
import { buildSaturationComparisonSql, DEFAULT_METRICS_TABLE } from './saturationSql';

export interface SaturationPanelConfig {
  datasource: { uid: string; type: string };
  metricsTable?: string;
  /** The consuming app decides what "view signals" means (e.g. reveal a detail panel). */
  onViewSignals?: (service: string, pod: string) => void;
}

interface SaturationPanelState extends SceneObjectState {
  selection: HeatmapSelection | null;
  scores: SaturationScore[];
  loading: boolean;
  /** True when the metrics query failed or returned nothing — renders the actionable empty state. */
  unavailable: boolean;
}

/**
 * Positional parser for the buildSaturationComparisonSql column order:
 * service, pod, metric, p95_selection, p95_baseline, selection_samples, max_selection.
 */
export function parseComparisonFrames(values: unknown[][] | undefined): ResourceComparisonRow[] {
  if (!values || values.length < 7) {
    return [];
  }
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(v);
    return v == null || !isFinite(n) ? null : n;
  };
  const [services, pods, metrics, p95Sel, p95Base, samples, maxSel] = values;
  return services.map((s, i) => ({
    service: String(s),
    pod: String(pods[i]),
    metricName: String(metrics[i]),
    p95Selection: num(p95Sel[i]),
    p95Baseline: num(p95Base[i]),
    selectionSamples: num(samples[i]) ?? 0,
    maxSelection: num(maxSel[i]),
  }));
}

const MAX_CARDS = 10;

export class SaturationPanel extends SceneObjectBase<SaturationPanelState> {
  private serviceVar: QueryVariable | null = null;
  private adHocVar: AdHocFiltersVariable | null = null;
  private requestId = 0;
  private readonly config: SaturationPanelConfig;

  constructor(config: SaturationPanelConfig) {
    super({ selection: null, scores: [], loading: false, unavailable: false });
    this.config = config;
  }

  public setServiceVariable(v: QueryVariable) {
    this.serviceVar = v;
  }

  public setAdHocVariable(v: AdHocFiltersVariable) {
    this.adHocVar = v;
  }

  public setSelection(selection: HeatmapSelection | null) {
    this.setState({ selection });
    if (selection) {
      this.runComparison(selection);
    } else {
      this.requestId++; // invalidate any in-flight request
      this.setState({ scores: [], loading: false, unavailable: false });
    }
  }

  private services(): string[] {
    if (!this.serviceVar) {
      return [];
    }
    const val = String(this.serviceVar.state.value ?? '');
    return val && val !== '$__all' && val !== '%' ? [val] : [];
  }

  /** Selection traceIds intentionally ignored: metrics cannot join on traces; correlation is time + service only. */
  private async runComparison(sel: HeatmapSelection) {
    const requestId = ++this.requestId;
    this.setState({ loading: true, unavailable: false });

    try {
      // Inside try so a synchronous throw from getTimeRange/buildSql also degrades
      // to the empty state rather than becoming an unhandled rejection (this method
      // is called without await) that leaves loading:true stuck forever.
      const tr = sceneGraph.getTimeRange(this).state.value;
      const sql = buildSaturationComparisonSql(
        { fromMs: sel.timeRange.from, toMs: sel.timeRange.to },
        { fromMs: tr.from.valueOf(), toMs: tr.to.valueOf() },
        this.services(),
        this.config.metricsTable ?? DEFAULT_METRICS_TABLE
      );

      const response = await lastValueFrom(
        getBackendSrv().fetch<{ results: Record<string, { frames: Array<{ data: { values: unknown[][] } }> }> }>({
          url: '/api/ds/query',
          method: 'POST',
          data: {
            queries: [{ refId: 'A', datasource: this.config.datasource, rawSql: sql, format: 1, queryType: 'sql' }],
            from: '0',
            to: String(Date.now()),
          },
        })
      );
      if (requestId !== this.requestId) {
        return; // superseded by a newer selection — don't clobber its results
      }
      const frames = response.data?.results?.A?.frames;
      const rows = parseComparisonFrames(frames?.[0]?.data?.values);
      const scores = scoreSaturation(rows).slice(0, MAX_CARDS);
      this.setState({ scores, loading: false, unavailable: rows.length === 0 });
    } catch (err) {
      if (requestId !== this.requestId) {
        return;
      }
      // Non-fatal by construction: metrics absence must never block span-side investigation.
      console.error('Saturation query failed:', err);
      this.setState({ scores: [], loading: false, unavailable: true });
    }
  }

  public filterToPod(pod: string) {
    if (!this.adHocVar) {
      return;
    }
    const existing = this.adHocVar.state.filters;
    if (existing.some((f) => f.key === 'k8s.pod.name' && f.value === pod && f.operator === '=')) {
      return;
    }
    // Works because k8s.pod.name is a SpanAttribute on the span side (buildFilterClause maps it).
    this.adHocVar.setState({ filters: [...existing, { key: 'k8s.pod.name', value: pod, operator: '=', condition: '' }] });
  }

  public focusService(service: string) {
    this.serviceVar?.changeValueTo(service, service);
  }

  public viewSignals(service: string, pod: string) {
    this.config.onViewSignals?.(service, pod);
  }

  public static Component = ({ model }: SceneComponentProps<SaturationPanel>) => {
    const { selection, scores, loading, unavailable } = model.useState();
    const styles = useStyles2(getStyles);

    if (!selection) {
      return (
        <div className={styles.container}>
          <div className={styles.hint}>
            <Icon name="fire" /> Select a region on the heatmap to see whether infrastructure was saturated during it.
          </div>
        </div>
      );
    }
    if (loading) {
      return <div className={styles.container}><div className={styles.hint}>Comparing resource saturation…</div></div>;
    }
    if (unavailable) {
      return (
        <div className={styles.container}>
          <div className={styles.hint}>
            No infra metrics found for this window. Check that the collector metrics pipeline is enabled
            (docker/otel-collector-config.yml, `metrics:` pipeline) and that trace-generator is emitting gauges —
            then re-select. Span-side analysis above is unaffected.
          </div>
        </div>
      );
    }
    if (scores.length === 0) {
      return (
        <div className={styles.container}>
          <div className={styles.hint}>
            No resource was more saturated during the selection than baseline. Widen the selection, or pivot via the
            attribute comparison above.
          </div>
        </div>
      );
    }

    const fmt = (s: SaturationScore) =>
      s.signal.kind === 'utilization'
        ? `${Math.round(s.selectionValue * 100)}% during selection vs ${Math.round(s.baselineValue * 100)}% baseline (+${Math.round(s.score * 100)}pts)`
        : `${s.selectionValue.toFixed(1)} during selection vs ${s.baselineValue.toFixed(1)} baseline (×${(s.selectionValue / Math.max(s.baselineValue, 1e-6)).toFixed(1)})`;

    return (
      <div className={styles.container}>
        <div className={styles.title}>Infra saturation during selection</div>
        {scores.map((s) => (
          <div key={`${s.service}|${s.pod}|${s.signal.metricName}`} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.resource}>
                {s.service} · {s.pod} · {s.signal.label}
                {s.lowConfidence ? ' (low sample — max shown)' : ''}
              </span>
              <span className={styles.delta}>{fmt(s)}</span>
            </div>
            <div className={styles.actions}>
              <Button size="sm" variant="secondary" icon="filter" onClick={() => model.filterToPod(s.pod)}>
                Filter to {s.pod}
              </Button>
              <Button size="sm" variant="secondary" icon="crosshair" onClick={() => model.focusService(s.service)}>
                Focus {s.service}
              </Button>
              <Button size="sm" variant="secondary" icon="graph-bar" onClick={() => model.viewSignals(s.service, s.pod)}>
                View signals
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  };
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    padding: theme.spacing(1),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  title: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  hint: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    padding: theme.spacing(1),
  }),
  card: css({
    background: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1),
  }),
  cardHeader: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(0.5),
  }),
  resource: css({
    fontWeight: theme.typography.fontWeightMedium,
  }),
  delta: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  actions: css({
    display: 'flex',
    gap: theme.spacing(0.5),
  }),
});
