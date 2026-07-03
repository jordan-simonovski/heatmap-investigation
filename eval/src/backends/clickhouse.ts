import { config } from "../config.ts";
import { safeFetchText } from "./http.ts";

// Runs agent-authored SQL over ClickHouse HTTP. Returns TabSeparatedWithNames
// text (or the real error), truncated. No query rewriting — the agent authors
// SQL by hand; that friction is what the benchmark measures.
export async function clickhouseSql(query: string): Promise<string> {
  const url = `${config.urls.clickhouse}/?default_format=TabSeparatedWithNames`;
  return safeFetchText(
    "ClickHouse",
    url,
    {
      method: "POST",
      headers: {
        "X-ClickHouse-User": process.env.EVAL_CLICKHOUSE_USER ?? "default",
        "X-ClickHouse-Key": process.env.EVAL_CLICKHOUSE_PASSWORD ?? "",
      },
      body: query,
    },
    60000,
  );
}
