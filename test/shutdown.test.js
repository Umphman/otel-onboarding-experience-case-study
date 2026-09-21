'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { flushTelemetry } = require('../app/shutdown');

function recordingLogger() {
  const warnings = [];
  return {
    warnings,
    warn(message, attributes) {
      warnings.push({ message, attributes });
    },
  };
}

test('telemetry shutdown reports a completed flush', async () => {
  const logger = recordingLogger();
  const outcome = await flushTelemetry({ shutdown: async () => {}, logger, timeoutMs: 50 });
  assert.deepEqual(outcome, { status: 'flushed' });
  assert.equal(logger.warnings.length, 0);
});

test('telemetry shutdown is bounded when an exporter never settles', async () => {
  const logger = recordingLogger();
  const startedAt = Date.now();
  const outcome = await flushTelemetry({
    shutdown: () => new Promise(() => {}),
    logger,
    timeoutMs: 20,
  });

  assert.deepEqual(outcome, { status: 'timed-out' });
  assert.ok(Date.now() - startedAt < 500, 'shutdown should return promptly after its timeout');
  assert.deepEqual(logger.warnings, [{
    message: 'telemetry shutdown timed out; exiting without a complete flush',
    attributes: { timeout_ms: 20 },
  }]);
});
