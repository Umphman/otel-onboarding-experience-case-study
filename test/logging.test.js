'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatLogRecord, normalizeOtelAttributes } = require('../app/logging');

test('structured stdout records contain trace correlation fields', () => {
  const record = formatLogRecord('info', 'checkout complete', { checkout_id: 'chk_1' }, {
    timestamp: '2026-01-01T00:00:00.000Z',
    spanContext: {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      traceFlags: 1,
    },
  });

  assert.deepEqual(record, {
    timestamp: '2026-01-01T00:00:00.000Z',
    level: 'info',
    message: 'checkout complete',
    checkout_id: 'chk_1',
    trace_id: 'a'.repeat(32),
    span_id: 'b'.repeat(16),
    trace_flags: 1,
  });
});

test('OTLP attributes remain primitive or become JSON strings', () => {
  assert.deepEqual(normalizeOtelAttributes({ ok: true, count: 2, nested: { a: 1 }, absent: null }), {
    ok: true,
    count: 2,
    nested: '{"a":1}',
  });
});
