'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSdkResource } = require('../instrumentation/sdk/resource');

test('SDK resource retains OpenTelemetry defaults and adds only the mode marker', () => {
  const attributes = createSdkResource().attributes;

  assert.equal(attributes['service.name'], `unknown_service:${process.argv0}`);
  assert.equal(attributes['telemetry.sdk.language'], 'nodejs');
  assert.equal(attributes['telemetry.sdk.name'], 'opentelemetry');
  assert.equal(typeof attributes['telemetry.sdk.version'], 'string');
  assert.equal(attributes['demo.instrumentation.mode'], 'sdk');
  assert.equal(attributes['deployment.environment.name'], undefined);
  assert.equal(attributes['service.namespace'], undefined);
  assert.equal(attributes['service.version'], undefined);
});
