# Runtime verification record

Date: 2026-09-21<br>
Application runtime: Node.js 24.21.0 in the pinned container image

This record separates the initial workstation setup evidence from the two
committed, volume-clean publication runs recorded below. The optional Grafana
Cloud check, dated screenshot gallery, and walkthrough video are still
required for their corresponding publication claims.

## Provenance milestones

- **Executable implementation verified:**
  `5cbd086da453659104b9f58eb007ba6557d1356d`.
- **Initial local evidence and documentation record introduced:**
  `4fcea6b8dc675975b2f4374d8aec1f9127f7262e`. This is a docs-only
  descendant of the verified implementation commit, not the runtime source for
  the local runs.
- **Grafana Cloud execution:** pending. Its evidence record must preserve the
  actual checked-out SHA used for the run. Any later commit that adds captures,
  updates this record, or becomes the release commit must be recorded
  separately rather than presented as the execution source.

## Status taxonomy

| Evidence layer | Status | What the status means |
| --- | --- | --- |
| Node processes and mock OTLP/HTTP receiver | **Observed locally** | The real instrumentation preloads sent non-empty protobuf requests to each expected signal endpoint; response trace IDs and structured stdout supplied the correlation evidence recorded below |
| Docker, Alloy, and local Grafana/LGTM | **Observed locally — two volume-clean runs** | The committed pipeline reproduced from removed volumes and no-cache builds; three isolated local failures were diagnosed and followed by fresh successful recovery probes. UI captures remain pending |
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

## Publication volume-clean runs

Both publication runs used source commit
`5cbd086da453659104b9f58eb007ba6557d1356d`. Each began with
`docker compose down -v --remove-orphans`, rebuilt without cache, started the
same `docker-compose.yml`, and used a new synthetic probe. The second run did
not reuse the first run's containers or volumes.

| Field | Clean run 1 | Clean run 2 |
| --- | --- | --- |
| Status | Passed | Passed |
| Run window | 2026-09-21 19:22:08–19:26:58 UTC+02:00 | 2026-09-21 19:45:03–19:47:51 UTC+02:00 |
| Timezone | Europe/Paris (`Romance Standard Time`) | Europe/Paris (`Romance Standard Time`) |
| Host | Windows 10, build 19045; WSL 2.7.14.0 | Windows 10, build 19045; WSL 2.7.14.0 |
| Docker | Desktop 4.92.0.240144; client/server Engine 29.8.0; Compose 5.5.1 | Desktop 4.92.0.240144; client/server Engine 29.8.0; Compose 5.5.1 |
| Node.js | Application image 24.21.0; workstation 22.18.0 | Application image 24.21.0; workstation 22.18.0 |
| Source commit | `5cbd086da453659104b9f58eb007ba6557d1356d` | `5cbd086da453659104b9f58eb007ba6557d1356d` |
| Compose project / path | `otel-onboarding-case-study`; explicit SDK, `normal` | `otel-onboarding-case-study`; explicit SDK, `normal` |
| Application image | `sha256:f2d9c798e773a015cecbc5d2dfedb504a568ec7adedc238714b743e308619087` | `sha256:aee1edcccc82509c9a6a769e46e88d8cea0ca4bb4824c2e14ceebba4606a41e0` |
| Alloy image | `grafana/alloy:v1.19.2`, digest `sha256:b8ec653c44235fbe910879145dac3597d66b0aaecf60bcbbe82580767771a839` | Same pinned image and digest |
| LGTM image | `grafana/otel-lgtm:0.33.1`, digest `sha256:d6c52678ab5b7144f27ae569fd778608121c0f4a10eb411983750a0d67c1fbe3` | Same pinned image and digest |
| Probe ID | `pipeline-20260921172436-947be4d9` | `pipeline-20260921174700-cbe54c51` |
| Trace ID | `a1c247af05be92ee31f81f2bd3f5c3cf` | `fee67cafec81fcf5c1dee5a72478b412` |

### First-attempt startup finding

The initial clean attempt exposed a startup-readiness problem rather than an
application or telemetry failure. LGTM's native health check used a 30-second
interval, three retries, and no start grace, so Compose marked it unhealthy
before first-start Grafana became ready at approximately 169 seconds. Commit
`5cbd086da453659104b9f58eb007ba6557d1356d` retained the same health script but
configured a 10-second interval, 5-second timeout, 12 retries, and a 240-second
`start_period`. Both complete volume-clean runs above then passed.

## Observed Alloy-to-backend evidence

Processor debug activity was observed for all three signals in both runs. The
pinned Alloy build did not expose exporter failed-send or enqueue-failure
series, so those checks remain **unavailable**, not inferred as zero. Receiver
refused-unit deltas were zero in every row.

| Run | Signal | Receiver accepted / refused | Exporter sent | Bounded backend result |
| --- | --- | --- | --- | --- |
| 1 | Traces | `+7 / +0` | `+8` | Tempo returned five connected spans for trace `a1c247af05be92ee31f81f2bd3f5c3cf`; required identity assertions passed |
| 1 | Metrics | `+22 / +0` | `+22` | Prometheus returned exact `+1` request and duration-count deltas; the cumulative post-loadgen series `demo_checkout_errors_total` had value `3` |
| 1 | Logs | `+3 / +0` | `+3` | Loki returned three correlated checkout/inventory records carrying the probe trace ID |
| 2 | Traces | `+7 / +0` | `+8` | Tempo returned five connected spans for trace `fee67cafec81fcf5c1dee5a72478b412`; required identity assertions passed |
| 2 | Metrics | `+10 / +0` | `+10` | Prometheus returned exact `+1` request and duration-count deltas; the cumulative post-loadgen series `demo_checkout_errors_total` had value `2` |
| 2 | Logs | `+3 / +0` | `+3` | Loki returned three correlated checkout/inventory records carrying the probe trace ID |

In both runs the application, Alloy readiness and health endpoints, and Grafana
health endpoint returned healthy results. Backend queries confirmed
`service.name=checkout-api`, `service.namespace=otel-onboarding`,
`service.version=1.0.0`, and `deployment.environment.name=local`. Tempo
preserved the checkout/inventory parent-child journey, and Loki preserved the
same trace ID across the three structured records. These are machine-query and
counter observations; no screenshot or video evidence is claimed.

## Observed local failures and recovery

Each failure was introduced separately against a healthy baseline. After each
diagnosis, the override was removed and a new end-to-end probe—not an earlier
successful result—established recovery.

| Scenario | Observed failure and highest validated state | Diagnosis | Fresh recovery evidence |
| --- | --- | --- | --- |
| Bad OTLP endpoint — `fault-bad-endpoint-20260921T1929`, trace `a579a34cac9629b0b0b487728dc78323` | **Highest validated state: Configured.** The application `/health` remained `200`, but export to port `14318` logged `ECONNREFUSED`. The application-receiver accepted-span series was absent, so Alloy receipt was not established; Tempo returned `404` and Loki returned no records. The verifier exited nonzero while waiting for the app receiver. | The override changed `OTEL_EXPORTER_OTLP_ENDPOINT` to `http://alloy:14318`; application health therefore did not imply telemetry receipt. Exporter failed-send and enqueue-failure series were unavailable, so no zero-value claim is made. | Removing the override and restarting produced probe `pipeline-20260921173314-60dad3e2`, trace `5ac909cc947ce1d5e6565851959993cf`; the full pipeline verifier passed. |
| Missing service name — `fault-missing-name-20260921T1935`, trace `0ad488d689c1612bf1b152e537b2369f` | **Highest validated state: Received.** The response reported `serviceName: null`. Tempo, Loki, and Prometheus received the signals under the SDK fallback `unknown_service:node`; the verifier timed out while seeking the exact trace in Tempo under the intended identity. | The override set `OTEL_SERVICE_NAME` to an empty string, so a healthy export was operationally hard to find under the intended service identity. | Removing the override and restarting produced probe `pipeline-20260921173842-85696b18`, trace `aaac3f20568c64ce58afa749c8de2d8d`; the full pipeline verifier passed with intended identity restored. |
| Broken context propagation — `fault-broken-context-20260921T1941` | **Highest validated state: Attributed.** Checkout trace `6f38366fe271fe54da49faae1f81524f` and inventory trace `95ef22a03b68d43c95b272767e84bba0` differed. Tempo split the operations into separate traces and Loki records carried split trace IDs. A direct verifier probe also returned a checkout/inventory mismatch (`0fefaae5a6319e312a9d9f06af9b3446` versus `d8517ad40fa887107d5a5d55c3cab162`). | The override selected `DEMO_SCENARIO=broken-context-propagation`; component health alone could not establish journey integrity. | Removing the override and restarting produced probe `pipeline-20260921174317-ae01d65f`, trace `02a4d744d35ea36e053f4ba91ae42799`; the full pipeline verifier passed with one connected journey restored. |

Exporter failed-send and enqueue-failure series were unavailable during these
checks; processor debug activity was observed. The failures above are based on
the actual application, Alloy, and backend responses rather than expected
scenario text.

The maturity-state labels above are analyst classifications derived from the
recorded evidence. The current verifier emits concrete failure text and a
nonzero exit; it does not emit the product taxonomy codes proposed elsewhere in
this case study.

## Controlled Grafana Cloud checkpoint

**Status: pending — unobserved.** No row below is evidence of a completed Cloud
run. The Cloud configuration intentionally omits the debug exporter; debug
activity recorded in the local runs is local-only evidence and is not exported
to Grafana Cloud.

| Checkpoint | Status | Required record |
| --- | --- | --- |
| Execution provenance | **Pending — unobserved** | Actual checked-out SHA used for the Cloud run, followed separately by any later capture or release commit |
| Invalid-auth boundary | **Pending — unobserved** | Bounded synthetic probe, sanitized authentication failure, local receiver evidence, and confirmation that the probe did not appear in the intended Cloud stack |
| Valid authenticated run | **Pending — unobserved** | Fresh bounded synthetic probe after replacing the invalid credential, with sanitized successful export or ingestion evidence |
| Hosted signal receipt | **Pending — unobserved** | Independent Cloud evidence for traces, metrics, and logs from the valid probe |
| Identity and correlation | **Pending — unobserved** | Intended service resource attributes plus checkout/inventory trace continuity and logs correlated to the same trace |
| Downstream view | **Pending — unobserved** | The named Grafana Cloud product surface or query view used to answer the operating question |
| Stack shutdown | **Pending — unobserved** | UTC time when the bounded Cloud Compose stack was stopped and its volumes removed |
| Token revocation | **Pending — unobserved** | UTC revocation time for the temporary least-privilege token; never record the token value |
| Local secret removal and history scan | **Pending — unobserved** | Confirmation that the ignored environment and secret files were deleted and that tracked files and Git history contain no credential material |

## Screenshot and video status

- Eight canonical evidence groups—the six healthy proof categories plus failure
  and recovery: **pending — unobserved**. Group 01 uses one supporting topology
  image and three signal-specific source captures.
- Approximately three-minute walkthrough: **pending — unrecorded**.
- Grafana Cloud capture: **pending — unobserved and optional**.

The capture schema and safety review are in the [image evidence
guide](../images/). The timed narrative is in the [demo
runbook](../../DEMO.md#approximately-three-minute-video-outline).

## Claims still prohibited

The local clean runs and isolated failure recoveries above do not establish any
hosted or visual evidence. This repository does not claim that:

- Grafana Cloud authentication or hosted receipt succeeded;
- a curated Grafana Cloud Application Observability surface was activated;
- screenshots or video were captured from the implementation.

The CI workflow is configured to build the container, resolve every Compose
override, validate both Alloy configurations, and run the Node checks. Those CI
steps become evidence only after the workflow actually runs successfully on the
recorded public commit.
