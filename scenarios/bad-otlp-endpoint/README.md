# Scenario: bad OTLP endpoint

## Hypothesis

A syntactically valid but unreachable endpoint lets the application remain
healthy while telemetry silently fails unless the user inspects exporter
diagnostics. Onboarding should separate **workload health** from **telemetry
pipeline health** and return a specific, testable remediation.

## Run

```bash
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml down -v --remove-orphans
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml up -d --wait lgtm alloy app
```

Generate traffic, then inspect the application logs:

```bash
curl -X POST http://localhost:8080/checkout -H "content-type: application/json" -d '{"checkoutId":"bad-endpoint-demo"}'
curl --fail --silent --show-error http://localhost:8080/health
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml logs --since 10m app alloy
```

Starting only `lgtm`, `alloy`, and `app` keeps `loadgen` out of the evidence
window so the failure probe remains attributable.

## Observed local evidence

- `GET /health` returned `200`.
- The application OTLP exporter reported `ECONNREFUSED` for `alloy:14318`.
- The failure probe produced no fresh Alloy receipt, returned no Tempo trace,
  and returned no Loki record.

The dated probe identifiers and backend results are in the [runtime verification
record](../../docs/evidence/runtime-verification.md).

## Diagnosis and recovery

The wrong port is configured at the application-to-Alloy hop. Restore
`http://alloy:4318` by removing the two-file scenario stack, starting a fresh
default stack without `loadgen`, and running a new bounded verifier probe:

```bash
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml down -v --remove-orphans
docker compose -f docker-compose.yml up -d --wait lgtm alloy app
npm run verify:pipeline
```

The recorded recovery restored receipt, intended attribution, trace/log
correlation, and queryable telemetry in all three local backends.

## Product implication

Show a hop-by-hop connection test before asking a user to search the backend.
The error should expose the canonical `LOCAL_RECEIVER_UNREACHABLE` code, the
failing host and port, the attempted protocol, and a safe retry action.
