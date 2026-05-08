# Metrics-Based Debugging Workflow

## Scenario 1: API latency spikes

1. Open the `Application Overview` dashboard.
2. Check `P95 Latency` and `Latency Quantiles` to confirm the spike is sustained.
3. Compare `Request Throughput by Route` to see whether the issue is traffic-driven or isolated to one endpoint.
4. Pivot to `Infrastructure Overview` and inspect `Container CPU by Service` and `Container Memory by Service`.
5. If infrastructure looks healthy, open `Logs & Reliability` and filter for `level=error` to inspect request failures around the spike window.

## Scenario 2: Increased 5xx responses

1. Watch the `Error Rate` stat and `Error Rate by Route`.
2. Confirm which route is failing most often.
3. Open `Application Logs` and search for matching `route` and `statusCode=500` entries.
4. Compare `Checkout Events` to see whether failures are affecting business outcomes such as successful orders.

## Scenario 3: Memory pressure inside the container

1. Start from `Infrastructure Overview`.
2. Review `Container Memory by Service` and `Host Memory Trend`.
3. If only the app container is climbing, compare with `app_process_memory_usage_bytes` in Prometheus Explore.
4. Use log timestamps to correlate memory growth with traffic bursts, specific routes, or error storms.

## Suggested operator workflow

- Metrics tell you *that* the system is degrading.
- Probes tell you *whether* users are likely impacted.
- Logs tell you *why* the degradation is happening.
- Alert rules reduce mean time to detection by surfacing the most actionable symptoms first.
