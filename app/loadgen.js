'use strict';

const { randomUUID } = require('node:crypto');

// TARGET_URL is the Compose-facing contract. BASE_URL remains a convenient
// local alias for people running the generator directly.
const targetUrl = (
  process.env.TARGET_URL
  || process.env.BASE_URL
  || `http://localhost:${process.env.PORT || 8080}`
).replace(/\/$/, '');
const requestCount = Number.parseInt(process.env.LOADGEN_REQUESTS || '12', 10);
const intervalMs = Number.parseInt(process.env.LOADGEN_INTERVAL_MS || '250', 10);

if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > 10_000) {
  throw new Error('LOADGEN_REQUESTS must be an integer from 1 to 10000.');
}

if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 60_000) {
  throw new Error('LOADGEN_INTERVAL_MS must be an integer from 0 to 60000.');
}

function buildCheckoutPayload(sequence) {
  const checkoutId = `load_${randomUUID().slice(0, 8)}`;
  if (sequence % 10 === 0) {
    return {
      expectedFailure: true,
      body: { checkoutId, items: [] },
    };
  }

  return {
    expectedFailure: false,
    body: {
      checkoutId,
      items: [
        { sku: sequence % 2 === 0 ? 'grafana-mug' : 'otel-sticker', quantity: (sequence % 3) + 1 },
      ],
    },
  };
}

async function sendCheckout(sequence) {
  const checkout = buildCheckoutPayload(sequence);
  const response = await fetch(`${targetUrl}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(checkout.body),
  });
  const body = await response.json();
  process.stdout.write(`${JSON.stringify({
    sequence,
    httpStatus: response.status,
    expectedFailure: checkout.expectedFailure,
    ...body,
  })}\n`);

  if (checkout.expectedFailure) {
    if (response.status !== 400) {
      throw new Error(`Expected checkout ${sequence} to return HTTP 400; received ${response.status}.`);
    }
    return;
  }

  if (!response.ok) throw new Error(`Checkout ${sequence} returned HTTP ${response.status}.`);
}

async function main() {
  let failures = 0;
  for (let sequence = 1; sequence <= requestCount; sequence += 1) {
    try {
      await sendCheckout(sequence);
    } catch (error) {
      failures += 1;
      process.stderr.write(`${JSON.stringify({ sequence, error: error.message })}\n`);
    }
    if (sequence < requestCount && intervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}

module.exports = { buildCheckoutPayload, main, sendCheckout };
