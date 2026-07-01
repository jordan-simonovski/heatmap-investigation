import { BadgeColor } from '@grafana/ui';
import { components } from '../../api/generated/types';

export type BurnSeverity = 'fast' | 'slow' | 'none';

const SEVERITY_META: Record<BurnSeverity, { label: string; color: BadgeColor; weight: number }> = {
  fast: { label: 'Fast burn', color: 'red', weight: 3 },
  slow: { label: 'Slow burn', color: 'orange', weight: 2 },
  none: { label: 'No burn', color: 'blue', weight: 1 },
};

export function getBurnSeverity(source: string): BurnSeverity {
  if (source.endsWith(':fast')) {
    return 'fast';
  }
  if (source.endsWith(':slow')) {
    return 'slow';
  }
  return 'none';
}

export const getSeverityLabel = (severity: BurnSeverity): string => SEVERITY_META[severity].label;
export const getSeverityBadgeColor = (severity: BurnSeverity): BadgeColor => SEVERITY_META[severity].color;
export const getSeverityWeight = (severity: BurnSeverity): number => SEVERITY_META[severity].weight;

// Active burn risk per SLO id: sum severity weights of unresolved burn events.
export function computeActiveRisk(burnEvents: components['schemas']['BurnEvent'][]): Map<string, number> {
  const risk = new Map<string, number>();
  for (const burn of burnEvents) {
    if (burn.eventType === 'burn_resolved') {
      continue;
    }
    const weight = getSeverityWeight(getBurnSeverity(burn.source));
    risk.set(burn.sloId, (risk.get(burn.sloId) ?? 0) + weight);
  }
  return risk;
}
