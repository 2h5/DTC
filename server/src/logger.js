"use strict";

const SENSITIVE_KEY = /(authorization|secret|token|signature|payer|email|phone|address|shipping|name)/i;
const ALLOWED_LEVELS = new Set(["info", "warn", "error"]);

function sanitize(value, key = "", depth = 0) {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (depth > 3) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 256);
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitize(entry, key, depth + 1));
  if (value && typeof value === "object") {
    const clean = {};
    for (const childKey of Object.keys(value).sort()) clean[childKey] = sanitize(value[childKey], childKey, depth + 1);
    return clean;
  }
  return String(value).slice(0, 128);
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function createLogger(options = {}) {
  const sink = options.sink || process.stdout;
  const clock = options.clock || (() => new Date());

  function write(level, event, context = {}) {
    if (!ALLOWED_LEVELS.has(level)) throw new TypeError("Invalid log level.");
    const record = sanitize({ timestamp: clock().toISOString(), level, event, ...context });
    sink.write(`${stableStringify(record)}\n`);
  }

  return Object.freeze({
    info(event, context) {
      write("info", event, context);
    },
    warn(event, context) {
      write("warn", event, context);
    },
    error(event, context) {
      write("error", event, context);
    },
  });
}

function createSilentLogger() {
  return Object.freeze({ info() {}, warn() {}, error() {} });
}

module.exports = { createLogger, createSilentLogger, sanitize, stableStringify };
