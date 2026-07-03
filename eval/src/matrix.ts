import type Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.ts";
import { scenarios, type Scenario } from "./scenarios.ts";
import { wideSqlArm } from "./tools/wideSqlTools.ts";
import { bubbleUpArm } from "./tools/bubbleUpTools.ts";
import { pillarsArm } from "./tools/pillarsTools.ts";
import type { ArmTools } from "./tools/types.ts";
import { runCell, type CellResult } from "./runner.ts";
import { judge } from "./judge.ts";

export type JudgedResult = CellResult & { pass: boolean; judgeReasoning: string };
export type MatrixOpts = {
  scenarioIds?: string[];
  armNames?: string[];
  trials?: number;
  concurrency?: number;
};

const ALL_ARMS: ArmTools[] = [wideSqlArm, bubbleUpArm, pillarsArm];

export function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

type Cell = { scenario: Scenario; arm: ArmTools; trial: number };

export function buildCells(opts: MatrixOpts): Cell[] {
  const scen = scenarios.filter((s) => !opts.scenarioIds || opts.scenarioIds.includes(s.id));
  const arms = ALL_ARMS.filter((a) => !opts.armNames || opts.armNames.includes(a.name));
  const trials = opts.trials ?? config.trials;
  const cells: Cell[] = [];
  for (const scenario of scen)
    for (const arm of arms)
      for (let trial = 1; trial <= trials; trial++) cells.push({ scenario, arm, trial });
  return cells;
}

export async function runMatrix(client: Anthropic, opts: MatrixOpts): Promise<JudgedResult[]> {
  const cells = buildCells(opts);
  const results: JudgedResult[] = [];
  for (const group of chunk(cells, opts.concurrency ?? config.concurrency)) {
    const batch = await Promise.all(
      group.map(async (cell) => {
        try {
          const r = await runCell(cell.scenario, cell.arm, cell.trial, client, () => Date.now());
          const j = r.verdict
            ? await judge(cell.scenario, r.verdict, client)
            : { pass: false, reasoning: "no verdict submitted" };
          return { ...r, pass: j.pass, judgeReasoning: j.reasoning };
        } catch (e) {
          return {
            scenario: cell.scenario.id,
            arm: cell.arm.name,
            trial: cell.trial,
            verdict: null,
            usage: { inputTokens: 0, outputTokens: 0 },
            wallClockMs: 0,
            toolCalls: 0,
            turns: 0,
            pass: false,
            judgeReasoning: `cell error: ${String(e)}`,
          } as JudgedResult;
        }
      }),
    );
    results.push(...batch);
  }
  return results;
}
