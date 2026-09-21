'use strict';

const { publicConfig, readRuntimeConfig } = require('./config');
const { logger } = require('./logging');
const { createServer } = require('./service');
const { flushTelemetry } = require('./shutdown');

const config = readRuntimeConfig();
const server = createServer({ config, logger });

server.listen(config.port, '0.0.0.0', () => {
  const address = server.address();
  logger.info('service started', {
    ...publicConfig(config),
    port: address.port,
    scenario_behavior: config.demoScenario === 'broken-context-propagation'
      ? 'intentional: checkout-to-inventory HTTP context is detached and should create a second trace'
      : 'checkout-to-inventory HTTP context should propagate in one trace',
  });
});

server.on('error', (error) => {
  logger.error('service failed', { error_message: error.message }, error);
  process.exitCode = 1;
  exitAfterShutdown('server-error', 1);
});

let shutdownPromise;
function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;

  shutdownPromise = (async () => {
    logger.info('service stopping', { signal });

    const forceClose = setTimeout(() => server.closeAllConnections(), 5_000);
    await new Promise((resolve) => server.close(resolve));
    clearTimeout(forceClose);

    return flushTelemetry({
      shutdown: globalThis.__OTEL_DEMO_SHUTDOWN__,
      logger,
      timeoutMs: 5_000,
    });
  })();

  return shutdownPromise;
}

function exitAfterShutdown(signal, exitCode) {
  void shutdown(signal)
    .catch((error) => {
      logger.error('graceful shutdown failed', { error_message: error.message }, error);
    })
    // Explicit exit is required after a bounded flush because an unreachable
    // exporter may still own retry/timer handles inside its unresolved shutdown.
    .finally(() => process.exit(exitCode));
}

process.once('SIGINT', () => exitAfterShutdown('SIGINT', 0));
process.once('SIGTERM', () => exitAfterShutdown('SIGTERM', 0));

module.exports = { server, shutdown };
