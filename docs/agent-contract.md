# Agent-Led Instrumentation Contract

## Status

This document proposes a product contract; it is not an implemented OpenTelemetry standard. The example is intentionally vendor-neutral at the application boundary and uses synthetic values. A production format would require schema publication, versioning policy, security review, and compatibility testing.

## Purpose

A coding agent can edit files and run commands quickly, but activity is not proof of a good observability outcome. The contract gives agents and humans a shared definition of:

- what may be discovered;
- what outcome is requested;
- how an instrumentation path is selected;
- which changes are authorized;
- where credentials come from without revealing them;
- which preflight and telemetry checks must pass;
- when the agent must stop or escalate;
- what evidence supports the final result.

The contract is designed around the [useful-observability maturity model](case-study.md#useful-observability-maturity-model). An agent reports the highest level it proves, never the level it intended to reach.

## Contract principles

- **Declarative outcome:** Describe desired signals and quality, not only a list of commands.
- **Evidence over confidence:** A successful build or healthy process is not proof of successful telemetry.
- **Least authority:** Read first; modify only scoped files; use referenced secrets; avoid production mutation by default.
- **One change at a time:** Preserve a causal link between a change and its validation.
- **Idempotence:** Re-running discovery or apply should not duplicate SDK initialization, agents, spans, or configuration blocks.
- **Reversibility:** Record touched files, previous commands, and rollback steps before mutation.
- **Explicit uncertainty:** Use `not_checked` when evidence is unavailable. Never coerce it to `passed`.
- **Secret opacity:** Agents may verify that a secret reference resolves and works, but must not print, persist, summarize, or send the secret value.
- **Human-readable parity:** The machine result and the UI explanation use the same stages and diagnostic codes.

## Proposed contract

The following YAML is illustrative. Secret references are names, not credential values.

```yaml
apiVersion: onboarding.grafana.example/v1alpha1
kind: TelemetryOnboardingPlan
metadata:
  sessionId: demo-session-001
  createdBy: human-with-agent

workload:
  repositoryRoot: .
  serviceEntryPoint: app/server.js
  runtime:
    name: nodejs
    versionConstraint: ">=24"
  deployment:
    type: docker-compose
    environment: local
    production: false

intent:
  targetMaturityLevel: 5
  signals: [traces, metrics, logs]
  operationalQuestion: "Which operation caused the synthetic error?"

instrumentation:
  selectedMode: auto
  allowedModes: [auto, sdk]
  preventDuplicateProviders: true
  selectionReason: "Supported HTTP framework; fast baseline coverage is sufficient"

pipeline:
  localReceiver:
    component: alloy
    protocol: otlphttp
    endpoint: http://alloy:4318
  backend:
    provider: local-lgtm
    endpoint: http://lgtm:4318
    credentials: none
  hostedVariant:
    enabled: false
    provider: grafana-cloud
    endpointFrom: env:GRAFANA_CLOUD_OTLP_ENDPOINT
    credentialFileFrom: env:GRAFANA_CLOUD_API_KEY_FILE

identity:
  expected:
    service.name: checkout-api
    service.namespace: otel-onboarding
    service.version: 1.0.0
    deployment.environment.name: local
  rejectDefaultServiceName: true
  requireCrossSignalConsistency: true

validation:
  probe:
    method: POST
    path: /checkout
    body:
      checkoutId: agent-demo-42
      items:
        - sku: grafana-mug
          quantity: 1
  timeoutSeconds: 120
  receipt:
    requiredSignalChecks:
      - received.traces
      - received.metrics
      - received.logs
    aggregateRule: all_required_signals_confirmed
  gates:
    - configured
    - workload
    - connected
    - received
    - attributed
    - correlated
    - actionable

changePolicy:
  allowedPaths:
    - app/
    - instrumentation/
    - alloy/
    - docker-compose.yml
    - .env.example
  forbiddenPaths:
    - .env
    - "**/*secret*"
  requireApprovalFor:
    - install_dependency
    - change_start_command
    - expose_host_port
    - modify_remote_resource
  allowProductionChanges: false
  requireRollbackPlan: true
```

The real schema should distinguish fields that are user intent, discovered fact, agent proposal, and observed result. An agent must not rewrite a user-owned intent field to make validation pass.

The identity fields in this example are the minimum policy selected for the
reference workload, not universal OpenTelemetry requirements. A production
contract must distinguish semantic-convention fields from product defaults and
customer- or organization-owned policy.

The six top-level onboarding gates remain `configured`, `connected`,
`received`, `attributed`, `correlated`, and `actionable`. Each required signal
declared in `intent.signals` creates a subordinate `received.<signal>` check.
Aggregate `received` passes only when all of those required signal checks pass;
an optional or undeclared signal cannot block the aggregate.

## Capability discovery

Discovery is read-only and precedes a recommendation. It should produce structured facts with provenance:

| Capability | Example evidence | Why it matters |
| --- | --- | --- |
| Runtime and version | package manifest, lockfile, runtime command | Package compatibility and initialization model |
| Framework and libraries | declared and resolved dependencies | Available automatic instrumentation |
| Existing telemetry | SDK imports, startup flags, exporter variables, collector config | Duplicate-provider and conflict prevention |
| Deployment type | Compose, container, process manager, Kubernetes files | Injection and networking choices |
| Logging path | logger dependency, stdout format, existing trace fields | Correlation design |
| Collector availability | config and service definitions | Whether direct export is necessary |
| Test commands | package scripts and CI config | Safe regression checks |
| Repository state | modified files and generated artifacts | Change isolation and rollback |

Every fact should include a source such as `package.json`, an environment-variable name, or a command result. Sensitive values are represented only as `present`, `absent`, or `unreadable`.

Example discovery result:

```json
{
  "runtime": {
    "name": "nodejs",
    "version": "24.21.0",
    "evidence": ["node --version", "package.json#engines"]
  },
  "existingInstrumentation": {
    "state": "not_detected",
    "checked": ["dependencies", "startupCommand", "knownEnvironmentKeys"]
  },
  "collector": {
    "state": "detected",
    "type": "grafana-alloy",
    "evidence": ["docker-compose.yml", "alloy/config.alloy"]
  },
  "secretFiles": {
    "GRAFANA_CLOUD_API_KEY_FILE": "present-and-ignored"
  }
}
```

## Path-selection policy

The agent proposes exactly one primary path and explains the alternatives.

### Prefer automatic instrumentation when

- the runtime and framework are supported by a known compatible package set;
- no conflicting provider or runtime agent is present;
- baseline HTTP, database, and client coverage satisfies the stated intent;
- startup injection is permitted;
- the user values low source-code change over custom domain context.

### Prefer SDK instrumentation when

- the operational question requires domain-specific spans, events, or bounded attributes;
- an unsupported library needs manual boundaries;
- the repository already owns SDK initialization;
- the runtime/deployment model makes automatic injection fragile;
- tests can exercise the initialization and context propagation.

### Prefer collector-only work when

- the workload already emits the required signals;
- the task concerns host, platform, routing, or enrichment rather than missing in-process context;
- source changes are outside the allowed scope.

The agent must stop and request a decision when paths are equally plausible and the choice materially changes source ownership, runtime behavior, cost, or deployment operations.

## Execution protocol

### 1. Discover

- inspect repository and runtime state without modification;
- locate local instructions and permitted commands;
- detect existing instrumentation and configuration sources;
- identify missing authority, tools, credentials, and tests;
- record a redacted baseline.

### 2. Propose

- state the selected path and reasoning;
- list exact files and commands expected to change;
- identify dependency, startup, port, secret-reference, and remote-side effects;
- define rollback;
- name the target maturity level and checks needed to prove it.

### 3. Obtain required approval

Approval is required when the configured policy says so. It is always required for production changes, new billable remote resources, broader credential scope, destructive actions, or access outside the declared repository and test destination.

Approval of a plan is not approval to reveal or persist credentials.

### 4. Preflight

- validate schema and placeholders;
- confirm compatible runtime and packages;
- check for duplicate SDK/agent initialization;
- parse application, Compose, and Alloy configuration;
- verify local endpoint and port assumptions;
- confirm secret references are present without displaying values;
- perform a minimally privileged remote check when authorized;
- report pass, fail, warning, or not checked for every item.

### 5. Apply

- make the smallest coherent change;
- preserve unrelated user edits;
- avoid editing generated or lock files except through the appropriate package tool;
- never write secret values to source or shell history;
- record changed files and commands;
- halt on an unexpected repository state instead of overwriting it.

### 6. Validate progressively

Run gates from nearest to farthest:

| Gate | Required evidence | Maturity contribution |
| --- | --- | --- |
| Configuration | Files parse; one mode is active; no placeholder or duplicate path remains | Level 0 |
| Workload | Service and synthetic route behave as expected | prerequisite |
| In-process telemetry | Expected signal is created with valid context | prerequisite |
| Export connectivity | Every required export boundary is reachable; authentication succeeds wherever authentication applies | Level 1 |
| Backend arrival | Each required `received.<signal>` check finds the expected probe-derived evidence in the selected backend within the bounded window | Level 2 only when all required checks pass |
| Identity | Expected resource identity is observed across implemented signals | Level 3 |
| Correlation | Probe trace and log join; expected span topology exists | Level 4 |
| Usefulness | Defined operational question is answered from the resulting view | Level 5 |

A failed later gate does not invalidate earlier evidence, but the overall outcome is `partial`, not `success`.

### 7. Report and hand off

The agent returns:

- selected path and rationale;
- files and dependencies changed;
- commands run;
- tests and preflight results;
- highest maturity level proven;
- expected-versus-observed identity;
- correlation evidence;
- unresolved warnings and not-checked items;
- rollback steps;
- safe next action and relevant downstream product context.

## Result state model

Overall status is one of:

- `planned`: discovery and plan exist; no authorized mutation occurred;
- `blocked`: a prerequisite or required authority is missing;
- `changed_unverified`: changes were applied but no end-to-end evidence is available;
- `partial`: at least one maturity gate passed and a later required gate failed;
- `success`: every gate through the requested target passed;
- `rolled_back`: attempted changes were reverted and rollback was checked.

`success` must include the target level and evidence timestamps. A process exit code of zero alone cannot produce `success`.

In machine results, the six stage names stay stable. Signal evidence uses the
subordinate keys `received.traces`, `received.metrics`, and `received.logs` for
this workload. The `received` aggregate is derived: it is `passed` only when
every signal in `intent.signals` is confirmed, `failed` when any required
signal fails, and `not_checked` while any required signal remains unchecked.

## Diagnostic envelope

All components should return a common, redacted shape:

```json
{
  "code": "BACKEND_EXPORT_UNREACHABLE",
  "stage": "connected",
  "component": "alloy.exporter",
  "status": "failed",
  "summary": "The local receiver accepted traces, but the selected backend was unreachable.",
  "observed": {
    "localReceiver": "passed",
    "backend": "local-lgtm",
    "backendConnection": "refused"
  },
  "likelyCauses": [
    "the backend container is not ready",
    "the configured backend host or port is incorrect"
  ],
  "nextAction": {
    "type": "check_backend_health_and_endpoint",
    "safeToRetry": true
  },
  "redactionsApplied": []
}
```

### Minimum diagnostic codes

| Code | Meaning | Retry guidance |
| --- | --- | --- |
| `CONFIG_PLACEHOLDER_PRESENT` | A required value still contains an example placeholder | Correct configuration before restart |
| `INSTRUMENTATION_CONFLICT` | Multiple provider or agent paths appear active | Stop; choose one path |
| `LOCAL_RECEIVER_UNREACHABLE` | Application cannot connect to the configured local endpoint | Verify network name, host, port, and protocol |
| `BACKEND_EXPORT_UNREACHABLE` | Local receiver acceptance is proven; export to the selected backend failed | Diagnose backend health, DNS, TLS, host, port, or route |
| `CLOUD_EXPORT_AUTHENTICATION_FAILED` | Local receiver acceptance is proven, but the optional hosted exporter has missing or invalid identity evidence, commonly an observed 401 | Repair the credential reference, then retry with a fresh probe |
| `CLOUD_EXPORT_AUTHORIZATION_DENIED` | Local receiver acceptance is proven, but the authenticated hosted identity lacks permission, commonly an observed 403 | Repair write scopes or policy, then retry with a fresh probe |
| `REQUIRED_SIGNAL_NOT_RECEIVED` | At least one required `received.<signal>` check failed while another may have passed | Name the missing signal and last proven boundary, then rerun that signal check |
| `SERVICE_IDENTITY_MISMATCH` | Observed identity differs from the contract | Show winning source and correct it |
| `CORRELATION_CONTEXT_MISSING` | Expected trace/log context is absent | Inspect the named async/outbound boundary |
| `VALIDATION_TIMEOUT` | Evidence did not arrive within the declared window | Report last proven boundary; do not label as absent forever |
| `VALIDATION_PERMISSION_DENIED` | Agent cannot query the evidence needed to prove success | Request read-only validation access or report unverified |

Diagnostic codes should be stable across UI, CLI, docs, support tooling, and agent APIs. Free-form text may improve without breaking automation.

## Safe-stop and escalation rules

The agent stops before mutation when:

- the target environment may be production and the contract does not explicitly authorize it;
- existing instrumentation is detected but its ownership or compatibility is unclear;
- required changes extend beyond allowed paths;
- credentials would need to be copied into a repository or command output;
- the request implies creating billable resources or expanding credential permissions;
- a package or image cannot be verified from the allowed source;
- the working tree contains overlapping edits that cannot be preserved safely;
- no reversible plan exists for a startup or deployment change.

The agent stops after mutation and reports a partial result when:

- workload behavior regresses;
- a security or sensitive-data check fails;
- the local receiver works but evidence from the selected backend is unavailable;
- identity or correlation differs from the contract;
- validation would require authority not included in the plan;
- the timeout is reached without enough evidence.

It must not “fix” an unexpected production, access, cost, or data-governance decision by assumption.

## Idempotence and rollback

Before applying changes, record:

- repository revision and pre-existing working-tree state;
- files to be created or modified;
- prior start command and dependency state;
- exposed ports and container services;
- runtime configuration keys introduced;
- remote resources, if separately authorized.

A repeated run should detect already-satisfied steps and validate them rather than adding duplicate code. Rollback removes only agent-owned additions and preserves pre-existing or concurrent user work. Secret rotation is a separate action: if exposure is suspected, reverting a file is not sufficient.

## Example final report

```json
{
  "status": "partial",
  "requestedLevel": 5,
  "provenLevel": 1,
  "instrumentationMode": "auto",
  "checks": {
    "configured": "passed",
    "workload": "passed",
    "connected": "passed",
    "received": "failed",
    "received.traces": "passed",
    "received.metrics": "passed",
    "received.logs": "failed",
    "attributed": "not_checked",
    "correlated": "not_checked",
    "actionable": "not_checked"
  },
  "diagnostics": [
    {
      "code": "REQUIRED_SIGNAL_NOT_RECEIVED",
      "signal": "logs",
      "boundary": "backend query"
    }
  ],
  "changedFiles": [
    "docker-compose.yml",
    "instrumentation/auto/register.js"
  ],
  "secretsPersisted": false,
  "rollbackAvailable": true,
  "nextAction": "Inspect the log export path after the last proven boundary, then rerun received.logs and recompute the received aggregate."
}
```

This is a better outcome than a false success. It tells a person exactly what the agent proved and where judgment is still needed.

## Versioning and compatibility

- `apiVersion` changes when field meaning or required behavior changes.
- Additive optional fields remain compatible within an alpha version only when consumers ignore unknown fields safely.
- Agents declare the contract versions and diagnostic codes they understand.
- The product rejects an unsupported required version rather than guessing.
- Observed results are stored separately from user intent so reruns remain auditable.
- Schema fixtures include healthy, partial, conflicted, and secret-redaction cases.

## Evaluation suite

Agent readiness should be evaluated against repositories that contain:

- no existing telemetry;
- a correct SDK setup;
- a partially configured SDK;
- automatic instrumentation already active;
- conflicting SDK and auto paths;
- an unreachable local receiver;
- a partial pipeline in which traces and metrics arrive but required logs do not;
- invalid cloud credentials;
- missing service identity;
- broken async context propagation;
- unrelated uncommitted user changes;
- secret-like strings in fixtures that must never be echoed.

Score the agent on achieved maturity, diagnostic accuracy, unnecessary change, rollback quality, secret handling, and escalation precision—not on number of files edited or speed alone.

## References

Checked official sources for resource attributes, context propagation, OTLP, semantic conventions, the JavaScript SDK, automatic instrumentation, Alloy, local LGTM, and Grafana Cloud are collected in [Technical references](references.md).
