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

## Safety prerequisites

- Docker Desktop or another Docker Engine with Compose v2.
- A disposable Grafana Cloud stack whose usage and billing policy you have
  reviewed.
- The stack's exact OTLP endpoint and OTLP instance ID from its OpenTelemetry
  connection details.
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
4. Leave the synthetic service identity and load generator defaults in place.

Start the Cloud topology:

```bash
npm run verify:cloud-config -- .env.cloud
docker compose --env-file .env.cloud -f docker-compose.cloud.yml up -d --build --wait
```

In another terminal, submit a recognizable synthetic request and check workload
health:

```bash
curl -X POST http://localhost:8080/checkout -H "content-type: application/json" -d '{"checkoutId":"invalid-auth-demo","items":[{"sku":"grafana-mug","quantity":1}]}'
curl http://localhost:8080/health
```

Inspect only the relevant Alloy logs. Do not dump the container environment or
print `.env.cloud`:

```bash
docker compose --env-file .env.cloud -f docker-compose.cloud.yml logs --since=5m alloy
```

Use Alloy's local Prometheus endpoint to prove receipt and failed export. Open
<http://localhost:12345/metrics>, record the values before a fresh request, then
refresh after the batch interval. Search for:

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
2. Recreate the stack so Alloy receives the corrected runtime value:

   ```bash
docker compose --env-file .env.cloud -f docker-compose.cloud.yml up -d --build --force-recreate --wait
   ```

3. Send a new request with a new checkout ID. Do not use old data as recovery
   proof.
4. Confirm the authentication error stops, then verify new traces, logs, and
   metrics in Grafana Cloud with `service.name=checkout-api`,
   `service.version=1.0.0`, and `deployment.environment.name=demo`.
5. Confirm the new checkout trace includes its inventory work and a structured
   log carries the same trace ID.
6. Revoke the temporary token after evidence capture and remove the local
   secret file when it is no longer needed.

Successful recovery must prove backend receipt, attribution, and correlation;
the absence of a new error line alone is insufficient.

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
