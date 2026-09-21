'use strict';

const DEFAULT_SERVICE_NAME = 'checkout-api';
const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318';
const DEFAULT_OTLP_PROTOCOL = 'http/protobuf';
const DEFAULT_PORT = 8080;
const VALID_SCENARIOS = new Set(['normal', 'broken-context-propagation']);

function hasOwn(environment, name) {
  return Object.prototype.hasOwnProperty.call(environment, name);
}

function parsePort(rawPort) {
  const value = rawPort === undefined || rawPort === '' ? DEFAULT_PORT : Number(rawPort);

  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`PORT must be an integer from 0 to 65535; received ${JSON.stringify(rawPort)}`);
  }

  return value;
}

function readRuntimeConfig(environment = process.env) {
  // An explicitly blank service name is deliberate: the missing-service-name
  // scenario needs to demonstrate the resulting unattributed telemetry.
  const serviceNameRaw = hasOwn(environment, 'OTEL_SERVICE_NAME')
    ? String(environment.OTEL_SERVICE_NAME)
    : DEFAULT_SERVICE_NAME;
  const serviceName = serviceNameRaw.trim() || undefined;

  const demoScenario = String(environment.DEMO_SCENARIO || 'normal').trim();
  if (!VALID_SCENARIOS.has(demoScenario)) {
    throw new Error(
      `DEMO_SCENARIO must be one of ${[...VALID_SCENARIOS].join(', ')}; received ${JSON.stringify(demoScenario)}`,
    );
  }

  const otlpProtocol = String(environment.OTEL_EXPORTER_OTLP_PROTOCOL || DEFAULT_OTLP_PROTOCOL).trim();
  if (otlpProtocol !== DEFAULT_OTLP_PROTOCOL) {
    throw new Error(
      `This reference implementation expects OTEL_EXPORTER_OTLP_PROTOCOL=${DEFAULT_OTLP_PROTOCOL}; received ${JSON.stringify(otlpProtocol)}`,
    );
  }

  const otlpEndpoint = String(environment.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT)
    .trim()
    .replace(/\/$/, '');

  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(otlpEndpoint);
  } catch {
    throw new Error(`OTEL_EXPORTER_OTLP_ENDPOINT must be an absolute URL; received ${JSON.stringify(otlpEndpoint)}`);
  }

  if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) {
    throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT must use http or https for OTLP/HTTP.');
  }

  return Object.freeze({
    port: parsePort(environment.PORT),
    serviceName,
    demoScenario,
    otlpEndpoint,
    otlpProtocol,
    instrumentationMode: environment.OTEL_DEMO_INSTRUMENTATION_MODE || 'unconfigured',
  });
}

function redactEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.username) url.username = 'redacted';
  if (url.password) url.password = 'redacted';
  return url.toString().replace(/\/$/, '');
}

function publicConfig(config) {
  return {
    serviceName: config.serviceName ?? null,
    serviceNameConfigured: Boolean(config.serviceName),
    demoScenario: config.demoScenario,
    instrumentationMode: config.instrumentationMode,
    otlpEndpoint: redactEndpoint(config.otlpEndpoint),
    otlpProtocol: config.otlpProtocol,
  };
}

module.exports = {
  DEFAULT_OTLP_ENDPOINT,
  DEFAULT_OTLP_PROTOCOL,
  DEFAULT_PORT,
  DEFAULT_SERVICE_NAME,
  VALID_SCENARIOS,
  publicConfig,
  readRuntimeConfig,
  redactEndpoint,
};
