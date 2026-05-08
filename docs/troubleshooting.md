# Troubleshooting Guide

## 1. Containers start but Grafana shows no data

- Confirm the stack is healthy with `docker compose ps`.
- Open Prometheus at `http://localhost:9090/targets` and verify the `app`, `node-exporter`, `cadvisor`, and `blackbox-http` targets are `UP`.
- If only the app target is down, check `docker compose logs app` and verify `http://localhost:3000/metrics` responds.

## 2. Readiness probe remains down

- The sample service intentionally delays readiness for the first 5 seconds to simulate warm-up.
- If it stays red, inspect `docker compose logs app` and `http://localhost:3000/health/ready`.
- A persistent readiness failure will also show up in the `ReadinessProbeFailing` alert.

## 3. cAdvisor or Node Exporter metrics are missing on Docker Desktop

- Run Docker Desktop in Linux container mode.
- On some Windows/macOS environments, host mounts are exposed through the Docker VM rather than the native host, so node-level metrics may represent the Docker VM.
- If cAdvisor fails to start, check whether Docker Desktop is blocking one of the mounted paths and adjust the mounts for your environment.

## 4. Loki receives no logs

- Verify the application is writing structured logs by running `docker compose logs app`.
- Confirm the shared `app_logs` volume is mounted in both `app` and `promtail`.
- Check `docker compose logs promtail` for path or parsing issues.

## 5. Alerts never fire

- Alerts only fire when the corresponding condition is sustained for the configured `for:` duration.
- Use the load test script or intentionally call `/api/error` several times to generate errors.
- Review rules directly in Prometheus under `http://localhost:9090/rules`.

## 6. Dashboard panels show `N/A`

- Wait at least 15-30 seconds after startup for the first scrape intervals to complete.
- Run the load generator so application-specific panels such as latency, error rate, and business events have fresh traffic to display.
- Ensure Grafana datasources are provisioned by checking `Connections -> Data Sources`.
