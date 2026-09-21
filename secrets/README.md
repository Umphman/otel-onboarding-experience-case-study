# Runtime secrets

Keep Grafana Cloud credentials out of Git and out of Compose environment
variables. For an optional hosted proof:

1. Create `secrets/grafana-cloud-api-key.txt` locally.
2. Put only the narrowly scoped, temporary access-policy token in that file,
   with no whitespace or trailing newline.
3. Set `GRAFANA_CLOUD_API_KEY_FILE=./secrets/grafana-cloud-api-key.txt` in the
   ignored `.env.cloud` file.
4. Revoke the token immediately after the bounded Cloud run.

Everything in this directory except this README is ignored by Git.
