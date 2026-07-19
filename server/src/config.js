"use strict";

const path = require("node:path");

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function parseInteger(value, fallback, name, min, max) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseOrigins(value, mode) {
  const origins = (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (mode !== "disabled" && origins.length === 0) {
    throw new ConfigError("ALLOWED_ORIGINS is required while checkout is active.");
  }

  const unique = new Set();
  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ConfigError(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
    if (parsed.origin !== origin || parsed.username || parsed.password) {
      throw new ConfigError(`ALLOWED_ORIGINS entries must be exact origins without paths: ${origin}`);
    }
    if (mode === "live" && parsed.protocol !== "https:") {
      throw new ConfigError("Every live ALLOWED_ORIGINS entry must use HTTPS.");
    }
    unique.add(origin);
  }
  return unique;
}

function loadConfig(env = process.env, overrides = {}) {
  const mode = env.PAYPAL_ENV || "disabled";
  if (!new Set(["disabled", "sandbox", "live"]).has(mode)) {
    throw new ConfigError("PAYPAL_ENV must be exactly disabled, sandbox, or live.");
  }
  if (mode === "live") {
    throw new ConfigError(
      "Live checkout is intentionally blocked: a production order-store adapter has not been selected or implemented."
    );
  }

  const active = mode !== "disabled";
  const clientId = env.PAYPAL_CLIENT_ID || "";
  const clientSecret = env.PAYPAL_CLIENT_SECRET || "";
  const webhookId = env.PAYPAL_WEBHOOK_ID || "";
  const expectedMerchantId = env.PAYPAL_EXPECTED_MERCHANT_ID || "";
  const expectedMerchantEmail = (env.PAYPAL_EXPECTED_MERCHANT_EMAIL || "").toLowerCase();
  const createEnabled = env.CHECKOUT_CREATE_ENABLED === "true";
  const allowedOrigins = parseOrigins(env.ALLOWED_ORIGINS, mode);

  if (active && (!clientId || !clientSecret)) {
    throw new ConfigError("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required while checkout is active.");
  }
  if (expectedMerchantId && !/^[2-9A-HJ-NP-Z]{13}$/.test(expectedMerchantId)) {
    throw new ConfigError("PAYPAL_EXPECTED_MERCHANT_ID is invalid.");
  }
  if (expectedMerchantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedMerchantEmail)) {
    throw new ConfigError("PAYPAL_EXPECTED_MERCHANT_EMAIL is invalid.");
  }

  const defaultDataDir = path.resolve(__dirname, "..", "data");
  const dataDir = path.resolve(env.ORDER_DATA_DIR || defaultDataDir);
  const paypalBaseUrl =
    overrides.paypalBaseUrl ||
    (mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

  return Object.freeze({
    mode,
    active,
    port: parseInteger(env.PORT, 8787, "PORT", 1, 65535),
    trustProxy: env.TRUST_PROXY === "1" ? 1 : false,
    allowedOrigins,
    clientId,
    clientSecret,
    webhookId,
    expectedMerchantId,
    expectedMerchantEmail,
    createEnabled,
    dataDir,
    paypalBaseUrl,
    paypalTimeoutMs: parseInteger(env.PAYPAL_TIMEOUT_MS, 8000, "PAYPAL_TIMEOUT_MS", 1000, 30000),
    paypalMaxRetries: parseInteger(env.PAYPAL_MAX_RETRIES, 1, "PAYPAL_MAX_RETRIES", 0, 2),
    checkoutRateLimit: parseInteger(env.CHECKOUT_RATE_LIMIT, 30, "CHECKOUT_RATE_LIMIT", 5, 300),
    webhookRateLimit: parseInteger(env.WEBHOOK_RATE_LIMIT, 120, "WEBHOOK_RATE_LIMIT", 10, 1000),
    rateWindowMs: 60_000,
  });
}

module.exports = {
  ConfigError,
  loadConfig,
};
