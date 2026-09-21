# From Uninstrumented Workload to Useful Observability

## Executive summary

Getting telemetry into a backend is necessary, but it is not the same as giving a team useful observability. A developer can receive a green “data detected” message while traces are attributed to the wrong service, logs cannot be correlated, or the first dashboard answers none of the questions that prompted instrumentation.

This case study uses a small synthetic Node.js service to examine that gap. The reference implementation supports an explicit OpenTelemetry Node.js SDK path and a Node.js automatic-instrumentation path, sends telemetry through Grafana Alloy, and includes deliberate failure scenarios. The code makes the workflow testable; the product work is the model for helping humans and coding agents choose a path, configure it safely, diagnose failures, and prove that the resulting telemetry is usable.

The central recommendation is to treat onboarding as a sequence of verified outcomes rather than a completed configuration wizard:

1. the workload is understood;
2. an instrumentation path is chosen intentionally;
3. the pipeline can authenticate and connect;
4. signals arrive in the selected backend;
5. those signals carry the expected identity;
6. signals correlate around a real request;
7. the user can answer an operational question.

The north-star measure should therefore be **time to useful telemetry**, not merely time to first data.

## Scope and assumptions

This is a hypothesis-driven product case study, not a report of Grafana customer research. Product claims are framed as proposals to validate.

The repository assumes:

- a synthetic Node.js HTTP workload named `checkout-api`, with no customer or production data;
- two mutually exclusive instrumentation modes: explicit OpenTelemetry Node.js SDK configuration and Node.js automatic instrumentation;
- Grafana Alloy as the local collection, processing, and forwarding layer;
- a credential-free local Grafana OpenTelemetry LGTM stack as the default, reproducible backend;
- an optional Grafana Cloud variant whose credentials are supplied at runtime and never committed;
- Docker Compose as the preferred local orchestration path;
- traces, metrics, and structured logs as the target signal set;
- product UI labels may evolve, so evidence is described by outcome rather than fragile click paths.

The case study does not claim production readiness, benchmark throughput, evaluate every language or framework, or reproduce private interview material. See [architecture.md](architecture.md) for the system boundary and [agent-contract.md](agent-contract.md) for the proposed machine-readable workflow.

## The product problem

“Instrument this service” hides several decisions:

- Which path is appropriate: explicit SDK, Node.js automatic instrumentation, runtime instrumentation, or a collector-only integration?
- Which endpoint and protocol should be used?
- Where should credentials live?
- Which resource attributes establish a stable service identity?
- How does the user know whether a missing signal is caused by the app, the collector, the network, authentication, or the backend?
- When data appears, how does the user know it belongs to the intended service and request?
- What should happen after the first successful export?

Today, those questions are often distributed across documentation, generated snippets, environment variables, collector logs, and multiple product screens. Each individual step can be technically correct while the end-to-end experience still fails.

## Research assumptions

This artifact tests technical and product hypotheses, not market demand. No
customer interviews are claimed. The next research step is to validate the state
model, instrumentation chooser, diagnostic contract, and TTUT definition with
the participants below; the detailed protocol is in [research-plan.md](research-plan.md).

### Primary participants and jobs

| User | Job to be done | Typical risk |
| --- | --- | --- |
| Application developer | Add useful telemetry without becoming an observability specialist | Chooses a path by copying the first snippet and misses identity or correlation requirements |
| Platform or SRE owner | Establish a repeatable, governable path across services | Creates a centrally correct pipeline that is opaque to application teams |
| Coding agent | Change a repository safely and verify the result | Optimizes for a successful build or HTTP 200 rather than healthy telemetry |
| Service owner or responder | Use telemetry to explain a symptom | Discovers during an incident that data is incomplete, mislabeled, or uncorrelated |

### Human and agent needs differ

A human benefits from progressive disclosure, visual confirmation, and explanations of tradeoffs. An agent needs the same concepts represented as explicit inputs, deterministic checks, typed errors, and safe stopping conditions. Good onboarding should not create two separate products; it should expose one state model through both a human interface and a machine-readable contract.

## Journey and failure points

| Stage | User question | Common failure | Product response |
| --- | --- | --- | --- |
| Discover | What is this workload and what is already installed? | Duplicate SDKs or an unsupported runtime are missed | Detect framework, runtime, existing agents, collector, and deployment environment |
| Choose | Which instrumentation path fits? | Fastest-looking option is selected without tradeoffs | Recommend a path with reasons, coverage limits, required code changes, and rollback |
| Configure | What values are required? | Endpoint, protocol, secret, or resource attributes are malformed | Validate locally; identify each field’s source and sensitivity |
| Connect | Can the app reach the collector and backend? | Authentication and network errors collapse into “no data” | Run preflight checks and return component-specific, actionable errors |
| Receive | Did the selected backend ingest every required signal? | One signal arrives and masks a partial pipeline failure | Query for a bounded synthetic probe per required signal and report the last proven boundary |
| Attribute | Is this the intended service and environment? | Data arrives as an unknown or default service | Enforce an identity contract and show the observed values |
| Correlate | Do signals describe the same request? | Logs, metrics, and traces exist but cannot be joined | Generate a known probe and verify trace/log context and expected spans |
| Activate | Can I answer a useful question? | Onboarding ends on a celebration screen | Open the relevant downstream view with a verified service, time range, and next action |

## Useful-observability maturity model

The maturity model creates a shared definition of “done” for UI flows, APIs, agents, support, and analytics. Each level requires evidence; later levels do not erase failures at earlier ones.

| Level | State | Verifiable evidence | User value |
| --- | --- | --- | --- |
| Pre-state | Uninstrumented | Workload runs; no intended telemetry pipeline is active | Baseline only |
| 0 | Configured | One instrumentation mode and a parseable, non-placeholder pipeline configuration are active | The intended route is explicit |
| 1 | Connected | Every required export boundary is reachable, and authentication succeeds wherever authentication applies | The configured route is usable |
| 2 | Received | Expected evidence generated by a known probe is queryable for every signal required by the contract within a bounded window | Complete required-signal delivery is proven |
| 3 | Attributed | Expected service name, namespace, version, and environment identity are present | Data can be found and owned |
| 4 | Correlated | A synthetic request links its server span and structured log; expected metrics share compatible resource identity | A request can be followed across signals |
| 5 | Actionable | The service view answers a defined question about traffic, errors, or latency and exposes a trace where relevant | Telemetry supports investigation |
| 6 | Operationalized | Ownership, alerting/SLO intent, cost expectations, and a repeatable validation check are established | Observability is sustained beyond setup |

Receipt remains one top-level stage in the six-stage onboarding model. It
exposes signal-specific evidence as `received.traces`, `received.metrics`, and
`received.logs` for this reference workload; aggregate `received` passes only
when every signal required by the contract is confirmed. This distinguishes a
partially functional setup, such as traces and metrics arriving without logs,
without adding another maturity level.

The four identity fields used here are an opinionated minimum product contract
for this reference workload. They are not presented as universal requirements
for every OpenTelemetry deployment; another workload or organization may apply
a different identity policy. `service.instance.id` remains useful supporting
metadata for instance-level analysis, but it is not required to pass Level 3.

### “First data” versus “useful observability”

First data is a leading receipt milestone, but Level 2 requires all signals in
the declared contract. Useful observability begins at Level 5. Treating first
arrival as complete receipt creates false-positive activation: the product
counts success while a required signal may still be missing or the user cannot
find their service or investigate a request.

For this reference implementation, the minimum demonstration acceptance criteria are:

- the known synthetic request completes;
- the backend shows the expected synthetic service identity;
- its trace contains the expected entry span and downstream work;
- a structured log can be associated with the same trace;
- request rate, error, and latency data are queryable for the same service;
- one operational question can be answered, such as “Which operation caused the injected error, and what else happened in that request?”

Level 6 is intentionally outside the one-command demo. The product recommendations explain how onboarding should invite, but not falsely claim, that transition.

## Instrumentation-path decision

The onboarding experience should make this choice explicit.

| Path | Prefer when | Tradeoff to disclose | Safe default behavior |
| --- | --- | --- | --- |
| Node.js automatic instrumentation | The framework is supported and fast, broad baseline coverage is the goal | Limited domain context; startup/runtime injection requirements; possible version conflicts | Detect existing instrumentation and preview packages/environment changes |
| SDK instrumentation | Custom business spans, attributes, or fine-grained control are required | Code changes and ongoing ownership | Generate a minimal initialization boundary and test context propagation |
| Collector-only integration | The workload already emits a supported signal or host/platform telemetry is the goal | Cannot invent missing in-process context | State clearly which application questions remain unanswered |

The product should recommend one path, explain why, and preserve the other paths as alternatives. An agent should never enable the explicit SDK and Node.js automatic instrumentation together unless the combination has been proven safe for that runtime. Direct export, Alloy, and Beyla/OBI runtime instrumentation are compared in [instrumentation-paths.md](instrumentation-paths.md); only OTLP/HTTP protobuf through Alloy is implemented here.

## Deliberate failure scenarios

Failures are part of the artifact because a happy-path screenshot does not demonstrate diagnostic quality.

| Scenario | Expected symptom | Root cause to surface | Evidence of a good diagnosis | Recovery check |
| --- | --- | --- | --- | --- |
| Bad OTLP endpoint | No new exports reach the intended receiver | Host, port, scheme, or route is wrong | Message names the attempted endpoint, failing hop, and a safe next test without exposing credentials | Preflight succeeds and the known probe reaches Level 2 for all required signals |
| Missing service name | Data arrives under a default or unknown identity | Required resource attribute is absent or overridden | Message shows expected versus observed identity and the winning configuration source | Probe appears under the intended synthetic service at Level 3 |
| Broken context propagation | Trace and log exist but cannot be joined, or a downstream span starts a new trace | Context is not propagated across an async or outbound boundary | Message identifies the broken boundary and shows trace-ID mismatch without dumping payloads | One probe produces the expected connected trace and correlated log at Level 4 |
| Invalid Cloud credentials | Expected: the local workload remains healthy while hosted export returns an authentication or authorization rejection, commonly 401/403 | Token, instance ID, or write scope is invalid | Message names the authenticated Cloud-export boundary and keeps credential values redacted | A fresh probe reaches the intended stack after restoring a correctly scoped token |

Each scenario should be reversible, isolated from the healthy default, and documented with the command or configuration switch that activates it. Failure output is part of the user experience and should be captured alongside the fix.

## Validation strategy

Validation proceeds from the nearest component outward so that every failure has a bounded owner:

1. **Static check:** required configuration is present, parseable, and free of placeholder values.
2. **Workload check:** the service starts and the synthetic request returns the expected response.
3. **Instrumentation check:** a span is created and a structured log contains valid trace context.
4. **Collector check:** Alloy accepts the signal and reports no sustained export failure.
5. **Backend check:** signal-specific queries find the known probe within a bounded time window; aggregate receipt passes only when every required signal is confirmed.
6. **Quality check:** observed identity, topology, and correlation match the expected contract.
7. **Value check:** the user can answer the predefined operational question.

Retries should account for ingestion latency, but a timeout must end in a diagnostic result rather than an indefinite spinner. The final report should name the highest maturity level proven and the evidence for every passed or failed gate.

## Product hypotheses

This artifact is designed to test five hypotheses:

1. A path recommendation with an explanation reduces abandoned or duplicated instrumentation attempts.
2. Preflight validation shifts failures earlier, where they are faster and safer to resolve.
3. A single end-to-end synthetic probe detects identity and correlation problems that component health checks miss.
4. Showing expected versus observed telemetry teaches users how the system works and improves trust.
5. A machine-readable contract lets coding agents complete routine setup autonomously while preserving meaningful human control.

The metrics and experiments for these hypotheses are defined in [product-recommendations.md](product-recommendations.md).

## Tradeoffs and decisions

- **Small workload over realistic business system:** keeps attention on onboarding and makes expected telemetry deterministic.
- **Alloy in the path over direct-to-cloud export:** exposes a common operational boundary and enables routing, enrichment, and diagnostics, at the cost of one more component.
- **Multiple signals over traces only:** enables a real correlation test, while increasing setup surface.
- **Two instrumentation modes over every possible path:** demonstrates choice without turning the repository into a compatibility matrix.
- **Local validation path by default, hosted proof by choice:** gives every reviewer a credential-free reproduction path while preserving Grafana Cloud as an optional final demonstration.
- **Outcome checks over UI-step instructions:** remains durable as product navigation changes.

## Limitations and follow-up research

The current case study does not provide evidence from real customer sessions, large deployments, Kubernetes, browser telemetry, mobile workloads, Beyla/OBI runtime instrumentation, or non-Node languages. Before committing to a roadmap, the team should:

- interview recent successful and unsuccessful onboarding users;
- analyze support cases and anonymized funnel events by runtime and path;
- observe developers and coding agents complete the same setup task;
- test error messages against real misconfigurations;
- validate that the maturity gates predict retention and downstream feature adoption;
- measure whether additional checks create unacceptable time or ingestion cost.

## Public-safety and authorship note

All services, requests, identities, and telemetry in this repository are synthetic. Screenshots must be captured from a dedicated demonstration stack and reviewed using [images/README.md](images/README.md). Secrets, account identifiers, proprietary source code, real user data, and private interview materials are excluded.

AI tools accelerated scaffolding, implementation, test generation, and editing. The repository author owns the product decisions, must be able to explain every decision, and must review every command and captured result. The setup run demonstrates end-to-end local Grafana behavior; publication-grade reproducibility is not claimed until the two clean Docker acceptance runs, isolated failure recovery, and evidence capture are complete.

## References

The checked official sources for instrumentation choices, resources, context propagation, OTLP, Grafana Alloy, the local LGTM image, Grafana Cloud ingestion, and Application Observability are collected in [Technical references](references.md).

The product hypotheses and maturity model are original analysis in this case study; they should not be presented as claims made by those sources.
