'use strict';

// This path intentionally delegates SDK construction, exporters, resource
// detection and module patching to OpenTelemetry's upstream Node.js automatic
// instrumentation register.
// The application code is identical to SDK mode.
const { announceBootstrap, configureTelemetryEnvironment } = require('../configure-env');
const config = configureTelemetryEnvironment('auto-instrumentation');

require('@opentelemetry/auto-instrumentations-node/register');
announceBootstrap(config);
