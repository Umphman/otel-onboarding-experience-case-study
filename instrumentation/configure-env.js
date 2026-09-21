'use strict';

const { DEFAULT_OTLP_ENDPOINT, DEFAULT_OTLP_PROTOCOL, DEFAULT_SERVICE_NAME, readRuntimeConfig } = require('../app/config');

function setDefault(environment, key, value) {
  if (!Object.prototype.hasOwnProperty.call(environment, key) || environment[key] === undefined) {
    environment[key] = value;
  }
}

function configureTelemetryEnvironment(mode, environment = process.env) {
  environment.OTEL_DEMO_INSTRUMENTATION_MODE = mode;
  setDefault(environment, 'OTEL_SERVICE_NAME', DEFAULT_SERVICE_NAME);
  setDefault(environment, 'OTEL_EXPORTER_OTLP_ENDPOINT', DEFAULT_OTLP_ENDPOINT);
  setDefault(environment, 'OTEL_EXPORTER_OTLP_PROTOCOL', DEFAULT_OTLP_PROTOCOL);
  setDefault(
    environment,
    'OTEL_RESOURCE_ATTRIBUTES',
    'service.namespace=otel-onboarding,deployment.environment.name=local,service.version=1.0.0',
  );
  setDefault(environment, 'OTEL_NODE_RESOURCE_DETECTORS', 'env,host,os,serviceinstance');
  setDefault(environment, 'OTEL_TRACES_EXPORTER', 'otlp');
  setDefault(environment, 'OTEL_METRICS_EXPORTER', 'otlp');
  setDefault(environment, 'OTEL_LOGS_EXPORTER', 'otlp');
  setDefault(environment, 'OTEL_METRIC_EXPORT_INTERVAL', '5000');

  // Validation happens before any SDK imports so configuration failures are
  // immediate and actionable instead of appearing later as exporter noise.
  return readRuntimeConfig(environment);
}

function announceBootstrap(config) {
  const serviceName = config.serviceName ?? '(omitted intentionally)';
  const message = {
    level: 'info',
    message: 'OpenTelemetry bootstrap configured',
    instrumentation_mode: config.instrumentationMode,
    service_name: serviceName,
    otlp_protocol: config.otlpProtocol,
    demo_scenario: config.demoScenario,
    scenario_behavior: config.demoScenario === 'broken-context-propagation'
      ? 'checkout-to-inventory propagation will be deliberately detached'
      : 'checkout-to-inventory propagation should remain connected',
  };
  process.stderr.write(`${JSON.stringify(message)}\n`);
}

module.exports = { announceBootstrap, configureTelemetryEnvironment, setDefault };
