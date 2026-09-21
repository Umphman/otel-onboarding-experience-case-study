# Scenario: missing service name

## Hypothesis

Data receipt is not enough. Telemetry without an intentional `service.name`
arrives under an SDK-generated fallback identity, which makes service discovery
and downstream activation unreliable.

## Run

```bash
docker compose -f docker-compose.yml -f scenarios/missing-service-name/compose.override.yml down -v --remove-orphans
docker compose -f docker-compose.yml -f scenarios/missing-service-name/compose.override.yml up -d --wait lgtm alloy app
```

Starting only `lgtm`, `alloy`, and `app` keeps `loadgen` out of the evidence
window so the failure probe remains attributable.

## Observed local evidence

- Telemetry continued to arrive.
- With the pinned OpenTelemetry Node SDK and container runtime, Tempo, Loki, and
  Prometheus attributed the failure probe to `unknown_service:node` rather than
  `checkout-api`.
- The intended `checkout-api` identity was absent for that failure probe.

The dated probe identifiers and backend results are in the [runtime verification
record](../../docs/evidence/runtime-verification.md).

`test/resource.test.js` asserts the SDK's exact `unknown_service:${process.argv0}`
rule across platforms. Revalidate it when upgrading the SDK; the product
invariant is that the intended identity is absent.

## Diagnosis and recovery

Restore the default identity configuration with a volume-clean two-file
shutdown, start the default services without `loadgen`, and run a fresh bounded
verifier probe:

```bash
docker compose -f docker-compose.yml -f scenarios/missing-service-name/compose.override.yml down -v --remove-orphans
docker compose -f docker-compose.yml up -d --wait lgtm alloy app
npm run verify:pipeline
```

The recorded recovery restored `service.name=checkout-api` across the required
backends and restored the expected trace/log correlation.

## Product implication

Treat missing identity as an onboarding validation failure, even when the first
batch was accepted. The UI and agent response should name the observed fallback
and propose the smallest configuration change.
