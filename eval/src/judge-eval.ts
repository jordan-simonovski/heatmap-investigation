import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { judge } from "./judge.ts";
import { scenarios } from "./scenarios.ts";
import type { Verdict } from "./tools/submitVerdict.ts";

// D3: measures the judge's own precision/recall/agreement against a small hand-labeled
// gold set (eval/gold/verdicts.json), so judge quality is a measured property rather than
// an assumed one. The gold-set labels are FIRST-PASS (see notes in the JSON file) and have
// NOT been independently reviewed — treat any run of this script as provisional until a
// second reviewer confirms expected_pass for each case.

export type GoldCase = {
  id: string;
  scenario_id: string;
  verdict: Verdict;
  expected_pass: boolean;
  note?: string;
};

export type GoldJudgement = GoldCase & { actualPass: boolean; reasoning: string };

export type ConfusionStats = {
  n: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  /** Of the cases the judge said PASS, what fraction were actually meant to pass. */
  precision: number;
  /** Of the cases meant to pass, what fraction did the judge say PASS. */
  recall: number;
  /** Overall fraction where the judge's pass/fail matched expected_pass. */
  agreement: number;
};

export function loadGoldSet(filePath: string): GoldCase[] {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`gold set at ${filePath} is not a JSON array`);
  for (const c of parsed) {
    if (!c.scenario_id || !c.verdict || typeof c.expected_pass !== "boolean") {
      throw new Error(`malformed gold case (missing scenario_id/verdict/expected_pass): ${JSON.stringify(c)}`);
    }
    if (!scenarios.some((s) => s.id === c.scenario_id)) {
      throw new Error(`gold case ${c.id ?? "?"} references unknown scenario_id "${c.scenario_id}"`);
    }
  }
  return parsed as GoldCase[];
}

export function scoreGoldSet(results: { expected_pass: boolean; actualPass: boolean }[]): ConfusionStats {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const r of results) {
    if (r.expected_pass && r.actualPass) tp++;
    else if (!r.expected_pass && r.actualPass) fp++;
    else if (!r.expected_pass && !r.actualPass) tn++;
    else fn++;
  }
  const n = results.length;
  return {
    n,
    tp,
    fp,
    tn,
    fn,
    precision: tp + fp > 0 ? tp / (tp + fp) : NaN,
    recall: tp + fn > 0 ? tp / (tp + fn) : NaN,
    agreement: n > 0 ? (tp + tn) / n : NaN,
  };
}

export async function runGoldSet(goldSet: GoldCase[], client: Anthropic): Promise<GoldJudgement[]> {
  const out: GoldJudgement[] = [];
  for (const g of goldSet) {
    const scenario = scenarios.find((s) => s.id === g.scenario_id);
    if (!scenario) throw new Error(`unknown scenario_id in gold set: ${g.scenario_id}`);
    const j = await judge(scenario, g.verdict, client);
    out.push({ ...g, actualPass: j.pass, reasoning: j.reasoning });
  }
  return out;
}

function defaultGoldSetPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "gold", "verdicts.json");
}

async function main() {
  const hasKey = !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN;
  if (!hasKey) {
    console.error(
      "No Anthropic credential in this process's environment — judge-eval needs live API access " +
        "to run the judge over the gold set.\nExport ANTHROPIC_API_KEY and re-run: npm run judge-eval",
    );
    process.exit(1);
  }

  const goldSet = loadGoldSet(defaultGoldSetPath());
  console.error(
    `⚠ Gold-set labels (${goldSet.length} cases) are FIRST-PASS hand judgments and have NOT been ` +
      "independently reviewed. Treat the numbers below as provisional.",
  );

  const client = new Anthropic();
  const results = await runGoldSet(goldSet, client);
  const stats = scoreGoldSet(results);

  console.log(`\nGold-set judge eval — n=${stats.n}`);
  console.log(
    `precision=${stats.precision.toFixed(2)} recall=${stats.recall.toFixed(2)} agreement=${stats.agreement.toFixed(2)}`,
  );
  console.log(`tp=${stats.tp} fp=${stats.fp} tn=${stats.tn} fn=${stats.fn}`);

  const mismatches = results.filter((r) => r.actualPass !== r.expected_pass);
  if (mismatches.length > 0) {
    console.log(`\n${mismatches.length} mismatch(es):`);
    for (const r of mismatches) {
      console.log(
        `  [${r.id} / ${r.scenario_id}] expected=${r.expected_pass} actual=${r.actualPass}` +
          (r.note ? ` note="${r.note}"` : "") +
          `\n    judge reasoning: ${r.reasoning}`,
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
