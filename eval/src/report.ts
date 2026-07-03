import type { JudgedResult } from "./matrix.ts";

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export type Cell = {
  arm: string;
  scenario: string;
  passRate: number;
  n: number;
  nPass: number;
  nError: number;
  /** Headline cost metric: median total tokens, PASSING trials only. */
  medTokens: number;
  /** V15/V3: median total tokens over ALL non-error (scored) trials, pass or fail — so a
   * cell that mostly fails (and burns tokens doing so) doesn't get flattered by looking
   * only at the rare passing run's cost. */
  medTokensAllTrials: number;
  /** V3/V15: median OUTPUT-only tokens over passing trials — format-neutral, since output
   * tokens are not inflated by the verbose-JSON backend payload that gets re-billed as
   * input on every turn. Alongside medTokens, not instead of it. */
  medOutputTokens: number;
  medWallMs: number;
  medToolCalls: number;
  /** MTTR proxy: median turns-to-resolution over passing trials, alongside tool-calls. */
  medTurns: number;
  /** V12: mean fraction of the scenario's required discriminating attributes identified,
   * over ALL scored (non-error) trials — including failing ones, so a "found half of it"
   * pattern is visible instead of collapsing to 0 under the binary pass/fail. */
  meanAttributeRecall: number;
  /** V16: sum of the (currently hardcoded-0) per-trial retry counter — see CellResult.retries. */
  retriesTotal: number;
  /** V6: resolved model id(s) actually served for this cell's scored trials (from the
   * response, not the requested alias). Multiple distinct ids joined with "+" would flag
   * an alias repointing mid-run; "—" when there were no scored trials. */
  resolvedModel: string;
};

export function aggregate(rows: JudgedResult[]): Cell[] {
  const groups = new Map<string, JudgedResult[]>();
  for (const r of rows) {
    const key = `${r.arm}/${r.scenario}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const totalTokens = (r: JudgedResult) => r.usage.inputTokens + r.usage.outputTokens;
  const cells: Cell[] = [];
  for (const [key, rs] of groups) {
    const [arm, scenario] = key.split("/");
    const errored = rs.filter((r) => r.error);
    const scored = rs.filter((r) => !r.error);
    const passing = scored.filter((r) => r.pass);
    const resolvedModels = [...new Set(scored.map((r) => r.resolvedModel).filter((m) => m))];
    cells.push({
      arm,
      scenario,
      n: scored.length,
      nPass: passing.length,
      nError: errored.length,
      passRate: scored.length ? passing.length / scored.length : 0,
      medTokens: median(passing.map(totalTokens)),
      medTokensAllTrials: median(scored.map(totalTokens)),
      medOutputTokens: median(passing.map((r) => r.usage.outputTokens)),
      medWallMs: median(passing.map((r) => r.wallClockMs)),
      medToolCalls: median(passing.map((r) => r.toolCalls)),
      medTurns: median(passing.map((r) => r.turns)),
      meanAttributeRecall: mean(scored.map((r) => r.attributeRecall)),
      retriesTotal: scored.reduce((sum, r) => sum + (r.retries ?? 0), 0),
      resolvedModel: resolvedModels.length ? resolvedModels.join("+") : "—",
    });
  }
  return cells.sort((a, b) => a.arm.localeCompare(b.arm) || a.scenario.localeCompare(b.scenario));
}

// V5: median([]) is 0, which used to render as a literal "0" in a zero-pass cell — reads
// as "free" rather than "no passing trial to measure." Render "—" instead whenever the
// underlying population for that column is empty.
function fmtNum(v: number, isEmpty: boolean): string {
  return isEmpty ? "—" : String(v);
}

function fmtPct(v: number, isEmpty: boolean): string {
  return isEmpty ? "—" : `${(v * 100).toFixed(0)}%`;
}

export function renderTable(cells: Cell[]): string {
  const header =
    "| arm | scenario | pass-rate | attr-recall | median tokens (pass) | median tokens (all) | median output tokens | median turns | median tool-calls | median wall (ms)* | resolved model | retries | errors |\n" +
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const rows = cells.map((c) => {
    const noPassing = c.nPass === 0;
    const noScored = c.n === 0;
    return (
      `| ${c.arm} | ${c.scenario} | ${c.nPass}/${c.n} (${(c.passRate * 100).toFixed(0)}%) | ` +
      `${fmtPct(c.meanAttributeRecall, noScored)} | ${fmtNum(c.medTokens, noPassing)} | ` +
      `${fmtNum(c.medTokensAllTrials, noScored)} | ${fmtNum(c.medOutputTokens, noPassing)} | ` +
      `${fmtNum(c.medTurns, noPassing)} | ${fmtNum(c.medToolCalls, noPassing)} | ` +
      `${fmtNum(c.medWallMs, noPassing)} | ${c.resolvedModel} | ${c.retriesTotal} | ${c.nError} |`
    );
  });
  return [header, ...rows].join("\n");
}
