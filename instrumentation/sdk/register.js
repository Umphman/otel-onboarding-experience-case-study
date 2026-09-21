'use strict';

// This preload must run before app/server.js imports node:http. That ordering is
// what allows HttpInstrumentation to patch both inbound and outbound requests.
const { announceBootstrap, configureTelemetryEnvironment } = require('../configure-env');
const config = configureTelemetryEnvironment('sdk');

const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-proto');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { createSdkResource } = require('./resource');

const metricExportInterval = Number.parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL, 10);
const sdk = new NodeSDK({
  // Keep OpenTelemetry's SDK identity and unknown_service fallback, then add
  // only the implementation-path marker. envDetector merges the configured
  // namespace/version/environment attributes during sdk.start().
  resource: createSdkResource(),
  serviceName: config.serviceName,
  traceExporter: new OTLPTraceExporter(),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: Number.isFinite(metricExportInterval) ? metricExportInterval : 5_000,
    }),
  ],
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  instrumentations: [new HttpInstrumentation()],
});

sdk.start();
announceBootstrap(config);

let shutdownPromise;
globalThis.__OTEL_DEMO_SHUTDOWN__ = function shutdownTelemetry() {
  shutdownPromise ||= sdk.shutdown();
  return shutdownPromise;
};
