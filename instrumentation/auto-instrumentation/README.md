# Node.js automatic-instrumentation comparison path

This mode preloads the upstream OpenTelemetry Node.js automatic-instrumentation
register before the unchanged application starts. The SDK, exporters, resource
detection, and module hooks are configured from environment variables.

```bash
docker compose -f docker-compose.yml -f instrumentation/auto-instrumentation/compose.override.yml up --build
```

Use this path to test the quickest supported baseline. Compare it with
`instrumentation/sdk/register.js`, which constructs the NodeSDK and exporters
explicitly. Do not preload both modes in one process.

The application still contains OpenTelemetry API calls for its domain spans,
metrics, and log records. Automatic here describes SDK bootstrap and library
instrumentation; it does not pretend that meaningful business semantics appear
without application knowledge.
