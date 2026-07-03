import { config } from "../config.ts";
import { safeFetchText } from "./http.ts";

// TraceQL search over the last 2 hours.
export async function traceql(query: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const url = new URL(`${config.urls.tempo}/api/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  url.searchParams.set("start", `${now - 7200}`);
  url.searchParams.set("end", `${now}`);
  return safeFetchText("Tempo", url);
}
