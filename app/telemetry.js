'use strict';

const { metrics, SpanStatusCode, trace } = require('@opentelemetry/api');

const tracer = trace.getTracer('synthetic-checkout', '1.0.0');
const meter = metrics.getMeter('synthetic-checkout', '1.0.0');

const instruments = Object.freeze({
  checkoutRequests: meter.createCounter('demo.checkout.requests', {
    description: 'Number of synthetic checkout attempts.',
    unit: '{checkout}',
  }),
  checkoutErrors: meter.createCounter('demo.checkout.errors', {
    description: 'Number of failed synthetic checkout attempts.',
    unit: '{error}',
  }),
  checkoutDuration: meter.createHistogram('demo.checkout.duration', {
    description: 'Synthetic checkout processing time.',
    unit: 'ms',
  }),
  inventoryReservations: meter.createCounter('demo.inventory.reservations', {
    description: 'Number of item units reserved by the synthetic inventory service.',
    unit: '{item}',
  }),
});

async function withSpan(name, attributes, operation) {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      throw error;
    } finally {
      span.end();
    }
  });
}

function activeTraceId() {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  return traceId && !/^0+$/.test(traceId) ? traceId : null;
}

module.exports = {
  activeTraceId,
  instruments,
  tracer,
  withSpan,
};
