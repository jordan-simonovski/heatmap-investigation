import { config } from "../config.ts";
import { safeFetchText } from "./http.ts";

const DEFAULT_SEARCH_LIMIT = 20;

// TraceQL search over the last 2 hours. `limit` caps the number of trace
// summaries returned and is agent-adjustable (validity audit V5): a
// hard-coded cap the agent can't raise would unfairly starve this arm
// relative to the SQL arm's own agent-authored LIMIT.
export async function traceql(query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(`${config.urls.tempo}/api/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", `${limit}`);
  url.searchParams.set("start", `${now - 7200}`);
  url.searchParams.set("end", `${now}`);
  return safeFetchText("Tempo", url, undefined, 60000);
}

// Fetch a single trace by ID, WITH its spans' attributes — this is how a real
// three-pillars SRE discovers trace-only attribute values (e.g. db.system,
// elasticsearch) instead of guessing them (validity audit V2). `traceql`
// above only returns trace summaries; it never exposes span attributes.
export async function getTrace(traceId: string): Promise<string> {
  const url = `${config.urls.tempo}/api/traces/${encodeURIComponent(traceId)}`;
  return safeFetchText("Tempo", url, undefined, 60000);
}

const WINDOW_SECONDS = 7200; // 2h, matches every other backend's query window

// Server-side TraceQL metrics aggregation via Tempo's metrics-generator
// (validity audit D1, now enabled at the data layer). Lets the pillars agent
// GROUP BY on the Tempo side instead of paging raw traces to aggregate
// client-side.
//
// `step` is set to the full window so each series collapses to ONE aggregate
// sample — the shape a `GROUP BY ... count()` gives in the SQL arm, and the
// one the agent actually wants for discrimination (a per-group total, not a
// time series). A finer step (e.g. 60s) multiplies sample count by
// window/step per series and reliably blows past truncateCap, corrupting the
// JSON mid-string — proven live against this stack with 8 pod-name series
// over 2h at a 60s step.
//
// CRITICAL: group-by attributes MUST use the `span.` scope (e.g.
// `span.k8s.pod.name`), not `resource.`. `resource.`-scoped group-by returns
// a single series labeled "nil" (verified live against this stack) — it
// silently collapses to one bucket instead of erroring, so the agent must be
// steered away from it via the tool description in pillarsTools.ts.
export async function traceqlMetrics(query: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(`${config.urls.tempo}/api/metrics/query_range`);
  url.searchParams.set("q", query);
  url.searchParams.set("start", `${now - WINDOW_SECONDS}`);
  url.searchParams.set("end", `${now}`);
  url.searchParams.set("step", `${WINDOW_SECONDS}s`);
  return safeFetchText("Tempo", url, undefined, 60000);
}
