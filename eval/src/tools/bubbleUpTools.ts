import type Anthropic from "@anthropic-ai/sdk";
import { clickhouseSql } from "../backends/clickhouse.ts";
import { escapeSql } from "@heatmap/shared-comparison/src/sqlFilters.ts";
import type { ArmTools } from "./types.ts";

const clickhouseTool: Anthropic.Tool = {
  name: "clickhouse_sql",
  description:
    "Run a ClickHouse SQL query over otel_traces. Returns TabSeparatedWithNames.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};

// rank_attributes: for a selection predicate, rank which attribute values are
// over-represented in the selection vs its NOT(selection) baseline — the
// bubble-up grammar from packages/shared-comparison, executed as SQL.
const rankTool: Anthropic.Tool = {
  name: "rank_attributes",
  description:
    "Given a WHERE predicate identifying a selected region of spans, rank which SpanAttributes keys/values are most over-represented in the selection vs the baseline (NOT the predicate). Use this to find what distinguishes the failing requests.",
  input_schema: {
    type: "object",
    properties: {
      selection_predicate: {
        type: "string",
        description: "A ClickHouse boolean expression over otel_traces columns, e.g. \"StatusCode='STATUS_CODE_ERROR'\".",
      },
      attribute_keys: {
        type: "array",
        items: { type: "string" },
        description: "SpanAttributes keys to compare, e.g. [\"app.feature_flag\",\"host.region\"].",
      },
    },
    required: ["selection_predicate", "attribute_keys"],
  },
};

async function rankAttributes(input: {
  selection_predicate: string;
  attribute_keys: string[];
}): Promise<string> {
  // For each key, compare selection share vs baseline share (percentage-point
  // diff, selection-first) — mirrors computeComparison in shared-comparison.
  // Rank by over-representation (sel_pct - base_pct), NOT by raw selection
  // frequency, so a value common in both selection and baseline does not win.
  const pred = input.selection_predicate;
  const parts = input.attribute_keys.map((key) => {
    const col = `SpanAttributes['${escapeSql(key)}']`;
    return `
SELECT
  '${key}' AS attr,
  ${col} AS value,
  countIf(${pred}) AS sel,
  countIf(NOT (${pred})) AS base,
  round(100 * sel / nullIf(sum(sel) OVER (), 0), 2) AS sel_pct,
  round(100 * base / nullIf(sum(base) OVER (), 0), 2) AS base_pct,
  round(sel_pct - base_pct, 2) AS diff
FROM otel_traces
WHERE ${col} != ''
GROUP BY value
HAVING sel > 0
ORDER BY diff DESC
LIMIT 5`;
  });
  const sql = parts.join("\nUNION ALL\n");
  return clickhouseSql(sql);
}

export const bubbleUpArm: ArmTools = {
  name: "bubble-up",
  definitions: [clickhouseTool, rankTool],
  handlers: {
    clickhouse_sql: (i) => clickhouseSql(i.query),
    rank_attributes: (i) => rankAttributes(i),
  },
};
