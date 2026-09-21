# Demo and clean-run verification runbook

This runbook defines the evidence required for a public demonstration. The local
route uses synthetic traffic and the credential-free LGTM stack. The optional
Grafana Cloud route requires a disposable stack and a temporary token.

## Evidence status and language

The Node/mock-receiver checks, two volume-clean Docker runs, and all three local
failure-and-recovery scenarios are observed in the [runtime verification
record](docs/evidence/runtime-verification.md). The local publication runs came
from the same recorded implementation commit and include Alloy counter deltas
plus Tempo, Loki, and Prometheus queries. The screenshot/video set and Grafana
Cloud remain **unobserved**; those sections below remain an execution and
capture contract.

Use these labels consistently:

- **Observed:** appeared in the dated run and is backed by a command result,
  counter delta, query result, screenshot, or recording.
- **Expected:** predicted by the configuration or scenario but not yet seen.
- **Analyzed:** evaluated as a design option without implementation.
- **Deferred:** intentionally excluded from this version.

Never convert an expected result into observed prose merely because the result
matches the design. Record the exact result first, including unexpected status
codes and error text.

## Phase 0: prepare a clean, attributable run

Run from a fresh clone or a copied clean directory, not the development working
tree. Keep credentials outside the repository.

Before startup, record the following in the [verification
record](docs/evidence/runtime-verification.md#publication-volume-clean-runs):

- operating system and version;
- Docker Desktop, Docker Engine, and Docker Compose versions;
- Node.js version;
- source commit SHA and whether `git status --short` is empty;
- timestamp, UTC offset, and named timezone;
- Compose project name and exact Compose files used;
- application image ID and Alloy/LGTM image tags and digests;
- scenario, instrumentation path, and synthetic probe ID.

Useful commands include:

```bash
git rev-parse HEAD
git status --short
node --version
docker version
docker compose version
docker compose config --quiet
docker compose images
```

Also confirm that ports `3000`, `4318`, `8080`, and `12345` are free. Do not
continue if the checkout is dirty, the source SHA is unknown, or a previous demo
stack is still running.

Install the exact host dependencies from the committed lockfile before running
the Node checks:

```bash
npm ci
```

## Phase 1: first clean execution

Remove this Compose project's containers and volumes, build without cache, and
start in the background so the evidence commands remain available:

```bash
docker compose down -v --remove-orphans
docker compose build --no-cache
docker compose up -d --wait
docker compose ps
```

Confirm the workload and every local control surface separately from telemetry
delivery. Grafana can need a short first-start warm-up even after its container
starts:

```bash
curl --fail --silent --show-error http://localhost:8080/health
curl --fail --silent --show-error http://localhost:12345/-/ready
curl --fail --silent --show-error http://localhost:12345/-/healthy
curl --fail --silent --show-error http://localhost:3000/api/health
npm test
npm run verify:signals
```

`npm run verify:signals` is a bounded process-level check against its own local
mock OTLP/HTTP receiver. It does **not** send through the running Alloy/LGTM
stack, so it cannot replace the pipeline proof in Phase 2.

Confirm that the load generator produced traffic, then stop it before the
bounded validation probe. This isolates counter deltas and keeps the detailed
debug exporter evidence attributable to the probe:

```bash
docker compose logs --since 2m loadgen
docker compose stop loadgen
npm run verify:pipeline
```

`verify:pipeline` creates its own unique probe, captures Alloy counter deltas and
post-processor debug activity, and queries Tempo, Loki, and Prometheus. Keep its
terminal summary or set `PIPELINE_VERIFY_JSON` to a new evidence-file path. It
fails when `loadgen` is still running so the exact metric deltas remain
attributable.

Create a unique probe whose identifier is recorded with the run, for example:

```bash
curl --fail --silent --show-error -X POST http://localhost:8080/checkout -H "content-type: application/json" -d '{"checkoutId":"clean-run-01","items":[{"sku":"grafana-mug","quantity":1}]}'
```

Allow at least 10 seconds for the SDK and Alloy batch processors to flush before
treating an empty backend query as a failure. Preserve relevant output from:

```bash
docker compose ps
docker compose logs --since 10m app alloy lgtm
```

Do not claim that startup is clean if an undocumented manual edit, restart, or
pre-existing volume is required.

## Phase 2: prove each pipeline boundary per signal

Open the Alloy UI at <http://localhost:12345> and Grafana at
<http://localhost:3000>. The component graph establishes configured topology
and health; it does not, by itself, prove that any signal traversed the pipeline.

For one bounded probe window, record the actual Alloy telemetry metric names,
before/after values, timestamps, and backend query. Each required signal needs
all four links below:

| Signal | Receiver accepted | Processor handled | Exporter sent | Backend returned probe |
| --- | --- | --- | --- | --- |
| Traces | Accepted-span count increases and refused-span count does not | Post-batch debug evidence contains the checkout spans; processor refusal/drop count does not increase | Sent-span count increases and failed-send count does not | Tempo returns `clean-run-01` with checkout and inventory in one trace |
| Metrics | Accepted-data-point count increases and refused-point count does not | Post-batch debug evidence contains `demo.checkout.requests`, `demo.checkout.errors`, and `demo.checkout.duration`; processor refusal/drop count does not increase | Sent-data-point count increases and failed-send count does not | Prometheus returns the checkout metrics for the declared run window and service identity |
| Logs | Accepted-log-record count increases and refused-record count does not | Post-batch debug evidence contains a structured record for `clean-run-01`; processor refusal/drop count does not increase | Sent-log-record count increases and failed-send count does not | Loki returns the probe log with the same trace ID as the Tempo trace |

The counter labels and exported metric names can change between Alloy versions.
Do not substitute guessed names: capture the exact names exposed by the pinned
image and quote them in the verification record. A debug batch proves that data
passed the receiver and configured processors to the debug exporter; pair it
with accepted/refused and sent/failed counter deltas plus the backend query. If
the healthy build does not expose a zero-valued failure series, record it as
`unavailable`, not as zero, and require direct retry/error evidence during the
corresponding fault scenario.

Validate the onboarding states in order:

0. **Workload preflight:** `/health` returns `200`.
1. **Configured:** Compose and Alloy configurations parse, the selected
   instrumentation mode is active, and required values have no unresolved
   placeholders.
2. **Connected:** every required export boundary is reachable, and
   authentication succeeds wherever authentication applies.
3. **Received:** `received.traces`, `received.metrics`, and `received.logs` are
   each confirmed by the four-link evidence above; aggregate `received` is true
   only when all required signals are confirmed.
4. **Attributed:** the probe carries `service.name=checkout-api`,
   `service.namespace=otel-onboarding`, `service.version=1.0.0`, and
   `deployment.environment.name=local`.
5. **Correlated:** checkout and inventory appear in one trace and the structured
   log carries the same trace ID.
6. **Actionable:** the combined signals answer “Are checkouts healthy?” and
   “Why did the known failure occur?”

In Grafana Explore, use the built-in Tempo, Loki, and Prometheus data sources.
Search by the recorded probe ID and bounded time window wherever the signal
supports it; otherwise use the exact service identity and metric names.

## Phase 3: capture the healthy state

Capture the following from the same commit and run window:

1. **Alloy pipeline:** component graph plus signal-specific receiver,
   post-processor/debug, exporter, and failed-record evidence for traces,
   metrics, and logs.
2. **Service identity:** name, namespace, version, and environment.
3. **Complete trace:** checkout and inventory with the expected parent-child
   relationship.
4. **Correlated log:** structured checkout event with the same trace ID.
5. **Metrics:** request rate, error count or rate, and latency distribution.
6. **Operating answer:** the evidence used to answer whether checkouts are
   healthy and why the deterministic failure occurred.

Use the canonical filenames and safety procedure in the [image evidence
guide](docs/images/). Each capture must state its claim, source SHA, run ID,
probe ID, timestamp/timezone, image versions, product surface, scenario, query
or filter, and whether it is local LGTM or Grafana Cloud evidence.

## Phase 4: execute failures one at a time

Reset to a proven healthy baseline before each scenario. Use a new probe ID for
the fault and another new probe ID after recovery. For every scenario record:

```text
Hypothesis
-> change introduced
-> what remains healthy
-> what breaks
-> exact observed evidence
-> highest validated onboarding state
-> diagnosis
-> recovery step
-> evidence of recovery
-> product implication
```

| Scenario | Observed local result | Recovery status |
| --- | --- | --- |
| [Bad OTLP endpoint](scenarios/bad-otlp-endpoint/) | The workload stayed healthy while the application exporter received `ECONNREFUSED` at the deliberately wrong port; the failure probe produced no fresh Alloy receipt or Tempo/Loki result | **Observed:** after restoring port `4318`, a fresh pipeline-verifier probe reached Alloy and all three local backends |
| [Missing service name](scenarios/missing-service-name/) | Signals arrived as `unknown_service:node` across Tempo, Loki, and Prometheus rather than as `checkout-api` | **Observed:** a fresh pipeline-verifier probe restored the intended identity in every required backend |
| [Broken context propagation](scenarios/broken-context-propagation/) | Checkout and inventory remained successful but appeared under different backend trace IDs, with correspondingly split log trace IDs | **Observed:** a fresh pipeline-verifier probe restored one connected trace and same-trace structured logs |
| [Invalid Cloud credentials](scenarios/invalid-cloud-credentials/) | **Pending — unobserved:** hosted export is expected to fail authentication while the local workload and app-to-Alloy boundary remain healthy | Required if run: authentication errors stop and a fresh probe appears in the intended Cloud stack |

The first three local scenarios and their fresh-probe recoveries are recorded in
the [runtime verification record](docs/evidence/runtime-verification.md). The
Cloud case is a guided exercise and remains **unobserved**.

For the bad-endpoint demonstration, remove demo volumes, start only the override,
and record the exact exporter error:

```bash
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml down -v --remove-orphans
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml up -d --wait lgtm alloy app
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml ps
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml logs --since 10m app alloy
```

Prove that `/health` still returns `200`, send a uniquely named failure probe,
and show which pipeline hop fails. Then return to a volume-clean default stack:

```bash
docker compose -f docker-compose.yml -f scenarios/bad-otlp-endpoint/compose.override.yml down -v --remove-orphans
docker compose -f docker-compose.yml up -d --wait lgtm alloy app
npm run verify:pipeline
```

Recovery is observed only when a **new** probe restores all four pipeline links,
the intended identity, the connected checkout/inventory trace, and the
same-trace structured log. A healthy graph or disappearance of an error is not
enough.

When any other scenario is executed, follow its linked README and use the same
baseline, unique-probe, diagnosis, and recovery sequence. For Cloud credentials,
record the exact status and sanitized error returned by the endpoint; do not
write an expected “401/403” as though it were observed.

## Phase 5: second clean execution

After all first-run captures, remove containers and volumes again. Rebuild and
start from the unchanged recorded commit:

```bash
docker compose down -v --remove-orphans
docker compose build --no-cache
docker compose up -d --wait
docker compose ps
curl --fail --silent --show-error http://localhost:8080/health
npm test
npm run verify:signals
docker compose logs --since 2m loadgen
docker compose stop loadgen
```

Send a new `clean-run-02` probe and repeat the full per-signal matrix from Phase
2. Record separate start/end timestamps, query windows, counter deltas, and
capture references. The second run passes only if it requires no data, volume,
container, or undocumented manual state from the first run.

Finally, stop the stack cleanly:

```bash
docker compose down -v --remove-orphans
```

## Optional Grafana Cloud execution

Grafana Cloud has **not** been executed for the current evidence record. The
local LGTM route is the required reference proof; one Cloud run would add hosted
authentication and destination evidence.

Copy `.env.cloud.example` to a runtime-only `.env.cloud`. Put a narrowly scoped,
temporary token—without whitespace or a trailing newline—in the ignored file
named by `GRAFANA_CLOUD_API_KEY_FILE`. Validate the HTTPS base OTLP endpoint,
bounded traffic, secret path, and Compose model before starting:

```bash
npm run verify:cloud-config -- .env.cloud
docker compose --env-file .env.cloud -f docker-compose.cloud.yml config --quiet
docker compose --env-file .env.cloud -f docker-compose.cloud.yml up -d --build --wait
```

The Cloud load generator is one-shot and defaults to 20 requests. Alloy's OTLP
receiver is reachable only inside the Compose network; only its local status UI
is published. The Cloud resource attributes include a stable, synthetic
`grafana.host.id` for this Docker proof; keep or deliberately replace it if the
run activates Application Observability. Never print the resolved Compose model
or container environment during a credentialed run. Stop the stack and revoke
the token immediately after capture.

If executed, distinguish `Observed locally` from `Observed in Grafana Cloud`.
Capture invalid credentials failing with the exact sanitized response, correct
credentials succeeding, a new probe in the intended stack, correct service
attribution, trace/log correlation, and one downstream view when available.
Raw OTLP receipt does not prove that a curated Application Observability surface
is activated. Never expose the token, stack identifier, account, or user; revoke
the token immediately after capture.

## Approximately three-minute video outline

- **0:00–0:30 — Product problem:** a healthy application can have broken
  telemetry; first receipt is not successful onboarding.
- **0:30–1:00 — Architecture and states:** show workload → Alloy → backend →
  operating answer, then configured → connected → received → attributed →
  correlated → actionable.
- **1:00–1:40 — Healthy proof:** show the three-signal Alloy pipeline evidence,
  service identity, complete trace, correlated log, and metric answering the
  operating question.
- **1:40–2:30 — One deterministic failure:** show the workload remaining healthy,
  the exact failed onboarding state, diagnosis, remediation, and fresh-probe
  recovery. Broken propagation or missing identity is the strongest choice.
- **2:30–3:00 — Product conclusion:** the product should report the highest
  validated state, its evidence, a stable error code, and the safest next action.

Show the source commit and run timestamp briefly. Use only evidence from the
same recorded run, and link the final video only after its claims match the
verification record.

## Evidence capture checklist

Save sanitized images under `docs/images/`:

1. `01-alloy-receipt.png` — per-signal receiver → processor → exporter evidence.
2. `02-service-identity.png` — intended name, namespace, version, and environment.
3. `03-correlated-trace.png` — checkout and inventory in one trace.
4. `04-correlated-log.png` — structured log with that trace ID.
5. `05-checkout-metrics.png` — request, error, and latency evidence.
6. `06-operating-answer.png` — evidence answering health and known-failure cause.
7. `07-failure-diagnosis.png` — healthy workload, exact failed hop, and diagnosis.
8. `08-recovered-state.png` — fresh-probe delivery, attribution, and correlation.

The [image evidence guide](docs/images/) is the source of truth for capture and
public-safety requirements. Do not publish a placeholder as evidence.

## Publication gate

- [x] Complete both volume-clean Docker runs from one recorded commit.
- [x] Add and pass a pipeline-targeted verifier; `verify:signals` remains a
  mock-receiver check and does not satisfy this item.
- [ ] Capture eight dated images: the six healthy proof categories plus failure
  and recovery states.
- [ ] Record and link the approximately three-minute walkthrough above the fold.
- [ ] Replace README capture-contract links with the actual proof.
- [x] Keep Grafana Cloud explicitly unobserved unless the optional run occurs.
- [x] Record exact OS, Docker, Compose, Node, image, commit, and timezone values.
- [x] Scope automatic-instrumentation and identity-contract claims to this
  configured reference workload.
- [x] Remove absolute workstation paths and verify all relative links.
- [x] Scan the current working tree for credential-shaped values.
- [ ] Have the author review first-person decisions and authorship in their own
  voice.
- [ ] Create the public GitHub repository from a clean history.
- [x] Scan the current local commit history for secrets and private material.
- [ ] Tag the evidence-bearing release, for example `v1.0.0-case-study`.
