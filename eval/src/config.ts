const env = process.env;

export const config = {
  agentModel: env.EVAL_AGENT_MODEL ?? "claude-sonnet-5",
  judgeModel: env.EVAL_JUDGE_MODEL ?? "claude-opus-4-8",
  trials: Number(env.EVAL_TRIALS ?? 5),
  concurrency: Number(env.EVAL_CONCURRENCY ?? 4),
  truncateCap: Number(env.EVAL_TRUNCATE_CAP ?? 8000),
  maxTokensPerTurn: Number(env.EVAL_MAX_TOKENS ?? 16000),
  urls: {
    clickhouse: env.EVAL_CLICKHOUSE_URL ?? "http://localhost:8123",
    prometheus: env.EVAL_PROMETHEUS_URL ?? "http://localhost:9090",
    loki: env.EVAL_LOKI_URL ?? "http://localhost:3100",
    tempo: env.EVAL_TEMPO_URL ?? "http://localhost:3200",
  },
} as const;
