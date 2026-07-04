# Agent-RCA Eval — Findings (hardened harness, N=10)

**Status:** Results from the *fairness-hardened* harness (all `docs/eval-validity-audit.md` findings closed). Reproducible; **one validation still open** before the accuracy headline is publishable — see *Pending*. Run date: 2026-07-04.

**Setup:** 8 scenarios (S1–S8) × 3 arms × 10 trials = 240 runs. Agent `claude-sonnet-5`; blind majority-vote judge (`claude-opus-4-8`, k=3, arm-blind). Live stack via `make up`; ClickHouse/Prometheus/Loki/Tempo digest-pinned. Three arms differ *only* in tools: **wide-sql** (`clickhouse_sql` over one wide-event table), **bubble-up** (SQL + `rank_attributes`), **pillars** (`promql` + `loki_logql` + `traceql`/`get_trace`/`traceql_metrics`).

Companion docs: `docs/eval-validity-audit.md` (the adversarial audit + fixes) and `docs/eval-methodology.md`.

---

## TL;DR — the honest result (and a corrected one)

An earlier run on a *partially unfair* harness showed a 4–20× token gap favoring wide events. An adversarial audit found that gap was largely an **artifact** (verbose-JSON tool results re-billed each turn; a crippled pillars arm that couldn't fetch traces or aggregate). We fixed all of it and re-ran. The corrected, defensible findings:

1. **Wide events make the agent substantially more *accurate* at RCA** — wide-sql 87% / bubble-up 89% / **pillars 61%** pass-rate — and the gap is concentrated exactly where theory predicts: **high-cardinality root causes that metrics can't carry** (feature flags, build+pod, tenant+flag). This is the real finding.
2. **Wide events are NOT meaningfully cheaper in tokens once you control for result format.** Total tokens look higher for pillars, but that is dominated by verbose backend JSON re-fed as input each turn; **output-token cost (reasoning effort) is comparable**, sometimes lower for pillars. We do **not** claim a token-efficiency win.
3. **No clean MTTR-by-time win either** — steps-to-resolution and contention-free wall-clock are both mixed. The real MTTR story is accuracy: **a wrong root cause has effectively infinite MTTR, and three pillars was wrong ~39% of the time vs ~12% for wide events.**

Short version: **the "easier/more reliable" half of the thesis holds strongly; the "cheaper" half does not survive a fair comparison.**

---

## Finding 1 — Accuracy (the finding)

Pass-rate over scored (non-errored) trials:

| arm | aggregate | high-card scenarios (S1/S4/S5) | accessible scenarios (S2/S3/S6/S7/S8) |
|---|---|---|---|
| wide-sql | 68/78 = **87%** | S1 33% · S4 100% · S5 78% | 100/100/90/90/100 |
| bubble-up | 64/72 = **89%** | S1 56% · S4 63% · S5 90% | 100/100/100/100/100 |
| pillars | 47/77 = **61%** | S1 **11%** · S4 **20%** · S5 **20%** | 80/78/100/78/100 |

The wide-events arms are ~26pp more accurate in aggregate, but the aggregate understates it — **the gap lives almost entirely in the three scenarios whose root cause is a high-cardinality attribute absent from metrics** (S1 `feature_flag`, S4 `tenant`+`flag`, S5 `build`+`pod`). There, the pillars agent — *even with* `get_trace` and server-side `traceql_metrics` — usually failed to stitch the cross-pillar correlation, while one `GROUP BY` over wide events found it. On scenarios whose discriminator is route/region/low-card accessible (S2, S3, S6, S7, S8), the pillars arm is competitive.

That is the thesis, demonstrated on **reliability**: wide events don't just make investigation cheaper — they make the agent *get the right answer more often*, specifically for the high-cardinality root causes that pillar-shaped telemetry scatters.

**Formal significance:** trials within a cell are correlated, so a single two-proportion test overstates certainty; a scenario-clustered model is the right analysis. But the per-scenario deltas (S4 100% vs 20%, S5 78–90% vs 20% at n≈10) are not plausibly noise.

**Judge validation (done):** the accuracy numbers are the judge's verdicts, so we validated the judge against a human-reviewed 27-case gold set. Raw: **precision 1.00, recall 0.85, agreement 0.93** (tp 11, fp 0, tn 14, fn 2). The two disagreements were both cases where human review found the *gold label* wrong and the judge *right* (it correctly failed a build_id-only S2 answer and a region-only S3 answer as incomplete) — so on the corrected gold set the judge agrees **27/27**. The key number is **precision 1.00: the judge never passed a wrong answer**, so the pass-rates are not inflated by leniency — if anything the judge is slightly strict on two-attribute rubrics, applied identically across all arms, so the wide-vs-pillars ordering is unaffected (conservative). Caveat: S3's rubric text is internally contradictory (the judge resolved it consistently as "both required"); we deliberately did not rewrite it post-run — see Pending.

## Finding 2 — Token cost is comparable once result format is controlled

Median tokens (passing trials), pillars vs wide-sql: S2 2.8× · S3 11× · S5 1.4× · S7 2.4× · S8 1.6× (S4/S6 pillars ≈ or below wide). At face value that revives a "pillars costs more" story — **but it's a serialization artifact, not reasoning cost.** The message history (including every verbose tool result) is re-fed as input on every turn, and the pillars backends return verbose JSON where ClickHouse returns compact TSV. The **output-token** column (what the agent actually generated) tells the real story:

- S3 pillars: **353k total tokens but only 6.9k output** — ≈98% is re-fed JSON, not reasoning.
- Output tokens are comparable across arms, and *lower* for pillars on several scenarios (S6 2.4k vs 5.4k; S8 2.7k vs 4.3k).

**Conclusion: we cannot claim wide events use fewer tokens.** Measured by reasoning effort, the arms are comparable; the total-token difference is a function of tool-result verbosity × full-history re-feeding, which is a harness/serialization property, not a property of the data model. Reporting the raw total as a "cost win" would be the exact kind of number a skeptic dismantles.

## Finding 3 — Time / MTTR is mixed; accuracy is the MTTR story

- **Steps-to-resolution** (median turns / tool-calls, passing): mixed — pillars takes more on S3/S7, fewer on S6/S8/S2.
- **Contention-free wall-clock** (`--concurrency 1`, S2/S3/S6): pillars vs wide-sql = S2 1.3×, S3 1.8×, **S6 0.53× (pillars faster)**. No consistent time penalty; S3 is the one pillars-slow outlier.

There is no clean "wide events resolve faster" claim in step-count or wall-clock. The defensible MTTR framing is **accuracy-as-MTTR**: cheap-and-fast MTTR wins are illusory if the conclusion is wrong, and the pillars agent reached a *wrong* root cause ~39% of the time (vs ~12%). For the S1/S4/S5 high-card incidents, the pillars agent frequently would have sent an operator down the wrong remediation path.

---

## What changed from the first run (threats to validity, and how we closed them)

Being explicit here is the point — it pre-empts the nitpicking:

- **Verbose-result re-billing (the token inflator):** identical `GROUP BY` returned 384 B (ClickHouse TSV) vs 4,608 B (Loki JSON) — 12×, re-billed each turn. **Fix:** added an output-only (format-neutral) token column; that's why Finding 2 does not claim a token win.
- **Crippled pillars arm:** Tempo returned no span attributes and had no fetch-by-ID (trace-only discriminators unguessable), and its metrics-generator was off (no server-side aggregation). **Fix:** added `get_trace` + `traceql_metrics` (span. scope) + tunable limits and enabled the Tempo metrics-generator. Pillars pass-rates rose accordingly — the 61% is a *fair* number, not a hobbled one.
- **Status-blind logs (the strawman):** logs carried no HTTP status, so the pillars agent couldn't even filter to failing requests — this manufactured a wrong S5 answer in the first run. **Fix:** logs now carry `http.status_code` + `Error` severity.
- **Scenario/rubric bugs:** S3 required naming Redis (which is on ~100% of traces, ≈1.0× lift — not a discriminator); S1/S7 rubrics called region "high-cardinality" (it isn't); S5's prompt led with a latency clue that pointed at a *different* scenario. All corrected.
- **Reporting bug:** zero-pass cells rendered `0` (read as "free"); now `—`. Pinned ClickHouse + collector by digest.

**Attacks that failed (measured, not assumed):** burn-profile noise does *not* wash out the signals (S1 flag = 98% of the slow selection at ground truth); truncation/result-caps were *not* the primary artifact (an aggregating agent stays under the cap); the judge is genuinely arm-blind.

---

## Pending before publication

- **S3 rubric wording (deferred, not blocking).** The judge validation surfaced that S3's rubric contradicts itself (one clause "region AND redis-mechanism required", another "region required, redis supporting"). The judge resolved it consistently as "both required," and we did NOT rewrite it after seeing results (that would taint the scoring). A future iteration should reword S3 unambiguously and re-run; the current results stand as judged.
- **Nondeterminism:** these models take no temperature; exact per-cell numbers wobble run-to-run (pillars S3 was 7/9 then 9/10 across two runs). The *qualitative ordering* is the claim, not the exact figures — say so, and don't publish a table as bit-reproducible.
- **bubble-up error rate:** 7 errored cells (vs 2–3 for the other arms) — worth checking whether `rank_attributes` is erroring before quoting bubble-up's n.
- **Concurrent-scenario design:** all 8 scenarios run in one stream; fine for the aggregate, but the S1/S4/S5 per-scenario story would be strengthened by an isolated-scenario control if the post leans on it.

## Reproduce
```
make up                                             # digest-pinned stack; wait ~15 min for status-bearing logs + Tempo blocks
bash scripts/verify-inv1.sh                         # fairness gate
make eval                                           # headline: N=10, all arms
make eval ARGS="--scenario S2,S3,S6 --concurrency 1"  # contention-free wall-clock
npm --prefix eval run judge-eval                    # judge precision/recall vs the reviewed gold set
```
Agent `claude-sonnet-5`, judge `claude-opus-4-8` (resolved model id recorded per run; both were served as requested). Exact figures are not expected to reproduce bit-for-bit (no temperature control); the cross-arm ordering is the reproducible claim.
