import { config } from "../config.ts";
import { truncate } from "./truncate.ts";

// Runs a fetch and ALWAYS resolves to text — HTTP errors, transport failures,
// and timeouts all come back as truncated error text so the agent can correct,
// never as a thrown exception that crashes the run.
export async function safeFetchText(
  tag: string,
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<string> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) return truncate(`${tag} error (${res.status}): ${text}`, config.truncateCap);
    return truncate(text, config.truncateCap);
  } catch (e) {
    return truncate(`${tag} error: ${String(e)}`, config.truncateCap);
  }
}
