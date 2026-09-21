# Scenario: broken context propagation

## Hypothesis

Healthy endpoints and arriving spans can hide a broken user journey. If trace
context is not carried from checkout to inventory, one request is split into
unrelated traces and cross-signal investigation loses its causal thread.

## Run

```bash
docker compose -f docker-compose.yml -f scenarios/broken-context-propagation/compose.override.yml up --build
```

Open `http://localhost:3000`, choose the Tempo data source in Explore, and
inspect a recent checkout request.

## Expected evidence

- Checkout and inventory both return successfully.
- Both operations emit spans, but inventory starts a different trace instead of
  appearing beneath checkout.
- Logs for the two operations contain different trace IDs.

## Diagnosis and recovery

Run the default stack without the override. A new checkout trace should include
the inventory operation as a descendant and correlated logs should share the
journey's trace ID.

## Product implication

Validation must test topology, not only volume. A product can issue a synthetic
request with a known trace context and verify that expected downstream spans
remain attached.
