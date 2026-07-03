# Agent-RCA Eval Methodology

This document describes the eval harness in `eval/` that tests the falsifiable claim behind
wide-events-driven root-cause analysis: **wide-events tooling (raw SQL over `otel_traces`,
or the same SQL plus bubble-up compare/rank primitives) lets an LLM agent find the root
cause of a production incident at least as reliably as, and more efficiently than, the
traditional three-pillars stack (metrics + logs + traces as separate systems) — specifically
on incidents whose discriminating attribute is high-cardinality and therefore invisible to
pre-aggregated RED metrics.**

If an arm with fewer, narrower tools wins on pass-rate or wins on efficiency at equal
pass-rate, the claim is falsified for that scenario. The harness is built to make that
falsification possible, not to make wide events look good — see the fairness invariants
below.

For the full design rationale, see
[`docs/superpowers/specs/2026-07-04-eval-harness-p1-p3-design.md`](./superpowers/specs/2026-07-04-eval-harness-p1-p3-design.md).

## The three arms

Every arm shares an identical system prompt ("you are an SRE performing root-cause
analysis; investigate with your tools; when confident, call `submit_verdict`"), an
identical symptom prompt per scenario, the same agent model, the same trial count, and the
same result-truncation cap. **The only thing that differs between arms is the tool set**
(this is invariant INV-2, held by code structure rather than a runtime diff: `runCell`
uses one shared `SYSTEM_PROMPT`/model/max-tokens across all arms, and the only per-arm
input it takes is the tool set — `eval/test/tools.test.ts` asserts that the arms' tool
sets differ correctly, it does not diff prompt strings):

| Arm | Tools |
|---|---|
| `wide-sql` | `clickhouse_sql` only — the agent authors raw SQL against `otel_traces` |
| `bubble-up` | `clickhouse_sql` plus `select_region`, `compare_baseline`, `rank_attributes` (the same primitives reused from `@heatmap/shared-comparison` that power the production bubble-up UI) |
| `pillars` | `promql`, `loki_logql`, `traceql` — one tool per pillar, no cross-pillar join |

Every arm also gets `submit_verdict`, the terminal tool an agent must call to finish a
trial; the runner reads its structured arguments (`rca`, `culprit_service`,
`discriminating_attributes`) directly rather than parsing free text. Query tools execute
the agent's query string verbatim against the real backend (ClickHouse for the wide arms;
Prometheus/Loki/Tempo for `pillars`) and return the real result or the real error — no
auto-correction, no query rewriting, and an identical truncation cap across arms. The
friction of authoring PromQL/LogQL/TraceQL/SQL by hand is exactly what the benchmark is
measuring, so the tools must not smooth it over.

## INV-1: discriminators are absent from RED metrics, present in logs/traces

The scenario suite (`eval/src/scenarios.ts`, S1–S8) is only a fair test of the wide-events
claim if its discriminating attributes are actually invisible to a metrics-only view. This
is asserted mechanically by `scripts/verify-inv1.sh` against the live stack, not just
documented:

- The script pulls every label name exposed by the `traces_span_metrics_*` series in
  Prometheus and asserts none of the high-cardinality scenario attributes
  (`app_feature_flag`, `app_tenant_id`, `app_build_id`, `k8s_pod_name`, `app_platform`,
  `user_id`) appear there — proven over a non-empty series set, so "absent" isn't proven
  over nothing.
- It then asserts the *same* attributes are present in the real arm-C backends the
  `pillars` arm actually queries — Loki (structured metadata) and Tempo (`span.<key>`
  scope) — not just in ClickHouse's raw `otel_logs`/`otel_traces`, because proving presence
  in ClickHouse alone wouldn't prove INV-1 for the arm that matters.
- **`host.region` is deliberately excluded** from the high-cardinality blocklist. Region is
  a legitimate, low-cardinality RED-metric label in real systems, so its presence in
  metrics is not a fairness violation.
- **S6 is the documented, expected exception**: its only discriminator is `host.region`,
  so it is metrics-solvable in every arm. The harness reports S6 as a tie across arms, not
  a wide-events win — a scenario with no high-cardinality discriminator has nothing for
  wide-events tooling to prove.
- **S5 is scored on `app.build_id` + `k8s.pod.name`**, both of which are legitimately
  reachable as span *and* log attributes in every arm. The infra-saturation USE metrics
  that also correlate to the same pods are realistic incidental signal available to the
  `pillars` arm, not a scored shortcut — the rubric does not require or reward finding them.
- **S3 discriminates on `db.system=redis`**, which is low-cardinality but is *not* a
  `spanmetrics` dimension — it exists only on trace leaf spans, so it is absent from RED
  metrics for a structural reason rather than a cardinality one. The fairness criterion for
  a scenario's rubric is therefore "the discriminator is absent from the RED metrics,
  forcing a logs/traces pivot," not strictly "high-cardinality."

## The judge

`eval/src/judge.ts` scores each trial's `submit_verdict` output against the scenario's
rubric and ground-truth RCA. The judge is:

- **blind to arm** — it is never told which tool set produced the verdict;
- **blind to efficiency** — it never sees token counts, wall-clock time, or tool-call
  counts, so it cannot reward or penalize brevity;
- **on a different model than the agent under test**, so the judge is not grading its own
  homework;
- **rubric-driven** — each scenario carries its own pass/fail criteria in `scenarios.ts`
  rather than an improvised judgment call per run.

`eval/test/judge.test.ts` asserts the blindness guarantee directly by inspecting the
constructed judge prompt for the absence of arm/efficiency fields.

This blindness is by *label* only: no arm name, tool identifier, or timing data is ever
placed into the judge prompt, but the agent's free-text `rca` field could still incidentally
name a tool it used (e.g. "my ClickHouse query showed..."). This is low-impact because the
judge grades against a tool-agnostic rubric with no notion of which arm "should" win, so an
incidental tool mention has nothing to bias toward.

## Pinned versions

Reproducibility requires pinning what varies between runs:

- **Agent model:** `claude-sonnet-5` (`eval/src/config.ts`, `EVAL_AGENT_MODEL` overridable) —
  the single model held constant across all three arms and all eight scenarios.
- **Judge model:** `claude-opus-4-8` (`EVAL_JUDGE_MODEL` overridable) — deliberately a
  different, more capable model than the agent under test.
- **P0 data-plane images**, pinned by digest in `docker/docker-compose.yml` so the trace
  generator's ground truth and the backends' query semantics don't drift under the eval:
  - `grafana/tempo@sha256:ef4384fce6e8ad22b95b243d8fc165628cda655376fd50e7850536ad89d71d50` (2.6.1)
  - `prom/prometheus@sha256:6559acbd5d770b15bb3c954629ce190ac3cbbdb2b7f1c30f0385c4e05104e218` (v3.1.0)
  - `grafana/loki@sha256:8af2de1abbdd7aa92b27c9bcc96f0f4140c9096b507c77921ffddf1c6ad6c48f` (3.3.2)

Any change to the agent model, judge model, or these image digests invalidates comparison
against a previously recorded results table.

## Reproduction

```bash
make up                        # bring up the full stack (ClickHouse, Prometheus, Loki, Tempo, trace generator)
bash scripts/verify-inv1.sh    # mechanically re-verify the fairness invariant before spending API calls
make eval                      # full 8 scenarios x 3 arms x N trials matrix (needs ANTHROPIC_API_KEY)
```

For cheap iteration without the full spend, pass a subset:

```bash
make eval ARGS="--scenario S1 --arm wide-sql --trials 1"
```

`--scenario` and `--arm` accept comma-separated lists; `--trials` overrides the default
trial count (`EVAL_TRIALS`, default 5); `--concurrency` bounds parallel agent sessions
(`EVAL_CONCURRENCY`, default 4).

## Reporting efficiency

`eval/src/report.ts` aggregates raw per-trial rows into one table row per (arm, scenario)
pair: pass-rate (`nPass/n`), and median tokens, wall-clock time, and tool-call count.
**Efficiency numbers are computed only over judge-passing runs** — a cheap wrong answer is
not counted as an efficiency win, so a low median-token count for an arm with a low
pass-rate does not make that arm look good. Medians are reported, not means, and the
underlying distribution (not a single number) is what should be compared across arms: a
single median masks whether an arm is consistently efficient or has a long tail of
expensive misfires that judge-filtering happens to exclude. Multi-model sweeps and
significance testing beyond median-and-spread are explicit out-of-scope extensions, not
covered by this harness.
