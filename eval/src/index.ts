import Anthropic from "@anthropic-ai/sdk";
import { runMatrix } from "./matrix.ts";
import { aggregate, renderTable } from "./report.ts";
import { config } from "./config.ts";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const scenarioIds = flag("scenario")?.split(",");
  const armNames = flag("arm")?.split(",");
  const trials = flag("trials") ? Number(flag("trials")) : undefined;
  const concurrency = flag("concurrency") ? Number(flag("concurrency")) : undefined;
  const raw = hasFlag("raw");

  const client = new Anthropic();
  console.error(
    `Running matrix: agent=${config.agentModel} judge=${config.judgeModel} ` +
      `scenarios=${scenarioIds ?? "ALL"} arms=${armNames ?? "ALL"} trials=${trials ?? config.trials}`,
  );
  const rows = await runMatrix(client, { scenarioIds, armNames, trials, concurrency });
  const table = renderTable(aggregate(rows));
  console.log(table);
  console.error(`\n${rows.length} runs, ${rows.filter((r) => r.pass).length} passing.`);

  // --raw: per-cell audit trail (verdict + judge reasoning + usage). The
  // aggregate table hides these; you need them to see WHY a cell failed.
  if (raw) {
    console.error("\n=== raw per-cell results ===");
    for (const r of rows) {
      const attrs = r.verdict
        ? r.verdict.discriminating_attributes.map((a) => `${a.key}=${a.value}`).join(", ")
        : "(no verdict submitted)";
      console.error(
        [
          `\n[${r.arm} ${r.scenario} trial ${r.trial}] pass=${r.pass} error=${r.error} ` +
            `turns=${r.turns} toolCalls=${r.toolCalls} tokens=${r.usage.inputTokens + r.usage.outputTokens}`,
          `  culprit_service: ${r.verdict?.culprit_service ?? "—"}`,
          `  discriminating_attributes: ${attrs}`,
          `  rca: ${r.verdict?.rca ?? "—"}`,
          `  judge: ${r.judgeReasoning}`,
        ].join("\n"),
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
