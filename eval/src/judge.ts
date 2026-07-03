import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat as zodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "./config.ts";
import type { Scenario } from "./scenarios.ts";
import type { Verdict } from "./tools/submitVerdict.ts";

export type Judgement = { pass: boolean; reasoning: string };

const JudgementSchema = z.object({
  pass: z.boolean(),
  reasoning: z.string(),
});

// Blind: no arm, no tokens, no timing. Only the incident, the ground truth,
// the rubric, and the candidate answer.
export function buildJudgePrompt(scenario: Scenario, verdict: Verdict): string {
  const attrs = verdict.discriminating_attributes
    .map((a) => `${a.key}=${a.value}`)
    .join(", ");
  return [
    "You are grading a root-cause-analysis answer against a known ground truth.",
    "",
    `SYMPTOM PRESENTED: ${scenario.symptomPrompt}`,
    "",
    `GROUND-TRUTH ROOT CAUSE: ${scenario.groundTruthRca}`,
    "",
    `GRADING RUBRIC: ${scenario.rubric}`,
    "",
    "CANDIDATE ANSWER:",
    `  culprit service: ${verdict.culprit_service}`,
    `  discriminating attributes: ${attrs}`,
    `  explanation: ${verdict.rca}`,
    "",
    "Apply the rubric strictly. Return pass=true only if the candidate identifies the required root cause per the rubric. Give one sentence of reasoning.",
  ].join("\n");
}

export async function judge(
  scenario: Scenario,
  verdict: Verdict,
  client: Anthropic,
): Promise<Judgement> {
  const res = await client.beta.messages.parse({
    model: config.judgeModel,
    max_tokens: 1024,
    messages: [{ role: "user", content: buildJudgePrompt(scenario, verdict) }],
    output_format: zodOutputFormat(JudgementSchema),
  });
  return res.parsed_output ?? { pass: false, reasoning: "judge produced no parseable output" };
}
