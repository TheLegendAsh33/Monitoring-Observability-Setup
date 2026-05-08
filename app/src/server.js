import http from "node:http";
import { URL } from "node:url";
import { logger } from "./logger.js";
import { createMetricsRegistry } from "./metrics.js";

const appName = process.env.APP_NAME || "checkout-service";
const appVersion = process.env.APP_VERSION || "1.0.0";
const environment = process.env.APP_ENV || process.env.NODE_ENV || "development";
const port = Number(process.env.APP_PORT || "3000");
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || "900000");
const configuredErrorRatePercent = Number(process.env.ERROR_RATE_PERCENT || "8");

const { registry, metrics, updateRuntimeMetrics } = createMetricsRegistry();
const activeUsers = new Map();
const activeSessions = new Map();
const bootDelayMs = 5_000;
const startedAt = Date.now();

function jsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function textResponse(response, statusCode, body, contentType = "text/plain; version=0.0.4; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function getRouteName(pathname) {
  if (pathname === "/") {
    return "/";
  }

  const knownRoutes = [
    "/api/catalog",
    "/api/checkout",
    "/api/error",
    "/api/sessions",
    "/health/live",
    "/health/ready",
    "/metrics",
  ];

  return knownRoutes.includes(pathname) ? pathname : "unmatched";
}

function pruneExpiredSessions() {
  const now = Date.now();

  for (const [userId, lastSeenAt] of activeUsers.entries()) {
    if (now - lastSeenAt > sessionTtlMs) {
      activeUsers.delete(userId);
    }
  }

  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.lastSeenAt > sessionTtlMs) {
      activeSessions.delete(sessionId);
    }
  }

  metrics.activeUsersGauge.set({}, activeUsers.size);
  metrics.activeSessionsGauge.set({}, activeSessions.size);
}

function identifyUser(requestUrl, headers) {
  return requestUrl.searchParams.get("user") || headers["x-user-id"] || "anonymous";
}

function refreshSession(userId, headers) {
  const sessionId = headers["x-session-id"] || `${userId}-session`;
  const now = Date.now();
  activeUsers.set(userId, now);
  activeSessions.set(sessionId, { userId, lastSeenAt: now });
  pruneExpiredSessions();
  return sessionId;
}

function sampleLatency(baseMs = 80, spreadMs = 500) {
  return baseMs + Math.floor(Math.random() * spreadMs);
}

function shouldReturnError(overridePercent) {
  const errorRate = Number.isFinite(overridePercent) ? overridePercent : configuredErrorRatePercent;
  return Math.random() * 100 < Math.max(0, Math.min(errorRate, 100));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isReady() {
  return Date.now() - startedAt >= bootDelayMs;
}

async function routeRequest(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  const pathname = requestUrl.pathname;
  const method = request.method || "GET";
  const route = getRouteName(pathname);
  const startedAtMs = performance.now();
  let statusCode = 200;
  let userId = "anonymous";

  try {
    pruneExpiredSessions();
    userId = identifyUser(requestUrl, request.headers);
    refreshSession(userId, request.headers);

    if (method === "GET" && pathname === "/") {
      return jsonResponse(response, 200, {
        service: appName,
        version: appVersion,
        environment,
        endpoints: [
          "/api/catalog",
          "/api/checkout",
          "/api/error",
          "/api/sessions",
          "/health/live",
          "/health/ready",
          "/metrics",
        ],
      });
    }

    if (method === "GET" && pathname === "/health/live") {
      return jsonResponse(response, 200, {
        status: "up",
        uptimeSeconds: Number(process.uptime().toFixed(2)),
        timestamp: new Date().toISOString(),
      });
    }

    if (method === "GET" && pathname === "/health/ready") {
      const ready = isReady();
      statusCode = ready ? 200 : 503;
      updateRuntimeMetrics(ready);
      return jsonResponse(response, statusCode, {
        status: ready ? "ready" : "starting",
        ready,
        timestamp: new Date().toISOString(),
      });
    }

    if (method === "GET" && pathname === "/metrics") {
      updateRuntimeMetrics(isReady());
      return textResponse(response, 200, registry.render());
    }

    if (method === "GET" && pathname === "/api/catalog") {
      const simulatedLatency = sampleLatency(30, 180);
      await delay(simulatedLatency);
      metrics.businessEventsTotal.inc({ event_type: "catalog_view" });
      return jsonResponse(response, 200, {
        items: [
          { sku: "SKU-1001", name: "Wireless Mouse", price: 24.99 },
          { sku: "SKU-1002", name: "Mechanical Keyboard", price: 89.0 },
          { sku: "SKU-1003", name: "Noise-Cancelling Headset", price: 129.99 },
        ],
        user: userId,
        latencyMs: simulatedLatency,
      });
    }

    if (method === "POST" && pathname === "/api/checkout") {
      const simulatedLatency = sampleLatency(100, 700);
      await delay(simulatedLatency);
      const forceError = requestUrl.searchParams.get("forceError") === "true";
      const failed = forceError || shouldReturnError(configuredErrorRatePercent);

      if (failed) {
        statusCode = 500;
        metrics.businessEventsTotal.inc({ event_type: "checkout_failure" });
        logger.error("Checkout failed for order submission.", {
          route: pathname,
          method,
          userId,
          statusCode,
          latencyMs: simulatedLatency,
        });
        return jsonResponse(response, statusCode, {
          status: "error",
          message: "Checkout could not be completed due to a transient upstream issue.",
        });
      }

      metrics.businessEventsTotal.inc({ event_type: "checkout_success" });
      return jsonResponse(response, 201, {
        status: "accepted",
        orderId: `ORD-${Date.now()}`,
        user: userId,
        latencyMs: simulatedLatency,
      });
    }

    if (method === "GET" && pathname === "/api/error") {
      const simulatedLatency = sampleLatency(20, 60);
      await delay(simulatedLatency);
      statusCode = 500;
      metrics.businessEventsTotal.inc({ event_type: "synthetic_error" });
      logger.error("Synthetic error endpoint invoked.", {
        route: pathname,
        method,
        userId,
        statusCode,
        latencyMs: simulatedLatency,
      });
      return jsonResponse(response, statusCode, {
        status: "error",
        message: "This endpoint intentionally returns an error for alert testing.",
      });
    }

    if (method === "GET" && pathname === "/api/sessions") {
      return jsonResponse(response, 200, {
        activeUsers: activeUsers.size,
        activeSessions: activeSessions.size,
        sessionTtlMs,
      });
    }

    statusCode = 404;
    return jsonResponse(response, statusCode, {
      status: "not_found",
      message: `Route ${pathname} is not implemented.`,
    });
  } catch (error) {
    statusCode = 500;
    metrics.logEventsTotal.inc({ level: "error" });
    logger.error("Unhandled application error.", {
      route,
      method,
      statusCode,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(response, statusCode, {
      status: "error",
      message: "Unexpected server error.",
    });
  } finally {
    const durationSeconds = Number(((performance.now() - startedAtMs) / 1000).toFixed(6));
    const normalizedStatus = response.statusCode || statusCode;
    metrics.httpRequestsTotal.inc({ method, route, status_code: normalizedStatus });
    metrics.httpRequestDurationSeconds.observe(
      { method, route, status_code: normalizedStatus },
      durationSeconds
    );

    if (normalizedStatus >= 400) {
      metrics.httpErrorsTotal.inc({ method, route, status_code: normalizedStatus });
    }

    metrics.logEventsTotal.inc({ level: normalizedStatus >= 500 ? "error" : "info" });
    logger.info("HTTP request served.", {
      route,
      method,
      userId,
      statusCode: normalizedStatus,
      durationMs: Number((durationSeconds * 1000).toFixed(2)),
      activeUsers: activeUsers.size,
      activeSessions: activeSessions.size,
    });
  }
}

const server = http.createServer((request, response) => {
  routeRequest(request, response);
});

setInterval(() => {
  pruneExpiredSessions();
  updateRuntimeMetrics(isReady());
}, 15_000).unref();

server.listen(port, "0.0.0.0", () => {
  logger.info("Checkout service started.", {
    port,
    appName,
    appVersion,
    environment,
    sessionTtlMs,
    configuredErrorRatePercent,
  });
});

process.on("SIGTERM", () => {
  logger.warn("SIGTERM received, shutting down HTTP server.");
  server.close(() => {
    logger.info("HTTP server stopped cleanly.");
    process.exit(0);
  });
});
