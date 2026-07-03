package main

import (
	"sort"
	"testing"
)

// The log record must carry exactly the same attribute keys the span common
// attributes carry, so an answer aggregated out of metrics still lives in logs.
func TestLogAttrsMirrorsSpanCommonAttrs(t *testing.T) {
	a := traceAttrs{
		route: "/cart/checkout", method: "POST", region: "eu-west-1",
		buildID: "build-7a3", platform: "ios", featureFlag: "new-checkout-flow",
		tenant: "tenant-initech", uid: "user-42", pod: "pod-abc-7",
	}

	// Derive want from commonKV, the single source of truth shared with the
	// span commonAttrs (main.go). If a key diverges between logAttrs and the
	// span attrs, this test fails because both are built from commonKV.
	want := make([]string, 0)
	for _, kv := range commonKV(a) {
		want = append(want, kv.Key)
	}
	sort.Strings(want)

	got := make([]string, 0, len(want))
	for _, kv := range logAttrs(a) {
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
	for _, kv := range logAttrs(a) {
		if string(kv.Key) == "app.feature_flag" && kv.Value.AsString() == "new-checkout-flow" {
			found = true
		}
	}
	if !found {
		t.Fatal("app.feature_flag value not carried in log record")
	}
}
