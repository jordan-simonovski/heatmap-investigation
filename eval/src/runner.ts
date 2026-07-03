import type Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.ts";
import type { ArmTools } from "./tools/types.ts";
import { SUBMIT_VERDICT, type Verdict } from "./tools/submitVerdict.ts";
import type { Scenario } from "./scenarios.ts";

export type Usage = { inputTokens: number; outputTokens: number };
export type CellResult = {
  scenario: string;
  arm: string;
  trial: number;
  verdict: Verdict | null;
  usage: Usage;
  wallClockMs: number;
  toolCalls: number;
  turns: number;
  /** V6: the model id the API actually served (from the response), not the requested
   * alias — records what ran even if an alias like "claude-sonnet-5" repoints later. */
  resolvedModel: string;
  /** V16: best-effort SDK-retry counter. The Anthropic SDK auto-retries network/5xx/429
   * errors transparently inside client.messages.create() but does not expose a per-call
   * retry count through the public response or a request-scoped hook without overriding
   * `fetch` at client-construction time (the client is built in index.ts, out of scope
   * for this change). Hardcoded to 0 until that hook exists — LIMITATION, not a measurement. */
  retries: number;
};

export function accumulateUsage(prev: Usage, u: { input_tokens: number; output_tokens: number }): Usage {
  return {
    inputTokens: prev.inputTokens + u.input_tokens,
    outputTokens: prev.outputTokens + u.output_tokens,
  };
}

const SYSTEM_PROMPT =
  "You are a senior SRE performing root-cause analysis on a microservices incident. " +
  "Investigate methodically using ONLY the tools provided. When you are confident you have " +
  "identified the root cause, call submit_verdict exactly once with the culprit service and the " +
  "attribute key/values that distinguish the failing requests. Do not call submit_verdict until you have evidence.";

const MAX_TURNS = 25;

export async function runCell(
  scenario: Scenario,
  arm: ArmTools,
  trial: number,
  client: Anthropic,
  nowMs: () => number,
): Promise<CellResult> {
  const tools = [...arm.definitions, SUBMIT_VERDICT];
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: scenario.symptomPrompt },
  ];
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let toolCalls = 0;
  let turns = 0;
  let verdict: Verdict | null = null;
  let resolvedModel = "";
  const start = nowMs();

  while (turns < MAX_TURNS) {
    turns++;
    const res = await client.messages.create({
      model: config.agentModel,
      max_tokens: config.maxTokensPerTurn,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
    resolvedModel = res.model;
    usage = accumulateUsage(usage, res.usage);
    messages.push({ role: "assistant", content: res.content });

    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) break; // agent ended without a verdict

    const verdictCall = toolUses.find((t) => t.name === "submit_verdict");
    if (verdictCall) {
      verdict = verdictCall.input as Verdict;
      break; // terminal tool — stop immediately
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      toolCalls++;
      const handler = arm.handlers[t.name];
      const out = handler
        ? await handler(t.input).catch((e) => `tool error: ${String(e)}`)
        : `unknown tool: ${t.name}`;
      results.push({ type: "tool_result", tool_use_id: t.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    scenario: scenario.id,
    arm: arm.name,
    trial,
    verdict,
    usage,
    wallClockMs: nowMs() - start,
    toolCalls,
    turns,
    resolvedModel,
    retries: 0,
  };
}
