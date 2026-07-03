package main

// Saturation-signal synthesis for the wide-events saturation campaign.
// Pure functions of (service, pod, metric, time) so the emission model is
// unit-testable and the P3 ground-truth gate can PREDICT scores from these
// constants before measuring.

import (
	"math"
	"math/rand"
	"time"
)

const (
	baselineUtilMid   = 0.35
	baselineUtilSwing = 0.10 // sinusoidal swing, 10-min period → baseline in [0.25, 0.45]

	// S5 memory saturation is EPISODIC, not a ramp: a monotonic ramp puts the
	// baseline p95 near the peak too and the p95-delta score collapses to ~0.
	s5EpisodePeriodMin = 15 // one episode per 15-minute block...
	s5EpisodeLenMin    = 3  // ...lasting 3 minutes (20% duty cycle)
	s5SaturatedMemory  = 0.92

	s8PinnedCPU        = 0.90
	queueBaselineDepth = 3.0
	s8QueueDepth       = 45.0

	// S5 503s concentrate inside saturation episodes so the error burst is
	// time-localized and a selection over it correlates with the memory signal.
	// Weighted average = 0.40*(3/15) + 0.01*(12/15) = 0.088 — still conservative
	// for local SLO calibration (see main_test.go).
	scenarioAuthMemoryLeakErrorRateInEpisode  = 0.40
	scenarioAuthMemoryLeakErrorRateOffEpisode = 0.01
)

var metricNames = []string{
	"cpu.utilization",
	"memory.utilization",
	"db.pool.utilization",
	"queue.depth",
}

// s5EpisodeActive reports whether ts falls inside an S5 memory-saturation
// episode: minutes [0, s5EpisodeLenMin) of every s5EpisodePeriodMin-minute block.
func s5EpisodeActive(ts time.Time) bool {
	return (ts.Unix()/60)%s5EpisodePeriodMin < s5EpisodeLenMin
}

// signalBaseValue returns the deterministic component of a signal.
// Random jitter is added at emission time (jitteredSignalValue), not here.
func signalBaseValue(service, pod, metric string, ts time.Time) float64 {
	phase := float64(ts.Unix()%600) / 600 * 2 * math.Pi
	base := baselineUtilMid + baselineUtilSwing*math.Sin(phase)

	switch metric {
	case "memory.utilization":
		if service == "user-service" && (pod == "pod-abc-7" || pod == "pod-abc-8") && s5EpisodeActive(ts) {
			return s5SaturatedMemory
		}
		return base
	case "cpu.utilization":
		if service == "search-service" {
			return s8PinnedCPU
		}
		return base
	case "db.pool.utilization":
		return base
	case "queue.depth":
		if service == "search-service" {
			return s8QueueDepth
		}
		return queueBaselineDepth
	}
	return base
}

// jitteredSignalValue adds emission-time noise: ±0.05 absolute for utilization
// signals (clamped so saturated stays saturated and baseline stays in band),
// ±10% relative for queue depth.
func jitteredSignalValue(service, pod, metric string, ts time.Time) float64 {
	v := signalBaseValue(service, pod, metric, ts)
	if metric == "queue.depth" {
		return math.Max(0, v*(1+(rand.Float64()-0.5)*0.2))
	}
	v += (rand.Float64() - 0.5) * 0.10
	return math.Min(0.98, math.Max(0.02, v))
}

type podIdentity struct {
	service, pod string
}

// metricPods lists the (service, pod) identities that emit metrics. Every
// service gets two healthy pods; user-service additionally gets the S5
// saturation pods. Span-side k8s.pod.name is uniform pod-abc-1..8, so
// filtering spans to these pods works (pods are SpanAttributes, main.go:415).
func metricPods() []podIdentity {
	services := []string{
		"api-gateway",
		"order-service",
		"user-service",
		"search-service",
		"payment-service",
		"notification-service",
	}
	pods := make([]podIdentity, 0, len(services)*2+2)
	for _, svc := range services {
		pods = append(pods, podIdentity{svc, "pod-abc-1"}, podIdentity{svc, "pod-abc-2"})
	}
	pods = append(pods, podIdentity{"user-service", "pod-abc-7"}, podIdentity{"user-service", "pod-abc-8"})
	return pods
}
