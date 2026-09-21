# Image Evidence Guide

This directory is reserved for public-safe visual evidence for the case study.
Images are evidence, not decoration: every screenshot must prove one claim that
a reviewer can understand from the credential-free local LGTM demonstration.
Optional Grafana Cloud captures may supplement, but should not replace, that
reproducible evidence.

**Current status:** no Docker, Alloy, Grafana, or Grafana Cloud capture has been
observed or committed. Every filename below is a plan until the exact result is
produced by one of the clean runs in the [demo runbook](../../DEMO.md).

Do not commit a screenshot until the implementation has produced the state it
depicts. Never fabricate product UI or use a mockup where the caption claims a
live result. `Observed` means the capture came from the recorded run;
`Expected` means the result is still a hypothesis. Never relabel expected
behavior as observed without the underlying counter, query, or UI result.

## Planned image set

| File | Claim it should prove | Required visible evidence | Suggested alt text |
| --- | --- | --- | --- |
| `01-alloy-receipt.png` | Each required signal traversed the Alloy pipeline | For traces, metrics, and logs: receiver accepted/refused delta, evidence after the configured processors, exporter sent/failed delta, and the matching backend query; include the component graph for topology, not as delivery proof | “Signal-specific Alloy receiver, processor, and exporter evidence for the synthetic checkout run.” |
| `02-service-identity.png` | Resource attribution is intentional and consistent | `service.name=checkout-api`, `service.namespace=otel-onboarding`, version, local environment, and bounded time range | “Verified OpenTelemetry resource identity for checkout-api in the local environment.” |
| `03-correlated-trace.png` | A known checkout produced the expected connected trace | Checkout entry span, inventory work, duration, and service identity | “Connected trace for a synthetic checkout and its inventory work.” |
| `04-correlated-log.png` | A structured checkout log can be joined to the same trace | Synthetic log event and matching trace context, with identifiers redacted if necessary | “Synthetic checkout log correlated with its originating trace.” |
| `05-checkout-metrics.png` | Metrics answer whether checkouts are healthy | Request rate, deterministic error count or rate, latency distribution, intended service identity, and bounded run window | “Checkout request, error, and latency metrics for the bounded synthetic run.” |
| `06-operating-answer.png` | The combined telemetry explains the known failure | The metric change plus the failing operation or validation evidence that answers both declared operating questions | “Correlated telemetry showing checkout health and the cause of the known synthetic failure.” |
| `07-failure-diagnosis.png` | A deliberate bad endpoint produces an actionable diagnosis | Healthy workload, failing export boundary, diagnostic category, and remediation context | “Bad OTLP endpoint diagnosis identifying the failed export hop while checkout-api remains healthy.” |
| `08-recovered-state.png` | Recovery restores useful telemetry rather than only component health | A probe created after the fix, renewed export and backend receipt, intended service identity, connected checkout/inventory trace, and correlated log | “Fresh checkout telemetry received, attributed, and correlated after the OTLP endpoint was restored.” |

This is the canonical evidence list and matches [the demo
runbook](../../DEMO.md#evidence-capture-checklist). If the Alloy counters are
not legible in one image, preserve same-run source captures as
`01a-alloy-traces.png`, `01b-alloy-metrics.png`, and `01c-alloy-logs.png`; the
three files jointly support claim 01 and must share one run ID and bounded
window. The final README should link an approximately three-minute walkthrough
captured from the same verified commit. An optional `architecture-overview.svg`
may explain the design, but it is not runtime proof.

## Required evidence groups

### Healthy state

The healthy set must show the application health result separately from
telemetry delivery. It must then show all three signal paths, intended service
identity, checkout/inventory trace topology, same-trace structured log, and the
request/error/duration metrics used to answer “Are checkouts healthy?”

### Failure state

The failure capture must identify the deliberate change, show what remains
healthy, expose the exact failed boundary or state, preserve the actual
sanitized error, and show enough context to support the diagnosis. Do not crop
away a warning that changes the interpretation. A predicted 401/403, connection
error, fallback service name, or split trace is not evidence until it appears.

### Recovered state

Recovery requires a probe created after the fix. The evidence must re-establish
receiver acceptance, processor handling, exporter send, backend query result,
intended identity, and trace/log correlation. A green graph, stopped error log,
or old backend record is insufficient.

The final set should come from a completed clean run and should be cross-checked
against the second volume-clean run. If evidence is captured across runs, the
caption must identify the run for each image; do not imply they are one event.

## Capture procedure

1. Complete Phase 0 of the [demo runbook](../../DEMO.md#phase-0-prepare-a-clean-attributable-run) and assign a run ID.
2. Use a dedicated demonstration stack containing only synthetic services and traffic.
3. Complete the first volume-clean startup; record a unique healthy probe ID.
4. Capture receiver → processor → exporter → backend evidence separately for traces, metrics, and logs.
5. Select the narrowest time range that clearly contains the probe.
6. Set filters explicitly to the synthetic service and the run's declared
   environment (`local` for the default stack, `demo` for the Cloud variant).
7. Capture only the panel or product region needed to prove the claim.
8. Reset to healthy before the selected failure, then use unique failure and recovery probes.
9. Complete the second volume-clean run and repeat the per-signal proof before calling the result reproducible.
10. Record the provenance fields below in a local capture log.
11. Review the full-resolution image for sensitive text before adding it to Git.
12. Write a concise caption that states what to inspect and why it matters.
13. Verify the Markdown image and alt text from a clean repository checkout.

If a screenshot is updated, re-run the scenario. Do not simply change its caption to match new claims.

## Capture provenance record

Record this metadata for every image and the video. The public caption may use a
sanitized subset, but the verification record must retain enough information to
reproduce the claim.

| Field | Required value |
| --- | --- |
| Evidence status | `Observed locally` or `Observed in Grafana Cloud`; never just `Expected` |
| Filename and claim | Canonical filename plus one falsifiable sentence |
| Run and probe | Clean-run ID and unique probe ID |
| Source | Commit SHA and confirmation that the checkout was clean |
| Time | Capture timestamp, UTC offset, named timezone, and bounded query window |
| Runtime | OS, Node, Docker Desktop/Engine/Compose versions |
| Images | Application image ID and Alloy/LGTM tag plus digest |
| Route | Exact Compose files, instrumentation path, scenario, and local/Cloud destination |
| Surface | Alloy component/telemetry view or Grafana data source and panel |
| Query | Exact sanitized query, labels, and filters used |
| Outcome | Actual counts, state, status, or sanitized error visible |
| Safety review | Reviewer/date and confirmation that no secret or private identifier is visible |

For `01-alloy-receipt.png` and any `01a`–`01c` source captures, also record this
matrix in the [verification
record](../evidence/runtime-verification.md#observed-alloy-to-backend-evidence):

| Signal | Receiver accepted/refused | Processor handled/refused or dropped | Exporter sent/failed | Backend result |
| --- | --- | --- | --- | --- |
| Traces | Pending — unobserved | Pending — unobserved | Pending — unobserved | Pending — unobserved |
| Metrics | Pending — unobserved | Pending — unobserved | Pending — unobserved | Pending — unobserved |
| Logs | Pending — unobserved | Pending — unobserved | Pending — unobserved | Pending — unobserved |

Use the actual metric names and before/after values exposed by the pinned Alloy
version. Do not guess counter names or use a component graph as a substitute.

## Approximately three-minute walkthrough

The video should use the same source SHA and one of the documented run IDs:

- **0:00–0:30:** product problem—application health and first receipt do not
  establish useful telemetry.
- **0:30–1:00:** workload → Alloy → backend architecture and the onboarding
  maturity states.
- **1:00–1:40:** healthy proof—three-signal pipeline, service identity, complete
  trace, correlated log, and useful metric.
- **1:40–2:30:** one deterministic failure, highest validated state, diagnosis,
  remediation, and fresh-probe recovery.
- **2:30–3:00:** product conclusion—evidence, stable error, and safest next
  action rather than a generic “data received” message.

Do not splice unrelated runs into one narrative. Show the commit and timestamp,
and do not link the recording until its claims match the verification record.

## Public-safety review

Before committing any image, verify that it contains none of the following:

- API keys, bearer tokens, basic-auth headers, cookies, or secret references that reveal values;
- Grafana Cloud stack, tenant, organization, account, billing, or user identifiers;
- browser profile details, email addresses, local usernames, filesystem paths, or terminal history;
- real hostnames, IP addresses, repository URLs, user data, portfolio data, or request payloads;
- proprietary employer, client, or source-code information;
- private interview prompts or confidential interview materials;
- unrelated browser tabs, notifications, bookmarks, extensions, or desktop content.

Cropping is preferred when it preserves the evidence. Use opaque redaction when cropping cannot remove a sensitive field. Blur is not sufficient for secrets because it can be reversible or leave recognizable structure. If a credential ever appears in a capture, rotate it even if the image is deleted.

## Accuracy and presentation

- Keep native product colors; do not recolor a result to imply a different status.
- Do not splice separate runs into one screenshot.
- Do not hide warnings that materially change the interpretation.
- Use callouts sparingly and keep an unannotated source capture outside the public repository if provenance is needed.
- Keep font sizes legible at the width used in the README.
- Prefer PNG for UI screenshots and SVG for the authored architecture diagram.
- Remove redundant empty chrome while retaining enough context to identify the product surface.
- Use consistent dimensions where before/after images are paired.
- Optimize file size without reducing text legibility.

## Captions should state evidence, not celebration

Good:

> The synthetic request appears under `checkout-api` in `local`; the checkout trace and correlated log share the same request context.

Weak:

> It works!

For a failure image, name the intentionally injected fault and the diagnostic behavior being evaluated. Readers should never mistake a staged failure for the default state.

## Repository hygiene

- Use lowercase, hyphenated filenames matching the inventory.
- Keep only final public-safe images in this directory.
- Do not store raw screen recordings, credential-bearing captures, or alternate screenshots here.
- Re-check all images before making the repository public.
- If product UI changes invalidate an image, remove or replace it rather than presenting stale evidence.
- Attribute third-party visual assets and confirm their license; the preferred architecture diagram is authored within this repository.

## Current status

The filenames above are a capture plan. No Docker, Alloy, Grafana, or Grafana
Cloud screenshot or video is currently claimed. Their presence must not be
claimed in public-facing documentation until the corresponding files exist,
match a completed verification record, and pass the safety review.
