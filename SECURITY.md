# Security and public-data policy

This project is intentionally synthetic. It must not contain production source
code, customer or portfolio data, access tokens, API keys, private interview
materials, or screenshots with account identifiers.

Use `.env.cloud` only for the Grafana Cloud endpoint, instance ID, bounded-load
settings, and the path to a secret file. Put the temporary token itself in the
ignored `secrets/` directory so Compose mounts it only into Alloy. Before a
public push, run:

```bash
git grep -n -I -E '(glc_|api[_-]?key|access[_-]?token|password)'
git diff --cached
```

If a credential is committed, revoke it first. Removing it from the latest
commit does not remove it from Git history.
