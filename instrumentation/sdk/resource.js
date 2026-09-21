'use strict';

const { defaultResource, resourceFromAttributes } = require('@opentelemetry/resources');

function createSdkResource() {
  return defaultResource().merge(resourceFromAttributes({
    'demo.instrumentation.mode': 'sdk',
  }));
}

module.exports = { createSdkResource };
