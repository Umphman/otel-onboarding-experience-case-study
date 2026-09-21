# Runtime verification record

Date: 2026-09-21<br>
Application runtime: Node.js 24.21.0 in the pinned container image

This record separates setup evidence observed on the current workstation from
the two committed, volume-clean publication runs and optional Grafana Cloud
check still required. It is not a substitute for the dated screenshot gallery
and walkthrough video.

## Status taxonomy

| Evidence layer | Status | What the status means |
| --- | --- | --- |
| Node processes and mock OTLP/HTTP receiver | **Observed locally** | The real instrumentation preloads sent non-empty protobuf requests to each expected signal endpoint; response trace IDs and structured stdout supplied the correlation evidence recorded below |
| Docker, Alloy, and local Grafana/LGTM | **Observed locally — setup run** | The real pipeline started and repeated bounded probes reached Tempo, Loki, and Prometheus through Alloy; committed volume-clean reruns, failure recovery, and UI captures remain pending |
| Grafana Cloud | **Pending — unobserved** | Hosted authentication, export, receipt, attribution, correlation, and downstream product views have not been executed |

`Observed` is reserved for evidence produced by an actual recorded run.
Configuration-derived behavior remains `Expected` until that evidence exists.
Design options that were evaluated but not built are `Analyzed`; intentionally
excluded work is `Deferred`.

## Observed local Docker setup run

This was a workstation setup and integration run, not a publication-grade clean
run. The repository had no commit and all project files were untracked, so a
source SHA and clean checkout could not be recorded. No screenshot or video is
claimed from this run.

| Field | Observed value |
| --- | --- |
| Run window | 2026-09-21 15:57–16:25 UTC+02:00, Europe/Paris (`Romance Standard Time`) |
| Host | Windows 10 Home Single Language 22H2, build 19045.6466; WSL 2.7.14.0 |
| Docker | Docker Desktop 4.92.0; client/server Engine 29.8.0; Compose 5.5.1; Linux `x86_64` engine |
| Node.js | Application image 24.21.0; workstation default 22.18.0 |
| Compose project | `otel-onboarding-case-study`, `docker-compose.yml` |
| Application image | `sha256:987721cabf685212f4d03378dbb9c1cd3d0db01e556e5ecf08f305ba4f54ed26` |
| Alloy image | `grafana/alloy:v1.19.2`, digest `sha256:b8ec653c44235fbe910879145dac3597d66b0aaecf60bcbbe82580767771a839` |
| LGTM image | `grafana/otel-lgtm:0.33.1`, digest `sha256:d6c52678ab5b7144f27ae569fd778608121c0f4a10eb411983750a0d67c1fbe3` |
| Mode | Explicit SDK, `normal`, `checkout-api` |

Both Compose files resolved with `config --quiet`. Both Alloy files passed the
`alloy validate` command in the pinned image; the Cloud configuration used only
non-secret placeholders and was not started. The local app reported healthy,
Alloy returned `200` from `/-/ready` and `/-/healthy`, and Grafana 13.2.1
returned `database=ok` from `/api/health` after its first-start warm-up.

The pipeline verifier passed repeatedly with the load generator stopped:

| Signal | Alloy receiver/exporter evidence | Backend evidence |
| --- | --- | --- |
| Traces | First probe: accepted `+7`, sent `+7`; refused `+0`; post-processor debug activity present | Tempo returned five connected spans with the required identity and `checkout.process`/`inventory.reserve` for trace `0b57e4338e19e85546a39187470bab1f` |
| Metrics | First probe: accepted `+11`, sent `+11`; refused `+0`; post-processor debug activity present | Prometheus showed exact `+1` deltas for request count and duration count in the quiescent probe window |
| Logs | First probe: accepted `+3`, sent `+3`; refused `+0`; post-processor debug activity present | Loki returned three checkout/inventory records carrying the same trace ID |

The first probe was `pipeline-20260921140438-02bbaeef`. Repeated verifier runs
also passed all three backends; the final probe was
`pipeline-20260921142505-10e79772` with trace
`3244c23bb8c9a43c7d81e9ee992d90b8`. Exporter failure-counter series were absent
in this healthy Alloy build and are recorded as unavailable, not inferred as
zero; no export error appeared, and fresh records were queryable in every
backend.

## Observed Node and mock-receiver evidence

### Automated checks

```text
npm test
tests 19
pass 19
fail 0
```

The same 19-test suite passed in `node:24.21.0-bookworm-slim`, matching the
application image. The workstation-default Node.js 22.18.0 run also passed but
is supporting evidence only because the package contract requires Node.js 24.

The `npm run verify:signals` harness uses a Node standard-library mock receiver,
with no additional receiver dependency, and also passed:

```text
verified explicit SDK normal: traces=1, metrics=4, logs=1, structured-logs=correlated
verified Node.js automatic instrumentation normal: traces=1, metrics=4, logs=1, structured-logs=correlated
verified explicit SDK broken context: traces=1, metrics=4, logs=1, structured-logs=split-as-expected
signal verification passed
```

The harness starts each real instrumentation preload against a bounded local
OTLP/HTTP receiver, sends a checkout probe, parses the application's structured
stdout, verifies checkout and inventory log trace IDs against the returned
trace IDs, asserts non-empty `application/x-protobuf` POSTs to each implemented
signal endpoint in every scenario, and cleans up every child process. CI runs
the same preserved command from `scripts/verify-signals.js` rather than relying
on a one-off manual test.

This harness does not route through Alloy or LGTM and cannot establish receiver,
processor, exporter, or backend behavior for the Compose architecture.

JavaScript syntax checks passed for `app/`, `instrumentation/`, `scripts/`, and
`test/`. All relative Markdown links resolved, no credential-like values were
found, and `npm audit --omit=dev` reported zero known vulnerabilities across 195
production dependencies.

### Explicit SDK path

A synthetic checkout returned one trace ID for both checkout and inventory:

```json
{
  "scenario": "normal",
  "checkoutTraceId": "5f77f81e4c5b1cf35ee9689bfd7c01df",
  "inventoryTraceId": "5f77f81e4c5b1cf35ee9689bfd7c01df",
  "contextPropagationHealthy": true
}
```

Structured stdout records for checkout and inventory carried that same
`trace_id` and their active `span_id` values.

### Configured Node.js automatic-instrumentation path

The unchanged workload was started with the repository's configured upstream
Node.js automatic-instrumentation preload. A checkout completed with matching
checkout and inventory trace IDs. The local mock OTLP/HTTP receiver accepted a
non-empty protobuf request at each expected signal endpoint:

```text
POST /v1/traces  content-type: application/x-protobuf
POST /v1/metrics content-type: application/x-protobuf
POST /v1/logs    content-type: application/x-protobuf
```

The harness does not decode those protobuf bodies; structured stdout and the
checkout response establish correlation separately. This is evidence for this
configured variant, not a universal claim about what Node.js automatic
instrumentation emits without configuration.

### Deliberately broken propagation

The broken-context scenario kept both operations healthy while splitting the
journey, as intended:

```json
{
  "scenario": "broken-context-propagation",
  "checkoutTraceId": "600c6562384ad237d6b8b91d06e8c7d0",
  "inventoryTraceId": "49c5865172bee19d3eddde0be6c0e755",
  "contextPropagationHealthy": false
}
```

## Publication clean-run environment and provenance template

The following values must be recorded from a fresh clone or copied clean
directory before any Docker result is promoted to observed evidence. `Not run`
is deliberately explicit; it must not be replaced with an expected value.

| Field | Clean run 1 | Clean run 2 |
| --- | --- | --- |
| Status | Not run | Not run |
| Start/end timestamp | Not run | Not run |
| UTC offset and named timezone | Not run | Not run |
| Operating system and version | Not run | Not run |
| Docker Desktop version, if applicable | Not run | Not run |
| Docker Engine client/server versions | Not run | Not run |
| Docker Compose version | Not run | Not run |
| Node.js version | Not run | Not run |
| Source commit SHA | Not run | Not run |
| `git status --short` empty | Not run | Not run |
| Compose project name and files | Not run | Not run |
| Instrumentation path and scenario | Not run | Not run |
| Application image ID | Not run | Not run |
| Alloy image tag and digest | Not run | Not run |
| LGTM image tag and digest | Not run | Not run |
| Synthetic probe ID | Not run | Not run |
| Bounded backend query window | Not run | Not run |
| Operator and capture-log reference | Not run | Not run |

Follow Phases 0–5 in the [demo runbook](../../DEMO.md). Clean run 1 must begin
with `docker compose down -v --remove-orphans`, a no-cache build, and a fresh
probe. Clean run 2 must again remove volumes, start the unchanged commit, use a
different probe, and repeat the complete evidence matrix. A second run is not a
pass if it depends on a volume, container, image-local edit, or undocumented
manual step retained from the first run.

## Per-signal Alloy-to-backend evidence template

Complete one row per signal for each clean run. Record the exact telemetry
counter names and labels exposed by the pinned Alloy image, their before/after
values, and the corresponding screenshot or log excerpt. Do not infer signal
delivery from the component graph.

| Signal | Receiver accepted | Processor handled | Exporter sent | Backend returned probe | Verdict |
| --- | --- | --- | --- | --- | --- |
| Traces | Pending — unobserved | Pending — unobserved | Pending — unobserved | Pending — unobserved | Pending |
| Metrics | Pending — unobserved | Pending — unobserved | Pending — unobserved | Pending — unobserved | Pending |
| Logs | Pending — unobserved | Pending — unobserved | Pending — unobserved | Pending — unobserved | Pending |

The minimum evidence for each row is:

- receiver accepted-unit delta and no corresponding refused-unit increase;
- evidence after the memory-limiter and batch processors, plus no processor
  refusal or drop increase;
- exporter sent-unit delta and no failed-send increase;
- a bounded backend query returning the fresh probe or its declared service and
  run window.

For traces, preserve checkout/inventory topology. For metrics, preserve results
for `demo.checkout.requests`, `demo.checkout.errors`, and
`demo.checkout.duration`. For logs, preserve the structured checkout record and
its trace ID. The aggregate `received` result may be marked true only after
`received.traces`, `received.metrics`, and `received.logs` are all confirmed.

## Healthy-state record template

For each clean run, attach dated evidence for:

1. application `/health` result and Compose service state;
2. all three signal rows in the pipeline matrix;
3. exact service name, namespace, version, and environment;
4. checkout and inventory in the expected parent-child trace relationship;
5. a structured log carrying the same trace ID;
6. request, error, and duration metrics answering the declared operating
   question.

Each evidence item must include run ID, probe ID, source SHA, timestamp/timezone,
image versions, product surface, query/filter, and capture filename. The setup
run above has machine-query evidence but no dated UI captures or committed
clean-run provenance attached.

## Failure and recovery record template

Reset to a proven healthy baseline and use a unique probe for each failure. Do
not reuse an earlier successful record as proof that a later recovery worked.

| Field | Recorded value |
| --- | --- |
| Scenario and hypothesis | Pending — unobserved |
| Exact change introduced | Pending — unobserved |
| What remained healthy | Pending — unobserved |
| Exact failed boundary and signal | Pending — unobserved |
| Actual status/error text, sanitized | Pending — unobserved |
| Highest validated onboarding state | Pending — unobserved |
| Diagnosis and product implication | Pending — unobserved |
| Recovery action | Pending — unobserved |
| Fresh recovery probe ID | Pending — unobserved |
| Receiver → processor → exporter → backend recovery evidence | Pending — unobserved |
| Restored identity and correlation evidence | Pending — unobserved |

Expected scenario outcomes belong in the scenario documentation. Only actual
run results belong in this table. If an invalid Cloud token returns a status
other than the anticipated 401/403, record the exact sanitized response instead
of rewriting it to match the hypothesis.

## Screenshot and video status

- Eight canonical images—the six healthy proof categories plus failure and
  recovery: **pending — unobserved**.
- Approximately three-minute walkthrough: **pending — unrecorded**.
- Grafana Cloud capture: **pending — unobserved and optional**.

The capture schema and safety review are in the [image evidence
guide](../images/). The timed narrative is in the [demo
runbook](../../DEMO.md#approximately-three-minute-video-outline).

## Claims still prohibited

Until the clean-run templates above are completed, this repository does not
claim that:

- the observed setup run came from a committed clean clone;
- a second volume-clean execution reproduced the first;
- the local failure scenarios were diagnosed and recovered in the live stack;
- Grafana Cloud authentication or hosted receipt succeeded;
- a curated Grafana Cloud Application Observability surface was activated;
- screenshots or video were captured from the implementation.

The CI workflow is configured to build the container, resolve every Compose
override, validate both Alloy configurations, and run the Node checks. Those CI
steps become evidence only after the workflow actually runs successfully on the
recorded public commit.
