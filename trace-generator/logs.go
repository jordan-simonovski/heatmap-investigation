package main

// Request-level logs for the three-pillars eval arm. Each request emits one
// log record carrying the SAME attribute set as the span commonAttrs
// (main.go), so a discriminating attribute aggregated out of the metrics
// pillar (spanmetrics dimensions) still survives in the logs pillar. INV-1.

import (
	"context"

	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
	otellog "go.opentelemetry.io/otel/log"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"google.golang.org/grpc"
)

// commonKV is the SINGLE SOURCE OF TRUTH for the request attribute set carried
// on both the span commonAttrs (main.go emitTrace) and the log record
// (logAttrs). Both callers range over this, so adding/renaming a key in one
// place changes the other automatically — the lockstep is structural, not by
// convention. Order matters only for readability; callers sort where needed.
func commonKV(a traceAttrs) []struct{ Key, Val string } {
	return []struct{ Key, Val string }{
		{"http.method", a.method},
		{"http.route", a.route},
		{"user.id", a.uid},
		{"app.tenant_id", a.tenant},
		{"host.region", a.region},
		{"app.build_id", a.buildID},
		{"app.platform", a.platform},
		{"app.feature_flag", a.featureFlag},
		{"k8s.pod.name", a.pod},
	}
}

// logAttrs mirrors the span commonAttrs key set onto a log record, built from
// commonKV so it stays in lockstep with the span attributes, plus the
// request's actual HTTP status code (V1 fix: the logs pillar must be able to
// filter/aggregate on failure, the same way the span attribute does).
func logAttrs(a traceAttrs, statusCode int) []otellog.KeyValue {
	kvs := commonKV(a)
	out := make([]otellog.KeyValue, 0, len(kvs)+1)
	for _, kv := range kvs {
		out = append(out, otellog.String(kv.Key, kv.Val))
	}
	out = append(out, otellog.Int("http.status_code", statusCode))
	return out
}

// startLogEmitter builds an OTLP log exporter over the shared gRPC conn and
// returns emit + shutdown funcs. Resource ServiceName is fixed; per-request
// service is not needed for the logs pillar (route disambiguates).
//
// emit takes the request's REAL HTTP status code (decided by the
// scenario/burn emitter in main.go, not guessed here) so the log record
// reflects what actually happened: severity is Error for 4xx/5xx, Info
// otherwise, and http.status_code is always present as an attribute (V1 fix).
func startLogEmitter(ctx context.Context, conn *grpc.ClientConn) (func(traceAttrs, string, int), func(context.Context), error) {
	exp, err := otlploggrpc.New(ctx, otlploggrpc.WithGRPCConn(conn))
	if err != nil {
		return nil, nil, err
	}
	res, _ := resource.New(ctx, resource.WithAttributes(
		semconv.ServiceName("trace-generator"),
	))
	lp := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exp)),
	)
	logger := lp.Logger("trace-generator")

	emit := func(a traceAttrs, body string, statusCode int) {
		var rec otellog.Record
		if statusCode >= 400 {
			rec.SetSeverity(otellog.SeverityError)
			rec.SetSeverityText("Error")
		} else {
			rec.SetSeverity(otellog.SeverityInfo)
			rec.SetSeverityText("Info")
		}
		rec.SetBody(otellog.StringValue(body))
		rec.AddAttributes(logAttrs(a, statusCode)...)
		logger.Emit(ctx, rec)
	}
	shutdown := func(c context.Context) { _ = lp.Shutdown(c) }
	return emit, shutdown, nil
}
