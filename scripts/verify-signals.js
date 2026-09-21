'use strict';

const CHILD_FLAG = '--verification-child';
const EXPECTED_PATHS = ['/v1/traces', '/v1/metrics', '/v1/logs'];
// Cold starts through a Windows bind mount can take longer while the local
// LGTM stack is consuming Docker resources. Keep the check bounded but allow
// enough time for either instrumentation preload to initialize.
const START_TIMEOUT_MS = readPositiveInteger('SIGNAL_VERIFY_START_TIMEOUT_MS', 90_000);
const REQUEST_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 12_000;
const CLEANUP_TIMEOUT_MS = 2_000;
const METRIC_EXPORT_WAIT_MS = 750;
const MAX_CAPTURED_OUTPUT = 32 * 1024;

function readPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${JSON.stringify(raw)}.`);
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function appendOutput(current, chunk) {
  const combined = `${current}${chunk}`;
  return combined.length <= MAX_CAPTURED_OUTPUT
    ? combined
    : combined.slice(combined.length - MAX_CAPTURED_OUTPUT);
}

function formatChildOutput(stdout, stderr) {
  const sections = [];
  if (stdout.trim()) sections.push(`stdout:\n${stdout.trim()}`);
  if (stderr.trim()) sections.push(`stderr:\n${stderr.trim()}`);
  return sections.length ? `\n${sections.join('\n')}` : '';
}

async function sendToParent(message) {
  if (!process.send || !process.connected) return;
  await new Promise((resolve, reject) => {
    process.send(message, (error) => (error ? reject(error) : resolve()));
  });
}

function loadAutomaticInstrumentation(registerPath) {
  // The upstream zero-code register owns its SDK instance and normally flushes
  // it on SIGTERM. Capturing that instance here gives this cross-platform test
  // an explicit shutdown path; Windows cannot deliver POSIX SIGTERM semantics.
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const originalStart = NodeSDK.prototype.start;
  let sdk;

  NodeSDK.prototype.start = function captureSdk(...args) {
    sdk = this;
    return originalStart.apply(this, args);
  };

  try {
    require(registerPath);
  } finally {
    NodeSDK.prototype.start = originalStart;
  }

  if (!sdk) throw new Error('Automatic instrumentation did not create a NodeSDK instance.');
  return () => sdk.shutdown();
}

async function runVerificationChild(mode) {
  const path = require('node:path');
  const repoRoot = path.resolve(__dirname, '..');
  let shutdownAutomaticSdk;

  if (mode === 'sdk') {
    require(path.join(repoRoot, 'instrumentation', 'sdk', 'register.js'));
  } else if (mode === 'auto') {
    shutdownAutomaticSdk = loadAutomaticInstrumentation(
      path.join(repoRoot, 'instrumentation', 'auto-instrumentation', 'register.js'),
    );
  } else {
    throw new Error(`Unknown instrumentation mode: ${JSON.stringify(mode)}`);
  }

  // Instrumentation must load before app/server.js imports node:http.
  const { server, shutdown } = require(path.join(repoRoot, 'app', 'server.js'));
  let stopping = false;

  async function stop() {
    if (stopping) return;
    stopping = true;

    try {
      await shutdown('signal-verification');
      if (shutdownAutomaticSdk) await shutdownAutomaticSdk();
      await sendToParent({ type: 'stopped' });
      process.exit(0);
    } catch (error) {
      await sendToParent({
        type: 'fatal',
        message: error?.message || String(error),
        stack: error?.stack,
      });
      process.exit(1);
    }
  }

  server.once('listening', () => {
    const address = server.address();
    void sendToParent({ type: 'ready', port: address.port });
  });

  process.on('message', (message) => {
    if (message?.type === 'shutdown') void stop();
  });
  process.once('disconnect', () => void stop());
}

function waitForChildMessage(child, predicate, timeoutMs, description, output) {
  return withTimeout(new Promise((resolve, reject) => {
    function cleanup() {
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
    }

    function fail(error) {
      cleanup();
      reject(error);
    }

    function onMessage(message) {
      if (message?.type === 'fatal') {
        fail(new Error(`${message.message}${message.stack ? `\n${message.stack}` : ''}`));
        return;
      }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    }

    function onError(error) {
      fail(error);
    }

    function onExit(code, signal) {
      fail(new Error(
        `Verification child exited before ${description} (code=${code}, signal=${signal}).`
        + formatChildOutput(output.stdout, output.stderr),
      ));
    }

    child.on('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
  }), timeoutMs, `Timed out waiting for ${description}.${formatChildOutput(output.stdout, output.stderr)}`);
}

function waitForChildExit(child, timeoutMs, output) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return withTimeout(new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  }), timeoutMs, `Timed out waiting for verification child exit.${formatChildOutput(output.stdout, output.stderr)}`);
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  try {
    if (child.connected) child.send({ type: 'shutdown' });
    await waitForChildExit(child, CLEANUP_TIMEOUT_MS, { stdout: '', stderr: '' });
    return;
  } catch {
    // Fall through to forced termination after the graceful cleanup deadline.
  }

  try {
    child.kill('SIGKILL');
  } catch {
    // The process may have exited between the deadline and the kill attempt.
  }

  try {
    await waitForChildExit(child, CLEANUP_TIMEOUT_MS, { stdout: '', stderr: '' });
  } catch {
    // Nothing else can be done portably after a forced child termination.
  }
}

async function startMockOtlpReceiver() {
  const http = require('node:http');
  const requests = [];
  const sockets = new Set();
  let activeCase = 'unassigned';

  const server = http.createServer((request, response) => {
    let bodyBytes = 0;
    request.on('data', (chunk) => {
      bodyBytes += chunk.length;
    });
    request.on('end', () => {
      requests.push({
        caseName: activeCase,
        method: request.method,
        path: request.url,
        contentType: request.headers['content-type'] || '',
        bodyBytes,
      });

      if (request.method === 'POST' && EXPECTED_PATHS.includes(request.url)) {
        response.writeHead(200, {
          'content-type': 'application/x-protobuf',
          'content-length': '0',
        });
        response.end();
        return;
      }

      response.writeHead(404, { 'content-length': '0' });
      response.end();
    });
  });

  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    port: server.address().port,
    requests,
    setActiveCase(name) {
      activeCase = name;
    },
    async close() {
      server.closeAllConnections?.();
      for (const socket of sockets) socket.destroy();
      await withTimeout(
        new Promise((resolve) => server.close(resolve)),
        CLEANUP_TIMEOUT_MS,
        'Timed out closing the mock OTLP receiver.',
      );
    },
  };
}

function assertTraceRelationship(assert, result, shouldMatch) {
  const checkoutTraceId = result.body?.telemetry?.checkoutTraceId;
  const inventoryTraceId = result.body?.telemetry?.inventoryTraceId;
  assert.match(checkoutTraceId || '', /^[0-9a-f]{32}$/, `${result.name} did not return a checkout trace ID.`);
  assert.match(inventoryTraceId || '', /^[0-9a-f]{32}$/, `${result.name} did not return an inventory trace ID.`);

  if (shouldMatch) {
    assert.equal(inventoryTraceId, checkoutTraceId, `${result.name} split a healthy checkout trace.`);
    assert.equal(result.body.telemetry.contextPropagationHealthy, true);
  } else {
    assert.notEqual(inventoryTraceId, checkoutTraceId, `${result.name} did not split the broken-context trace.`);
    assert.equal(result.body.telemetry.contextPropagationHealthy, false);
  }
}

function parseStructuredLogs(stdout) {
  const records = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    try {
      const record = JSON.parse(trimmed);
      if (record && typeof record === 'object' && typeof record.message === 'string') {
        records.push(record);
      }
    } catch {
      // Instrumentation can write non-JSON diagnostics to stdout. Only the
      // application's structured records are relevant to this assertion.
    }
  }

  return records;
}

function assertLogCorrelation(assert, result, shouldMatch) {
  const checkoutId = result.body?.checkoutId;
  const checkoutTraceId = result.body?.telemetry?.checkoutTraceId;
  const inventoryTraceId = result.body?.telemetry?.inventoryTraceId;
  const forCheckout = result.structuredLogs.filter((record) => record.checkout_id === checkoutId);
  const checkoutLogs = forCheckout.filter((record) => (
    record.message === 'checkout started' || record.message === 'checkout completed'
  ));
  const inventoryLogs = forCheckout.filter((record) => record.message === 'inventory reserved');

  assert.equal(
    checkoutLogs.length,
    2,
    `${result.name} did not emit both structured checkout logs for ${JSON.stringify(checkoutId)}.`,
  );
  assert.equal(
    inventoryLogs.length,
    1,
    `${result.name} did not emit the structured inventory log for ${JSON.stringify(checkoutId)}.`,
  );

  for (const record of checkoutLogs) {
    assert.equal(
      record.trace_id,
      checkoutTraceId,
      `${result.name} emitted ${JSON.stringify(record.message)} outside the checkout trace.`,
    );
    assert.match(
      record.span_id || '',
      /^[0-9a-f]{16}$/,
      `${result.name} emitted ${JSON.stringify(record.message)} without a valid span ID.`,
    );
  }

  const inventoryLog = inventoryLogs[0];
  assert.equal(
    inventoryLog.trace_id,
    inventoryTraceId,
    `${result.name} emitted the inventory log outside the inventory trace.`,
  );
  assert.match(
    inventoryLog.span_id || '',
    /^[0-9a-f]{16}$/,
    `${result.name} emitted the inventory log without a valid span ID.`,
  );

  if (shouldMatch) {
    assert.equal(
      checkoutLogs[0].trace_id,
      inventoryLog.trace_id,
      `${result.name} did not correlate checkout and inventory structured logs.`,
    );
  } else {
    assert.notEqual(
      checkoutLogs[0].trace_id,
      inventoryLog.trace_id,
      `${result.name} did not preserve the deliberate checkout/inventory log split.`,
    );
  }
}

function assertSignalExports(assert, result) {
  for (const expectedPath of EXPECTED_PATHS) {
    const matching = result.requests.filter((request) => request.path === expectedPath);
    assert.ok(matching.length > 0, `${result.name} did not export ${expectedPath}.`);
    for (const request of matching) {
      assert.equal(request.method, 'POST', `${result.name} used the wrong method for ${expectedPath}.`);
      assert.equal(
        request.contentType.split(';', 1)[0].trim().toLowerCase(),
        'application/x-protobuf',
        `${result.name} used the wrong content type for ${expectedPath}.`,
      );
      assert.ok(request.bodyBytes > 0, `${result.name} sent an empty protobuf body to ${expectedPath}.`);
    }
  }
}

async function runCase(testCase, receiver, children) {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  const repoRoot = path.resolve(__dirname, '..');
  const output = { stdout: '', stderr: '' };
  const requestStart = receiver.requests.length;

  receiver.setActiveCase(testCase.name);
  const child = spawn(process.execPath, [__filename, CHILD_FLAG, testCase.mode], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: '0',
      DEMO_SCENARIO: testCase.scenario,
      OTEL_SERVICE_NAME: 'checkout-api',
      OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=otel-onboarding,deployment.environment.name=verification,service.version=1.0.0',
      OTEL_NODE_RESOURCE_DETECTORS: 'env,host,os,serviceinstance',
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${receiver.port}`,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_TIMEOUT: '3000',
      OTEL_METRIC_EXPORT_INTERVAL: '250',
      OTEL_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  children.add(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output.stdout = appendOutput(output.stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    output.stderr = appendOutput(output.stderr, chunk);
  });

  try {
    const ready = await waitForChildMessage(
      child,
      (message) => message?.type === 'ready',
      START_TIMEOUT_MS,
      `${testCase.name} startup`,
      output,
    );

    const response = await fetch(`http://127.0.0.1:${ready.port}/checkout`, {
      method: 'POST',
      headers: {
        'connection': 'close',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        checkoutId: `verify-${testCase.mode}-${testCase.scenario}`,
        items: [{ sku: 'otel-verification', quantity: 1 }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await response.json();
    if (response.status !== 201) {
      throw new Error(`${testCase.name} checkout returned HTTP ${response.status}: ${JSON.stringify(body)}`);
    }

    // Give the short verification metric interval time to produce an export;
    // traces and logs are flushed explicitly during the bounded shutdown.
    await delay(METRIC_EXPORT_WAIT_MS);
    const stoppedPromise = waitForChildMessage(
      child,
      (message) => message?.type === 'stopped',
      SHUTDOWN_TIMEOUT_MS,
      `${testCase.name} telemetry shutdown`,
      output,
    );
    child.send({ type: 'shutdown' });
    await stoppedPromise;
    const exit = await waitForChildExit(child, CLEANUP_TIMEOUT_MS, output);
    if (exit.code !== 0) {
      throw new Error(
        `${testCase.name} verification child exited with code=${exit.code}, signal=${exit.signal}.`
        + formatChildOutput(output.stdout, output.stderr),
      );
    }

    return {
      name: testCase.name,
      body,
      requests: receiver.requests.slice(requestStart),
      structuredLogs: parseStructuredLogs(output.stdout),
    };
  } finally {
    await terminateChild(child);
    children.delete(child);
  }
}

async function runVerification() {
  const assert = require('node:assert/strict');
  const children = new Set();
  const receiver = await startMockOtlpReceiver();
  const cases = [
    { name: 'explicit SDK normal', mode: 'sdk', scenario: 'normal', shouldMatch: true },
    { name: 'Node.js automatic instrumentation normal', mode: 'auto', scenario: 'normal', shouldMatch: true },
    { name: 'explicit SDK broken context', mode: 'sdk', scenario: 'broken-context-propagation', shouldMatch: false },
  ];

  try {
    for (const testCase of cases) {
      const result = await runCase(testCase, receiver, children);
      assertTraceRelationship(assert, result, testCase.shouldMatch);
      assertLogCorrelation(assert, result, testCase.shouldMatch);
      assertSignalExports(assert, result);

      const counts = Object.fromEntries(EXPECTED_PATHS.map((path) => [
        path.replace('/v1/', ''),
        result.requests.filter((request) => request.path === path).length,
      ]));
      const structuredLogState = testCase.shouldMatch ? 'correlated' : 'split-as-expected';
      process.stdout.write(
        `verified ${testCase.name}: traces=${counts.traces}, metrics=${counts.metrics}, logs=${counts.logs}, structured-logs=${structuredLogState}\n`,
      );
    }

    process.stdout.write('signal verification passed\n');
  } finally {
    await Promise.all([...children].map((child) => terminateChild(child)));
    await receiver.close();
  }
}

if (process.argv[2] === CHILD_FLAG) {
  runVerificationChild(process.argv[3]).catch(async (error) => {
    try {
      await sendToParent({ type: 'fatal', message: error?.message || String(error), stack: error?.stack });
    } finally {
      process.exit(1);
    }
  });
} else {
  runVerification().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
