'use strict';

const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_URL = process.env.PIPELINE_APP_URL || 'http://127.0.0.1:8080';
const ALLOY_URL = process.env.PIPELINE_ALLOY_URL || 'http://127.0.0.1:12345';
const VERIFY_TIMEOUT_MS = readPositiveInteger('PIPELINE_VERIFY_TIMEOUT_MS', 90_000);
const HTTP_TIMEOUT_MS = readPositiveInteger('PIPELINE_HTTP_TIMEOUT_MS', 5_000);
const POLL_INTERVAL_MS = readPositiveInteger('PIPELINE_POLL_INTERVAL_MS', 1_000);
const MAX_COMMAND_OUTPUT = 4 * 1024 * 1024;
const COMMAND_TERMINATION_GRACE_MS = 1_000;

const EXPECTED_IDENTITY = Object.freeze({
  'service.name': 'checkout-api',
  'service.namespace': 'otel-onboarding',
  'service.version': '1.0.0',
  'deployment.environment.name': 'local',
});

const SIGNALS = Object.freeze({
  traces: Object.freeze({
    accepted: 'otelcol_receiver_accepted_spans',
    refused: 'otelcol_receiver_refused_spans',
    sent: 'otelcol_exporter_sent_spans',
    sendFailed: 'otelcol_exporter_send_failed_spans',
    enqueueFailed: 'otelcol_exporter_enqueue_failed_spans',
    debugMarker: 'msg=Traces',
  }),
  metrics: Object.freeze({
    accepted: 'otelcol_receiver_accepted_metric_points',
    refused: 'otelcol_receiver_refused_metric_points',
    sent: 'otelcol_exporter_sent_metric_points',
    sendFailed: 'otelcol_exporter_send_failed_metric_points',
    enqueueFailed: 'otelcol_exporter_enqueue_failed_metric_points',
    debugMarker: 'msg=Metrics',
  }),
  logs: Object.freeze({
    accepted: 'otelcol_receiver_accepted_log_records',
    refused: 'otelcol_receiver_refused_log_records',
    sent: 'otelcol_exporter_sent_log_records',
    sendFailed: 'otelcol_exporter_send_failed_log_records',
    enqueueFailed: 'otelcol_exporter_enqueue_failed_log_records',
    debugMarker: 'msg=Logs',
  }),
});

const COMPONENTS = Object.freeze({
  receiver: 'otelcol.receiver.otlp.app',
  memoryLimiter: 'otelcol.processor.memory_limiter.telemetry',
  batch: 'otelcol.processor.batch.telemetry',
  exporter: 'otelcol.exporter.otlphttp.lgtm',
  debug: 'otelcol.exporter.debug.receipt',
});

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

function withTimeout(promise, milliseconds, description) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out ${description}.`)), milliseconds);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function waitForChildExit(child, milliseconds) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(milliseconds),
  ]);
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  try {
    child.kill('SIGTERM');
  } catch {
    // The command may have exited between the state check and termination.
  }
  await waitForChildExit(child, COMMAND_TERMINATION_GRACE_MS);

  if (child.exitCode === null && child.signalCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // The command may have exited during the grace period.
    }
    await waitForChildExit(child, COMMAND_TERMINATION_GRACE_MS);
  }
}

function appendBounded(current, chunk) {
  const combined = `${current}${chunk}`;
  return combined.length <= MAX_COMMAND_OUTPUT
    ? combined
    : combined.slice(combined.length - MAX_COMMAND_OUTPUT);
}

function commandError(command, args, code, signal, stdout, stderr) {
  const rendered = [command, ...args].map((item) => (
    /[\s"]/u.test(item) ? JSON.stringify(item) : item
  )).join(' ');
  const details = [
    `Command failed: ${rendered}`,
    `exit code=${code}, signal=${signal || 'none'}`,
  ];
  if (stdout.trim()) details.push(`stdout:\n${stdout.trim()}`);
  if (stderr.trim()) details.push(`stderr:\n${stderr.trim()}`);
  return new Error(details.join('\n'));
}

async function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 20_000;
  const allowedExitCodes = new Set(options.allowedExitCodes || [0]);
  let child;

  const completion = new Promise((resolve, reject) => {
    child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (!allowedExitCodes.has(code)) {
        reject(commandError(command, args, code, signal, stdout, stderr));
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });

  try {
    return await withTimeout(
      completion,
      timeoutMs,
      `waiting for ${path.basename(command)} ${args.slice(0, 2).join(' ')}`,
    );
  } catch (error) {
    await terminateChild(child);
    throw error;
  }
}

function dockerCandidates() {
  const candidates = [];
  if (process.env.DOCKER_BIN) candidates.push(process.env.DOCKER_BIN);
  candidates.push('docker');

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.ProgramFiles;
    if (localAppData) {
      candidates.push(path.join(
        localAppData,
        'Programs',
        'DockerDesktop',
        'resources',
        'bin',
        'docker.exe',
      ));
    }
    if (programFiles) {
      candidates.push(path.join(programFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'));
    }
  }

  return [...new Set(candidates)];
}

async function resolveDocker() {
  const failures = [];
  for (const command of dockerCandidates()) {
    try {
      const dockerDirectory = path.dirname(command);
      const env = command === 'docker' || dockerDirectory === '.'
        ? process.env
        : { ...process.env, PATH: `${dockerDirectory}${path.delimiter}${process.env.PATH || ''}` };
      const result = await runCommand(command, ['version', '--format', '{{.Client.Version}}'], {
        timeoutMs: 10_000,
        env,
      });
      return { command, env, clientVersion: result.stdout.trim() };
    } catch (error) {
      failures.push(`${command}: ${error.message.split('\n', 1)[0]}`);
    }
  }

  throw new Error(`Docker CLI is unavailable. Tried:\n- ${failures.join('\n- ')}`);
}

function createDockerRunner(docker) {
  return (args, options = {}) => runCommand(docker.command, args, {
    ...options,
    env: docker.env,
  });
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${url} returned invalid JSON: ${error.message}\n${text.slice(0, 500)}`);
  }
}

async function pollFor(description, operation, deadline) {
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

async function lgtmCurlJson(runDocker, url, parameters = [], headers = []) {
  const args = [
    'compose', 'exec', '-T', 'lgtm',
    'curl', '-fsS', '--max-time', String(Math.ceil(HTTP_TIMEOUT_MS / 1000)),
  ];
  for (const header of headers) args.push('-H', header);
  if (parameters.length) args.push('-G');
  args.push(url);
  for (const [name, value] of parameters) {
    args.push('--data-urlencode', `${name}=${value}`);
  }
  const result = await runDocker(args, { timeoutMs: HTTP_TIMEOUT_MS + 10_000 });
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${url} returned invalid JSON: ${error.message}\n${result.stdout.slice(0, 500)}`);
  }
}

async function lgtmReady(runDocker, url) {
  await runDocker([
    'compose', 'exec', '-T', 'lgtm',
    'curl', '-fsS', '--max-time', String(Math.ceil(HTTP_TIMEOUT_MS / 1000)), url,
  ], { timeoutMs: HTTP_TIMEOUT_MS + 10_000 });
  return true;
}

function unescapePrometheusLabel(value) {
  return value.replace(/\\n/gu, '\n').replace(/\\"/gu, '"').replace(/\\\\/gu, '\\');
}

function parseLabels(raw) {
  const labels = {};
  const expression = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/gu;
  let match;
  while ((match = expression.exec(raw)) !== null) {
    labels[match[1]] = unescapePrometheusLabel(match[2]);
  }
  return labels;
}

function parsePrometheus(text) {
  const series = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([^\s{]+)(?:\{(.*)\})?\s+([^\s]+)(?:\s+\d+)?$/u.exec(trimmed);
    if (!match) continue;
    const value = Number(match[3]);
    if (Number.isNaN(value)) continue;
    series.push({ name: match[1], labels: parseLabels(match[2] || ''), value });
  }
  return series;
}

function metricNameMatches(name, base) {
  return name === base || name === `${base}_total`;
}

function componentMetric(snapshot, base, componentId) {
  const matches = snapshot.filter((item) => (
    metricNameMatches(item.name, base) && item.labels.component_id === componentId
  ));
  return {
    names: [...new Set(matches.map((item) => item.name))],
    series: matches.length,
    value: matches.reduce((total, item) => total + item.value, 0),
  };
}

function counterDelta(before, after, base, componentId, requiredAfter) {
  const start = componentMetric(before, base, componentId);
  const finish = componentMetric(after, base, componentId);
  if (requiredAfter && finish.series === 0) {
    const unscoped = after.filter((item) => metricNameMatches(item.name, base));
    const found = unscoped.slice(0, 5).map((item) => ({ name: item.name, labels: item.labels }));
    throw new Error(
      `Alloy did not expose ${base} for component_id=${componentId}.`
      + (found.length ? ` Candidate series: ${JSON.stringify(found)}` : ''),
    );
  }
  if (finish.series === 0) {
    return {
      available: false,
      metricNames: start.names,
      before: null,
      after: null,
      delta: null,
    };
  }
  if (finish.value < start.value) {
    throw new Error(`${base} decreased from ${start.value} to ${finish.value}; Alloy may have restarted.`);
  }
  return {
    available: true,
    metricNames: finish.names.length ? finish.names : start.names,
    before: start.value,
    after: finish.value,
    delta: finish.value - start.value,
  };
}

function buildAlloyEvidence(before, after) {
  const evidence = {};
  for (const [signal, names] of Object.entries(SIGNALS)) {
    const accepted = counterDelta(before, after, names.accepted, COMPONENTS.receiver, true);
    const refused = counterDelta(before, after, names.refused, COMPONENTS.receiver, false);
    const sent = counterDelta(before, after, names.sent, COMPONENTS.exporter, true);
    const sendFailed = counterDelta(before, after, names.sendFailed, COMPONENTS.exporter, false);
    const enqueueFailed = counterDelta(before, after, names.enqueueFailed, COMPONENTS.exporter, false);

    evidence[signal] = { accepted, refused, sent, sendFailed, enqueueFailed };
  }
  return evidence;
}

function alloyEvidenceComplete(evidence) {
  return Object.values(evidence).every((signal) => (
    signal.accepted.delta > 0
    && signal.sent.delta > 0
    && (!signal.refused.available || signal.refused.delta === 0)
    && (!signal.sendFailed.available || signal.sendFailed.delta === 0)
    && (!signal.enqueueFailed.available || signal.enqueueFailed.delta === 0)
  ));
}

function processorMetricSeries(snapshot, componentId) {
  const bases = new Set([
    'otelcol_processor_incoming_items',
    'otelcol_processor_incoming_items_total',
    'otelcol_processor_outgoing_items',
    'otelcol_processor_outgoing_items_total',
  ]);
  return snapshot.filter((item) => bases.has(item.name) && item.labels.component_id === componentId);
}

function processorEvidence(before, after, logs) {
  const counters = {};
  for (const [name, componentId] of [
    ['memoryLimiter', COMPONENTS.memoryLimiter],
    ['batch', COMPONENTS.batch],
  ]) {
    const start = processorMetricSeries(before, componentId);
    const finish = processorMetricSeries(after, componentId);
    counters[name] = {
      componentId,
      before: start.map((item) => ({ metric: item.name, labels: item.labels, value: item.value })),
      after: finish.map((item) => ({ metric: item.name, labels: item.labels, value: item.value })),
    };
  }

  const debugSummaries = Object.fromEntries(Object.entries(SIGNALS).map(([signal, names]) => [
    signal,
    logs.split(/\r?\n/u).filter((line) => (
      line.includes(COMPONENTS.debug) && line.includes(names.debugMarker)
    )).length,
  ]));

  return { counters, debugSummaries };
}

function processorEvidenceComplete(evidence) {
  return Object.values(evidence.debugSummaries).every((count) => count > 0);
}

function decodeAnyValue(value) {
  if (!value || typeof value !== 'object') return value;
  for (const key of [
    'stringValue', 'intValue', 'doubleValue', 'boolValue', 'bytesValue',
    'string_value', 'int_value', 'double_value', 'bool_value', 'bytes_value',
  ]) {
    if (Object.hasOwn(value, key)) return value[key];
  }
  return value;
}

function attributesToObject(attributes) {
  if (!Array.isArray(attributes)) return {};
  return Object.fromEntries(attributes.map((attribute) => [
    attribute.key,
    decodeAnyValue(attribute.value),
  ]));
}

function analyzeTempoTrace(tracePayload, probeId) {
  const requiredSpans = ['checkout.process', 'inventory.reserve'];
  const batches = Array.isArray(tracePayload?.batches)
    ? tracePayload.batches
    : (Array.isArray(tracePayload?.resourceSpans) ? tracePayload.resourceSpans : []);
  const groups = batches.map((batch) => {
    const resource = attributesToObject(batch.resource?.attributes);
    const scopes = batch.scopeSpans || batch.scope_spans || [];
    const spans = scopes.flatMap((scope) => (Array.isArray(scope.spans) ? scope.spans : []));
    const spanDetails = spans.map((span) => ({
      name: span.name,
      attributes: attributesToObject(span.attributes),
    }));
    const identityMatches = Object.entries(EXPECTED_IDENTITY).every(([key, expected]) => (
      resource[key] === expected
    ));
    const requiredSpansPresent = requiredSpans.every((name) => spanDetails.some((span) => (
      span.name === name && span.attributes['checkout.id'] === probeId
    )));
    return {
      resource,
      spans,
      spanDetails,
      identityMatches,
      hasProbe: spanDetails.some((span) => span.attributes['checkout.id'] === probeId),
      requiredSpansPresent,
    };
  });
  const attributed = groups.find((group) => group.identityMatches && group.requiredSpansPresent);
  const identityGroup = attributed || groups.find((group) => group.identityMatches);
  const allSpans = groups.flatMap((group) => group.spans);

  return {
    spanCount: allSpans.length,
    spanNames: [...new Set(allSpans.map((span) => span.name))].sort(),
    identity: identityGroup?.resource || {},
    identityMatches: Boolean(attributed),
    hasProbe: Boolean(attributed?.hasProbe),
    requiredSpansPresent: Boolean(attributed?.requiredSpansPresent),
  };
}

function vectorResults(payload) {
  if (payload?.status !== 'success' || payload?.data?.resultType !== 'vector') return [];
  return Array.isArray(payload.data.result) ? payload.data.result : [];
}

function resultValue(result) {
  return Number(result?.value?.[1]);
}

function selectMetricFamily(results, matcher) {
  const selected = results.filter((result) => matcher(result.metric?.__name__ || ''));
  const byName = new Map();
  for (const result of selected) {
    const name = result.metric.__name__;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(result);
  }
  return byName;
}

function identityLabelsMatch(labels) {
  return labels.service_name === EXPECTED_IDENTITY['service.name']
    && labels.service_namespace === EXPECTED_IDENTITY['service.namespace']
    && labels.service_version === EXPECTED_IDENTITY['service.version']
    && labels.deployment_environment_name === EXPECTED_IDENTITY['deployment.environment.name'];
}

function analyzePrometheusDelta(beforePayload, afterPayload, familyMatcher, expectedDelta) {
  const beforeFamilies = selectMetricFamily(vectorResults(beforePayload), familyMatcher);
  const afterFamilies = selectMetricFamily(vectorResults(afterPayload), familyMatcher);
  const candidates = [];

  for (const [metricName, results] of afterFamilies) {
    const identitySeries = results.filter((result) => identityLabelsMatch(result.metric || {}));
    if (!identitySeries.length) continue;
    const after = identitySeries.reduce((total, result) => total + resultValue(result), 0);
    const before = (beforeFamilies.get(metricName) || [])
      .filter((result) => identityLabelsMatch(result.metric || {}))
      .reduce((total, result) => total + resultValue(result), 0);
    candidates.push({
      metricName,
      labels: identitySeries.map((result) => result.metric),
      before,
      after,
      delta: after - before,
    });
  }

  const match = candidates.find((candidate) => Math.abs(candidate.delta - expectedDelta) < 1e-9);
  return { match, candidates };
}

function analyzeLoki(payload) {
  if (payload?.status !== 'success' || payload?.data?.resultType !== 'streams') {
    return { matched: false, lines: [], streams: [] };
  }
  const streams = Array.isArray(payload.data.result) ? payload.data.result : [];
  const lines = streams.flatMap((stream) => (
    Array.isArray(stream.values) ? stream.values.map((value) => value[1]) : []
  ));
  const expected = ['checkout started', 'inventory reserved', 'checkout completed'];
  return {
    matched: expected.every((line) => lines.includes(line)),
    lines,
    streams: streams.map((stream) => stream.stream),
  };
}

function logqlString(value) {
  return `\`${String(value).replace(/`/gu, '\\`')}\``;
}

async function prometheusQuery(runDocker, query) {
  return lgtmCurlJson(
    runDocker,
    'http://127.0.0.1:9090/api/v1/query',
    [['query', query]],
  );
}

async function tempoTrace(runDocker, traceId) {
  return lgtmCurlJson(
    runDocker,
    `http://127.0.0.1:3200/api/traces/${traceId}`,
    [],
    ['Accept: application/json'],
  );
}

async function lokiLogs(runDocker, query, startNanoseconds, endNanoseconds) {
  return lgtmCurlJson(
    runDocker,
    'http://127.0.0.1:3100/loki/api/v1/query_range',
    [
      ['query', query],
      ['start', startNanoseconds],
      ['end', endNanoseconds],
      ['direction', 'forward'],
      ['limit', '100'],
    ],
  );
}

async function requireServices(runDocker) {
  const result = await runDocker(
    ['compose', 'ps', '--status', 'running', '--services'],
    { timeoutMs: 20_000 },
  );
  const services = new Set(result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean));
  const missing = ['app', 'alloy', 'lgtm'].filter((service) => !services.has(service));
  if (missing.length) {
    throw new Error(`Required Compose services are not running: ${missing.join(', ')}.`);
  }
  if (services.has('loadgen')) {
    throw new Error(
      'The loadgen service is running. Stop it before verification so the exact metric delta is attributable to one probe.',
    );
  }
  return [...services].sort();
}

async function readAlloyMetrics() {
  return parsePrometheus(await fetchText(`${ALLOY_URL}/metrics`));
}

async function readAlloyLogs(runDocker, since) {
  const result = await runDocker(
    ['compose', 'logs', '--no-color', '--since', since, 'alloy'],
    { timeoutMs: 20_000 },
  );
  return `${result.stdout}\n${result.stderr}`;
}

function formatOptionalDelta(counter) {
  return counter.available ? `+${counter.delta}` : 'unavailable';
}

function printSummary(report) {
  process.stdout.write(`probe: ${report.probe.id}\n`);
  process.stdout.write(`trace: ${report.probe.traceId}\n`);
  for (const signal of Object.keys(SIGNALS)) {
    const evidence = report.alloy.signals[signal];
    process.stdout.write(
      `Alloy ${signal}: accepted +${evidence.accepted.delta}, sent +${evidence.sent.delta}, `
      + `refused ${formatOptionalDelta(evidence.refused)}, `
      + `send-failed ${formatOptionalDelta(evidence.sendFailed)}, `
      + `enqueue-failed ${formatOptionalDelta(evidence.enqueueFailed)}\n`,
    );
  }
  process.stdout.write(
    `post-processor debug activity since probe start: traces=${report.alloy.processors.debugSummaries.traces}, `
    + `metrics=${report.alloy.processors.debugSummaries.metrics}, `
    + `logs=${report.alloy.processors.debugSummaries.logs}\n`,
  );
  process.stdout.write(
    `Tempo: spans=${report.backends.tempo.spanCount}, identity=${report.backends.tempo.identityMatches}, `
    + `probe=${report.backends.tempo.hasProbe}\n`,
  );
  process.stdout.write(
    `Loki: records=${report.backends.loki.lines.length}, correlated=${report.backends.loki.matched}\n`,
  );
  process.stdout.write(
    `Prometheus: ${report.backends.prometheus.requests.metricName} +${report.backends.prometheus.requests.delta}; `
    + `${report.backends.prometheus.duration.metricName} +${report.backends.prometheus.duration.delta}\n`,
  );
  process.stdout.write('pipeline verification passed\n');
}

async function runVerification() {
  const docker = await resolveDocker();
  const runDocker = createDockerRunner(docker);
  const services = await requireServices(runDocker);

  await pollFor('application health', async () => {
    const health = await fetchJson(`${APP_URL}/health`);
    return health.status === 'ok' ? health : false;
  }, Date.now() + VERIFY_TIMEOUT_MS);
  await pollFor('Alloy readiness', async () => (
    (await fetchText(`${ALLOY_URL}/-/ready`)).includes('ready')
  ), Date.now() + VERIFY_TIMEOUT_MS);
  await pollFor('LGTM backends', async () => {
    await Promise.all([
      lgtmReady(runDocker, 'http://127.0.0.1:3100/ready'),
      lgtmReady(runDocker, 'http://127.0.0.1:3200/ready'),
      lgtmReady(runDocker, 'http://127.0.0.1:9090/-/ready'),
    ]);
    return true;
  }, Date.now() + VERIFY_TIMEOUT_MS);

  const requestQuery = '{__name__=~"demo_checkout_requests.*"}';
  const durationQuery = '{__name__=~"demo_checkout_duration.*_count"}';
  const [alloyBefore, requestsBefore, durationBefore] = await Promise.all([
    readAlloyMetrics(),
    prometheusQuery(runDocker, requestQuery),
    prometheusQuery(runDocker, durationQuery),
  ]);

  const probeStartedAt = new Date();
  const probeId = `pipeline-${probeStartedAt.toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`;
  const checkout = await fetchJson(`${APP_URL}/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      checkoutId: probeId,
      items: [{ sku: 'pipeline-verification', quantity: 1 }],
    }),
  });
  const traceId = checkout?.telemetry?.checkoutTraceId;
  const inventoryTraceId = checkout?.telemetry?.inventoryTraceId;
  if (!/^[0-9a-f]{32}$/u.test(traceId || '')) {
    throw new Error(`Checkout did not return a valid trace ID: ${JSON.stringify(traceId)}.`);
  }
  if (inventoryTraceId !== traceId || checkout.telemetry.contextPropagationHealthy !== true) {
    throw new Error(
      `Checkout context was split: checkout=${traceId}, inventory=${inventoryTraceId}.`,
    );
  }

  const alloyResult = await pollFor('per-signal Alloy receipt and export', async () => {
    const after = await readAlloyMetrics();
    const logs = await readAlloyLogs(runDocker, probeStartedAt.toISOString());
    const signals = buildAlloyEvidence(alloyBefore, after);
    const processors = processorEvidence(alloyBefore, after, logs);
    return alloyEvidenceComplete(signals) && processorEvidenceComplete(processors)
      ? { after, signals, processors }
      : false;
  }, Date.now() + VERIFY_TIMEOUT_MS);

  const tempo = await pollFor('the exact trace in Tempo', async () => {
    const payload = await tempoTrace(runDocker, traceId);
    const analysis = analyzeTempoTrace(payload, probeId);
    return analysis.requiredSpansPresent && analysis.hasProbe && analysis.identityMatches
      ? analysis
      : false;
  }, Date.now() + VERIFY_TIMEOUT_MS);

  const lokiQuery = [
    '{service_name="checkout-api",service_namespace="otel-onboarding",deployment_environment_name="local"}',
    `| service_version = ${logqlString(EXPECTED_IDENTITY['service.version'])}`,
    `| checkout_id = ${logqlString(probeId)}`,
    `| trace_id = ${logqlString(traceId)}`,
  ].join(' ');
  const startNanoseconds = (BigInt(probeStartedAt.getTime()) - 5_000n) * 1_000_000n;
  const loki = await pollFor('the correlated probe logs in Loki', async () => {
    const endNanoseconds = (BigInt(Date.now()) + 5_000n) * 1_000_000n;
    const payload = await lokiLogs(
      runDocker,
      lokiQuery,
      startNanoseconds.toString(),
      endNanoseconds.toString(),
    );
    const analysis = analyzeLoki(payload);
    return analysis.matched ? analysis : false;
  }, Date.now() + VERIFY_TIMEOUT_MS);

  const prometheus = await pollFor('the exact controlled metric deltas in Prometheus', async () => {
    const [requestsAfter, durationAfter] = await Promise.all([
      prometheusQuery(runDocker, requestQuery),
      prometheusQuery(runDocker, durationQuery),
    ]);
    const requests = analyzePrometheusDelta(
      requestsBefore,
      requestsAfter,
      (name) => name.includes('demo_checkout_requests') && !name.endsWith('_created'),
      1,
    );
    const duration = analyzePrometheusDelta(
      durationBefore,
      durationAfter,
      (name) => name.includes('demo_checkout_duration') && name.endsWith('_count'),
      1,
    );
    return requests.match && duration.match
      ? { requests: requests.match, duration: duration.match }
      : false;
  }, Date.now() + VERIFY_TIMEOUT_MS);

  const completedAt = new Date();
  const report = {
    schemaVersion: 1,
    startedAt: probeStartedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - probeStartedAt.getTime(),
    environment: {
      dockerClientVersion: docker.clientVersion,
      composeServices: services,
      appUrl: APP_URL,
      alloyUrl: ALLOY_URL,
    },
    probe: {
      id: probeId,
      traceId,
      inventoryTraceId,
      contextPropagationHealthy: true,
    },
    alloy: {
      signals: alloyResult.signals,
      processors: alloyResult.processors,
    },
    backends: { tempo, loki, prometheus },
    states: {
      connected: true,
      received: { traces: true, metrics: true, logs: true },
      attributed: true,
      correlated: true,
    },
  };

  const outputPath = process.env.PIPELINE_VERIFY_JSON;
  if (outputPath) {
    const resolved = path.resolve(REPO_ROOT, outputPath);
    fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`evidence: ${resolved}\n`);
  }
  printSummary(report);
}

runVerification().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
