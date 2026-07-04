# Eval Validity Audit (adversarial, 2026-07-04)

Five independent hostile-reviewer audits (telemetry fidelity, scenario discriminability, fairness/tool-parity, rubric/judge, methodology/reproducibility), each verified against the code **and** live queries over the 15M-span `otel_traces` and the running Prometheus/Loki/Tempo. Purpose: find every way a skeptic could invalidate the benchmark before it backs a public post, and plug it.

## Bottom line

The **thesis is real** — the wide-events data model puts the signal (latency/status) and the high-cardinality context in one row, so one `GROUP BY` discriminates a cohort, whereas three pillars must correlate across surfaces. That split is a genuine data-model property, not a harness bug (fairness-F3, confirmed).

But **the raw "4–20× tokens" number is not yet trustworthy** — it's inflated by harness artifacts, and the **correctness comparison is not statistically significant**. After the fixes below, the pillars arm gets *stronger*, so the honest gap will **shrink** toward the true correlation cost. That smaller, defensible number is what should go in the blog.

Two theories were **refuted** by measurement (worth stating publicly — they pre-empt attacks):
- **Burn-profile contamination does NOT wash out the signals** — at ground truth, S1 `new-checkout-flow` = 98.3% of slow eu-west-1 checkout; S5 `build-7a3` = 91% of `/api/auth` 503s. The pillars "evenly distributed" failure is a data-*access* artifact, not contamination.
- **Truncation/result-caps are NOT the primary artifact** — a pillars agent that *aggregates* stays under the 8000-char cap. The real inflators are verbose JSON re-billing (F1) and missing trace-fetch (F2).
- **Judge blindness holds** (unit-enforced; no arm/token/timing in the prompt).

---

## Findings — must-fix for a public claim

### V1 — Logs pillar is status-blind (CRITICAL, telemetry). *This is the real strawman.*
`commonKV` (`trace-generator/logs.go:24`) has **no status code**; every request logs one `SeverityInfo` line even for 503/504 (`main.go:414`, emitted before the error branch). Loki carries only `service_name` + INFO. So the pillars arm literally cannot filter "failing requests," and any "which attribute dominates the failures?" collapses to base-rate — this **manufactures** the S5 "build_id evenly distributed" wrong answer. Real access logs (nginx/envoy/app) carry status. **Fix:** add `http.status_code` to `commonKV` and set severity `Error` on 4xx/5xx. **CLEAR-FIX.**

### V2 — Tempo returns no span attributes and there's no fetch-by-ID (HIGH, fairness). Breaks S3.
The `traceql` tool (`pillarsTools.ts` → `tempo.ts` `/api/search`) returns trace *summaries* only (`{traceID, rootServiceName, durationMs}`) — even with `| select(...)`. There is **no `get_trace`/`/api/traces/{id}` tool**. So trace-only discriminators (S3 `db.system=redis`, S4/S8 `elasticsearch`) can be *filtered* but never *discovered* — the agent must guess the value. A real three-pillars SRE fetches the trace and reads spans. **Fix:** add a `get_trace` tool (and/or surface span attributes in `traceql`). **CLEAR-FIX.**

### V3 — Token verbosity tax: JSON vs TSV = 7–12× on identical info (HIGH, fairness). *Prime headline inflator.*
Same aggregation, both arms: `region × feature_flag` counts = ClickHouse **384 B** vs Loki **4608 B** (**12×**); p99 by route×region = **461 B** vs Prometheus **3165 B** (**7×**). Because message history is re-fed as input every turn (up to `MAX_TURNS=25`), verbose results are **re-billed** repeatedly. Much of "4–20×" is serialization, not data model. **Fix:** report a **payload-excluded / output-tokens-only** sensitivity column alongside the raw number; if the gap collapses toward ~2× it was mostly format. (Optionally normalize backend JSON→compact — but that hides a cost a real agent pays; prefer the sensitivity metric.) **DECISION.**

### V4 — Correctness comparison not statistically significant (BLOCKING, methodology).
Wilson 95% CIs overlap: bubble-up 84% [70–93], wide-sql 82% [67–91], pillars 68% [52–80]; bubble-up-vs-pillars z≈1.76 **p≈0.078**. 80% power on a 16pp gap needs **~14 trials/cell** (2.7× current). The token-cost finding (mechanistically explained by tool-call count) survives; the pass-rate claim does not. **Fix:** drop the correctness claim from the public post, or attach CIs, or re-run at N≥~15. **DECISION.**

### V5 — `renderTable` prints `0` for zero-pass cells (HIGH, real code bug).
`report.ts` `median([])→0`, so a 0-pass cell renders `... | 0 | 0 | 0 |` (reads as "free"). The `—` in `docs/eval-findings.md` was a **hand edit** — a stranger re-running `make eval` gets misleading zeros. **Fix:** render `—` when `nPass===0`; add a test. **CLEAR-FIX.**

### V6 — Reproducibility pinning (BLOCKING per own bar, methodology).
`clickhouse-server:latest-alpine` (floating `latest`, and it's the primary wide-events datastore), collector pinned by tag not digest; grafana/postgres floating; model aliases not snapshot-recorded. **Fix:** digest-pin ClickHouse + collector; record the resolved model IDs (from the API response) in the results artifact. **CLEAR-FIX (mechanical).**

### V7 — Nondeterminism undisclosed; "Reproducible" overclaims (HIGH, methodology).
No temperature is set (correct — `sonnet-5`/`opus-4-8` reject sampling params), so exact per-cell numbers won't replicate. **Fix:** disclose; soften "Reproducible" → "environment-reproducible; qualitative ordering replicates, exact figures won't." **CLEAR-FIX (doc).**

---

## Findings — rubric/prompt text (CLEAR-FIX, in `scenarios.ts`)

### V8 — S3 rubric requires `db.system=redis`, which is NOT a discriminator (HIGH).
Normal user-service emits a fast redis span on **every** trace (`main.go:932`), so redis is ~100% everywhere → **≈1.0× lift**. The real signal is `host.region=ap-southeast-1` + slow duration. **Fix:** grade S3 on region + "slow cache/redis dependency" as supporting, not redis-as-required.

### V9 — S1/S7 rubric "high-cardinality discriminator" wording is factually inverted (MED/LOW).
Region has *more* values (4) than feature-flags (3); in the slow selection **flag and region are both 100%** (co-necessary, neither sufficient alone). "eu-west-1 regional slowdown" is statistically perfect yet failed. **Fix:** drop the false wording; require the **conjunction**; justify the flag on causal/actionability grounds.

### V10 — S5 prompt's latency clue points at S3, not S5 (MED-HIGH).
Slow `/api/auth` is **58.7% ap-southeast-1** (S3 bleeding in); S5 is clean only on the **503 error axis** (build-7a3 = 91%, pods 7/8 = 90%). Agents chase the "p99 ~800ms" clue → land on S3's answer → fail S5. **Fix:** rewrite S5's prompt to foreground the **503 error burst**, de-emphasize latency. (Combined with V1 status-in-logs, this should make S5 genuinely recoverable by all arms.)

### V11 — S6 header says "30% prob"; actual is 4.87% (IMPORTANT).
`main.go:20` vs const `scenarioPaymentTimeoutRate=0.05` (`main.go:255`); measured 4.87%. **Fix:** correct the header table. (Eval doesn't cite it, but it's a public-facing doc bug.)

---

## Findings — grading & metrics hardening (CLEAR-FIX)

- **V12 — Binary pass discards "found 1 of 2"** (6 scenarios have 2-attribute discriminators). Add an attribute-recall field to the judge schema + report it. Lets a metrics-first arm's consistent half-right pattern show instead of collapsing to 0.
- **V13 — Judge label-namespace mismatch** (`host.region` vs `host_region`): normalize dotted/underscored before display or instruct the judge to equate.
- **V14 — Judge "Apply strictly" biases toward false-negatives.** Soften to "pass if the required root cause is named, even if phrased differently."
- **V15 — Median over passing-runs only hides failure cost.** Add an all-non-error-trials cost metric alongside; note bubble-up S1's "282k median" is one trial (1/5).
- **V16 — Wall-clock caveat is 50 lines below the table.** Footnote the column (or drop it); surface an SDK-retry counter in `CellResult`.

---

## Findings — design decisions (owner's call, not unilateral)

- **D1 — Tempo metrics-generator is disabled** (`tempo.yml` has no `metrics_generator`), so TraceQL aggregation errors (`empty ring`) → the pillars agent must page raw traces instead of one server-side `GROUP BY`. Enabling it makes the arm fairer and shrinks the gap toward the true correlation cost; leaving it off is defensible ("Tempo-without-generator" is a common deployment) but widens the measured gap. **Materially changes the headline number.**
- **D2 — S5 Redis red herring** = S3's ground truth: S5 emits a slow redis span, so "it's Redis" *passes* S3 but *fails* S5. Adversarially confounded — keep (and reward "found Redis, wrong root cause" as a partial state) or simplify.
- **D3 — Judge robustness:** k-sample majority-vote + a small (~20–40) human-labeled gold set to measure judge precision/recall. More defensible; more cost/effort. (Note: determinism via temp=0 is NOT available on these models — majority-vote is the lever.)
- **D4 — Concurrent-all-scenarios** stays as the (realistic-noise) design for the aggregate token claim; run an isolated-scenario control only if publishing per-scenario narratives (S1 hardest, etc.).

---

## Clean (attacks that FAILED — state these to pre-empt nitpicks)
- Metrics pillar cardinality is **realistic** (low-card labels only — nobody puts build_id on spanmetrics); intended aggregation loss faithfully modeled.
- Tempo carries **full attribute parity** (not a data strawman) — the gap is aggregation ergonomics (D1) + fetch-wiring (V2), not missing data.
- Timeouts/error-handling/retry are **symmetric** across arms (all 60s, all fail-closed).
- System prompt is **arm-neutral** (names no tool/backend/verb).
- `StatusCode='Error'` (not `STATUS_CODE_ERROR`) penalizes the *wide* arm if anything — doesn't rig toward the thesis (worth a one-line note in the agent prompt).

## Consequence for the numbers
Every V1/V2/V8/V10 fix and the D1 decision **change the measured result** (they strengthen the pillars arm). So plugging these **requires re-running the matrix** and re-reporting. Expect the token gap to shrink and pillars pass-rates to rise — that is the honest, defensible outcome.
