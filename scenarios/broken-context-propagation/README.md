# Scenario: broken context propagation

## Hypothesis

Healthy endpoints and arriving spans can hide a broken user journey. If trace
context is not carried from checkout to inventory, one request is split into
unrelated traces and cross-signal investigation loses its causal thread.

## Run

```bash
docker compose -f docker-compose.yml -f scenarios/broken-context-propagation/compose.override.yml down -v --remove-orphans
docker compose -f docker-compose.yml -f scenarios/broken-context-propagation/compose.override.yml up -d --wait lgtm alloy app
```

Open `http://localhost:3000`, choose the Tempo data source in Explore, and
inspect a recent checkout request.

Starting only `lgtm`, `alloy`, and `app` keeps `loadgen` out of the evidence
window so the failure probe remains attributable.

## Observed local evidence

- Checkout and inventory both returned successfully.
- Both operations emitted spans, but the backend returned two traces rather
  than one connected checkout/inventory trace.
- The checkout and inventory logs carried different trace IDs.

The dated probe identifiers and backend results are in the [runtime verification
record](../../docs/evidence/runtime-verification.md).

## Diagnosis and recovery

Remove the two-file scenario stack and its volumes, start the default services
without `loadgen`, and run a fresh bounded verifier probe:

```bash
docker compose -f docker-compose.yml -f scenarios/broken-context-propagation/compose.override.yml down -v --remove-orphans
docker compose -f docker-compose.yml up -d --wait lgtm alloy app
npm run verify:pipeline
```

The recorded recovery returned checkout and inventory to one connected trace,
with the structured logs carrying that journey's trace ID.

## Product implication

Validation must test topology, not only volume. A product can issue a synthetic
request with a known trace context and verify that expected downstream spans
remain attached.
