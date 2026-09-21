'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const validator = path.resolve('scripts/validate-cloud-env.js');

function runPreflight(overrides = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-env-test-'));
  fs.mkdirSync(path.join(cwd, 'secrets'));
  fs.writeFileSync(path.join(cwd, 'secrets', 'token.txt'), 'temporary-test-token');

  const values = {
    GRAFANA_CLOUD_OTLP_ENDPOINT: 'https://otlp-gateway.example.test/otlp',
    GRAFANA_CLOUD_INSTANCE_ID: '123456',
    GRAFANA_CLOUD_API_KEY_FILE: './secrets/token.txt',
    LOADGEN_REQUESTS: '20',
    ...overrides,
  };
  const envPath = path.join(cwd, '.env.cloud');
  fs.writeFileSync(envPath, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'));

  const result = spawnSync(process.execPath, [validator, envPath], {
    cwd,
    encoding: 'utf8',
  });
  fs.rmSync(cwd, { recursive: true, force: true });
  return result;
}

test('Cloud preflight accepts exactly 20 requests without revealing endpoint or token', () => {
  const result = runPreflight();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cloud preflight passed/u);
  assert.match(result.stdout, /endpoint=valid/u);
  assert.doesNotMatch(result.stdout, /otlp-gateway\.example\.test/u);
  assert.doesNotMatch(result.stdout, /temporary-test-token/u);
});

test('Cloud preflight rejects plaintext transport and signal-specific endpoints', () => {
  const plaintext = runPreflight({ GRAFANA_CLOUD_OTLP_ENDPOINT: 'http://example.test/otlp' });
  assert.notEqual(plaintext.status, 0);
  assert.match(plaintext.stderr, /must use HTTPS/u);

  const signalPath = runPreflight({ GRAFANA_CLOUD_OTLP_ENDPOINT: 'https://example.test/otlp/v1/traces' });
  assert.notEqual(signalPath.status, 0);
  assert.match(signalPath.stderr, /base OTLP endpoint/u);
});

test('Cloud preflight rejects inline API keys', () => {
  const inline = runPreflight({ GRAFANA_CLOUD_API_KEY: 'must-not-be-here' });
  assert.notEqual(inline.status, 0);
  assert.match(inline.stderr, /do not put the API key/u);
});

test('Cloud preflight rejects any request count other than 20', () => {
  for (const requestCount of ['19', '21', '10000']) {
    const result = runPreflight({ LOADGEN_REQUESTS: requestCount });
    assert.notEqual(result.status, 0, `LOADGEN_REQUESTS=${requestCount} unexpectedly passed`);
    assert.match(result.stderr, /must be exactly 20/u);
  }
});
