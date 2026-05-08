import os from "node:os";

function sanitizeLabelValue(value) {
  return String(value ?? "unknown").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function serializeLabels(labels = {}) {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return "";
  }

  const serialized = entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${sanitizeLabelValue(value)}"`)
    .join(",");

  return `{${serialized}}`;
}

function bucketKey(boundary) {
  return Number.isFinite(boundary) ? String(boundary) : "+Inf";
}

class CounterMetric {
  constructor({ name, help, labelNames = [] }) {
    this.name = name;
    this.help = help;
    this.type = "counter";
    this.labelNames = labelNames;
    this.values = new Map();
  }

  inc(labels = {}, amount = 1) {
    const key = serializeLabels(labels);
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current + amount);
  }

  render() {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} ${this.type}`,
    ];

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
      return lines.join("\n");
    }

    for (const [labels, value] of this.values.entries()) {
      lines.push(`${this.name}${labels} ${value}`);
    }

    return lines.join("\n");
  }
}

class GaugeMetric {
  constructor({ name, help, labelNames = [] }) {
    this.name = name;
    this.help = help;
    this.type = "gauge";
    this.labelNames = labelNames;
    this.values = new Map();
  }

  set(labels = {}, value = 0) {
    const key = serializeLabels(labels);
    this.values.set(key, value);
  }

  inc(labels = {}, amount = 1) {
    const key = serializeLabels(labels);
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current + amount);
  }

  dec(labels = {}, amount = 1) {
    this.inc(labels, amount * -1);
  }

  render() {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} ${this.type}`,
    ];

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
      return lines.join("\n");
    }

    for (const [labels, value] of this.values.entries()) {
      lines.push(`${this.name}${labels} ${value}`);
    }

    return lines.join("\n");
  }
}

class HistogramMetric {
  constructor({ name, help, labelNames = [], buckets = [0.05, 0.1, 0.25, 0.5, 1, 2, 5] }) {
    this.name = name;
    this.help = help;
    this.type = "histogram";
    this.labelNames = labelNames;
    this.buckets = [...buckets].sort((left, right) => left - right);
    this.values = new Map();
  }

  observe(labels = {}, value = 0) {
    const labelKey = serializeLabels(labels);
    let entry = this.values.get(labelKey);
    if (!entry) {
      entry = {
        buckets: new Map(this.buckets.map((bucket) => [bucketKey(bucket), 0])),
        count: 0,
        sum: 0,
        labels,
      };
      entry.buckets.set("+Inf", 0);
      this.values.set(labelKey, entry);
    }

    for (const bucket of this.buckets) {
      if (value <= bucket) {
        const key = bucketKey(bucket);
        entry.buckets.set(key, (entry.buckets.get(key) ?? 0) + 1);
      }
    }

    entry.buckets.set("+Inf", (entry.buckets.get("+Inf") ?? 0) + 1);
    entry.count += 1;
    entry.sum += value;
  }

  render() {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} ${this.type}`,
    ];

    if (this.values.size === 0) {
      lines.push(`${this.name}_bucket{le="+Inf"} 0`);
      lines.push(`${this.name}_sum 0`);
      lines.push(`${this.name}_count 0`);
      return lines.join("\n");
    }

    for (const entry of this.values.values()) {
      for (const bucket of [...this.buckets.map((item) => bucketKey(item)), "+Inf"]) {
        lines.push(
          `${this.name}_bucket${serializeLabels({ ...entry.labels, le: bucket })} ${entry.buckets.get(bucket) ?? 0}`
        );
      }
      lines.push(`${this.name}_sum${serializeLabels(entry.labels)} ${entry.sum}`);
      lines.push(`${this.name}_count${serializeLabels(entry.labels)} ${entry.count}`);
    }

    return lines.join("\n");
  }
}

class MetricsRegistry {
  constructor() {
    this.metrics = [];
    this.startTime = Date.now();
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuCheckAt = process.hrtime.bigint();
    this.cpuCount = os.cpus().length || 1;
  }

  counter(config) {
    const metric = new CounterMetric(config);
    this.metrics.push(metric);
    return metric;
  }

  gauge(config) {
    const metric = new GaugeMetric(config);
    this.metrics.push(metric);
    return metric;
  }

  histogram(config) {
    const metric = new HistogramMetric(config);
    this.metrics.push(metric);
    return metric;
  }

  collectRuntimeMetrics() {
    const memoryUsage = process.memoryUsage();
    const currentCpuUsage = process.cpuUsage();
    const currentCheckAt = process.hrtime.bigint();
    const cpuDeltaMicros =
      currentCpuUsage.user +
      currentCpuUsage.system -
      (this.lastCpuUsage.user + this.lastCpuUsage.system);
    const elapsedNanos = Number(currentCheckAt - this.lastCpuCheckAt);
    const elapsedSeconds = elapsedNanos / 1_000_000_000;

    const cpuPercent =
      elapsedSeconds > 0
        ? (cpuDeltaMicros / 1_000_000) / (elapsedSeconds * this.cpuCount) * 100
        : 0;

    this.lastCpuUsage = currentCpuUsage;
    this.lastCpuCheckAt = currentCheckAt;

    return {
      cpuPercent: Number(cpuPercent.toFixed(2)),
      memoryUsage,
      uptimeSeconds: process.uptime(),
    };
  }

  render() {
    return `${this.metrics.map((metric) => metric.render()).join("\n\n")}\n`;
  }
}

export function createMetricsRegistry() {
  const registry = new MetricsRegistry();

  const httpRequestsTotal = registry.counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests served by the application.",
    labelNames: ["method", "route", "status_code"],
  });

  const httpErrorsTotal = registry.counter({
    name: "http_errors_total",
    help: "Total number of HTTP requests resulting in an error response.",
    labelNames: ["method", "route", "status_code"],
  });

  const httpRequestDurationSeconds = registry.histogram({
    name: "http_request_duration_seconds",
    help: "Latency histogram for HTTP requests.",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  });

  const activeUsersGauge = registry.gauge({
    name: "app_active_users",
    help: "Current number of distinct active users observed within the TTL window.",
  });

  const activeSessionsGauge = registry.gauge({
    name: "app_active_sessions",
    help: "Current number of active sessions tracked by the application.",
  });

  const readinessGauge = registry.gauge({
    name: "app_readiness_status",
    help: "Readiness status of the service, where 1 means ready.",
  });

  const runtimeGauge = registry.gauge({
    name: "app_process_cpu_usage_percent",
    help: "Approximate percentage of CPU consumed by the Node.js process.",
  });

  const memoryGauge = registry.gauge({
    name: "app_process_memory_usage_bytes",
    help: "Current process memory usage by memory area.",
    labelNames: ["type"],
  });

  const uptimeGauge = registry.gauge({
    name: "app_uptime_seconds",
    help: "Application uptime in seconds.",
  });

  const businessEventsTotal = registry.counter({
    name: "app_business_events_total",
    help: "Business-level events emitted by the sample checkout workflow.",
    labelNames: ["event_type"],
  });

  const logEventsTotal = registry.counter({
    name: "app_log_events_total",
    help: "Total number of structured log events emitted by the application.",
    labelNames: ["level"],
  });

  function updateRuntimeMetrics(isReady = true) {
    const { cpuPercent, memoryUsage, uptimeSeconds } = registry.collectRuntimeMetrics();
    runtimeGauge.set({}, cpuPercent);
    memoryGauge.set({ type: "rss" }, memoryUsage.rss);
    memoryGauge.set({ type: "heap_used" }, memoryUsage.heapUsed);
    memoryGauge.set({ type: "heap_total" }, memoryUsage.heapTotal);
    memoryGauge.set({ type: "external" }, memoryUsage.external);
    uptimeGauge.set({}, uptimeSeconds);
    readinessGauge.set({}, isReady ? 1 : 0);
  }

  updateRuntimeMetrics(true);

  return {
    registry,
    metrics: {
      httpRequestsTotal,
      httpErrorsTotal,
      httpRequestDurationSeconds,
      activeUsersGauge,
      activeSessionsGauge,
      readinessGauge,
      runtimeGauge,
      memoryGauge,
      uptimeGauge,
      businessEventsTotal,
      logEventsTotal,
    },
    updateRuntimeMetrics,
  };
}
