# Product Recommendations

## Recommendation in one sentence

Turn onboarding from a sequence of copy-paste instructions into a verified journey that recommends an instrumentation path, validates each boundary, proves telemetry quality with a known request, and hands the user directly into an operational workflow.

These recommendations are hypotheses based on the synthetic reference implementation. They require customer research and product data before broad rollout.

The default reference path exercises the journey against a credential-free
local LGTM stack. An end-to-end setup run is recorded in the [runtime
verification record](evidence/runtime-verification.md); two volume-clean reruns,
isolated failure recovery, and curated captures remain publication gates.
Grafana Cloud is an optional hosted variant, so cloud authentication
recommendations are evaluated separately from the local path.

## Desired outcome

The product should help a developer or coding agent reach **useful observability**: correctly attributed, correlated telemetry that answers a real operational question. “The backend received a payload” is an intermediate state, not the outcome.

The shared maturity sequence is:

- pre-state: uninstrumented;
- Level 0: configured;
- Level 1: connected;
- Level 2: received;
- Level 3: attributed;
- Level 4: correlated;
- Level 5: actionable;
- Level 6: operationalized.

Definitions and acceptance evidence are in [case-study.md](case-study.md#useful-observability-maturity-model).

`Connected` means every required export boundary is reachable and
authentication succeeds wherever authentication applies. `Received` remains one of the six
top-level onboarding states, with subordinate `received.traces`,
`received.metrics`, and `received.logs` checks for this reference workload. The
aggregate state passes only when every signal required by the contract is
confirmed.

## Product principles

1. **Recommend, then explain.** Give a clear default path and make its assumptions, tradeoffs, and rollback visible.
2. **Validate near the source of failure.** Detect malformed configuration before restart, transport failure before a backend search, and identity failure before a user navigates away.
3. **Show expected versus observed.** “No data” is not a diagnosis.
4. **Make quality a first-class state.** Arrival, attribution, correlation, and usefulness are distinct.
5. **Use one contract for people and agents.** Human copy, CLI output, APIs, and agent workflows should describe the same stages and errors.
6. **Preserve user control.** An agent may make reversible repository changes, but it should disclose them, protect secrets, and stop when authority or evidence is missing.
7. **End in the product, not the wizard.** Successful onboarding should open a useful service context and a specific next action.

## Priority opportunities

### 1. Environment-aware path recommendation

**Problem:** Users are asked to choose among SDK, automatic instrumentation, and collector-based paths before they understand the differences.

**Proposal:** Add a lightweight discovery step that detects runtime, framework, package manager, deployment environment, existing instrumentation, and collector availability. Recommend one path with:

- the evidence used;
- expected coverage;
- required code and runtime changes;
- known limitations;
- rollback steps;
- reasons the alternatives were not selected.

The user can change the choice, but the product should not present equally weighted options when it has enough context to recommend one.

**Agent requirement:** Return the recommendation as structured data with confidence and unresolved checks. Never activate SDK and automatic instrumentation together without an explicit compatibility rule.

**Success signal:** More users accept an appropriate recommendation and fewer restart onboarding through a different path after a failed attempt.

### 2. Declarative onboarding contract

**Problem:** Critical inputs are scattered across documentation, UI snippets, shell state, and collector configuration. Humans lose provenance; agents guess.

**Proposal:** Represent the intended result as a versioned contract:

- workload and runtime;
- chosen instrumentation mode;
- signal goals, each mapped to a signal-specific receipt check;
- local receiver and transport;
- required resource identity;
- secret references, never secret values;
- expected validation probe;
- success gates;
- supported rollback.

The product can render this contract as a checklist for a person and expose it as JSON or YAML for a coding agent. A proposed format and behavior are in [agent-contract.md](agent-contract.md).

The identity attributes in the reference contract are an opinionated minimum
for this workload, not a claim that every OpenTelemetry deployment must require
the same set. The contract should distinguish semantic standards, product
defaults, and customer or organization policy.

**Success signal:** Higher completion rate across sessions and fewer configuration-source conflicts.

### 3. Preflight checks before workload restart

**Problem:** Many deterministic errors appear only after a user restarts the service and waits for data.

**Proposal:** Validate as much as possible before mutation or restart:

- endpoint parses and uses an allowed scheme;
- target host and port are reachable where a safe check is possible;
- credentials are present through a secret reference;
- required write permissions can be tested without displaying the credential;
- configuration syntax is valid;
- local port conflicts are identified;
- required packages and runtime versions are compatible;
- existing SDK initialization or agent injection will not conflict;
- resource attributes are neither missing nor obvious placeholders.

Preflight output should separate **pass**, **fail**, **warning**, and **not checked**. “Not checked” must not be rendered as success.

**Success signal:** A larger share of failures are resolved before restart, and median recovery time falls.

### 4. Boundary-aware diagnostics

**Problem:** “No data received” forces the user to inspect every component.

**Proposal:** Model the route as a diagnostic graph:

```text
workload → instrumentation → local receiver → processor/exporter → backend ingest → query/index
```

Errors should identify:

- the last proven boundary;
- the first unproven boundary;
- the observed error category;
- the relevant component and safe configuration key;
- one concrete next test;
- whether retry is safe;
- a stable diagnostic code that UI, CLI, docs, support, and agents share.

For example, an unreachable local backend should not be presented as “the application emitted no spans.” The application-to-Alloy hop may be healthy even when Alloy-to-backend export is not. In the optional hosted path, cloud authentication is another distinct boundary.

**Success signal:** Higher first-recommendation resolution and lower time spent switching among logs, docs, and product screens.

### 5. End-to-end verification with a known probe

**Problem:** Component health and payload receipt cannot prove that telemetry is correctly attributed or correlated.

**Proposal:** Generate or guide the user through a synthetic request with a bounded validation marker. Query for its expected evidence:

- service and environment identity;
- expected entry and child spans;
- a structured log associated with the trace;
- a predictable request metric change;
- arrival within a stated time window.

Show a maturity result rather than a single success banner:

```text
Configured ✓  Connected ✓  Received ✕  Attributed —  Correlated —  Actionable —
                              received.traces ✓  received.metrics ✓  received.logs ✕
```

The failed gate should link directly to evidence and the next diagnostic action.
The receipt aggregate must not hide partial delivery: in the example, traces
and metrics arrived but logs did not. A user may continue with a warning, but
the product should not label the setup complete.

**Success signal:** More onboarded services reach Levels 4 and 5, and fewer activated users later report unknown services or disconnected signals.

### 6. Service-identity linting

**Problem:** Valid telemetry often arrives with `unknown_service`, inconsistent environment values, or different resources per signal.

**Proposal:** Treat service identity like a schema:

- compare expected and observed values;
- detect defaults, empty values, and likely high-cardinality identities;
- show which configuration layer won;
- compare resource identity across traces, metrics, and logs;
- allow organization policy to supply owned attributes without silently hiding application errors;
- preview the service label that will appear in navigation.

Identity linting should run both at configuration time and against observed data.

**Success signal:** Lower unknown-service rate and higher cross-signal identity consistency.

### 7. Contextual activation handoff

**Problem:** Onboarding often ends just before the product becomes useful.

**Proposal:** After Level 5 is proven, open the appropriate downstream experience with:

- service, environment, and time range preselected;
- the validation trace or exemplar in context;
- an explanation of what the current instrumentation covers;
- one next action matched to the workload, such as reviewing errors, defining an SLO, or enabling a platform integration;
- an honest indication of remaining maturity work.

The destination could be Application Observability, Kubernetes Monitoring, or another experience. The choice should derive from discovered workload context, not a generic upsell.

**Success signal:** Increased meaningful downstream use within seven days, without a corresponding increase in ingest surprise or alert churn.

## Error-design standard

Every onboarding error should answer four questions:

1. **What was attempted?** Name the signal and boundary without exposing sensitive values.
2. **What was observed?** Include status category, timestamp, and component-level evidence.
3. **What is the likely cause?** Distinguish fact from inference.
4. **What should happen next?** Provide one safe action and a deterministic recheck.

Example:

> Traces reached the local Alloy receiver, but the selected backend was unreachable. Confirm that the backend is healthy and that Alloy uses the expected host and port. Re-run backend export validation after correcting the endpoint.

For the optional hosted path, an authorization error should instead name the rejected cloud-export boundary, point to the credential reference and required write scope, and keep the credential value redacted.

Avoid messages that blame the wrong component, expose full URLs containing credentials, or recommend repeatedly restarting the entire stack.

## Measurement strategy

### North-star metric: time to useful telemetry

**Time to useful telemetry (TTUT)** is elapsed time from the moment the user confirms an intent to instrument a named workload to the moment the system verifies correctly attributed, correlated telemetry that answers a predefined operating question in the intended downstream experience.

Report median and 75th percentile by runtime, deployment type, instrumentation path, prior product experience, and human-led versus agent-led session. Also report the share of started sessions that never reach Level 5; excluding abandoned sessions would make the metric look artificially healthy.

The start is not a documentation page view, and the stop is not a generic data-ingest event. Sessions that abandon, require manual support, or roll back remain in the funnel rather than disappearing from TTUT reporting.

### Funnel

| Event | Meaning | Required properties |
| --- | --- | --- |
| `onboarding_started` | User or agent begins a scoped setup | anonymous session, workload class, runtime, deployment type |
| `path_recommended` | Product proposes an instrumentation path | path, reasons, confidence, conflicts found |
| `plan_accepted` | User authorizes the proposed change | selected path, overridden recommendation flag |
| `preflight_completed` | Local and remote checks finish | pass/fail/not-checked counts, diagnostic codes |
| `pipeline_connected` | Level 1 proven across every required export boundary | route topology, selected destination, authentication class, elapsed time |
| `first_signal_received` | A leading receipt milestone, not Level 2 completion | selected backend, signal, elapsed time |
| `required_signal_received` | One `received.<signal>` sub-check is proven | selected backend, signal, elapsed time, validation method |
| `all_required_signals_received` | Aggregate Level 2 is proven | required-signal set, elapsed time, validation window |
| `identity_verified` | Level 3 proven | mismatch categories, not raw attribute values |
| `correlation_verified` | Level 4 proven | signal pairs verified |
| `useful_view_opened` | Level 5 proven | destination experience, operational question class |
| `onboarding_abandoned` | Session ends or expires before target | last proven gate, diagnostic category |

Do not send credentials, endpoint query strings, source code, raw service names, log bodies, trace IDs, or customer payloads as product analytics.

### Supporting metrics

| Metric | Why it matters |
| --- | --- |
| Recommendation acceptance and override rate | Tests whether path guidance is credible |
| Preflight catch rate | Measures failures prevented before restart |
| Time to first data | Preserves transport speed as a useful leading indicator |
| Required-signal receipt completeness | Exposes partial pipelines that deliver some required signals but not others |
| Level 1 → Level 2, Level 2 → Level 3, and Level 3 → Level 4 conversion | Exposes delivery and quality loss hidden by connection-only metrics |
| Unknown/default service rate | Measures attribution quality |
| Cross-signal identity consistency | Measures whether signals can share a service context |
| Diagnostic first-action resolution rate | Tests error actionability |
| Median attempts and restarts per successful setup | Captures friction |
| Agent autonomous completion rate | Measures routine work completed without intervention |
| Agent escalation precision | Penalizes both unnecessary escalation and unsafe guessing |
| Seven-day downstream activation | Tests whether setup produces continuing value |

### Guardrails

- telemetry volume and estimated cost introduced by defaults;
- application startup time and latency overhead;
- crash or rollback rate after instrumentation changes;
- credential exposure or sensitive-data incidents;
- duplicate-span and duplicate-metric rate;
- high-cardinality attribute/label detection;
- false-positive validation rate;
- alert or dashboard abandonment after automatic activation;
- support contacts per completed onboarding.
- manual-support intervention rate;
- configuration rollback rate and time to restore after failed setup;
- unsafe or unauthorized agent-generated change rate.

No recommendation should be declared successful if it improves completion by weakening security, increasing unexpected cost, or accepting malformed telemetry.

## Experiment plan

| Hypothesis | Test | Primary measure | Guardrail |
| --- | --- | --- | --- |
| Recommended paths reduce decision friction | Compare guided recommendation with an equal-choice selector | plan acceptance and TTUT | override-related failures |
| Preflight reduces recovery time | Introduce preflight for selected runtimes | restarts and time to resolution | false blocks |
| Maturity states improve quality | Compare arrival-only completion with staged verification | Level 4/5 conversion | added abandonment and duration |
| Expected-versus-observed diagnostics improve trust | Usability test on endpoint and identity failures | correct first action | accidental secret exposure |
| Agent contract enables safe autonomy | Give humans and agents the same synthetic setup tasks | autonomous Level 5 completion | unauthorized changes and false success |

Initial experiments should use synthetic or dedicated test stacks. Customer-facing experiments need privacy review, opt-out behavior, and clear data retention.

## Roadmap

### Phase 0 — Instrument the onboarding journey

**Goal:** Establish a trustworthy baseline.

- define the maturity model and canonical diagnostic taxonomy;
- instrument the funnel with privacy-safe events;
- measure current TTUT, abandonment, and unknown-service rate;
- review support cases and observe onboarding sessions;
- identify two high-volume runtime/deployment combinations.

**Exit criterion:** The team can explain where users stop and distinguish transport failures from identity and correlation failures.

### Phase 1 — Make the common path diagnosable

**Goal:** Remove avoidable setup loops for one supported path.

- ship environment discovery and one opinionated recommendation;
- add configuration and credential preflight;
- expose boundary-specific health and stable diagnostic codes;
- lint service identity;
- document reversible changes and rollback.

**Exit criterion:** The selected cohort shows fewer restarts and a material improvement in median and p75 time to Level 3 without guardrail regression.

### Phase 2 — Verify telemetry quality

**Goal:** Move the definition of activation from arrival to correlation and usefulness.

- add the known-request validator;
- present the maturity result in UI and machine-readable form;
- expose receipt status for each required signal and derive the Level 2 aggregate;
- verify cross-signal resource consistency and trace/log linkage;
- route successful users into a pre-filtered service experience;
- keep unresolved gates visible after handoff.

**Exit criterion:** A meaningful majority of successful setups reach Level 5, and manual review confirms a low false-positive rate.

### Phase 3 — Enable agent-led onboarding

**Goal:** Let coding agents complete routine cases safely.

- publish the versioned agent contract and capability discovery;
- support dry-run, explicit patch summaries, deterministic checks, and rollback;
- expose structured diagnostic results and retryability;
- define human-approval and escalation boundaries;
- evaluate across repositories with and without existing instrumentation.

**Exit criterion:** Agents complete eligible synthetic and pilot setups at Level 5 with no material increase in unsafe changes, secret handling incidents, or false success.

### Phase 4 — Scale across ecosystems

**Goal:** Generalize only after the state model is proven.

- add languages and deployment types based on volume and failure data;
- integrate organization policy for identity and routing;
- personalize activation for application, infrastructure, and Kubernetes journeys;
- add continuous drift detection for identity, correlation, and export health.

**Exit criterion:** New integrations reuse the same maturity and diagnostic contracts rather than inventing incompatible onboarding flows.

## Prioritization

The recommended order is deliberate:

1. measurement and diagnostic taxonomy;
2. path recommendation and preflight;
3. identity and end-to-end verification;
4. activation handoff;
5. agent autonomy;
6. ecosystem breadth.

Automating an ambiguous workflow first would make errors faster and less visible. Building more integrations first would multiply inconsistent experiences. The shared state and error model are foundational product infrastructure.

## Open product questions

- Which runtime/deployment combinations account for the most starts, failures, and strategic value?
- What exact evidence best predicts seven-day retention and successful incident use?
- Which cloud permission test is both safe and sufficiently representative?
- How long should validation wait for each signal before distinguishing latency from failure?
- Which identity attributes are organization-owned versus application-owned?
- When may an agent modify source or deployment configuration without a separate approval?
- Which downstream destination produces the clearest first operational win for each workload type?
- How should the product price or explain telemetry generated by validation and default instrumentation?

These are discovery questions, not gaps to fill with invented certainty. The reference implementation provides a controlled environment in which to test them.

## References

Checked official sources for Node.js automatic and SDK instrumentation, resource identity, context propagation, Alloy diagnostics, OTLP ingestion, the local LGTM image, and Application Observability are collected in [Technical references](references.md).

The prioritization, metrics, experiments, and roadmap above are product recommendations from this case study, not statements of Grafana’s current roadmap.
