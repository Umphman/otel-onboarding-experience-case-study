'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../app/service');

const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
});

function testConfig(overrides = {}) {
  return {
    port: 0,
    serviceName: 'test-service',
    demoScenario: 'normal',
    otlpEndpoint: 'http://localhost:4318',
    otlpProtocol: 'http/protobuf',
    instrumentationMode: 'test',
    ...overrides,
  };
}

async function startServer(config = testConfig(), options = {}) {
  const server = createServer({ config, logger: silentLogger, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { server, baseUrl };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('health reports telemetry mode, identity, and scenario', async (t) => {
  const { server, baseUrl } = await startServer(testConfig({ demoScenario: 'broken-context-propagation' }));
  t.after(() => closeServer(server));

  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    telemetry: {
      serviceName: 'test-service',
      serviceNameConfigured: true,
      demoScenario: 'broken-context-propagation',
      instrumentationMode: 'test',
      otlpEndpoint: 'http://localhost:4318',
      otlpProtocol: 'http/protobuf',
    },
  });
});

test('checkout calls inventory and returns a synthetic confirmation', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(() => closeServer(server));

  const response = await fetch(`${baseUrl}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checkoutId: 'chk_test', items: [{ sku: 'otel-sticker', quantity: 2 }] }),
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.checkoutId, 'chk_test');
  assert.equal(body.status, 'confirmed');
  assert.match(body.reservationId, /^res_[a-f0-9]{8}$/);
  assert.equal(body.telemetry.scenario, 'normal');
  // Tests run without an SDK preload, so there is intentionally no active trace.
  assert.equal(body.telemetry.contextPropagationHealthy, null);
});

test('invalid checkout payload and unknown routes are actionable', async (t) => {
  const { server, baseUrl } = await startServer();
  t.after(() => closeServer(server));

  const invalid = await fetch(`${baseUrl}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ sku: '', quantity: 0 }] }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /requires a non-empty sku/);

  const missing = await fetch(`${baseUrl}/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Route not found.' });
});

test('checkout metrics include validation failures', async (t) => {
  const observations = { requests: [], errors: [], durations: [] };
  const telemetryInstruments = {
    checkoutRequests: { add: (...args) => observations.requests.push(args) },
    checkoutErrors: { add: (...args) => observations.errors.push(args) },
    checkoutDuration: { record: (...args) => observations.durations.push(args) },
    inventoryReservations: { add() {} },
  };
  const { server, baseUrl } = await startServer(testConfig(), { telemetryInstruments });
  t.after(() => closeServer(server));

  const response = await fetch(`${baseUrl}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checkoutId: 'expected-error', items: [] }),
  });

  assert.equal(response.status, 400);
  assert.equal(observations.requests.length, 1);
  assert.equal(observations.errors.length, 1);
  assert.equal(observations.durations.length, 1);
  assert.equal(observations.requests[0][0], 1);
  assert.equal(observations.errors[0][0], 1);
  assert.ok(observations.durations[0][0] >= 0);
});
