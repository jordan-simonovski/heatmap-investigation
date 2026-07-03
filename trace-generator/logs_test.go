package main

import (
	"sort"
	"testing"
)

// The log record must carry exactly the same attribute keys the span common
// attributes carry (plus http.status_code, V1 fix), so an answer aggregated
// out of metrics still lives in logs, and the logs pillar can filter/GROUP BY
// failure status the same way the span attribute allows.
func TestLogAttrsMirrorsSpanCommonAttrs(t *testing.T) {
	a := traceAttrs{
		route: "/cart/checkout", method: "POST", region: "eu-west-1",
		buildID: "build-7a3", platform: "ios", featureFlag: "new-checkout-flow",
		tenant: "tenant-initech", uid: "user-42", pod: "pod-abc-7",
	}
	const statusCode = 503

	// Derive want from commonKV, the single source of truth shared with the
	// span commonAttrs (main.go), plus the status attribute logAttrs adds on
	// top. If a key diverges between logAttrs and the span attrs, this test
	// fails because both are built from commonKV.
	want := make([]string, 0)
	for _, kv := range commonKV(a) {
		want = append(want, kv.Key)
	}
	want = append(want, "http.status_code")
	sort.Strings(want)

	got := make([]string, 0, len(want))
	for _, kv := range logAttrs(a, statusCode) {
		got = append(got, string(kv.Key))
	}
	sort.Strings(got)

	if len(got) != len(want) {
		t.Fatalf("attribute count: got %d %v, want %d %v", len(got), got, len(want), want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("attribute key mismatch at %d: got %q, want %q", i, got[i], want[i])
		}
	}

	// Spot-check a discriminating value is actually carried, not just the key.
	found := false
	statusFound := false
	for _, kv := range logAttrs(a, statusCode) {
		if string(kv.Key) == "app.feature_flag" && kv.Value.AsString() == "new-checkout-flow" {
			found = true
		}
		if string(kv.Key) == "http.status_code" && kv.Value.AsInt64() == statusCode {
			statusFound = true
		}
	}
	if !found {
		t.Fatal("app.feature_flag value not carried in log record")
	}
	if !statusFound {
		t.Fatal("http.status_code value not carried in log record")
	}
}
