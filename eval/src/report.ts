import type { JudgedResult } from "./matrix.ts";

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type Cell = {
  arm: string;
  scenario: string;
  passRate: number;
  n: number;
  nPass: number;
  medTokens: number;
  medWallMs: number;
  medToolCalls: number;
};

export function aggregate(rows: JudgedResult[]): Cell[] {
  const groups = new Map<string, JudgedResult[]>();
  for (const r of rows) {
    const key = `${r.arm}/${r.scenario}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const cells: Cell[] = [];
  for (const [key, rs] of groups) {
    const [arm, scenario] = key.split("/");
    const passing = rs.filter((r) => r.pass);
    cells.push({
      arm,
      scenario,
      n: rs.length,
      nPass: passing.length,
      passRate: rs.length ? passing.length / rs.length : 0,
      medTokens: median(passing.map((r) => r.usage.inputTokens + r.usage.outputTokens)),
      medWallMs: median(passing.map((r) => r.wallClockMs)),
      medToolCalls: median(passing.map((r) => r.toolCalls)),
    });
  }
  return cells.sort((a, b) => a.arm.localeCompare(b.arm) || a.scenario.localeCompare(b.scenario));
}

export function renderTable(cells: Cell[]): string {
  const header =
    "| arm | scenario | pass-rate | median tokens | median wall (ms) | median tool-calls |\n" +
    "|---|---|---|---|---|---|";
  const rows = cells.map(
    (c) =>
      `| ${c.arm} | ${c.scenario} | ${c.nPass}/${c.n} (${(c.passRate * 100).toFixed(0)}%) | ${c.medTokens} | ${c.medWallMs} | ${c.medToolCalls} |`,
  );
  return [header, ...rows].join("\n");
}
