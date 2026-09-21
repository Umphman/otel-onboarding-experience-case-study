# Instrumentation and Export Paths

## Decision status

This repository implements two application-instrumentation modes and one export
topology:

- an **explicit Node.js SDK** bootstrap;
- **Node.js automatic instrumentation** using the upstream OpenTelemetry
  auto-instrumentation register; and
- OTLP/HTTP through Grafana Alloy, with either the local LGTM stack or Grafana
  Cloud as the destination.

Direct-to-Grafana-Cloud export and eBPF-based instrumentation with Grafana
Beyla or OpenTelemetry eBPF Instrumentation (OBI) are analyzed below, but they
are not implemented or evaluated by this version. This boundary matters:
configuration analysis is not runtime evidence.

## The two implemented Node.js modes

Both modes start before `app/server.js` imports `node:http`, run the same
application code, use the same synthetic traffic, and export traces, metrics,
and logs. Only one mode may be active in a process.

| Dimension | Explicit Node.js SDK | Node.js automatic instrumentation |
| --- | --- | --- |
| Start command | `npm run start:sdk` | `npm run start:auto` |
| Compose command | `docker compose up --build` | `docker compose -f docker-compose.yml -f instrumentation/auto-instrumentation/compose.override.yml up --build` |
| Bootstrap | `instrumentation/sdk/register.js` constructs `NodeSDK`, exporters, processors/readers, resource data, and HTTP instrumentation | `instrumentation/auto-instrumentation/register.js` preloads `@opentelemetry/auto-instrumentations-node/register`; the upstream package constructs the SDK and loads supported instrumentations from environment configuration |
| Library coverage | HTTP instrumentation is selected explicitly | The upstream bundle discovers and enables its supported Node.js library instrumentations |
| Control surface | Code plus standard environment variables | Primarily standard environment variables and the preload command |
| Best fit | Domain context, explicit lifecycle control, nonstandard libraries, or a deliberately narrow instrumentation set | A fast baseline for a supported Node.js runtime and libraries |
| Main cost | More application-owned telemetry code and upgrades | Broader implicit behavior, coverage gaps, and less obvious ownership when defaults change |

The application contains OpenTelemetry API calls for its domain span, metrics,
and log records in both modes. Therefore, “automatic” here describes SDK
bootstrap and supported-library instrumentation; it does **not** claim that
application-specific business semantics appeared with no code. Calling this
mode simply “zero-code” would hide that distinction.

The comparison is intentionally controlled: same workload, same resource
contract, same pipeline, same backend, and same validation request. A reviewer
can therefore attribute differences to the instrumentation path rather than to
two unrelated examples.

### Selection rule

Start with Node.js automatic instrumentation when the runtime and important
libraries are supported and the immediate goal is a reversible baseline.
Choose the explicit SDK path when the operating question requires domain spans,
bounded business attributes, an unsupported boundary, explicit processor or
exporter behavior, or lifecycle control. In either case, validate identity,
correlation, and usefulness; signal arrival alone does not make the choice
successful.

Do not preload both modes. Competing providers and duplicate library hooks can
produce duplicate spans and misleading evidence.

## Exact protocol implemented

Every implemented telemetry hop uses **OTLP/HTTP with binary Protocol Buffers**:

| Hop | Evidence in this repository |
| --- | --- |
| Application to Alloy | `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, the JavaScript `*-otlp-proto` exporters, and Alloy's `otelcol.receiver.otlp` `http` receiver on port `4318` |
| Alloy to local LGTM | `otelcol.exporter.otlphttp` with the local LGTM base endpoint |
| Alloy to Grafana Cloud | `otelcol.exporter.otlphttp` with the Cloud base endpoint and an Alloy basic-auth handler |

OTLP defines both HTTP and gRPC transports over the same protobuf message
schema. That does not make their wire behavior identical. This sample selected
HTTP/protobuf because one transport is enough to test the onboarding state
model, it is explicit in the environment contract, and its HTTP failure
boundary is straightforward to demonstrate.

**OTLP/gRPC is not configured, exercised, benchmarked, or compared here.** No
conclusion about relative throughput, latency, proxy compatibility, retry
behavior, or operational suitability should be inferred from this repository.
A valid gRPC comparison would require its own receiver/exporter configuration,
port and proxy checks, equivalent failure cases, and measured results.

## Direct to Cloud or through Alloy

The executable reference always uses Alloy:

```text
Node.js application -> OTLP/HTTP -> Alloy -> OTLP/HTTP -> local LGTM or Grafana Cloud
```

A direct route would instead put the Cloud OTLP endpoint and credentials in the
application deployment. It is a legitimate option, but it is not an executable
variant in this repository.

| Decision factor | SDK or automatic instrumentation direct to Cloud | SDK or automatic instrumentation through Alloy |
| --- | --- | --- |
| Strength | Fewer deployed components and one fewer network hop | Central place for authentication, routing, batching, retry/queue policy, redaction, enrichment, and pipeline diagnostics |
| Cost | Every application deployment owns endpoint, credentials, exporter policy, and credential rotation | A collector component must be deployed, secured, observed, upgraded, and owned |
| Credential boundary | Cloud credential is available to the application runtime or its deployment environment | Application knows only Alloy's private endpoint; the Cloud credential terminates at Alloy |
| Failure surface | Shorter path, but application and backend concerns are coupled | More failure boundaries, but each can be inspected and policy can change without rebuilding the application |
| Consistency | Simple for one controlled workload; configuration can drift as services multiply | Shared controls can make identity and export policy consistent across a fleet |
| Best fit | Small, controlled deployment with clear application ownership and no need for shared processing | Multiple services, centralized governance, credential isolation, or a platform team that owns the telemetry route |

The v1 reference chooses Alloy because collector onboarding, authentication,
pipeline visibility, and separation of application health from telemetry health
are part of the product question. It also keeps Grafana Cloud credentials out of
the application container. This is a scoped design decision, not a claim that a
collector is mandatory for every workload.

## Where Beyla, OBI, and eBPF fit

Grafana Beyla is Grafana's supported distribution of OpenTelemetry eBPF
Instrumentation (OBI). OBI is the upstream OpenTelemetry project; the two share
the eBPF instrumentation core, while their packaging, release cadence, and some
features differ.

This runtime instrumentation path is attractive when a team needs broad,
low-touch discovery and baseline observability across supported Linux workloads
without modifying application packages or restarting each application. It can
observe network and protocol boundaries, produce RED metrics and transaction
spans, cover multiple languages, and place instrumentation ownership with a
platform team rather than every application team.

That strength comes with a different set of tradeoffs:

- it requires a supported Linux kernel, BTF, host/process visibility, and the
  documented root or Linux capability permissions;
- generic network and protocol observation cannot infer every custom span,
  business event, application-only attribute, or in-process boundary;
- runtime-specific context propagation and trace/log correlation need explicit
  validation rather than assumption;
- service discovery, naming, and Kubernetes decoration become platform policy;
  and
- running eBPF and language instrumentation together requires an intentional
  coexistence or exclusion policy to avoid duplicate or confusing telemetry.

Use Beyla or OBI as a strong candidate for fast fleet coverage, polyglot estates,
or workloads where changing source and dependencies is expensive. Prefer a
language agent or explicit SDK when the operating question depends on rich
application semantics or a precisely controlled in-process trace shape. A
layered approach can also be appropriate, but it must define which layer owns
each signal and verify that the result is coherent.

### Why eBPF instrumentation is excluded from v1

1. The experiment isolates one decision: explicit Node.js SDK bootstrap versus
   Node.js automatic instrumentation on the same source and pipeline.
2. The repository is designed to be reproducible on ordinary Docker Desktop
   environments; a meaningful eBPF test needs a qualifying Linux host and an
   explicit permissions review.
3. The validation contract depends on a known domain span and trace-correlated
   application log, areas where language-level context is deliberately visible.
4. Adding a third mode would require separate acceptance criteria for kernel
   compatibility, discovery, privilege, duplicate suppression, propagation,
   and resource identity.

The exclusion is not a judgment that Beyla or OBI is unsuitable. It prevents a
configuration-only example from being presented as evaluated runtime proof.

### Proposed follow-up experiment

On a supported Linux host, run Beyla and upstream OBI as separately identified
variants against the same synthetic checkout request. Record setup time, source
and deployment changes, required permissions, discovered service identity,
span topology, RED metrics, context propagation, trace/log correlation, CPU and
memory overhead, removal/rollback behavior, and diagnosis quality. Compare
those results with the two implemented Node.js modes before changing the
instrumentation chooser.

## Primary sources

The official specifications and project documentation supporting these
boundaries are collected in [Technical references](references.md).
