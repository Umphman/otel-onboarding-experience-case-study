# Scenario: invalid Grafana Cloud credentials

> **Execution status:** documented, not yet executed. No runtime evidence or
> screenshot in this repository currently proves this scenario.

## Purpose and boundary

This Cloud-only scenario isolates authentication on the Alloy-to-Grafana Cloud
hop. The Node.js application should stay healthy and continue exporting to
Alloy while Alloy's authenticated OTLP/HTTP request is rejected by Grafana
Cloud.

It uses the existing `docker-compose.cloud.yml` and `alloy/config.cloud.alloy`;
there is no local-LGTM equivalent because the default local route intentionally
requires no credentials.

The Cloud Alloy configuration intentionally has no `debug` exporter. The
controlled Cloud run sends only to the `grafana_cloud` exporter, so container
logs cannot accidentally become a second copy of telemetry payloads. Local
debug-exporter evidence belongs only to the separate local verification path.

## Safety prerequisites

- Docker Desktop or another Docker Engine with Compose v2.
- A disposable Grafana Cloud stack whose usage and billing policy you have
  reviewed.
- The stack's exact OTLP endpoint and OTLP instance ID from its OpenTelemetry
  connection details.
- Treat the endpoint host and every Cloud account, organization, stack, tenant,
  and instance identifier as private. Exclude or redact them from screenshots,
  transcripts, and committed evidence.
- Synthetic sample traffic only. Do not point this exercise at a production
  workload or reuse production credentials.
- `.env.cloud` and the token file under `secrets/` must remain ignored by Git.
  Never paste a valid token into a command, terminal transcript, issue,
  screenshot, or committed file.

An intentionally invalid string is used for the failure, so no valid Cloud
token is required until the recovery step. If recovery will be demonstrated,
create a short-lived, least-privilege access-policy token with
`metrics:write`, `logs:write`, and `traces:write`. Keep it in an approved secret
store until the recovery run, mount it only through the ignored secret file,
and revoke it after capture.

## Prepare the failure

1. Copy `.env.cloud.example` to the ignored file `.env.cloud`.
2. Set `GRAFANA_CLOUD_OTLP_ENDPOINT` and `GRAFANA_CLOUD_INSTANCE_ID` to the
   values for the disposable stack.
3. Create the file named by `GRAFANA_CLOUD_API_KEY_FILE` under `secrets/` and
   put only `intentionally-invalid-not-a-secret` in it, with no trailing
   newline. Do not use a malformed endpoint: the request must reach the Cloud
   authentication boundary for this scenario to be valid.
4. Leave the synthetic service identity in place and keep
   `LOADGEN_REQUESTS=20`. The preflight rejects every other request count.
5. Record the checked-out commit SHA and the UTC start time in the evidence
   notes. Do not record the endpoint host, instance ID, or token.

Reset prior Cloud state, validate the inputs, build the two application images,
then start **only** Alloy and the application. Starting the named services is
important: it prevents the Compose `loadgen` service from racing the baseline.

```bash
npm run verify:cloud-config -- .env.cloud
docker compose --env-file .env.cloud -f docker-compose.cloud.yml down -v --remove-orphans
docker compose --env-file .env.cloud -f docker-compose.cloud.yml build --no-cache
docker compose --env-file .env.cloud -f docker-compose.cloud.yml up -d --wait alloy app
```

Confirm the application is healthy without generating checkout telemetry:

```bash
curl --fail http://localhost:8080/health
```

Before traffic, capture a baseline from <http://localhost:12345/metrics> for the
`otelcol_receiver_accepted_*` and `otelcol_exporter_send_failed_*` counters
listed below. Preserve the `component_id` label so the before/after values are
attributable to the `app` receiver and `grafana_cloud` exporter.

Run the one-shot generator **exactly once**. This is the entire invalid-token
workload: 20 synthetic checkout requests, including the generator's expected
validation failures. Do not also send a manual `POST /checkout`, and do not run
the command a second time.

```bash
docker compose --env-file .env.cloud -f docker-compose.cloud.yml run --rm --no-deps loadgen
```

After the batch/retry interval, capture the same counters again:

```text
otelcol_receiver_accepted_spans_total
otelcol_receiver_accepted_log_records_total
otelcol_receiver_accepted_metric_points_total
otelcol_exporter_send_failed_spans_total
otelcol_exporter_send_failed_log_records_total
otelcol_exporter_send_failed_metric_points_total
```

The three receiver counters must increase after synthetic traffic, and the
failed-export counters for the `grafana_cloud` exporter must increase or Alloy
must emit an equivalent failed-batch log with the Cloud HTTP status. Preserve
the relevant label set when capturing evidence so a counter from another
component cannot be mistaken for this pipeline.

Inspect only the relevant Alloy logs; do not dump the container environment or
print `.env.cloud`:

```bash
docker compose --env-file .env.cloud -f docker-compose.cloud.yml logs --since=10m alloy
```

In Grafana Cloud, use the recorded UTC window and
`service.name=checkout-api` to confirm that no fresh traces, logs, or metrics
from this invalid-token phase arrived. Capture the exact sanitized HTTP status
or normalized authentication classification from Alloy and the bounded Cloud
absence result. Redact the endpoint host, account/organization/stack and
instance identifiers, authorization headers, and token-shaped values.

The Alloy UI at <http://localhost:12345> can provide component-level context,
but a green component graph proves that configuration loaded—not that Cloud
accepted a batch.

## Expected evidence

The exact error text can vary with the Grafana Cloud gateway and Alloy version.
The required invariant is an authentication rejection at the authenticated
Alloy-to-Cloud export boundary:

- `GET /health` returns `200`, and checkout requests still complete.
- The application continues to target private endpoint `http://alloy:4318`;
  application logs do not contain a Cloud token.
- Alloy's accepted-signal counters increase for traces, logs, and metrics, while
  the `grafana_cloud` OTLP/HTTP exporter reports failed sends or retries.
- A deliberately invalid token commonly produces HTTP `401 Unauthorized` or an
  `Unauthenticated` classification. A valid identity lacking required write
  permission or blocked by policy may instead produce HTTP `403 Forbidden` or a
  `PermissionDenied` classification.
- Exporter failed-send evidence increases while no fresh `checkout-api` data
  from this run appears in the intended Grafana Cloud stack.

Capture the HTTP status or normalized authentication classification, component
name, signal type, attempt time, and retry/discard state. Redact the OTLP host,
instance or tenant identifier, authorization headers, and any token-shaped
value before publishing evidence.

The scenario is not valid if the primary evidence is DNS failure, connection
refusal, TLS failure, timeout, or `404`; those indicate endpoint or network
configuration rather than authentication. It is also not valid if Grafana Cloud
accepts the deliberately invalid string. In that case, stop the exercise and
investigate the endpoint and credential source before continuing.

## Diagnosis

The end-to-end pipeline has **not** reached **Connected**: the
application-to-Alloy sub-boundary passes, but the authenticated
Alloy-to-Grafana-Cloud sub-boundary fails. **Received** also remains unproven
because it is reserved for evidence from the intended backend. The diagnostic
must preserve that partial progress while reporting the failed overall gate:

```text
application health: healthy
application -> Alloy: connected and sending
Alloy receiver: receiving
Alloy -> Grafana Cloud: authentication or authorization rejected
Grafana Cloud receipt: not proven
```

This distinction prevents a user from changing application instrumentation or
searching an empty backend when the failing control is the Cloud credential.

## Recovery and validation

1. Replace only the contents of the ignored file named by
   `GRAFANA_CLOUD_API_KEY_FILE` with a valid, short-lived access-policy token
   carrying `metrics:write`, `logs:write`, and `traces:write`. Use an editor or
   approved runtime secret mechanism so the token does not enter shell history.
2. Run the preflight again. It must report `endpoint=valid`, not the endpoint
   host, and `loadgen_requests=20`:

   ```bash
npm run verify:cloud-config -- .env.cloud
   ```

3. Recreate **only Alloy** so the credential boundary is unambiguous while the
   already-healthy application remains in place:

   ```bash
docker compose --env-file .env.cloud -f docker-compose.cloud.yml up -d --force-recreate --no-deps --wait alloy
   ```

4. Record a new UTC start time and a fresh Alloy-counter baseline. Then run the
   one-shot generator exactly once—again, no manual checkout request:

   ```bash
docker compose --env-file .env.cloud -f docker-compose.cloud.yml run --rm --no-deps loadgen
   ```

5. Preserve one successful `checkoutId` and its returned trace ID from the
   generator output as the correlation probe. After the export interval,
   confirm the prior authentication failure has stopped and record the new
   receiver/sent/failed counter deltas for all three signals.
6. In Grafana Cloud, restrict every search to the recovery UTC window and prove:
   - a fresh trace for the selected checkout contains both `checkout.process`
     and `inventory.reserve` in one trace;
   - structured `checkout started`, `inventory reserved`, and
     `checkout completed` logs carry the selected `checkout_id`, with the same
     trace ID as the trace;
   - fresh `demo.checkout.requests` and `demo.checkout.duration` metric series
     appear (the backend may normalize their displayed names); and
   - traces, logs, and metrics all retain `service.name=checkout-api`,
     `service.version=1.0.0`, and `deployment.environment.name=demo`.
7. Open one enabled downstream Grafana Cloud product view, such as the service
   overview or Application Observability, and confirm it identifies the same
   `checkout-api` service from the controlled window. This distinguishes a
   usable product outcome from raw Explore ingestion alone.

Successful recovery must prove backend receipt, attribution, and correlation;
the absence of a new error line alone is insufficient.

## Mandatory cleanup and credential audit

After the captures are complete, stop the topology and delete its persisted
volume with this exact command:

```bash
docker compose --env-file .env.cloud -f docker-compose.cloud.yml down -v --remove-orphans
```

Revoke the temporary access-policy token in Grafana Cloud immediately and
record the successful revocation time in UTC in the evidence notes. Then delete
both local secret inputs without displaying their contents:

```bash
rm -f secrets/grafana-cloud-api-key.txt .env.cloud
```

If `GRAFANA_CLOUD_API_KEY_FILE` was deliberately changed from the documented
path, delete that exact file through the file manager or editor instead; do not
expand or print it in a shell command. Finally run these non-secret Git checks:

```bash
git check-ignore -v .env.cloud secrets/grafana-cloud-api-key.txt
git status --short
git log --all -- .env.cloud secrets/grafana-cloud-api-key.txt
```

The ignore check must identify the repository ignore rules, status must not
show either credential input, and the history query must produce no commits for
either path. Do not paste the real token into a search command or transcript.
Record the stack shutdown, token revocation, local deletion, and Git-audit
results as separate checklist items.

## Product implication

Authentication deserves its own onboarding result, separate from endpoint
reachability and configuration parsing. A human UI or agent response should:

- identify the failed hop and destination without echoing a credential;
- distinguish `CLOUD_EXPORT_AUTHENTICATION_FAILED` (`401`/invalid identity)
  from `CLOUD_EXPORT_AUTHORIZATION_DENIED` (`403`/insufficient policy), while
  preserving the raw backend status as evidence;
- name the credential source and the required `metrics:write`, `logs:write`, and
  `traces:write` scopes without displaying the token value;
- avoid suggesting application-code changes while app-to-Alloy receipt is
  healthy; and
- require a fresh synthetic signal to verify recovery.

This scenario remains a hypothesis until the documented run is executed and
sanitized evidence is captured from a disposable Grafana Cloud stack.
