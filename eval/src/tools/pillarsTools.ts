import type Anthropic from "@anthropic-ai/sdk";
import { promql } from "../backends/prometheus.ts";
import { logql } from "../backends/loki.ts";
import { traceql } from "../backends/tempo.ts";
import type { ArmTools } from "./types.ts";

const promTool: Anthropic.Tool = {
  name: "promql",
  description: "Run an instant PromQL query against Prometheus (RED metrics: traces_span_metrics_*). Metrics carry only low-cardinality labels (service, http_route, host_region, status_code).",
  input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};
const lokiTool: Anthropic.Tool = {
  name: "loki_logql",
  description: "Run a LogQL query against Loki over the last 2h. Per-request attributes are structured metadata (e.g. `{service_name=\"trace-generator\"} | app_feature_flag=\\`value\\``).",
  input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};
const tempoTool: Anthropic.Tool = {
  name: "traceql",
  description: "Run a TraceQL search against Tempo over the last 2h (e.g. `{ span.app.feature_flag=\"value\" }`).",
  input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};

export const pillarsArm: ArmTools = {
  name: "pillars",
  definitions: [promTool, lokiTool, tempoTool],
  handlers: {
    promql: (i) => promql(i.query),
    loki_logql: (i) => logql(i.query),
    traceql: (i) => traceql(i.query),
  },
};
