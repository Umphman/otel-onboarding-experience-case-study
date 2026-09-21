'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { context, ROOT_CONTEXT } = require('@opentelemetry/api');
const { publicConfig } = require('./config');
const { logger: defaultLogger } = require('./logging');
const { activeTraceId, instruments, withSpan } = require('./telemetry');

const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;

  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      throw new HttpError(413, `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function normalizeItems(items) {
  const source = items === undefined ? [{ sku: 'grafana-mug', quantity: 1 }] : items;
  if (!Array.isArray(source) || source.length === 0 || source.length > 20) {
    throw new HttpError(400, 'items must be a non-empty array with at most 20 entries.');
  }

  return source.map((item, index) => {
    const sku = typeof item?.sku === 'string' ? item.sku.trim() : '';
    const quantity = Number(item?.quantity);
    if (!sku || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new HttpError(400, `items[${index}] requires a non-empty sku and quantity from 1 to 100.`);
    }
    return { sku, quantity };
  });
}

function postJson({ port, path, body }) {
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-demo-hop': 'checkout-to-inventory',
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          let result;
          try {
            result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            reject(new Error(`Inventory returned non-JSON with status ${response.statusCode}.`));
            return;
          }

          if ((response.statusCode || 500) >= 400) {
            reject(new Error(result.error || `Inventory returned status ${response.statusCode}.`));
            return;
          }
          resolve(result);
        });
      },
    );

    request.setTimeout(2_000, () => request.destroy(new Error('Inventory request timed out.')));
    request.on('error', reject);
    request.end(payload);
  });
}

function createInventoryClient({ scenario, getPort }) {
  return async function reserveInventory(checkout) {
    const operation = () => postJson({ port: getPort(), path: '/inventory/reserve', body: checkout });

    if (scenario === 'broken-context-propagation') {
      // This is an intentional anti-pattern. Starting the HTTP request from the
      // root context makes its client span a new trace, so inventory remains
      // observable but is no longer connected to the checkout trace.
      return context.with(ROOT_CONTEXT, operation);
    }

    return operation();
  };
}

function createRequestHandler({
  config,
  inventoryClient,
  logger = defaultLogger,
  telemetryInstruments = instruments,
}) {
  async function handleInventory(request, response) {
    const body = await readJson(request);
    const items = normalizeItems(body.items);
    const units = items.reduce((total, item) => total + item.quantity, 0);

    const result = await withSpan(
      'inventory.reserve',
      {
        'checkout.id': body.checkoutId || 'unknown',
        'inventory.items.count': items.length,
        'inventory.units.count': units,
      },
      async (span) => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        const reservationId = `res_${randomUUID().slice(0, 8)}`;
        span.setAttribute('inventory.reservation.id', reservationId);
        telemetryInstruments.inventoryReservations.add(units, { 'demo.scenario': config.demoScenario });
        logger.info('inventory reserved', {
          checkout_id: body.checkoutId || 'unknown',
          reservation_id: reservationId,
          item_count: items.length,
          unit_count: units,
        });
        return { reservationId, inventoryTraceId: activeTraceId(), itemCount: items.length, unitCount: units };
      },
    );

    sendJson(response, 200, result);
  }

  async function handleCheckout(request, response) {
    const startedAt = process.hrtime.bigint();
    const metricAttributes = { 'demo.scenario': config.demoScenario };

    // Count every request reaching the checkout route, including malformed or
    // invalid payloads, so the demo's error-rate metric matches HTTP reality.
    telemetryInstruments.checkoutRequests.add(1, metricAttributes);

    try {
      const body = await readJson(request);
      const checkoutId = typeof body.checkoutId === 'string' && body.checkoutId.trim()
        ? body.checkoutId.trim()
        : `chk_${randomUUID().slice(0, 8)}`;
      const items = normalizeItems(body.items);
      const result = await withSpan(
        'checkout.process',
        {
          'checkout.id': checkoutId,
          'checkout.items.count': items.length,
          'demo.scenario': config.demoScenario,
        },
        async (span) => {
          const checkoutTraceId = activeTraceId();
          logger.info('checkout started', {
            checkout_id: checkoutId,
            item_count: items.length,
            scenario: config.demoScenario,
          });

          const inventory = await inventoryClient({ checkoutId, items });
          const propagationHealthy = checkoutTraceId && inventory.inventoryTraceId
            ? checkoutTraceId === inventory.inventoryTraceId
            : null;

          span.setAttribute('demo.context_propagation.healthy', propagationHealthy ?? false);
          logger.info('checkout completed', {
            checkout_id: checkoutId,
            reservation_id: inventory.reservationId,
            context_propagation_healthy: propagationHealthy,
          });

          return {
            checkoutId,
            status: 'confirmed',
            reservationId: inventory.reservationId,
            telemetry: {
              scenario: config.demoScenario,
              checkoutTraceId,
              inventoryTraceId: inventory.inventoryTraceId,
              contextPropagationHealthy: propagationHealthy,
            },
          };
        },
      );

      sendJson(response, 201, result);
    } catch (error) {
      telemetryInstruments.checkoutErrors.add(1, metricAttributes);
      throw error;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      telemetryInstruments.checkoutDuration.record(durationMs, metricAttributes);
    }
  }

  return async function requestHandler(request, response) {
    const url = new URL(request.url, 'http://localhost');

    try {
      if (request.method === 'GET' && url.pathname === '/') {
        sendJson(response, 200, {
          name: 'Synthetic checkout telemetry demo',
          endpoints: ['GET /health', 'POST /checkout', 'POST /inventory/reserve'],
          scenario: config.demoScenario,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'ok', telemetry: publicConfig(config) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/checkout') {
        await handleCheckout(request, response);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/inventory/reserve') {
        await handleInventory(request, response);
        return;
      }

      throw new HttpError(404, 'Route not found.');
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      logger.error('request failed', {
        http_method: request.method,
        http_path: url.pathname,
        http_status_code: statusCode,
        error_type: error.name,
        error_message: error.message,
      }, error);
      if (!response.headersSent) sendJson(response, statusCode, { error: error.message });
      else response.destroy(error);
    }
  };
}

function createServer({ config, logger = defaultLogger, inventoryClient, telemetryInstruments = instruments } = {}) {
  let server;
  const resolvedInventoryClient = inventoryClient || createInventoryClient({
    scenario: config.demoScenario,
    getPort: () => server.address().port,
  });
  const handler = createRequestHandler({
    config,
    inventoryClient: resolvedInventoryClient,
    logger,
    telemetryInstruments,
  });
  server = http.createServer((request, response) => void handler(request, response));
  return server;
}

module.exports = {
  HttpError,
  createInventoryClient,
  createRequestHandler,
  createServer,
  normalizeItems,
  readJson,
  sendJson,
};
