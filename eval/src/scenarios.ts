export type Attr = { key: string; value: string };

export type Scenario = {
  id: string;
  symptomPrompt: string;
  groundTruthRca: string;
  culpritService: string;
  discriminatingAttributes: Attr[];
  rubric: string;
  tie?: boolean;
};

const TASK = "Investigate using your tools and, when confident, call submit_verdict with the culprit service and the attribute key/values that distinguish the failing requests.";

export const scenarios: Scenario[] = [
  {
    id: "S1",
    symptomPrompt: `Checkout requests to /cart/checkout are completing successfully but running about 1.5s slower than normal, pushing the checkout p99 latency SLO into breach. These requests are slow, not failing — there is no elevated error rate on the affected traffic. ${TASK}`,
    groundTruthRca:
      "Checkout latency (p99 ~1500ms, N+1 DB queries) is isolated to requests with feature flag new-checkout-flow in region eu-west-1. The new-checkout-flow feature flag rollout in eu-west-1 is the root cause.",
    culpritService: "order-service",
    discriminatingAttributes: [
      { key: "app.feature_flag", value: "new-checkout-flow" },
      { key: "host.region", value: "eu-west-1" },
    ],
    rubric:
      "PASS only if the answer identifies BOTH the new-checkout-flow feature flag AND region eu-west-1 — the slowdown is isolated to that conjunction (flag and region are each ~100% of the slow selection, i.e. co-necessary; neither is sufficient alone, so 'eu-west-1 regional slowdown' without the flag does not pass). The feature flag is graded as the actionable root cause on CAUSAL grounds, not cardinality grounds: a flag rollout is the thing you would disable or roll back, whereas the region is where the effect is observed. Region alone is insufficient; naming the feature flag (scoped to eu-west-1) is required.",
  },
  {
    id: "S2",
    symptomPrompt: `The error rate on /api/orders has spiked — a burst of HTTP 500 responses that return quickly (~250ms), so this is a failure spike, not a latency problem. ${TASK}`,
    groundTruthRca:
      "HTTP 500s (~250ms) on /api/orders are isolated to platform=ios on build build-7a3. The build-7a3 release on iOS is the root cause.",
    culpritService: "order-service",
    discriminatingAttributes: [
      { key: "app.platform", value: "ios" },
      { key: "app.build_id", value: "build-7a3" },
    ],
    rubric:
      "PASS if the answer identifies build build-7a3 on the iOS platform as the root cause. Both platform and build_id should appear; identifying build-7a3 is required.",
  },
  {
    id: "S3",
    symptomPrompt: `Read latency on user-service is elevated (p99 ~650ms) with no rise in error rate, and the slowdown is concentrated in a single geographic region. ${TASK}`,
    groundTruthRca:
      "p99 ~650ms on user-service is isolated to region ap-southeast-1, where the (normally fast) Redis dependency call times out and falls back to Postgres. Region ap-southeast-1 is the root cause locus; the timing-out Redis-to-Postgres fallback is the mechanism.",
    culpritService: "user-service",
    discriminatingAttributes: [
      { key: "host.region", value: "ap-southeast-1" },
      { key: "db.system", value: "redis" },
    ],
    rubric:
      "PASS if the answer identifies region ap-southeast-1 as the locus of the slowdown AND names the slow cache/Redis dependency (falling back to Postgres) as the mechanism. Region is the required, recoverable discriminator: a fast redis span appears on essentially every user-service trace across all regions (~100% incidence, ~1.0x lift), so 'Redis' alone — without scoping to ap-southeast-1 — is NOT a valid discriminator and does not pass by itself. db.system=redis is graded as supporting mechanism evidence once ap-southeast-1 is named as the locus.",
  },
  {
    id: "S4",
    symptomPrompt: `Requests to /api/search are failing with HTTP 500s that take ~3s (a backend search-engine timeout), and the failures are confined to a single customer. ${TASK}`,
    groundTruthRca:
      "HTTP 500 (Elasticsearch timeout ~3s) on /api/search for tenant tenant-initech with feature flag dark-launch-search. The dark-launch-search flag for tenant-initech is the root cause.",
    culpritService: "search-service",
    discriminatingAttributes: [
      { key: "app.tenant_id", value: "tenant-initech" },
      { key: "app.feature_flag", value: "dark-launch-search" },
    ],
    rubric:
      "PASS if the answer identifies tenant-initech with the dark-launch-search feature flag as the root cause. Both are required.",
  },
  {
    id: "S5",
    symptomPrompt: `The /api/auth endpoint is throwing a burst of intermittent HTTP 503 errors — they arrive in clusters rather than being spread evenly across all traffic, and appear concentrated on a subset of service instances rather than the whole fleet. Overall latency is only mildly elevated; the defining signal is the 503 error burst itself. ${TASK}`,
    groundTruthRca:
      "Intermittent 503s and p99 ~800ms on /api/auth from a memory leak on build build-7a3, concentrated on pods pod-abc-7 and pod-abc-8. The build-7a3 memory leak on those pods is the root cause.",
    culpritService: "user-service",
    discriminatingAttributes: [
      { key: "app.build_id", value: "build-7a3" },
      { key: "k8s.pod.name", value: "pod-abc-7" },
    ],
    rubric:
      "PASS if the answer identifies build build-7a3 AND the affected pods (pod-abc-7 / pod-abc-8) as the root cause. Score on build_id + pod; the memory-saturation mechanism is supporting evidence, not required.",
  },
  {
    id: "S6",
    symptomPrompt: `Checkout requests to /cart/checkout are timing out — returning HTTP 504 after hanging for roughly 5 seconds — for a subset of users. ${TASK}`,
    groundTruthRca:
      "HTTP 504 (~5s payment provider timeout) on /cart/checkout isolated to region us-west-2. The us-west-2 payment provider timeout is the root cause.",
    culpritService: "payment-service",
    discriminatingAttributes: [{ key: "host.region", value: "us-west-2" }],
    tie: true,
    rubric:
      "PASS if the answer identifies region us-west-2 as the root cause of the checkout 504s. (This scenario is region-only — an expected tie across arms.)",
  },
  {
    id: "S7",
    symptomPrompt: `A single customer reports that every request is roughly 150ms slower than for other customers — a small, uniform latency overhead spread across all routes, with no errors. ${TASK}`,
    groundTruthRca:
      "A +150ms overhead on all routes for tenant tenant-umbrella in region eu-west-1 (EU compliance overhead). tenant-umbrella in eu-west-1 is the root cause.",
    culpritService: "api-gateway",
    discriminatingAttributes: [
      { key: "app.tenant_id", value: "tenant-umbrella" },
      { key: "host.region", value: "eu-west-1" },
    ],
    rubric:
      "PASS if the answer identifies tenant-umbrella as the source of the latency overhead. The symptom already narrows this to 'a single customer', so tenant is the natural required answer; region eu-west-1 is supporting context and is a bonus if included, but naming tenant-umbrella is required regardless.",
  },
  {
    id: "S8",
    symptomPrompt: `Product-catalog write requests on /api/products are slow (~500ms, a slow search/index backend) for a single customer, while reads are unaffected. ${TASK}`,
    groundTruthRca:
      "Slow Elasticsearch (~500ms) on POST /api/products for tenant tenant-globex (batch import). tenant-globex's product batch import is the root cause.",
    culpritService: "search-service",
    discriminatingAttributes: [
      { key: "app.tenant_id", value: "tenant-globex" },
      { key: "http.method", value: "POST" },
    ],
    rubric:
      "PASS if the answer identifies tenant-globex on POST /api/products as the root cause. Naming tenant-globex is required.",
  },
];
