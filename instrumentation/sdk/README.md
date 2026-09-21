# Explicit SDK path

This is the default demonstration mode. `register.js` runs before the server
imports `node:http`, creates OTLP/HTTP exporters for all three signals, installs
HTTP instrumentation, and flushes providers during shutdown.

```bash
npm run start:sdk
```

This path is appropriate when the team needs explicit control over SDK behavior
or domain telemetry. Configuration remains in environment variables so routing
and credentials stay outside application code.
