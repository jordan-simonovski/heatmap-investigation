import { config } from "../config.ts";
import { safeFetchText } from "./http.ts";

const DEFAULT_LIMIT = 50;

// LogQL range query over the last 2 hours (matches the emitted data window).
// `limit` caps the number of log lines returned and is agent-adjustable
// (validity audit V5): a hard-coded cap the agent can't raise would unfairly
// starve this arm relative to the SQL arm's own agent-authored LIMIT.
export async function logql(query: string, limit = DEFAULT_LIMIT): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(`${config.urls.loki}/loki/api/v1/query_range`);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", `${limit}`);
  url.searchParams.set("start", `${(now - 7200) * 1_000_000_000}`);
  url.searchParams.set("end", `${now * 1_000_000_000}`);
  return safeFetchText("Loki", url, undefined, 60000);
}
