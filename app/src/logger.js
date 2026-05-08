import fs from "node:fs";
import path from "node:path";

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const activeLevelName = (process.env.LOG_LEVEL || "info").toLowerCase();
const activeLevel = LEVELS[activeLevelName] ?? LEVELS.info;
const logDir = process.env.LOG_DIR || "/var/log/checkout-service";
const logFile = process.env.LOG_FILE || "application.log";
const logPath = path.join(logDir, logFile);

try {
  fs.mkdirSync(logDir, { recursive: true });
} catch (error) {
  // Continue logging to stdout even if the file sink is unavailable.
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "warn",
    message: "Unable to create log directory, file logging disabled.",
    error: error.message,
  }));
}

function writeToFile(line) {
  try {
    fs.appendFileSync(logPath, `${line}\n`, "utf8");
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "warn",
      message: "Unable to write application log to file.",
      error: error.message,
    }));
  }
}

function log(level, message, context = {}) {
  if ((LEVELS[level] ?? LEVELS.info) < activeLevel) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: process.env.APP_NAME || "checkout-service",
    environment: process.env.APP_ENV || process.env.NODE_ENV || "development",
    message,
    ...context,
  };

  const serialized = JSON.stringify(entry);
  process.stdout.write(`${serialized}\n`);
  writeToFile(serialized);
}

export const logger = {
  debug(message, context) {
    log("debug", message, context);
  },
  info(message, context) {
    log("info", message, context);
  },
  warn(message, context) {
    log("warn", message, context);
  },
  error(message, context) {
    log("error", message, context);
  },
};
