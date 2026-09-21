'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { publicConfig, readRuntimeConfig, redactEndpoint } = require('../app/config');
const { configureTelemetryEnvironment } = require('../instrumentation/configure-env');

test('runtime configuration has runnable defaults', () => {
  const config = readRuntimeConfig({});
  assert.equal(config.port, 8080);
  assert.equal(config.serviceName, 'checkout-api');
  assert.equal(config.demoScenario, 'normal');
  assert.equal(config.otlpEndpoint, 'http://localhost:4318');
  assert.equal(config.otlpProtocol, 'http/protobuf');
});

test('bootstrap provides local resource defaults without replacing explicit deployment attributes', () => {
  const localEnvironment = {};
  configureTelemetryEnvironment('sdk', localEnvironment);
  assert.equal(
    localEnvironment.OTEL_RESOURCE_ATTRIBUTES,
    'service.namespace=otel-onboarding,deployment.environment.name=local,service.version=1.0.0',
  );
  assert.equal(localEnvironment.OTEL_NODE_RESOURCE_DETECTORS, 'env,host,os,serviceinstance');

  const cloudEnvironment = {
    OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=otel-onboarding,deployment.environment.name=demo,service.version=2.0.0',
  };
  configureTelemetryEnvironment('sdk', cloudEnvironment);
  assert.equal(
    cloudEnvironment.OTEL_RESOURCE_ATTRIBUTES,
    'service.namespace=otel-onboarding,deployment.environment.name=demo,service.version=2.0.0',
  );
});

test('an explicitly blank OTEL_SERVICE_NAME remains omitted', () => {
  const environment = { OTEL_SERVICE_NAME: '' };
  const config = configureTelemetryEnvironment('sdk', environment);
  assert.equal(config.serviceName, undefined);
  assert.equal(environment.OTEL_SERVICE_NAME, '');
  assert.equal(publicConfig(config).serviceNameConfigured, false);
});

test('scenario and protocol validation fail with actionable messages', () => {
  assert.throws(() => readRuntimeConfig({ DEMO_SCENARIO: 'mystery' }), /DEMO_SCENARIO must be one of/);
  assert.throws(
    () => readRuntimeConfig({ OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc' }),
    /expects OTEL_EXPORTER_OTLP_PROTOCOL=http\/protobuf/,
  );
});

test('public endpoint output redacts embedded credentials', () => {
  const result = redactEndpoint('https://12345:secret@example.test/otlp');
  assert.equal(result, 'https://redacted:redacted@example.test/otlp');
});
