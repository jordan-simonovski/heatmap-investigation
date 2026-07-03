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
    symptomPrompt: `The SLO for checkout p99 latency has been burning over the last 15 minutes. ${TASK}`,
    groundTruthRca:
      "Checkout latency (p99 ~1500ms, N+1 DB queries) is isolated to requests with feature flag new-checkout-flow in region eu-west-1. The new-checkout-flow feature flag rollout in eu-west-1 is the root cause.",
    culpritService: "order-service",
    discriminatingAttributes: [
      { key: "app.feature_flag", value: "new-checkout-flow" },
      { key: "host.region", value: "eu-west-1" },
    ],
    rubric:
      "PASS if the answer identifies the new-checkout-flow feature flag (the high-cardinality discriminator) as the root cause, ideally scoped to eu-west-1. Region alone is insufficient; naming the feature flag is required.",
  },
  {
    id: "S2",
    symptomPrompt: `Error rate on the orders API has spiked. ${TASK}`,
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
    symptomPrompt: `User-service latency is elevated in one region. ${TASK}`,
    groundTruthRca:
      "p99 ~650ms on user-service in region ap-southeast-1 caused by Redis timeouts falling back to Postgres (db.system redis slow). The root cause is the Redis timeout in ap-southeast-1.",
    culpritService: "user-service",
    discriminatingAttributes: [
      { key: "host.region", value: "ap-southeast-1" },
      { key: "db.system", value: "redis" },
    ],
    rubric:
      "PASS if the answer identifies Redis (db.system=redis) timeouts in ap-southeast-1 as the cause. db.system is trace-only; naming Redis as the failing dependency is required.",
  },
  {
    id: "S4",
    symptomPrompt: `Search requests are failing for one tenant. ${TASK}`,
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
    symptomPrompt: `Auth requests show intermittent 503s and rising latency. ${TASK}`,
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
    symptomPrompt: `Checkout is timing out for some users. ${TASK}`,
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
    symptomPrompt: `One tenant reports across-the-board slowness. ${TASK}`,
    groundTruthRca:
      "A +150ms overhead on all routes for tenant tenant-umbrella in region eu-west-1 (EU compliance overhead). tenant-umbrella in eu-west-1 is the root cause.",
    culpritService: "api-gateway",
    discriminatingAttributes: [
      { key: "app.tenant_id", value: "tenant-umbrella" },
      { key: "host.region", value: "eu-west-1" },
    ],
    rubric:
      "PASS if the answer identifies tenant-umbrella (the high-cardinality discriminator), ideally scoped to eu-west-1, as the source of the latency overhead.",
  },
  {
    id: "S8",
    symptomPrompt: `Product API writes are slow for one tenant. ${TASK}`,
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
