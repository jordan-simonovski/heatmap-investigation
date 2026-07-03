import type Anthropic from "@anthropic-ai/sdk";
import { clickhouseSql } from "../backends/clickhouse.ts";
import type { ArmTools } from "./types.ts";

const clickhouseTool: Anthropic.Tool = {
  name: "clickhouse_sql",
  description:
    "Run a ClickHouse SQL query over the otel_traces table (one wide row per span, all attributes in SpanAttributes/ResourceAttributes maps). Returns TabSeparatedWithNames.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "ClickHouse SQL." } },
    required: ["query"],
  },
};

export const wideSqlArm: ArmTools = {
  name: "wide-sql",
  definitions: [clickhouseTool],
  handlers: { clickhouse_sql: (i) => clickhouseSql(i.query) },
};
