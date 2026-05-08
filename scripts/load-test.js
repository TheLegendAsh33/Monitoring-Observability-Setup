const targetBaseUrl = process.env.TARGET_URL || "http://localhost:3000";
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || "8");
const durationSeconds = Number(process.env.LOAD_TEST_DURATION_SECONDS || "60");
const checkoutWeight = Number(process.env.LOAD_TEST_CHECKOUT_WEIGHT || "0.45");
const errorWeight = Number(process.env.LOAD_TEST_ERROR_WEIGHT || "0.10");

const users = ["alex", "sam", "jordan", "taylor", "morgan", "casey", "ash", "jamie"];
const stats = {
  startedAt: Date.now(),
  totalRequests: 0,
  successResponses: 0,
  errorResponses: 0,
  networkErrors: 0,
  latenciesMs: [],
};

function percentile(values, quantile) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * quantile));
  return sorted[index];
}

function chooseRequestPath(iteration) {
  const random = Math.random();
  const user = users[iteration % users.length];

  if (random < errorWeight) {
    return `/api/error?user=${user}`;
  }

  if (random < errorWeight + checkoutWeight) {
    return `/api/checkout?user=${user}`;
  }

  return `/api/catalog?user=${user}`;
}

async function invokeRequest(workerId, iteration) {
  const path = chooseRequestPath(iteration);
  const method = path.startsWith("/api/checkout") ? "POST" : "GET";
  const startedAt = performance.now();

  try {
    const response = await fetch(`${targetBaseUrl}${path}`, {
      method,
      headers: {
        "x-user-id": users[(workerId + iteration) % users.length],
        "x-session-id": `worker-${workerId}-session`,
      },
    });

    const latencyMs = performance.now() - startedAt;
    stats.totalRequests += 1;
    stats.latenciesMs.push(latencyMs);

    if (response.ok) {
      stats.successResponses += 1;
    } else {
      stats.errorResponses += 1;
    }
  } catch (error) {
    stats.totalRequests += 1;
    stats.networkErrors += 1;
    stats.latenciesMs.push(performance.now() - startedAt);
    console.error(`Worker ${workerId} request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function worker(workerId, stopAt) {
  let iteration = 0;

  while (Date.now() < stopAt) {
    await invokeRequest(workerId, iteration);
    iteration += 1;
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 200)));
  }
}

async function run() {
  const stopAt = Date.now() + durationSeconds * 1000;
  console.log(`Starting load test against ${targetBaseUrl} with concurrency=${concurrency} for ${durationSeconds}s`);

  await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index + 1, stopAt)));

  const elapsedSeconds = (Date.now() - stats.startedAt) / 1000;
  const requestsPerSecond = stats.totalRequests / elapsedSeconds;

  console.log("");
  console.log("Load test summary");
  console.log("-----------------");
  console.log(`Total requests : ${stats.totalRequests}`);
  console.log(`Successful     : ${stats.successResponses}`);
  console.log(`Error responses: ${stats.errorResponses}`);
  console.log(`Network errors : ${stats.networkErrors}`);
  console.log(`Avg RPS        : ${requestsPerSecond.toFixed(2)}`);
  console.log(`p50 latency    : ${percentile(stats.latenciesMs, 0.50).toFixed(2)} ms`);
  console.log(`p95 latency    : ${percentile(stats.latenciesMs, 0.95).toFixed(2)} ms`);
  console.log(`p99 latency    : ${percentile(stats.latenciesMs, 0.99).toFixed(2)} ms`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
