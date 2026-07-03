import { config } from "../config.ts";
import { safeFetchText } from "./http.ts";

// LogQL range query over the last 2 hours (matches the emitted data window).
export async function logql(query: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(`${config.urls.loki}/loki/api/v1/query_range`);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "50");
  url.searchParams.set("start", `${(now - 7200) * 1_000_000_000}`);
  url.searchParams.set("end", `${now * 1_000_000_000}`);
  return safeFetchText("Loki", url);
}
