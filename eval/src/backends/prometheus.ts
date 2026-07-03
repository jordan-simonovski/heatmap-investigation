import { config } from "../config.ts";
import { safeFetchText } from "./http.ts";

// Instant PromQL query. The agent may pass range selectors in the query itself.
export async function promql(query: string): Promise<string> {
  const url = new URL(`${config.urls.prometheus}/api/v1/query`);
  url.searchParams.set("query", query);
  return safeFetchText("Prometheus", url, undefined, 60000);
}
