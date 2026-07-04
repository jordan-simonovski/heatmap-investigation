import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat as zodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { config } from "./config.ts";
import type { Scenario } from "./scenarios.ts";
import type { Verdict } from "./tools/submitVerdict.ts";

// V13: pillars agents emit underscored attribute keys (host_region), wide agents emit
// dotted keys (host.region) — same attribute, different serialization. Normalize before
// comparing so neither arm is penalized for its backend's naming convention.
export function normalizeAttrKey(key: string): string {
  return key.trim().toLowerCase().replace(/[._]+/g, "_");
}

export type JudgeVote = { pass: boolean; reasoning: string; identifiedAttributes: string[] };

export type Judgement = {
  pass: boolean;
  reasoning: string;
  /** Normalized keys (subset of the scenario's required discriminatingAttributes) that a
   * majority of judge votes agreed the candidate correctly identified (key + value). */
  identifiedAttributes: string[];
  votes: JudgeVote[];
};

const JudgementSchema = z.object({
  pass: z.boolean(),
  reasoning: z.string(),
  identifiedAttributes: z
    .array(z.string())
    .default([])
    .describe(
      "Normalized keys (from the REQUIRED DISCRIMINATING ATTRIBUTES list) that the candidate correctly identified.",
    ),
});

// Blind: no arm, no tokens, no timing. Only the incident, the ground truth,
// the rubric, and the candidate answer.
export function buildJudgePrompt(scenario: Scenario, verdict: Verdict): string {
  const requiredAttrs = scenario.discriminatingAttributes
    .map((a) => `${a.key}=${a.value} (normalized key: ${normalizeAttrKey(a.key)})`)
    .join("; ");
  const candidateAttrs =
    verdict.discriminating_attributes
      .map((a) => `${a.key}=${a.value} (normalized key: ${normalizeAttrKey(a.key)})`)
      .join(", ") || "(none provided)";
  return [
    "You are grading a root-cause-analysis answer against a known ground truth.",
    "",
    `SYMPTOM PRESENTED: ${scenario.symptomPrompt}`,
    "",
    `GROUND-TRUTH ROOT CAUSE: ${scenario.groundTruthRca}`,
    "",
    `GRADING RUBRIC: ${scenario.rubric}`,
    "",
    `REQUIRED DISCRIMINATING ATTRIBUTES FOR THIS SCENARIO: ${requiredAttrs}`,
    "",
    "CANDIDATE ANSWER:",
    `  culprit service: ${verdict.culprit_service}`,
    `  discriminating attributes: ${candidateAttrs}`,
    `  explanation: ${verdict.rca}`,
    "",
    "Grade generously on phrasing: pass if the candidate identifies the root cause required by " +
      "the rubric, even when it is worded differently, includes extra detail, or omits " +
      "non-required supporting evidence. Do not fail an otherwise-correct answer merely because " +
      "it uses different words than the rubric or ground truth.",
    "",
    "Attribute keys may be written with dots or underscores interchangeably — e.g. host.region " +
      "and host_region, or app.feature_flag and app_feature_flag, name the SAME attribute. Treat " +
      "them as equivalent when deciding whether the candidate identified a required attribute " +
      "(match on normalized key AND matching value).",
    "",
    "In addition to pass/reasoning, return identifiedAttributes: the normalized keys (exactly as " +
      "given in the REQUIRED DISCRIMINATING ATTRIBUTES list above) that the candidate correctly " +
      "identified with a matching value. Only use normalized keys from that required list; omit " +
      "any the candidate did not correctly identify.",
  ].join("\n");
}

async function judgeOnce(scenario: Scenario, verdict: Verdict, client: Anthropic): Promise<JudgeVote> {
  const requiredKeys = new Set(scenario.discriminatingAttributes.map((a) => normalizeAttrKey(a.key)));
  const res = await client.beta.messages.parse({
    model: config.judgeModel,
    max_tokens: 1024,
    // NOTE: these models reject temperature/top_p (400 error) — do NOT set sampling
    // params here. Majority-vote (see judge()) relies on natural response variance
    // across independent calls instead of temperature-induced variance.
    messages: [{ role: "user", content: buildJudgePrompt(scenario, verdict) }],
    output_format: zodOutputFormat(JudgementSchema),
  });
  const parsed = res.parsed_output;
  if (!parsed) {
    return { pass: false, reasoning: "judge produced no parseable output", identifiedAttributes: [] };
  }
  // Defensive: only trust attribute keys that are actually in this scenario's required
  // list (post-normalization) — guards against the judge hallucinating extra keys.
  const identifiedAttributes = [
    ...new Set(parsed.identifiedAttributes.map(normalizeAttrKey).filter((k) => requiredKeys.has(k))),
  ];
  return { pass: parsed.pass, reasoning: parsed.reasoning, identifiedAttributes };
}

// D3: majority vote across k independent judge calls. Pure function so the voting logic
// is unit-testable on fixtures without live API access.
export function majorityVote(votes: JudgeVote[]): Judgement {
  if (votes.length === 0) {
    return { pass: false, reasoning: "no judge votes", identifiedAttributes: [], votes: [] };
  }
  const passCount = votes.filter((v) => v.pass).length;
  const pass = passCount * 2 > votes.length;
  const reasoning = votes
    .map((v, i) => `[vote ${i + 1}/${votes.length}: ${v.pass ? "PASS" : "FAIL"}] ${v.reasoning}`)
    .join(" ");
  // An attribute counts as "identified" for the cell only if a majority of votes agreed,
  // matching the same majority principle used for pass/fail.
  const attrCounts = new Map<string, number>();
  for (const v of votes) {
    for (const a of v.identifiedAttributes) attrCounts.set(a, (attrCounts.get(a) ?? 0) + 1);
  }
  const identifiedAttributes = [...attrCounts.entries()]
    .filter(([, count]) => count * 2 > votes.length)
    .map(([k]) => k);
  return { pass, reasoning, identifiedAttributes, votes };
}

export async function judge(
  scenario: Scenario,
  verdict: Verdict,
  client: Anthropic,
  k: number = config.judgeSamples,
): Promise<Judgement> {
  const samples = Math.max(1, k);
  const votes = await Promise.all(Array.from({ length: samples }, () => judgeOnce(scenario, verdict, client)));
  return majorityVote(votes);
}
