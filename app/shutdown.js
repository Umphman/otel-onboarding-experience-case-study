'use strict';

async function flushTelemetry({ shutdown, logger, timeoutMs = 5_000 }) {
  if (typeof shutdown !== 'function') return { status: 'not-configured' };

  let timeoutHandle;
  const shutdownOutcome = Promise.resolve()
    .then(() => shutdown())
    .then(
      () => ({ status: 'flushed' }),
      (error) => ({ status: 'failed', error }),
    );
  const timeoutOutcome = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ status: 'timed-out' }), timeoutMs);
  });

  const outcome = await Promise.race([shutdownOutcome, timeoutOutcome]);
  clearTimeout(timeoutHandle);

  if (outcome.status === 'timed-out') {
    logger.warn('telemetry shutdown timed out; exiting without a complete flush', {
      timeout_ms: timeoutMs,
    });
  } else if (outcome.status === 'failed') {
    logger.warn('telemetry shutdown failed; exiting after best-effort flush', {
      error_message: outcome.error?.message || String(outcome.error),
    });
  }

  return outcome;
}

module.exports = { flushTelemetry };
