import type Anthropic from "@anthropic-ai/sdk";
import { promql } from "../backends/prometheus.ts";
import { logql } from "../backends/loki.ts";
import { traceql, getTrace, traceqlMetrics } from "../backends/tempo.ts";
import type { ArmTools } from "./types.ts";

const promTool: Anthropic.Tool = {
  name: "promql",
  description: "Run an instant PromQL query against Prometheus (RED metrics: traces_span_metrics_*). Metrics carry only low-cardinality labels (service, http_route, host_region, status_code).",
  input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};
const lokiTool: Anthropic.Tool = {
  name: "loki_logql",
  description: "Run a LogQL query against Loki over the last 2h. Per-request attributes are structured metadata (e.g. `{service_name=\"trace-generator\"} | app_feature_flag=\\`value\\``).",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number", description: "Max log lines to return (default 50). Raise it if you need more rows." },
    },
    required: ["query"],
  },
};
const tempoTool: Anthropic.Tool = {
  name: "traceql",
  description: "Run a TraceQL search against Tempo over the last 2h (e.g. `{ span.app.feature_flag=\"value\" }`). Returns trace SUMMARIES ONLY (traceID, root service, duration) — no span attributes. Use `get_trace` to read a trace's spans and their attributes, and `traceql_metrics` to aggregate/group-by server-side instead of paging summaries.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number", description: "Max trace summaries to return (default 20). Raise it if you need more rows." },
    },
    required: ["query"],
  },
};
const getTraceTool: Anthropic.Tool = {
  name: "get_trace",
  description: "Fetch one trace by ID and return its spans WITH their attributes (db.system, http.status_code, k8s.pod.name, etc.). Use this after `traceql`/`traceql_metrics` surfaces a candidate trace ID — it's the only way to discover trace-only attribute values (e.g. which db.system, which search backend) instead of guessing them.",
  input_schema: {
    type: "object",
    properties: { trace_id: { type: "string", description: "The traceID from a traceql search result." } },
    required: ["trace_id"],
  },
};
const tempoMetricsTool: Anthropic.Tool = {
  name: "traceql_metrics",
  description:
    "Run a server-side TraceQL metrics aggregation against Tempo over the last 2h, e.g. `{ span.http.route=\"/api/auth\" } | count_over_time() by (span.k8s.pod.name)`. Use this to GROUP BY an attribute across many traces in one call instead of paging raw traces with `traceql`. Returns one aggregate total per group over the full window (not a fine-grained time series). " +
    "CRITICAL: the by(...) attribute MUST use the `span.` scope (e.g. `span.k8s.pod.name`, `span.db.system`) — `resource.`-scoped group-by silently returns a single meaningless series and will look like there's no signal.",
  input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};

export const pillarsArm: ArmTools = {
  name: "pillars",
  definitions: [promTool, lokiTool, tempoTool, getTraceTool, tempoMetricsTool],
  handlers: {
    promql: (i) => promql(i.query),
    loki_logql: (i) => logql(i.query, i.limit),
    traceql: (i) => traceql(i.query, i.limit),
    get_trace: (i) => getTrace(i.trace_id),
    traceql_metrics: (i) => traceqlMetrics(i.query),
  },
};
