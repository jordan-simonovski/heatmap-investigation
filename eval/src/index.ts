import Anthropic from "@anthropic-ai/sdk";
import { runMatrix } from "./matrix.ts";
import { aggregate, renderTable } from "./report.ts";
import { config } from "./config.ts";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const scenarioIds = flag("scenario")?.split(",");
  const armNames = flag("arm")?.split(",");
  const trials = flag("trials") ? Number(flag("trials")) : undefined;
  const concurrency = flag("concurrency") ? Number(flag("concurrency")) : undefined;

  const client = new Anthropic();
  console.error(
    `Running matrix: agent=${config.agentModel} judge=${config.judgeModel} ` +
      `scenarios=${scenarioIds ?? "ALL"} arms=${armNames ?? "ALL"} trials=${trials ?? config.trials}`,
  );
  const rows = await runMatrix(client, { scenarioIds, armNames, trials, concurrency });
  const table = renderTable(aggregate(rows));
  console.log(table);
  console.error(`\n${rows.length} runs, ${rows.filter((r) => r.pass).length} passing.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
