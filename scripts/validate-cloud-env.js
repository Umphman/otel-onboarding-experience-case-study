'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(`cloud preflight failed: ${message}`);
  process.exit(1);
}

function parseEnv(text) {
  const values = new Map();

  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) fail(`invalid assignment on line ${index + 1}`);

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }

  return values;
}

const envPath = path.resolve(process.argv[2] || '.env.cloud');
if (!fs.existsSync(envPath)) fail(`missing ${path.basename(envPath)}`);

const values = parseEnv(fs.readFileSync(envPath, 'utf8'));
if (values.has('GRAFANA_CLOUD_API_KEY')) {
  fail('do not put the API key in .env.cloud; use GRAFANA_CLOUD_API_KEY_FILE');
}

const endpointValue = values.get('GRAFANA_CLOUD_OTLP_ENDPOINT');
const instanceId = values.get('GRAFANA_CLOUD_INSTANCE_ID');
const tokenFileValue = values.get('GRAFANA_CLOUD_API_KEY_FILE');
if (!endpointValue) fail('GRAFANA_CLOUD_OTLP_ENDPOINT is required');
if (!instanceId) fail('GRAFANA_CLOUD_INSTANCE_ID is required');
if (!tokenFileValue) fail('GRAFANA_CLOUD_API_KEY_FILE is required');

let endpoint;
try {
  endpoint = new URL(endpointValue);
} catch {
  fail('GRAFANA_CLOUD_OTLP_ENDPOINT must be a valid URL');
}

if (endpoint.protocol !== 'https:') fail('the Cloud OTLP endpoint must use HTTPS');
if (endpoint.username || endpoint.password) fail('the endpoint must not embed credentials');
if (endpoint.search || endpoint.hash) fail('the endpoint must not contain a query or fragment');
if (endpoint.pathname.replace(/\/+$/u, '') === '' ||
    !endpoint.pathname.replace(/\/+$/u, '').endsWith('/otlp')) {
  fail('use the base OTLP endpoint ending in /otlp, not a signal-specific /v1 path');
}

const secretsRoot = path.resolve('secrets');
const tokenPath = path.resolve(tokenFileValue);
if (tokenPath !== secretsRoot && !tokenPath.startsWith(`${secretsRoot}${path.sep}`)) {
  fail('the token file must be inside the ignored secrets directory');
}
if (!fs.existsSync(tokenPath)) fail(`token file not found: ${path.relative(process.cwd(), tokenPath)}`);

const token = fs.readFileSync(tokenPath, 'utf8');
if (!token) fail('the token file is empty');
if (token !== token.trim() || /\s/u.test(token)) {
  fail('the token file must contain only the token, with no whitespace or trailing newline');
}

const requestText = values.get('LOADGEN_REQUESTS') || '20';
const requestCount = Number(requestText);
if (!Number.isInteger(requestCount) || requestCount !== 20) {
  fail('LOADGEN_REQUESTS must be exactly 20 for the controlled Cloud proof');
}

console.log('cloud preflight passed');
console.log('endpoint=valid');
console.log('instance_id=present');
console.log(`token_file=${path.relative(process.cwd(), tokenPath)}`);
console.log(`loadgen_requests=${requestCount}`);
