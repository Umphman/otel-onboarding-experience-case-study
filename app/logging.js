'use strict';

const { context, isSpanContextValid, trace } = require('@opentelemetry/api');
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');

const otelLogger = logs.getLogger('synthetic-checkout', '1.0.0');

const SEVERITIES = Object.freeze({
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
});

function currentSpanContext() {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  return spanContext && isSpanContextValid(spanContext) ? spanContext : undefined;
}

function normalizeOtelAttribute(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))) {
    return value;
  }
  return JSON.stringify(value);
}

function normalizeOtelAttributes(attributes) {
  return Object.fromEntries(
    Object.entries(attributes)
      .map(([key, value]) => [key, normalizeOtelAttribute(value)])
      .filter(([, value]) => value !== undefined),
  );
}

function formatLogRecord(level, message, attributes = {}, options = {}) {
  const spanContext = options.spanContext;
  const record = {
    timestamp: options.timestamp || new Date().toISOString(),
    level,
    message,
    ...attributes,
  };

  if (spanContext && isSpanContextValid(spanContext)) {
    record.trace_id = spanContext.traceId;
    record.span_id = spanContext.spanId;
    record.trace_flags = spanContext.traceFlags;
  }

  return record;
}

function emit(level, message, attributes = {}, exception) {
  const spanContext = currentSpanContext();
  const timestamp = new Date();
  const record = formatLogRecord(level, message, attributes, {
    spanContext,
    timestamp: timestamp.toISOString(),
  });

  // stdout is intentionally structured for Alloy file/container collection.
  // This does not magically become an OTLP log: the explicit Logs API emit below
  // is the independent OTLP path and carries the current span context as well.
  process.stdout.write(`${JSON.stringify(record)}\n`);

  otelLogger.emit({
    timestamp,
    severityNumber: SEVERITIES[level] || SeverityNumber.UNSPECIFIED,
    severityText: level.toUpperCase(),
    body: message,
    attributes: normalizeOtelAttributes(attributes),
    exception,
  });
}

const logger = Object.freeze({
  debug(message, attributes) {
    emit('debug', message, attributes);
  },
  info(message, attributes) {
    emit('info', message, attributes);
  },
  warn(message, attributes) {
    emit('warn', message, attributes);
  },
  error(message, attributes, exception) {
    emit('error', message, attributes, exception);
  },
});

module.exports = {
  formatLogRecord,
  logger,
  normalizeOtelAttributes,
};
