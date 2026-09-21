# Scenario: bad OTLP endpoint

## Hypothesis

A syntactically valid but unreachable endpoint lets the application remain
healthy while telemetry silently fails unless the user inspects exporter
diagnostics. Onboarding should separate **workload health** from **telemetry
pipeline health** and return a specific, testable remediation.

## Run

```bash
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml up --build
```

Generate traffic, then inspect the application logs:

```bash
curl -X POST http://localhost:8080/checkout -H "content-type: application/json" -d '{"checkoutId":"bad-endpoint-demo"}'
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml logs app
```

## Expected evidence

- `GET /health` still returns `200`.
- The OTLP exporter reports a connection error for `alloy:14318`.
- Alloy reports no new batches from the application.
- No new `checkout-api` telemetry appears in Grafana.

## Diagnosis and recovery

The wrong port is configured at the application-to-Alloy hop. Restore
`http://alloy:4318`, restart the app, and confirm both receipt and attribution.

## Product implication

Show a hop-by-hop connection test before asking a user to search the backend.
The error should expose the canonical `LOCAL_RECEIVER_UNREACHABLE` code, the
failing host and port, the attempted protocol, and a safe retry action.
