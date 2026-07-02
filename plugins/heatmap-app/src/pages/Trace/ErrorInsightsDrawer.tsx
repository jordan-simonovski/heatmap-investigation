import React from 'react';
import { css, keyframes } from '@emotion/css';
import { GrafanaTheme2, PanelData } from '@grafana/data';
import {
  sceneGraph,
  SceneComponentProps,
  SceneObjectBase,
  SceneObjectState,
  VizPanel,
} from '@grafana/scenes';
import { Icon, useStyles2 } from '@grafana/ui';

// Spans query filters to error/exception spans only, so returned row count IS the error count.
export function errorCount(data: PanelData | undefined): number {
  return data?.series?.[0]?.length ?? 0;
}

export interface ErrorInsightsDrawerState extends SceneObjectState {
  expanded: boolean;
  panel: VizPanel;
}

export class ErrorInsightsDrawer extends SceneObjectBase<ErrorInsightsDrawerState> {
  static Component = ErrorInsightsRenderer;
}

function ErrorInsightsRenderer({ model }: SceneComponentProps<ErrorInsightsDrawer>) {
  const { expanded, panel } = model.useState();
  const { data } = sceneGraph.getData(model).useState();
  const count = errorCount(data);
  const hasErrors = count > 0;
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.container}>
      {expanded && (
        <div className={styles.panel}>
          <panel.Component model={panel} />
        </div>
      )}
      <button
        type="button"
        className={css(styles.bar, hasErrors && styles.barGlow)}
        onClick={() => model.setState({ expanded: !expanded })}
        aria-expanded={expanded}
      >
        <span className={styles.label}>
          <Icon name={hasErrors ? 'exclamation-triangle' : 'check-circle'} />
          {hasErrors ? `Error insights (${count})` : 'No errors detected'}
        </span>
        <Icon name={expanded ? 'angle-down' : 'angle-up'} />
      </button>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => {
  const glow = keyframes({
    '0%, 100%': { boxShadow: `0 0 0 0 ${theme.colors.error.transparent}` },
    '50%': { boxShadow: `0 0 12px 2px ${theme.colors.error.border}` },
  });

  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
    }),
    panel: css({
      height: 360,
      marginBottom: theme.spacing(1),
    }),
    bar: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: theme.spacing(1, 2),
      background: theme.colors.background.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      borderRadius: theme.shape.radius.default,
      color: theme.colors.text.secondary,
      cursor: 'pointer',
      '&:hover': { background: theme.colors.action.hover },
    }),
    barGlow: css({
      color: theme.colors.error.text,
      borderColor: theme.colors.error.border,
      animation: `${glow} 2s ease-in-out infinite`,
      // ponytail: static border fallback; drop when no reduced-motion users complain
      '@media (prefers-reduced-motion: reduce)': {
        animation: 'none',
        boxShadow: `0 0 0 1px ${theme.colors.error.border}`,
      },
    }),
    label: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      fontWeight: theme.typography.fontWeightMedium,
    }),
  };
};
