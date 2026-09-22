# Technical references

Checked on 2026-09-22. Primary project documentation and release registries are
used so the executable example can be audited independently.

## Version choices

- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [Official Node container tags](https://github.com/docker-library/official-images/blob/master/library/node)
- [Grafana Alloy v1.19.2 release](https://github.com/grafana/alloy/releases/tag/v1.19.2)
- [Docker OTel LGTM v0.33.1 release](https://github.com/grafana/docker-otel-lgtm/releases/tag/v0.33.1)
- [OpenTelemetry JavaScript releases](https://github.com/open-telemetry/opentelemetry-js/releases)

The lockfile is committed because some OpenTelemetry JavaScript packages used
for the logs pipeline remain experimental and may make breaking changes.

## Instrumentation and SDK configuration

- [Grafana: instrument a Node.js application](https://grafana.com/docs/opentelemetry/instrument/node/)
- [OpenTelemetry: JavaScript zero-code instrumentation](https://opentelemetry.io/docs/zero-code/js/)
- [OpenTelemetry Protocol specification](https://opentelemetry.io/docs/specs/otlp/)
- [OTLP exporter endpoint semantics](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/)
- [SDK environment-variable specification](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/)
- [OpenTelemetry JavaScript signal status](https://opentelemetry.io/docs/languages/js/)

## Runtime and eBPF instrumentation

- [Grafana Beyla documentation](https://grafana.com/docs/beyla/latest/)
- [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/)
- [Grafana Beyla and upstream OBI](https://grafana.com/docs/beyla/latest/obi/)

## Alloy pipeline

- [OTLP receiver](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.receiver.otlp/)
- [Memory limiter processor](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.processor.memory_limiter/)
- [Batch processor](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.processor.batch/)
- [OTLP/HTTP exporter](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.exporter.otlphttp/)
- [Debug exporter and stability requirement](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.exporter.debug/)
- [Basic authentication component](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.auth.basic/)
- [Alloy issue #5793: auth extensions start unused client/server variants](https://github.com/grafana/alloy/issues/5793)
- [Alloy v1.19.2 auth-extension lifecycle source](https://github.com/grafana/alloy/blob/v1.19.2/internal/component/otelcol/auth/auth.go#L236-L265)
- [Alloy v1.19.2 basic-auth client credential-file source](https://github.com/grafana/alloy/blob/v1.19.2/internal/component/otelcol/auth/basic/basic.go#L45-L64)
- [Send OpenTelemetry data to Grafana Cloud through Alloy](https://grafana.com/docs/opentelemetry/collector/grafana-alloy/)
- [Grafana Cloud authentication and access policies](https://grafana.com/docs/grafana-cloud/platform/security-and-account-management/security-and-access/authentication-and-permissions/)
- [Alloy and OpenTelemetry Collector internal metrics](https://grafana.com/docs/grafana-cloud/observe-and-act/send-data/fleet-management/manage-fleet/collectors/troubleshoot-unhealthy-collector/internal-metrics/)
- [Validate an Alloy configuration](https://grafana.com/docs/alloy/latest/reference/cli/validate/)
- [Troubleshoot Alloy](https://grafana.com/docs/alloy/latest/troubleshoot/debug/)

## Identity, quality, and activation

- [Service resource semantic conventions](https://opentelemetry.io/docs/specs/semconv/resource/service/)
- [Deployment resource attribute](https://opentelemetry.io/docs/specs/semconv/registry/attributes/deployment/)
- [Application Observability quality report](https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/application-observability-kg/service-detail/quality-report/)
- [Application Observability setup](https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/application-observability-kg/setup/)
- [Docker OpenTelemetry LGTM](https://grafana.com/docs/opentelemetry/docker-lgtm/)

## Review note

The local LGTM image is a development and demonstration environment, not a
production deployment recommendation. The five-second metric export interval is
also a demo choice; the SDK specification default is longer. These choices make
the feedback loop visible without presenting demo settings as production policy.
