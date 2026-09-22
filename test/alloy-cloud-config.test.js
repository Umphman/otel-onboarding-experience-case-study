'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cloudConfig = fs.readFileSync(
  path.join(__dirname, '..', 'alloy', 'config.cloud.alloy'),
  'utf8',
);

function extractBlock(source, header) {
  const headerStart = source.indexOf(header);
  assert.notEqual(headerStart, -1, `missing ${header} block`);

  const openingBrace = source.indexOf('{', headerStart);
  assert.notEqual(openingBrace, -1, `missing opening brace for ${header}`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;

    if (depth === 0) {
      return {
        body: source.slice(openingBrace + 1, index),
        end: index + 1,
        start: headerStart,
      };
    }
  }

  assert.fail(`missing closing brace for ${header}`);
}

test('Grafana Cloud basic auth keeps server placeholders separate from client credentials', () => {
  const auth = extractBlock(cloudConfig, 'otelcol.auth.basic "grafana_cloud"');
  const clientAuth = extractBlock(auth.body, 'client_auth {');
  const topLevelAuth = auth.body.slice(0, clientAuth.start) + auth.body.slice(clientAuth.end);

  assert.match(topLevelAuth, /^\s*username\s*=\s*"__unused_server_auth__"\s*$/mu);
  assert.match(topLevelAuth, /^\s*password\s*=\s*"__invalid_server_auth__"\s*$/mu);
  assert.doesNotMatch(
    topLevelAuth,
    /GRAFANA_CLOUD_INSTANCE_ID|password_file|grafana_cloud_api_key/u,
  );
  assert.match(
    clientAuth.body,
    /^\s*username\s*=\s*sys\.env\("GRAFANA_CLOUD_INSTANCE_ID"\)\s*$/mu,
  );
  assert.match(
    clientAuth.body,
    /^\s*password_file\s*=\s*"\/run\/secrets\/grafana_cloud_api_key"\s*$/mu,
  );
  assert.doesNotMatch(clientAuth.body, /__unused_server_auth__|__invalid_server_auth__/u);
});
