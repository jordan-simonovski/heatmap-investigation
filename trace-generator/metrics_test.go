package main

import (
	"testing"
	"time"
)

func TestS5EpisodeIsThreeMinutesOfEveryFifteen(t *testing.T) {
	// Minutes 0,1,2 of each 15-min block are active; 3..14 are not.
	cases := []struct {
		minute int64
		active bool
	}{
		{0, true}, {1, true}, {2, true}, {3, false}, {8, false}, {14, false},
		{15, true}, {16, true}, {18, false}, {29, false}, {30, true},
	}
	for _, c := range cases {
		ts := time.Unix(c.minute*60, 0)
		if got := s5EpisodeActive(ts); got != c.active {
			t.Fatalf("minute %d: expected active=%v, got %v", c.minute, c.active, got)
		}
	}
}

func TestS5MemorySaturatesOnlyTargetPodsInsideEpisodes(t *testing.T) {
	inEpisode := time.Unix(60, 0)   // minute 1 — active
	offEpisode := time.Unix(300, 0) // minute 5 — inactive

	if v := signalBaseValue("user-service", "pod-abc-7", "memory.utilization", inEpisode); v < 0.85 {
		t.Fatalf("pod-abc-7 memory in episode should saturate (>=0.85), got %f", v)
	}
	if v := signalBaseValue("user-service", "pod-abc-7", "memory.utilization", offEpisode); v < 0.20 || v > 0.50 {
		t.Fatalf("pod-abc-7 memory off-episode should be baseline [0.20,0.50], got %f", v)
	}
	if v := signalBaseValue("user-service", "pod-abc-1", "memory.utilization", inEpisode); v < 0.20 || v > 0.50 {
		t.Fatalf("healthy pod-abc-1 must never saturate, got %f", v)
	}
	if v := signalBaseValue("order-service", "pod-abc-7", "memory.utilization", inEpisode); v < 0.20 || v > 0.50 {
		t.Fatalf("other services must never S5-saturate, got %f", v)
	}
}

func TestSearchServicePinnedCPUAndQueue(t *testing.T) {
	ts := time.Unix(300, 0)
	if v := signalBaseValue("search-service", "pod-abc-1", "cpu.utilization", ts); v < 0.85 {
		t.Fatalf("search-service cpu should be pinned >=0.85, got %f", v)
	}
	if v := signalBaseValue("api-gateway", "pod-abc-1", "cpu.utilization", ts); v < 0.20 || v > 0.50 {
		t.Fatalf("api-gateway cpu should be baseline, got %f", v)
	}
	search := signalBaseValue("search-service", "pod-abc-1", "queue.depth", ts)
	other := signalBaseValue("api-gateway", "pod-abc-1", "queue.depth", ts)
	if search < 5*other {
		t.Fatalf("search-service queue.depth (%f) should be >=5x baseline (%f)", search, other)
	}
}

func TestJitteredValuesStayInBands(t *testing.T) {
	inEpisode := time.Unix(60, 0)
	for i := 0; i < 200; i++ {
		v := jitteredSignalValue("user-service", "pod-abc-7", "memory.utilization", inEpisode)
		if v < 0.85 || v > 0.99 {
			t.Fatalf("saturated jittered memory out of band: %f", v)
		}
		b := jitteredSignalValue("api-gateway", "pod-abc-1", "cpu.utilization", inEpisode)
		if b < 0.15 || b > 0.55 {
			t.Fatalf("baseline jittered cpu out of band: %f", b)
		}
		q := jitteredSignalValue("api-gateway", "pod-abc-1", "queue.depth", inEpisode)
		if q < 0 {
			t.Fatalf("queue depth must be non-negative: %f", q)
		}
	}
}

func TestMetricPodsCoverS5Pods(t *testing.T) {
	pods := metricPods()
	found7, found8 := false, false
	for _, p := range pods {
		if p.service == "user-service" && p.pod == "pod-abc-7" {
			found7 = true
		}
		if p.service == "user-service" && p.pod == "pod-abc-8" {
			found8 = true
		}
	}
	if !found7 || !found8 {
		t.Fatalf("metricPods must include user-service pod-abc-7 and pod-abc-8")
	}
}
