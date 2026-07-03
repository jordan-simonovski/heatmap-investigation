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

  // Pre-flight auth check — a single shared client is created here, so auth is
  // all-or-nothing. Announce what the PROCESS sees (masked) and fail fast if it
  // has no credential, rather than churning the whole matrix into auth errors.
  // (Checks env vars; does not detect `ant`/OAuth-profile credentials.)
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const hasToken = !!process.env.ANTHROPIC_AUTH_TOKEN;
  console.error(`auth (this process): ANTHROPIC_API_KEY=${hasKey ? "set" : "UNSET"}, ANTHROPIC_AUTH_TOKEN=${hasToken ? "set" : "UNSET"}`);
  if (!hasKey && !hasToken) {
    console.error(
      "No Anthropic credential in THIS process's environment — the eval cannot authenticate.\n" +
        "Export ANTHROPIC_API_KEY in the SAME shell that runs the eval (the one where the 120-run succeeded), or run it inline:\n" +
        '  ANTHROPIC_API_KEY=sk-ant-... make eval ARGS="--scenario S5 --trials 5 --raw"',
    );
    process.exit(1);
  }

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
