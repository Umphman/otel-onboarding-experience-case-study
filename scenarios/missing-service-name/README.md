# Scenario: missing service name

## Hypothesis

Data receipt is not enough. Telemetry without an intentional `service.name`
arrives under an SDK-generated fallback identity, which makes service discovery
and downstream activation unreliable.

## Run

```bash
docker compose -f docker-compose.yml -f scenarios/missing-service-name/compose.override.yml up --build
```

## Expected evidence

- Telemetry continues to arrive.
- With the pinned OpenTelemetry Node SDK, the service is attributed to
  `unknown_service:<process.argv0>` rather than `checkout-api`. Because
  `process.argv0` is runtime-specific, the clean Docker capture must record the
  exact observed value before submission instead of treating a workstation path
  as the portable expected value.
- A search or dashboard scoped to `checkout-api` appears empty.

`test/resource.test.js` asserts the SDK's exact `unknown_service:${process.argv0}`
rule across platforms. Revalidate it when upgrading the SDK; the product
invariant is that the intended identity is absent.

## Diagnosis and recovery

Set `OTEL_SERVICE_NAME=checkout-api`, restart the app, and verify the resource
attribute on a fresh trace, log, and metric.

## Product implication

Treat missing identity as an onboarding validation failure, even when the first
batch was accepted. The UI and agent response should name the observed fallback
and propose the smallest configuration change.
