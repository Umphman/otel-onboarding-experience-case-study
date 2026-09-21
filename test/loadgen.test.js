'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCheckoutPayload, sendCheckout } = require('../app/loadgen');

test('load generator makes every tenth checkout a deterministic expected error', () => {
  const ninth = buildCheckoutPayload(9);
  const tenth = buildCheckoutPayload(10);
  const twentieth = buildCheckoutPayload(20);

  assert.equal(ninth.expectedFailure, false);
  assert.equal(ninth.body.items.length, 1);
  assert.deepEqual(tenth.body.items, []);
  assert.equal(tenth.expectedFailure, true);
  assert.deepEqual(twentieth.body.items, []);
  assert.equal(twentieth.expectedFailure, true);
});

test('an expected HTTP 400 does not count as a load-generator failure', async () => {
  const originalFetch = global.fetch;
  const originalWrite = process.stdout.write;
  global.fetch = async () => ({
    status: 400,
    ok: false,
    async json() {
      return { error: 'items must be a non-empty array with at most 20 entries.' };
    },
  });
  process.stdout.write = () => true;

  try {
    await assert.doesNotReject(sendCheckout(10));
    await assert.rejects(sendCheckout(9), /returned HTTP 400/);
  } finally {
    global.fetch = originalFetch;
    process.stdout.write = originalWrite;
  }
});
